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

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub role: String,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub images: Vec<ChatImage>,
    /// An assistant turn exactly as `llm:turn` delivered it, sent back
    /// verbatim. Claude's thinking blocks and their signatures must reach the
    /// provider unchanged in a tool loop, so a turn is never rebuilt from parts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub native: Option<Value>,
    /// Role `"tool"`: the call this result answers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(default)]
    pub is_error: bool,
}

/// One tool a chat round may call, in the host's neutral shape.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolDef {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

/// `None` keeps the tools declared but stops the model calling them: the way
/// to force a final answer once the history holds a tool call, where dropping
/// `tools` is a 400.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ToolChoice {
    #[default]
    Auto,
    None,
}

/// One completed item decoded from a provider's event stream.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SseParseItem {
    Text(String),
    /// Provider reported a mid-stream failure (Anthropic `event: error`).
    Failure(String),
    Done,
    /// Anthropic opened a content block: its `content_block` object as sent.
    /// Text blocks open here too, so the assembler knows where text goes.
    BlockStart(Value),
    /// A fragment for the last opened block that is not answer text:
    /// `thinking_delta`, `signature_delta` or `input_json_delta`, as sent.
    BlockDelta(Value),
    /// OpenAI `delta.tool_calls`: fragments of one or more calls, by index.
    ToolCallDeltas(Vec<Value>),
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

    /// Models whose tool calls this endpoint can stream. Astra and 6.1 Sol
    /// require Responses; Workers AI's stream is unverified (Linear KAV-18).
    pub fn supports_tools(self, model: &str) -> bool {
        match self {
            LlmProvider::Anthropic => true,
            LlmProvider::Openai => !matches!(model, "gpt-6-astra" | "gpt-6.1-sol"),
            LlmProvider::Cloudflare => false,
        }
    }

    /// Streaming request body in the provider's own message shape, plus the
    /// tools a chat round may call. No tools adds nothing, so a plain request
    /// sends exactly what it sent before tools existed.
    pub fn body_with_tools(
        self,
        model: &str,
        messages: &[ChatMessage],
        tools: &[ToolDef],
        tool_choice: ToolChoice,
    ) -> Result<Value, String> {
        if !tools.is_empty() && !self.supports_tools(model) {
            return Err("tools_not_supported".into());
        }
        let mut body = match self {
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

                let mut body = json!({
                    "model": model,
                    "max_tokens": MAX_OUTPUT_TOKENS,
                    "stream": true,
                    "messages": anthropic_turns(messages)?,
                });
                if !system.is_empty() {
                    body["system"] = json!(system);
                }
                if runs_at_low_effort(model) {
                    body["output_config"] = json!({ "effort": "low" });
                }
                body
            }
            LlmProvider::Openai => json!({
                "model": model,
                "stream": true,
                "messages": messages
                    .iter()
                    .map(|message| message_value(message, self))
                    .collect::<Result<Vec<_>, _>>()?,
            }),
            // Workers AI takes the model in the URL, not the body.
            LlmProvider::Cloudflare => json!({
                "stream": true,
                "messages": messages
                    .iter()
                    .map(|message| message_value(message, self))
                    .collect::<Result<Vec<_>, _>>()?,
            }),
        };
        if tools.is_empty() {
            return Ok(body);
        }
        if self == LlmProvider::Anthropic {
            body["tools"] = tools
                .iter()
                .map(|tool| {
                    json!({
                        "name": tool.name,
                        "description": tool.description,
                        "input_schema": tool.input_schema,
                    })
                })
                .collect();
            if tool_choice == ToolChoice::None {
                body["tool_choice"] = json!({ "type": "none" });
            }
        } else {
            // GPT-6 Sol/Luna reject Chat Completions tools with default reasoning.
            if matches!(model, "gpt-6-sol" | "gpt-6-luna") {
                body["reasoning_effort"] = json!("none");
            }
            body["tools"] = tools
                .iter()
                .map(|tool| {
                    json!({
                        "type": "function",
                        "function": {
                            "name": tool.name,
                            "description": tool.description,
                            "parameters": tool.input_schema,
                        },
                    })
                })
                .collect();
            if tool_choice == ToolChoice::None {
                body["tool_choice"] = json!("none");
            }
        }
        Ok(body)
    }

    /// Decode one `data:` payload into a stream item, or `None` to skip it.
    pub fn parse_sse_data(self, data: &str) -> Option<SseParseItem> {
        if data == "[DONE]" {
            return Some(SseParseItem::Done);
        }
        let value: Value = serde_json::from_str(data).ok()?;
        match self {
            LlmProvider::Anthropic => match value.get("type")?.as_str()? {
                "content_block_start" => value
                    .get("content_block")
                    .cloned()
                    .map(SseParseItem::BlockStart),
                "content_block_delta" => {
                    let delta = value.get("delta")?;
                    match delta.get("type")?.as_str()? {
                        "text_delta" => delta
                            .get("text")
                            .and_then(Value::as_str)
                            .filter(|text| !text.is_empty())
                            .map(|text| SseParseItem::Text(text.to_string())),
                        "thinking_delta" | "signature_delta" | "input_json_delta" => {
                            Some(SseParseItem::BlockDelta(delta.clone()))
                        }
                        _ => None,
                    }
                }
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
            LlmProvider::Openai => {
                let delta = value.pointer("/choices/0/delta")?;
                if let Some(text) = delta
                    .get("content")
                    .and_then(Value::as_str)
                    .filter(|text| !text.is_empty())
                {
                    return Some(SseParseItem::Text(text.to_string()));
                }
                delta
                    .get("tool_calls")
                    .and_then(Value::as_array)
                    .filter(|calls| !calls.is_empty())
                    .map(|calls| SseParseItem::ToolCallDeltas(calls.clone()))
            }
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
    if let Some(native) = &message.native {
        return Ok(native.clone());
    }
    if message.role == "tool" {
        // Anthropic merges tool results in `anthropic_turns` and never gets here.
        return Ok(json!({
            "role": "tool",
            "tool_call_id": message.tool_call_id.as_deref().ok_or("tool_result_without_id")?,
            "content": message.content,
        }));
    }
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

/// Anthropic's turn list without `system`, with consecutive tool results
/// merged into one `user` message: sent apart they are a 400, and split
/// results teach the model to stop calling tools in parallel.
fn anthropic_turns(messages: &[ChatMessage]) -> Result<Vec<Value>, String> {
    let mut turns: Vec<Value> = Vec::new();
    for message in messages.iter().filter(|message| message.role != "system") {
        if message.role != "tool" {
            turns.push(message_value(message, LlmProvider::Anthropic)?);
            continue;
        }
        let block = json!({
            "type": "tool_result",
            "tool_use_id": message.tool_call_id.as_deref().ok_or("tool_result_without_id")?,
            "content": message.content,
            "is_error": message.is_error,
        });
        match turns.last_mut() {
            Some(last) if is_tool_result_turn(last) => last["content"]
                .as_array_mut()
                .expect("checked by is_tool_result_turn")
                .push(block),
            _ => turns.push(json!({ "role": "user", "content": [block] })),
        }
    }
    Ok(turns)
}

fn is_tool_result_turn(turn: &Value) -> bool {
    turn["role"] == "user"
        && turn["content"].as_array().is_some_and(|blocks| {
            !blocks.is_empty() && blocks.iter().all(|block| block["type"] == "tool_result")
        })
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
    use serde_json::json;

    fn messages() -> Vec<ChatMessage> {
        vec![
            ChatMessage {
                role: "system".into(),
                content: "Translate.".into(),
                images: Vec::new(),
                ..Default::default()
            },
            ChatMessage {
                role: "user".into(),
                content: "Hallo".into(),
                images: Vec::new(),
                ..Default::default()
            },
        ]
    }

    /// Anthropic rejects a `system` role inside `messages`.
    #[test]
    fn anthropic_lifts_system_out_of_the_message_list() {
        let body = LlmProvider::Anthropic
            .body_with_tools("claude-haiku-4-5", &messages(), &[], ToolChoice::Auto)
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
            .body_with_tools("claude-haiku-4-5", &messages(), &[], ToolChoice::Auto)
            .unwrap();
        assert!(haiku.get("thinking").is_none());
        assert!(haiku.get("output_config").is_none());

        for model in ["claude-sonnet-5", "claude-opus-5", "claude-fable-5"] {
            let body = LlmProvider::Anthropic
                .body_with_tools(model, &messages(), &[], ToolChoice::Auto)
                .unwrap();
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
            .body_with_tools("gpt-4o-mini", &messages(), &[], ToolChoice::Auto)
            .unwrap();
        assert_eq!(openai["messages"].as_array().unwrap().len(), 2);
        assert_eq!(openai["model"], "gpt-4o-mini");

        let cloudflare = LlmProvider::Cloudflare
            .body_with_tools(
                "@cf/meta/llama-3.2-1b-instruct",
                &messages(),
                &[],
                ToolChoice::Auto,
            )
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
            ..Default::default()
        };
        assert!(LlmProvider::Openai
            .body_with_tools("gpt-4o-mini", &[message], &[], ToolChoice::Auto)
            .is_ok());
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
            ..Default::default()
        }];
        let anthropic = LlmProvider::Anthropic
            .body_with_tools("claude-haiku-4-5", &messages, &[], ToolChoice::Auto)
            .unwrap();
        assert_eq!(
            anthropic["messages"][0]["content"][0]["source"]["media_type"],
            "image/png"
        );
        let openai = LlmProvider::Openai
            .body_with_tools("gpt-4o-mini", &messages, &[], ToolChoice::Auto)
            .unwrap();
        assert_eq!(
            openai["messages"][0]["content"][0]["image_url"]["url"],
            "data:image/png;base64,QUJD"
        );
        assert_eq!(
            LlmProvider::Cloudflare.body_with_tools(
                "@cf/meta/llama-3.2-1b-instruct",
                &messages,
                &[],
                ToolChoice::Auto
            ),
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
        assert!(matches!(
            LlmProvider::Anthropic.parse_sse_data(
                r#"{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"x"}}"#
            ),
            Some(SseParseItem::BlockDelta(_))
        ));
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

    fn weather_tool() -> ToolDef {
        ToolDef {
            name: "weather_current".into(),
            description: "Current weather".into(),
            input_schema: json!({ "type": "object", "properties": {}, "required": [] }),
        }
    }

    #[test]
    fn tools_and_tool_choice_use_each_provider_shape() {
        let anthropic = LlmProvider::Anthropic
            .body_with_tools(
                "claude-haiku-4-5",
                &messages(),
                &[weather_tool()],
                ToolChoice::None,
            )
            .unwrap();
        assert_eq!(anthropic["tools"][0]["name"], "weather_current");
        assert_eq!(anthropic["tools"][0]["input_schema"]["type"], "object");
        assert_eq!(anthropic["tool_choice"]["type"], "none");

        let openai = LlmProvider::Openai
            .body_with_tools(
                "gpt-4o-mini",
                &messages(),
                &[weather_tool()],
                ToolChoice::Auto,
            )
            .unwrap();
        assert_eq!(openai["tools"][0]["type"], "function");
        assert_eq!(
            openai["tools"][0]["function"]["parameters"]["type"],
            "object"
        );
        assert!(openai.get("tool_choice").is_none(), "auto stays implicit");
    }

    #[test]
    fn gpt6_chat_tools_disable_reasoning_only_where_supported() {
        for model in ["gpt-6-sol", "gpt-6-luna"] {
            assert!(LlmProvider::Openai.supports_tools(model));
            for choice in [ToolChoice::Auto, ToolChoice::None] {
                let body = LlmProvider::Openai
                    .body_with_tools(model, &messages(), &[weather_tool()], choice)
                    .unwrap();
                assert_eq!(body["reasoning_effort"], "none");
                assert_eq!(body["tools"][0]["function"]["name"], "weather_current");
            }
            let plain = LlmProvider::Openai
                .body_with_tools(model, &messages(), &[], ToolChoice::Auto)
                .unwrap();
            assert!(plain.get("reasoning_effort").is_none());
        }
        for model in ["gpt-4o-mini", "gpt-5.4-nano-2026-03-17"] {
            let body = LlmProvider::Openai
                .body_with_tools(model, &messages(), &[weather_tool()], ToolChoice::Auto)
                .unwrap();
            assert!(body.get("reasoning_effort").is_none());
        }
        for model in ["gpt-6-astra", "gpt-6.1-sol"] {
            assert!(!LlmProvider::Openai.supports_tools(model));
            assert_eq!(
                LlmProvider::Openai.body_with_tools(
                    model,
                    &messages(),
                    &[weather_tool()],
                    ToolChoice::Auto,
                ),
                Err("tools_not_supported".into()),
            );
        }
    }

    /// OpenAI rejects `tools: []`; a chat round with nothing to call sends none.
    #[test]
    fn no_tools_leaves_the_body_as_before() {
        for provider in [LlmProvider::Anthropic, LlmProvider::Openai] {
            let body = provider
                .body_with_tools("claude-haiku-4-5", &messages(), &[], ToolChoice::None)
                .unwrap();
            assert!(body.get("tools").is_none());
            assert!(body.get("tool_choice").is_none());
        }
    }

    #[test]
    fn cloudflare_refuses_tools_instead_of_dropping_them() {
        assert_eq!(
            LlmProvider::Cloudflare.body_with_tools(
                "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
                &messages(),
                &[weather_tool()],
                ToolChoice::Auto
            ),
            Err("tools_not_supported".into())
        );
    }

    fn tool_round() -> Vec<ChatMessage> {
        let native = json!({
            "role": "assistant",
            "content": [
                { "type": "thinking", "thinking": "", "signature": "sig-1" },
                { "type": "tool_use", "id": "call_a", "name": "weather_current", "input": {} },
                { "type": "tool_use", "id": "call_b", "name": "weather_current", "input": {} },
            ],
        });
        vec![
            ChatMessage {
                role: "user".into(),
                content: "Weather?".into(),
                ..Default::default()
            },
            ChatMessage {
                role: "assistant".into(),
                native: Some(native),
                ..Default::default()
            },
            ChatMessage {
                role: "tool".into(),
                content: "{\"t\":12}".into(),
                tool_call_id: Some("call_a".into()),
                ..Default::default()
            },
            ChatMessage {
                role: "tool".into(),
                content: "offline".into(),
                tool_call_id: Some("call_b".into()),
                is_error: true,
                ..Default::default()
            },
        ]
    }

    /// The thinking signature goes back byte for byte, and parallel results
    /// travel in one message.
    #[test]
    fn anthropic_echoes_the_turn_and_merges_tool_results() {
        let body = LlmProvider::Anthropic
            .body_with_tools(
                "claude-haiku-4-5",
                &tool_round(),
                &[weather_tool()],
                ToolChoice::Auto,
            )
            .unwrap();
        let turns = body["messages"].as_array().unwrap();
        assert_eq!(turns.len(), 3);
        assert_eq!(turns[1]["content"][0]["signature"], "sig-1");
        let results = turns[2]["content"].as_array().unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0]["tool_use_id"], "call_a");
        assert_eq!(results[1]["is_error"], true);
    }

    #[test]
    fn openai_sends_one_tool_message_per_result() {
        let mut round = tool_round();
        round[1].native = Some(json!({
            "role": "assistant",
            "content": null,
            "tool_calls": [
                { "id": "call_a", "type": "function", "function": { "name": "weather_current", "arguments": "{}" } },
                { "id": "call_b", "type": "function", "function": { "name": "weather_current", "arguments": "{}" } },
            ],
        }));
        let body = LlmProvider::Openai
            .body_with_tools("gpt-4o-mini", &round, &[weather_tool()], ToolChoice::Auto)
            .unwrap();
        let messages = body["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 4);
        assert_eq!(messages[1]["tool_calls"][1]["id"], "call_b");
        assert_eq!(messages[2]["role"], "tool");
        assert_eq!(messages[3]["tool_call_id"], "call_b");
    }
}
