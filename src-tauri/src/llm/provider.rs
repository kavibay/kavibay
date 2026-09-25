//! Endpoint, request body and SSE dialect per provider — the streaming half of
//! what `catalog` lists. Which provider serves a model is the catalog's answer;
//! this module only knows how to talk to each one.

use crate::credentials::{ResolveError, ResolvedCredential};
use crate::llm::catalog::LlmProvider;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatImage {
    pub media_type: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub images: Vec<ChatImage>,
}

/// One completed item decoded from a provider's event stream.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SseParseItem {
    Text(String),
    /// Provider reported a mid-stream failure (Anthropic `event: error`).
    Failure(String),
    Done,
}

/// Whether a one-purpose transform should run at `effort: "low"`.
///
/// Every model the catalog lists effort levels for accepts it; Haiku 4.5 lists
/// none because it rejects the field. Thinking is left on: low effort is what
/// keeps a transform fast, and switching thinking off can leak internal tags
/// into text that is pasted straight into someone's document.
fn runs_at_low_effort(model: &str) -> bool {
    crate::llm::catalog::find_model(model)
        .is_some_and(|def| def.effort_levels.iter().any(|level| level == "low"))
}

/// Output cap for a single transform. Anthropic requires `max_tokens`, and on
/// the models that think by default it caps thinking and answer together.
/// Streamed, so a generous cap costs nothing unless it is used.
const MAX_OUTPUT_TOKENS: u32 = 16000;

/// The streaming half of a provider, kept next to the SSE parser that reads its
/// replies rather than next to the catalog that lists its models.
impl LlmProvider {
    /// Chat-completion endpoint. Cloudflare puts account and model in the path.
    pub fn endpoint(self, credential: &ResolvedCredential, model: &str) -> Result<String, String> {
        Ok(match self {
            LlmProvider::Anthropic => "https://api.anthropic.com/v1/messages".to_string(),
            LlmProvider::Openai => "https://api.openai.com/v1/chat/completions".to_string(),
            LlmProvider::Cloudflare => format!(
                "https://api.cloudflare.com/client/v4/accounts/{}/ai/run/{}",
                credential
                    .require_field("accountId")
                    .map_err(|error: ResolveError| error.to_string())?,
                model.trim_start_matches('/')
            ),
        })
    }

    /// Non-secret headers the provider requires. The key itself is attached by
    /// the credential type's declared injection.
    pub fn extra_headers(self) -> &'static [(&'static str, &'static str)] {
        match self {
            LlmProvider::Anthropic => &[("anthropic-version", "2023-06-01")],
            LlmProvider::Openai | LlmProvider::Cloudflare => &[],
        }
    }

    /// Streaming request body in the provider's own message shape.
    pub fn body(self, model: &str, messages: &[ChatMessage]) -> Result<Value, String> {
        match self {
            // Anthropic takes `system` as a top-level field, not a message.
            LlmProvider::Anthropic => {
                if messages
                    .iter()
                    .any(|message| message.role == "system" && !message.images.is_empty())
                {
                    return Err("system_images_not_supported".into());
                }
                let system = messages
                    .iter()
                    .filter(|message| message.role == "system")
                    .map(|message| message.content.as_str())
                    .collect::<Vec<_>>()
                    .join("\n\n");
                let turns: Vec<Value> = messages
                    .iter()
                    .filter(|message| message.role != "system")
                    .map(|message| message_value(message, self))
                    .collect::<Result<_, _>>()?;

                let mut body = json!({
                    "model": model,
                    "max_tokens": MAX_OUTPUT_TOKENS,
                    "stream": true,
                    "messages": turns,
                });
                if !system.is_empty() {
                    body["system"] = json!(system);
                }
                if runs_at_low_effort(model) {
                    body["output_config"] = json!({ "effort": "low" });
                }
                Ok(body)
            }
            LlmProvider::Openai => Ok(json!({
                "model": model,
                "stream": true,
                "messages": messages
                    .iter()
                    .map(|message| message_value(message, self))
                    .collect::<Result<Vec<_>, _>>()?,
            })),
            // Workers AI takes the model in the URL, not the body.
            LlmProvider::Cloudflare => Ok(json!({
                "stream": true,
                "messages": messages
                    .iter()
                    .map(|message| message_value(message, self))
                    .collect::<Result<Vec<_>, _>>()?,
            })),
        }
    }

    /// Decode one `data:` payload into a stream item, or `None` to skip it.
    pub fn parse_sse_data(self, data: &str) -> Option<SseParseItem> {
        if data == "[DONE]" {
            return Some(SseParseItem::Done);
        }
        let value: Value = serde_json::from_str(data).ok()?;
        match self {
            LlmProvider::Anthropic => match value.get("type")?.as_str()? {
                "content_block_delta" => value
                    .pointer("/delta/text")
                    .and_then(Value::as_str)
                    .filter(|text| !text.is_empty())
                    .map(|text| SseParseItem::Text(text.to_string())),
                // A declined or cut-off answer still ends with `message_stop`;
                // only this event says so. Read as done, a quick action would
                // paste the partial text over the selection as if it were whole.
                "message_delta" => match value.pointer("/delta/stop_reason")?.as_str()? {
                    "refusal" => Some(SseParseItem::Failure(
                        "The model declined this request.".into(),
                    )),
                    "max_tokens" => Some(SseParseItem::Failure(
                        "The answer was cut off at the output limit.".into(),
                    )),
                    _ => None,
                },
                "message_stop" => Some(SseParseItem::Done),
                "error" => Some(SseParseItem::Failure(
                    value
                        .pointer("/error/message")
                        .and_then(Value::as_str)
                        .unwrap_or("Anthropic reported a stream error")
                        .to_string(),
                )),
                _ => None,
            },
            LlmProvider::Openai => value
                .pointer("/choices/0/delta/content")
                .and_then(Value::as_str)
                .filter(|text| !text.is_empty())
                .map(|text| SseParseItem::Text(text.to_string())),
            LlmProvider::Cloudflare => value
                .get("response")
                .and_then(Value::as_str)
                .filter(|text| !text.is_empty())
                .map(|text| SseParseItem::Text(text.to_string()))
                .or_else(|| {
                    // Newer Workers AI models speak OpenAI's delta shape on the
                    // same `/ai/run` stream.
                    value
                        .pointer("/choices/0/delta/content")
                        .and_then(Value::as_str)
                        .filter(|text| !text.is_empty())
                        .map(|text| SseParseItem::Text(text.to_string()))
                }),
        }
    }
}

const IMAGE_TYPES: &[&str] = &["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_IMAGE_BYTES: usize = 4 * 1024 * 1024;
const MAX_IMAGES_PER_MESSAGE: usize = 6;

fn message_value(message: &ChatMessage, provider: LlmProvider) -> Result<Value, String> {
    if message.images.is_empty() {
        return Ok(json!({ "role": message.role, "content": message.content }));
    }
    if provider == LlmProvider::Cloudflare {
        return Err("images_not_supported".into());
    }
    Ok(json!({
        "role": message.role,
        "content": image_content(&message.content, &message.images, provider)?,
    }))
}

fn image_content(text: &str, images: &[ChatImage], provider: LlmProvider) -> Result<Value, String> {
    if images.len() > MAX_IMAGES_PER_MESSAGE {
        return Err("too_many_images".into());
    }
    let mut blocks = Vec::with_capacity(images.len() + 1);
    for image in images {
        if !IMAGE_TYPES.contains(&image.media_type.as_str()) {
            return Err(format!("unsupported_image_type:{}", image.media_type));
        }
        if image.data.is_empty() {
            return Err("empty_image".into());
        }
        if image.data.contains("base64,") {
            return Err("image_data_has_prefix".into());
        }
        if decoded_len(&image.data) > MAX_IMAGE_BYTES {
            return Err("image_too_large".into());
        }
        blocks.push(match provider {
            LlmProvider::Anthropic => json!({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": image.media_type,
                    "data": image.data,
                },
            }),
            LlmProvider::Openai => json!({
                "type": "image_url",
                "image_url": {
                    "url": format!("data:{};base64,{}", image.media_type, image.data),
                },
            }),
            LlmProvider::Cloudflare => unreachable!(),
        });
    }
    blocks.push(json!({ "type": "text", "text": text }));
    Ok(Value::Array(blocks))
}

fn decoded_len(data: &str) -> usize {
    let padding = data.bytes().rev().take_while(|byte| *byte == b'=').count();
    // Saturating: "==" is more padding than data, and a plain subtraction
    // panicked the stream task, which then never reported an error.
    (data.len().saturating_mul(3) / 4).saturating_sub(padding)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn messages() -> Vec<ChatMessage> {
        vec![
            ChatMessage {
                role: "system".into(),
                content: "Translate.".into(),
                images: Vec::new(),
            },
            ChatMessage {
                role: "user".into(),
                content: "Hallo".into(),
                images: Vec::new(),
            },
        ]
    }

    /// Anthropic rejects a `system` role inside `messages`.
    #[test]
    fn anthropic_lifts_system_out_of_the_message_list() {
        let body = LlmProvider::Anthropic
            .body("claude-haiku-4-5", &messages())
            .unwrap();
        assert_eq!(body["system"], "Translate.");
        assert_eq!(body["messages"].as_array().unwrap().len(), 1);
        assert_eq!(body["messages"][0]["role"], "user");
        assert_eq!(body["max_tokens"], MAX_OUTPUT_TOKENS);
    }

    /// Thinking/effort only for the models that accept them.
    #[test]
    fn anthropic_tunes_only_the_models_that_support_it() {
        let haiku = LlmProvider::Anthropic
            .body("claude-haiku-4-5", &messages())
            .unwrap();
        assert!(haiku.get("thinking").is_none());
        assert!(haiku.get("output_config").is_none());

        for model in ["claude-sonnet-5", "claude-opus-5", "claude-fable-5"] {
            let body = LlmProvider::Anthropic.body(model, &messages()).unwrap();
            assert!(body.get("thinking").is_none(), "{model} keeps thinking on");
            assert_eq!(
                body["output_config"]["effort"], "low",
                "{model} runs at low effort"
            );
        }
    }

    #[test]
    fn openai_and_cloudflare_keep_the_plain_message_list() {
        let openai = LlmProvider::Openai
            .body("gpt-4o-mini", &messages())
            .unwrap();
        assert_eq!(openai["messages"].as_array().unwrap().len(), 2);
        assert_eq!(openai["model"], "gpt-4o-mini");

        let cloudflare = LlmProvider::Cloudflare
            .body("@cf/meta/llama-3.2-1b-instruct", &messages())
            .unwrap();
        assert_eq!(cloudflare["messages"].as_array().unwrap().len(), 2);
        // Workers AI reads the model from the URL.
        assert!(cloudflare.get("model").is_none());
    }

    #[test]
    fn padding_only_image_data_does_not_panic() {
        let message = ChatMessage {
            role: "user".into(),
            content: "?".into(),
            images: vec![ChatImage {
                media_type: "image/png".into(),
                data: "==".into(),
            }],
        };
        assert!(LlmProvider::Openai.body("gpt-4o-mini", &[message]).is_ok());
    }

    #[test]
    fn image_messages_use_each_provider_shape() {
        let messages = vec![ChatMessage {
            role: "user".into(),
            content: "What is this?".into(),
            images: vec![ChatImage {
                media_type: "image/png".into(),
                data: "QUJD".into(),
            }],
        }];
        let anthropic = LlmProvider::Anthropic
            .body("claude-haiku-4-5", &messages)
            .unwrap();
        assert_eq!(
            anthropic["messages"][0]["content"][0]["source"]["media_type"],
            "image/png"
        );
        let openai = LlmProvider::Openai.body("gpt-4o-mini", &messages).unwrap();
        assert_eq!(
            openai["messages"][0]["content"][0]["image_url"]["url"],
            "data:image/png;base64,QUJD"
        );
        assert_eq!(
            LlmProvider::Cloudflare.body("@cf/meta/llama-3.2-1b-instruct", &messages),
            Err("images_not_supported".into())
        );
    }

    /// A refusal or a cut-off answer is a failure, never a finished paste.
    #[test]
    fn a_declined_or_cut_off_answer_is_not_done() {
        let delta = |reason: &str| {
            LlmProvider::Anthropic.parse_sse_data(&format!(
                r#"{{"type":"message_delta","delta":{{"stop_reason":"{reason}"}},"usage":{{"output_tokens":3}}}}"#
            ))
        };
        assert!(matches!(delta("refusal"), Some(SseParseItem::Failure(_))));
        assert!(matches!(
            delta("max_tokens"),
            Some(SseParseItem::Failure(_))
        ));
        assert_eq!(
            delta("end_turn"),
            None,
            "a normal end still waits for message_stop"
        );
    }

    #[test]
    fn each_provider_decodes_its_own_delta_shape() {
        assert_eq!(
            LlmProvider::Anthropic.parse_sse_data(
                r#"{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}"#
            ),
            Some(SseParseItem::Text("Hi".into()))
        );
        assert_eq!(
            LlmProvider::Anthropic.parse_sse_data(r#"{"type":"message_stop"}"#),
            Some(SseParseItem::Done)
        );
        assert_eq!(
            LlmProvider::Openai.parse_sse_data(r#"{"choices":[{"delta":{"content":"Hi"}}]}"#),
            Some(SseParseItem::Text("Hi".into()))
        );
        assert_eq!(
            LlmProvider::Cloudflare.parse_sse_data(r#"{"response":"Hi"}"#),
            Some(SseParseItem::Text("Hi".into()))
        );
        assert_eq!(
            LlmProvider::Cloudflare.parse_sse_data(r#"{"choices":[{"delta":{"content":"Hi"}}]}"#),
            Some(SseParseItem::Text("Hi".into()))
        );
        for provider in [
            LlmProvider::Anthropic,
            LlmProvider::Openai,
            LlmProvider::Cloudflare,
        ] {
            assert_eq!(provider.parse_sse_data("[DONE]"), Some(SseParseItem::Done));
        }
    }

    /// Role/ping/usage frames must not be mistaken for content.
    #[test]
    fn non_text_frames_are_skipped() {
        assert!(LlmProvider::Anthropic
            .parse_sse_data(r#"{"type":"ping"}"#)
            .is_none());
        assert!(LlmProvider::Anthropic
            .parse_sse_data(
                r#"{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"x"}}"#
            )
            .is_none());
        assert!(LlmProvider::Openai
            .parse_sse_data(r#"{"choices":[{"delta":{"role":"assistant"}}]}"#)
            .is_none());
    }

    #[test]
    fn anthropic_error_frames_surface_their_message() {
        assert_eq!(
            LlmProvider::Anthropic
                .parse_sse_data(r#"{"type":"error","error":{"message":"overloaded"}}"#),
            Some(SseParseItem::Failure("overloaded".into()))
        );
    }
}
