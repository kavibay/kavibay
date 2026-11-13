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
    /// Responses API: one finished output item (reasoning, function call,
    /// message), kept verbatim for the next tool round.
    OutputItem(Value),
    /// A Chat Completions delta carrying more than plain answer text: reasoning
    /// to echo back next round, tool fragments, or both next to text in one frame.
    ChatDelta(Value),
}

/// How one Chat Completions service differs from another.
///
/// OpenAI, DeepSeek and OpenRouter share a wire format — message list, tool
/// shape, `choices[0].delta` stream — and differ only in the handful of fields
/// below. Keeping those differences as data means a further compatible service
/// is a row here plus a credential type, not another arm in every `match`.
/// What is genuinely one model's quirk (GPT-6's tool/reasoning conflict) stays
/// keyed on the model, not on the service.
#[derive(Debug)]
pub struct ChatCompletions {
    /// For error messages: "<label> reported a stream error".
    pub label: &'static str,
    pub url: &'static str,
    /// Non-secret headers sent with every request. The key is the credential
    /// type's injection, never listed here.
    pub headers: &'static [(&'static str, &'static str)],
    /// Field that caps output, or `None` to leave the service default. OpenAI
    /// streams without one; DeepSeek's default is too small for thinking.
    pub output_cap: Option<&'static str>,
    pub effort: EffortField,
    /// Run one-purpose transforms at `low` effort when the catalog lists it.
    pub transform_effort: bool,
    /// Delta field with reasoning the service requires back on the next tool
    /// round, written into the assistant turn under the same name.
    pub reasoning_echo: Option<&'static str>,
    /// Where the usage block reports prompt tokens served from cache.
    pub cache_hits: CacheHits,
}

/// Where a service reads the reasoning-effort level from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EffortField {
    /// `"reasoning_effort": "<level>"` (OpenAI, DeepSeek).
    ReasoningEffort,
    /// `"reasoning": { "effort": "<level>" }` (OpenRouter's unified field).
    ReasoningObject,
}

/// How cached prompt tokens are reported. Both count them inside
/// `prompt_tokens`; only the field naming the cached part differs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CacheHits {
    /// `prompt_tokens_details.cached_tokens` (+ `cache_write_tokens`).
    PromptTokensDetails,
    /// `prompt_cache_hit_tokens` (DeepSeek).
    PromptCacheHitTokens,
}

impl ChatCompletions {
    /// Writes `level` where this service reads it. Added, never set to null:
    /// an absent field and a null one are different requests.
    pub fn set_effort(&self, body: &mut Value, level: &str) {
        match self.effort {
            EffortField::ReasoningEffort => body["reasoning_effort"] = json!(level),
            EffortField::ReasoningObject => body["reasoning"] = json!({ "effort": level }),
        }
    }
}

const OPENAI_CHAT: ChatCompletions = ChatCompletions {
    label: "OpenAI",
    url: "https://api.openai.com/v1/chat/completions",
    headers: &[],
    output_cap: None,
    effort: EffortField::ReasoningEffort,
    transform_effort: false,
    reasoning_echo: None,
    cache_hits: CacheHits::PromptTokensDetails,
};

const DEEPSEEK_CHAT: ChatCompletions = ChatCompletions {
    label: "DeepSeek",
    url: "https://api.deepseek.com/chat/completions",
    headers: &[],
    output_cap: Some("max_tokens"),
    effort: EffortField::ReasoningEffort,
    transform_effort: true,
    // Required: a tool round without the previous reasoning is a 400.
    reasoning_echo: Some("reasoning_content"),
    cache_hits: CacheHits::PromptCacheHitTokens,
};

/// OpenRouter forwards to many upstream vendors behind one key.
///
/// Its reasoning comes back as `reasoning` / `reasoning_details`; neither is
/// echoed yet, because merging streamed `reasoning_details` fragments is
/// unverified here. Models whose tool loops need that echo must therefore
/// not list `functionCalling` in the catalog until it is.
const OPENROUTER_CHAT: ChatCompletions = ChatCompletions {
    label: "OpenRouter",
    url: "https://openrouter.ai/api/v1/chat/completions",
    // OpenRouter's documented app attribution. Names the app, nothing about
    // the user.
    headers: &[
        ("HTTP-Referer", "https://www.kavibay.com"),
        ("X-Title", "Kavibay"),
    ],
    output_cap: Some("max_tokens"),
    effort: EffortField::ReasoningObject,
    transform_effort: true,
    reasoning_echo: None,
    cache_hits: CacheHits::PromptTokensDetails,
};

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
    /// The service's Chat Completions profile, or `None` for a provider with
    /// its own wire format (Anthropic Messages, Workers AI `/ai/run`).
    pub fn chat_completions(self) -> Option<&'static ChatCompletions> {
        match self {
            LlmProvider::Openai => Some(&OPENAI_CHAT),
            LlmProvider::Deepseek => Some(&DEEPSEEK_CHAT),
            LlmProvider::Openrouter => Some(&OPENROUTER_CHAT),
            LlmProvider::Anthropic | LlmProvider::Cloudflare | LlmProvider::Chatgpt => None,
        }
    }

    /// The model name the service expects. ChatGPT plan models are listed as
    /// `chatgpt/<slug>` because catalog ids are unique and the plain slug is
    /// the API-key twin's; the service only knows the slug.
    pub fn wire_model(self, id: &str) -> &str {
        match self {
            LlmProvider::Chatgpt => id.strip_prefix("chatgpt/").unwrap_or(id),
            _ => id,
        }
    }

    /// Chat-completion endpoint. Cloudflare puts account and model in the path.
    pub fn endpoint(self, credential: &ResolvedCredential, model: &str) -> Result<String, String> {
        if let Some(chat) = self.chat_completions() {
            return Ok(chat.url.to_string());
        }
        Ok(match self {
            LlmProvider::Anthropic => "https://api.anthropic.com/v1/messages".to_string(),
            LlmProvider::Chatgpt => "https://api.openai.com/v1/responses".to_string(),
            LlmProvider::Cloudflare => format!(
                "https://api.cloudflare.com/client/v4/accounts/{}/ai/run/{}",
                credential
                    .require_field("accountId")
                    .map_err(|error: ResolveError| error.to_string())?,
                model.trim_start_matches('/')
            ),
            // Answered by `chat_completions` above.
            LlmProvider::Openai | LlmProvider::Deepseek | LlmProvider::Openrouter => {
                unreachable!("Chat Completions services have a profile")
            }
        })
    }

    /// Non-secret headers the provider requires. The key itself is attached by
    /// the credential type's declared injection.
    pub fn extra_headers(self) -> &'static [(&'static str, &'static str)] {
        match self.chat_completions() {
            Some(chat) => chat.headers,
            None if self == LlmProvider::Anthropic => &[("anthropic-version", "2023-06-01")],
            None => &[],
        }
    }

    /// Models whose tool calls this endpoint can stream. Astra and 6.1 Sol
    /// require Responses; Workers AI's stream is unverified (Linear KAV-18).
    pub fn supports_tools(self, model: &str) -> bool {
        match self {
            LlmProvider::Anthropic => true,
            // Whether a model calls tools is the catalog's `functionCalling`.
            LlmProvider::Deepseek | LlmProvider::Openrouter => true,
            LlmProvider::Openai => !matches!(model, "gpt-6-astra" | "gpt-6.1-sol"),
            LlmProvider::Cloudflare => false,
            LlmProvider::Chatgpt => true,
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
        // The catalog says which compatible models see images; sending one to
        // a text-only model costs a round trip to learn the same thing.
        if (self.chat_completions().is_some() || self == LlmProvider::Chatgpt)
            && crate::llm::catalog::find_model(model)
                .is_some_and(|def| !def.capabilities.iter().any(|cap| cap == "vision"))
            && messages.iter().any(|message| !message.images.is_empty())
        {
            return Err("images_not_supported".into());
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
            LlmProvider::Openai | LlmProvider::Deepseek | LlmProvider::Openrouter => json!({
                "model": model,
                "stream": true,
                "messages": messages
                    .iter()
                    .map(|message| message_value(message, self))
                    .collect::<Result<Vec<_>, _>>()?,
            }),
            // Responses API, stateless: nothing is stored at OpenAI, so the
            // encrypted reasoning has to travel with each tool round instead.
            LlmProvider::Chatgpt => {
                let (instructions, input) = responses_input(messages)?;
                let mut body = json!({
                    "model": self.wire_model(model),
                    "stream": true,
                    "store": false,
                    "include": ["reasoning.encrypted_content"],
                    "input": input,
                });
                if !instructions.is_empty() {
                    body["instructions"] = json!(instructions);
                }
                body
            }
            // Workers AI takes the model in the URL, not the body.
            LlmProvider::Cloudflare => json!({
                "stream": true,
                "messages": messages
                    .iter()
                    .map(|message| message_value(message, self))
                    .collect::<Result<Vec<_>, _>>()?,
            }),
        };
        if let Some(chat) = self.chat_completions() {
            if let Some(field) = chat.output_cap {
                body[field] = json!(MAX_OUTPUT_TOKENS);
            }
            if chat.transform_effort && runs_at_low_effort(model) {
                chat.set_effort(&mut body, "low");
            }
        }
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
        } else if self == LlmProvider::Chatgpt {
            // Responses flattens the Chat Completions `function` wrapper.
            body["tools"] = tools
                .iter()
                .map(|tool| {
                    json!({
                        "type": "function",
                        "name": tool.name,
                        "description": tool.description,
                        "parameters": tool.input_schema,
                    })
                })
                .collect();
            if tool_choice == ToolChoice::None {
                body["tool_choice"] = json!("none");
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
            LlmProvider::Openai | LlmProvider::Deepseek | LlmProvider::Openrouter => {
                chat_completions_item(self.chat_completions()?, &value)
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
            LlmProvider::Chatgpt => responses_item(&value),
        }
    }

    /// The message for a failed HTTP response. A ChatGPT plan problem gets its
    /// sentence; everything else stays exactly the `HTTP <status>: <body>` it
    /// always was.
    pub fn http_error(self, status: reqwest::StatusCode, body: &str) -> String {
        if self == LlmProvider::Chatgpt {
            let sentence = serde_json::from_str::<Value>(body)
                .ok()
                .and_then(|value| value.pointer("/error/code")?.as_str().map(str::to_string))
                .and_then(|code| chatgpt_error_sentence(&code));
            if let Some(sentence) = sentence {
                return sentence.to_string();
            }
        }
        format!("HTTP {status}: {body}")
    }
}

/// One decoded Responses API event.
///
/// Only `response.completed` means the answer is whole: an incomplete or failed
/// response still closes the stream, and read as done a quick action would
/// paste a partial answer over the selection.
fn responses_item(value: &Value) -> Option<SseParseItem> {
    match value.get("type")?.as_str()? {
        "response.output_text.delta" => value
            .get("delta")
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
            .map(|text| SseParseItem::Text(text.to_string())),
        "response.output_item.done" => value.get("item").cloned().map(SseParseItem::OutputItem),
        "response.completed" => Some(SseParseItem::Done),
        "response.incomplete" => Some(SseParseItem::Failure("response_truncated".into())),
        "response.failed" | "error" => {
            let error = value.pointer("/response/error").unwrap_or(value);
            let code = error
                .get("code")
                .and_then(Value::as_str)
                .unwrap_or_default();
            Some(SseParseItem::Failure(
                chatgpt_error_sentence(code)
                    .map(str::to_string)
                    .or_else(|| {
                        error
                            .get("message")
                            .and_then(Value::as_str)
                            .map(str::to_string)
                    })
                    .unwrap_or_else(|| "OpenAI reported a stream error".to_string()),
            ))
        }
        _ => None,
    }
}

/// One decoded Chat Completions frame.
///
/// A failure is checked first: OpenRouter reports an upstream error mid-stream
/// as a frame with `error` and `finish_reason: "error"`, and DeepSeek does the
/// same with `error` alone. A cut-off or filtered answer still ends with
/// `[DONE]`, so only `finish_reason` says it is not whole.
fn chat_completions_item(chat: &ChatCompletions, value: &Value) -> Option<SseParseItem> {
    if let Some(error) = value.get("error") {
        return Some(SseParseItem::Failure(
            error["message"]
                .as_str()
                .map(str::to_string)
                .unwrap_or_else(|| format!("{} reported a stream error", chat.label)),
        ));
    }
    match value
        .pointer("/choices/0/finish_reason")
        .and_then(Value::as_str)
    {
        Some("length") => return Some(SseParseItem::Failure("response_truncated".into())),
        Some("content_filter") => return Some(SseParseItem::Failure("model_refused".into())),
        Some("error") => {
            return Some(SseParseItem::Failure(format!(
                "{} reported a stream error",
                chat.label
            )))
        }
        _ => {}
    }
    let delta = value.pointer("/choices/0/delta")?;
    let text = delta
        .get("content")
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty());
    let has_calls = delta
        .get("tool_calls")
        .and_then(Value::as_array)
        .is_some_and(|calls| !calls.is_empty());
    let has_echo = chat
        .reasoning_echo
        .and_then(|field| delta.get(field))
        .and_then(Value::as_str)
        .is_some_and(|reasoning| !reasoning.is_empty());
    match (text, has_calls, has_echo) {
        // Role, usage and empty frames carry nothing for us.
        (None, false, false) => None,
        (Some(text), false, false) => Some(SseParseItem::Text(text.to_string())),
        _ => Some(SseParseItem::ChatDelta(delta.clone())),
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

/// What a ChatGPT plan error code means, in words a user can act on.
///
/// OpenAI reports plan problems as codes in an otherwise ordinary error body or
/// `response.failed` event; shown raw they read as a broken app. Codes not
/// listed here keep the provider's own message.
pub(crate) fn chatgpt_error_sentence(code: &str) -> Option<&'static str> {
    Some(match code {
        "subscription_sharing_usage_limit_exceeded" => {
            "You've reached your ChatGPT plan's usage limit for now. Check your usage in ChatGPT → Settings → Usage."
        }
        "subscription_sharing_user_not_eligible" => {
            "ChatGPT plan usage isn't available for this account or workspace. Use an API key instead."
        }
        "subscription_sharing_invalid_user" => {
            "Your ChatGPT sign-in is no longer valid. Sign in again in Settings → AI."
        }
        "subscription_sharing_usage_unavailable" => {
            "ChatGPT plan usage is temporarily unavailable. Try again in a moment."
        }
        _ => return None,
    })
}

/// The Responses API's `instructions` and `input` items.
///
/// System messages become the instructions. An assistant turn the host got
/// back from `llm:turn` is the round's list of output items (reasoning,
/// function calls, message) and goes back verbatim — the encrypted reasoning
/// only works unchanged. Tool results are `function_call_output` items.
fn responses_input(messages: &[ChatMessage]) -> Result<(String, Vec<Value>), String> {
    let instructions = messages
        .iter()
        .filter(|message| message.role == "system")
        .map(|message| message.content.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");
    let mut input = Vec::new();
    for message in messages.iter().filter(|message| message.role != "system") {
        if let Some(native) = &message.native {
            let items = native.as_array().ok_or("invalid_native_turn")?;
            input.extend(items.iter().cloned());
            continue;
        }
        if message.role == "tool" {
            input.push(json!({
                "type": "function_call_output",
                "call_id": message.tool_call_id.as_deref().ok_or("tool_result_without_id")?,
                "output": message.content,
            }));
            continue;
        }
        let content = if message.images.is_empty() {
            let kind = if message.role == "assistant" {
                "output_text"
            } else {
                "input_text"
            };
            json!([{ "type": kind, "text": message.content }])
        } else {
            image_content(&message.content, &message.images, LlmProvider::Chatgpt)?
        };
        input.push(json!({ "role": message.role, "content": content }));
    }
    Ok((instructions, input))
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
            LlmProvider::Openai | LlmProvider::Deepseek | LlmProvider::Openrouter => json!({
                "type": "image_url",
                "image_url": {
                    "url": format!("data:{};base64,{}", image.media_type, image.data),
                },
            }),
            LlmProvider::Chatgpt => json!({
                "type": "input_image",
                "image_url": format!("data:{};base64,{}", image.media_type, image.data),
            }),
            LlmProvider::Cloudflare => unreachable!(),
        });
    }
    let text_type = if provider == LlmProvider::Chatgpt {
        "input_text"
    } else {
        "text"
    };
    blocks.push(json!({ "type": text_type, "text": text }));
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
    fn deepseek_uses_chat_completions_tools_and_its_own_options() {
        for model in ["deepseek-flash", "deepseek-v4-pro"] {
            let body = LlmProvider::Deepseek
                .body_with_tools(model, &messages(), &[weather_tool()], ToolChoice::None)
                .unwrap();
            assert_eq!(body["model"], model);
            assert_eq!(body["stream"], true);
            assert_eq!(body["messages"][0]["role"], "system");
            assert_eq!(body["reasoning_effort"], "low");
            assert_eq!(body["max_tokens"], MAX_OUTPUT_TOKENS);
            assert_eq!(body["tools"][0]["function"]["name"], "weather_current");
            assert_eq!(body["tool_choice"], "none");
            assert!(body.get("max_completion_tokens").is_none());
            assert!(body.get("prompt_cache_key").is_none());
        }
    }

    #[test]
    fn deepseek_only_offers_images_on_flash() {
        let messages = [ChatMessage {
            role: "user".into(),
            content: "Describe this".into(),
            images: vec![ChatImage {
                media_type: "image/png".into(),
                data: "QUJD".into(),
            }],
            ..Default::default()
        }];
        let body = LlmProvider::Deepseek
            .body_with_tools("deepseek-flash", &messages, &[], ToolChoice::Auto)
            .unwrap();
        assert_eq!(
            body["messages"][0]["content"][0]["image_url"]["url"],
            "data:image/png;base64,QUJD"
        );
        assert_eq!(
            LlmProvider::Deepseek
                .body_with_tools("deepseek-v4-pro", &messages, &[], ToolChoice::Auto)
                .unwrap_err(),
            "images_not_supported"
        );
    }

    #[test]
    fn deepseek_stream_failures_are_not_successful_empty_answers() {
        for frame in [
            r#"{"error":{"message":"overloaded"}}"#,
            r#"{"choices":[{"delta":{},"finish_reason":"length"}]}"#,
            r#"{"choices":[{"delta":{},"finish_reason":"content_filter"}]}"#,
        ] {
            assert!(matches!(
                LlmProvider::Deepseek.parse_sse_data(frame),
                Some(SseParseItem::Failure(_))
            ));
        }
    }

    /// The services that speak Chat Completions are rows in one table; this
    /// pins the rows so a new one cannot silently inherit another's quirks.
    #[test]
    fn chat_completions_profiles_cover_exactly_the_compatible_services() {
        assert!(LlmProvider::Anthropic.chat_completions().is_none());
        assert!(LlmProvider::Cloudflare.chat_completions().is_none());
        let openrouter = LlmProvider::Openrouter.chat_completions().unwrap();
        assert_eq!(
            openrouter.url,
            "https://openrouter.ai/api/v1/chat/completions"
        );
        assert_eq!(openrouter.reasoning_echo, None);
        assert_eq!(
            LlmProvider::Deepseek
                .chat_completions()
                .unwrap()
                .reasoning_echo,
            Some("reasoning_content")
        );
        assert!(LlmProvider::Openrouter
            .extra_headers()
            .iter()
            .any(|(name, _)| *name == "X-Title"));
        assert!(LlmProvider::Openai.extra_headers().is_empty());
    }

    #[test]
    fn openrouter_body_caps_output_and_spells_effort_its_own_way() {
        let body = LlmProvider::Openrouter
            .body_with_tools(
                "qwen/qwen3.7-flash",
                &messages(),
                &[weather_tool()],
                ToolChoice::None,
            )
            .unwrap();
        assert_eq!(body["model"], "qwen/qwen3.7-flash");
        assert_eq!(body["max_tokens"], MAX_OUTPUT_TOKENS);
        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(body["tools"][0]["function"]["name"], "weather_current");
        assert_eq!(body["tool_choice"], "none");
        // The catalog lists no effort levels for it, so none is sent.
        assert!(body.get("reasoning").is_none());
        assert!(body.get("reasoning_effort").is_none());

        let mut body = json!({});
        LlmProvider::Openrouter
            .chat_completions()
            .unwrap()
            .set_effort(&mut body, "low");
        assert_eq!(body, json!({ "reasoning": { "effort": "low" } }));
    }

    #[test]
    fn openrouter_refuses_images_for_a_text_only_model() {
        let messages = [ChatMessage {
            role: "user".into(),
            content: "Describe this".into(),
            images: vec![ChatImage {
                media_type: "image/png".into(),
                data: "QUJD".into(),
            }],
            ..Default::default()
        }];
        assert_eq!(
            LlmProvider::Openrouter
                .body_with_tools("qwen/qwen3.7-flash", &messages, &[], ToolChoice::Auto)
                .unwrap_err(),
            "images_not_supported"
        );
    }

    #[test]
    fn openrouter_stream_errors_fail_and_reasoning_alone_is_skipped() {
        assert_eq!(
            LlmProvider::Openrouter.parse_sse_data(
                r#"{"error":{"code":502,"message":"Provider returned error"},"choices":[{"delta":{"content":""},"finish_reason":"error"}]}"#
            ),
            Some(SseParseItem::Failure("Provider returned error".into()))
        );
        assert!(matches!(
            LlmProvider::Openrouter
                .parse_sse_data(r#"{"choices":[{"delta":{},"finish_reason":"error"}]}"#),
            Some(SseParseItem::Failure(_))
        ));
        assert_eq!(
            LlmProvider::Openrouter
                .parse_sse_data(r#"{"choices":[{"delta":{"reasoning":"Hmm."}}]}"#),
            None,
            "reasoning is not answer text and is not echoed"
        );
        assert_eq!(
            LlmProvider::Openrouter.parse_sse_data(r#"{"choices":[{"delta":{"content":"Hi"}}]}"#),
            Some(SseParseItem::Text("Hi".into()))
        );
    }

    /// Text and a tool call in one frame: the old OpenAI parser kept the text
    /// and dropped the call.
    #[test]
    fn text_and_tool_fragments_in_one_frame_both_survive() {
        let frame = r#"{"choices":[{"delta":{"content":"Checking.","tool_calls":[{"index":0,"id":"c","function":{"name":"x","arguments":""}}]}}]}"#;
        for provider in [
            LlmProvider::Openai,
            LlmProvider::Deepseek,
            LlmProvider::Openrouter,
        ] {
            assert!(
                matches!(
                    provider.parse_sse_data(frame),
                    Some(SseParseItem::ChatDelta(_))
                ),
                "{provider:?}"
            );
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

    #[test]
    fn chatgpt_body_is_a_stateless_responses_request() {
        let body = LlmProvider::Chatgpt
            .body_with_tools("chatgpt/gpt-6-sol", &messages(), &[], ToolChoice::Auto)
            .unwrap();
        assert_eq!(body["model"], "gpt-6-sol");
        assert_eq!(body["store"], false);
        assert_eq!(body["stream"], true);
        assert_eq!(body["include"], json!(["reasoning.encrypted_content"]));
        assert!(body.get("messages").is_none());
        assert!(body.get("tools").is_none());
        assert_eq!(
            body["input"],
            json!([{ "role": "user", "content": [{ "type": "input_text", "text": "Hallo" }] }])
        );
    }

    #[test]
    fn chatgpt_system_messages_become_instructions() {
        let body = LlmProvider::Chatgpt
            .body_with_tools("chatgpt/gpt-6-sol", &messages(), &[], ToolChoice::Auto)
            .unwrap();
        assert_eq!(body["instructions"], "Translate.");
        let only_user = &messages()[1..];
        let body = LlmProvider::Chatgpt
            .body_with_tools("chatgpt/gpt-6-sol", only_user, &[], ToolChoice::Auto)
            .unwrap();
        assert!(body.get("instructions").is_none());
    }

    #[test]
    fn chatgpt_tools_use_the_flat_function_shape() {
        let tool = weather_tool();
        let body = LlmProvider::Chatgpt
            .body_with_tools(
                "chatgpt/gpt-6-sol",
                &messages(),
                std::slice::from_ref(&tool),
                ToolChoice::None,
            )
            .unwrap();
        assert_eq!(
            body["tools"][0],
            json!({
                "type": "function",
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.input_schema,
            })
        );
        assert_eq!(body["tool_choice"], "none");
    }

    #[test]
    fn chatgpt_tool_round_echoes_items_then_outputs() {
        let reasoning =
            json!({ "type": "reasoning", "id": "rs_1", "encrypted_content": "enc", "summary": [] });
        let call = json!({ "type": "function_call", "id": "fc_1", "call_id": "c1", "name": "weather_current", "arguments": "{}" });
        let round = vec![
            ChatMessage {
                role: "user".into(),
                content: "Weather?".into(),
                ..Default::default()
            },
            ChatMessage {
                role: "assistant".into(),
                native: Some(json!([reasoning.clone(), call.clone()])),
                ..Default::default()
            },
            ChatMessage {
                role: "tool".into(),
                content: "{\"t\":12}".into(),
                tool_call_id: Some("c1".into()),
                ..Default::default()
            },
        ];
        let body = LlmProvider::Chatgpt
            .body_with_tools(
                "chatgpt/gpt-6-sol",
                &round,
                &[weather_tool()],
                ToolChoice::Auto,
            )
            .unwrap();
        let input = body["input"].as_array().unwrap();
        assert_eq!(input.len(), 4);
        assert_eq!(input[1], reasoning);
        assert_eq!(input[2], call);
        assert_eq!(
            input[3],
            json!({ "type": "function_call_output", "call_id": "c1", "output": "{\"t\":12}" })
        );
    }

    #[test]
    fn chatgpt_rejects_a_native_turn_that_is_not_an_item_list() {
        let round = vec![ChatMessage {
            role: "assistant".into(),
            native: Some(json!({ "role": "assistant" })),
            ..Default::default()
        }];
        assert_eq!(
            LlmProvider::Chatgpt
                .body_with_tools("chatgpt/gpt-6-sol", &round, &[], ToolChoice::Auto)
                .unwrap_err(),
            "invalid_native_turn"
        );
    }

    #[test]
    fn chatgpt_plain_history_and_images_use_responses_content_types() {
        let history = vec![
            ChatMessage {
                role: "user".into(),
                content: "What is this?".into(),
                images: vec![ChatImage {
                    media_type: "image/png".into(),
                    data: "aGk=".into(),
                }],
                ..Default::default()
            },
            ChatMessage {
                role: "assistant".into(),
                content: "A cat.".into(),
                ..Default::default()
            },
        ];
        let body = LlmProvider::Chatgpt
            .body_with_tools("chatgpt/gpt-6-sol", &history, &[], ToolChoice::Auto)
            .unwrap();
        assert_eq!(
            body["input"][0]["content"],
            json!([
                { "type": "input_image", "image_url": "data:image/png;base64,aGk=" },
                { "type": "input_text", "text": "What is this?" },
            ])
        );
        assert_eq!(
            body["input"][1],
            json!({ "role": "assistant", "content": [{ "type": "output_text", "text": "A cat." }] })
        );
    }

    #[test]
    fn chatgpt_endpoint_and_wire_model() {
        assert_eq!(
            LlmProvider::Chatgpt.wire_model("chatgpt/gpt-6-sol"),
            "gpt-6-sol"
        );
        assert_eq!(
            LlmProvider::Openrouter.wire_model("openai/gpt-x"),
            "openai/gpt-x"
        );
        assert!(LlmProvider::Chatgpt.chat_completions().is_none());
        assert!(LlmProvider::Chatgpt.supports_tools("chatgpt/gpt-6-sol"));
        assert!(LlmProvider::Chatgpt.extra_headers().is_empty());
    }

    #[test]
    fn openai_api_key_body_is_unchanged_by_the_new_provider() {
        let body = LlmProvider::Openai
            .body_with_tools("gpt-6-luna", &messages(), &[], ToolChoice::Auto)
            .unwrap();
        assert!(body.get("messages").is_some());
        for field in ["store", "input", "include", "instructions"] {
            assert!(
                body.get(field).is_none(),
                "{field} leaked into Chat Completions"
            );
        }
    }

    #[test]
    fn chatgpt_stream_events_decode_to_items() {
        let p = LlmProvider::Chatgpt;
        assert!(matches!(
            p.parse_sse_data(r#"{"type":"response.output_text.delta","delta":"Hi"}"#),
            Some(SseParseItem::Text(text)) if text == "Hi"
        ));
        assert!(p
            .parse_sse_data(r#"{"type":"response.output_text.delta","delta":""}"#)
            .is_none());
        let item =
            json!({ "type": "function_call", "call_id": "c1", "name": "f", "arguments": "{}" });
        assert!(matches!(
            p.parse_sse_data(&json!({ "type": "response.output_item.done", "item": item }).to_string()),
            Some(SseParseItem::OutputItem(value)) if value == item
        ));
        assert!(matches!(
            p.parse_sse_data(r#"{"type":"response.completed","response":{}}"#),
            Some(SseParseItem::Done)
        ));
        assert!(matches!(
            p.parse_sse_data(r#"{"type":"response.incomplete","response":{}}"#),
            Some(SseParseItem::Failure(code)) if code == "response_truncated"
        ));
        assert!(p
            .parse_sse_data(r#"{"type":"response.created","response":{}}"#)
            .is_none());
    }

    #[test]
    fn chatgpt_stream_failures_speak_the_plan_language() {
        let p = LlmProvider::Chatgpt;
        let limit = r#"{"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded","message":"raw"}}}"#;
        assert!(matches!(
            p.parse_sse_data(limit),
            Some(SseParseItem::Failure(text)) if text.contains("usage limit")
        ));
        let other = r#"{"type":"response.failed","response":{"error":{"code":"server_error","message":"Boom"}}}"#;
        assert!(matches!(
            p.parse_sse_data(other),
            Some(SseParseItem::Failure(text)) if text == "Boom"
        ));
        let bare =
            r#"{"type":"error","code":"subscription_sharing_usage_unavailable","message":"raw"}"#;
        assert!(matches!(
            p.parse_sse_data(bare),
            Some(SseParseItem::Failure(text)) if text.contains("temporarily unavailable")
        ));
    }

    #[test]
    fn http_errors_name_plan_problems_and_leave_others_alone() {
        let limit =
            r#"{"error":{"code":"subscription_sharing_usage_limit_exceeded","message":"raw"}}"#;
        assert!(LlmProvider::Chatgpt
            .http_error(reqwest::StatusCode::TOO_MANY_REQUESTS, limit)
            .contains("usage limit"));
        assert_eq!(
            LlmProvider::Chatgpt.http_error(reqwest::StatusCode::BAD_GATEWAY, "x"),
            "HTTP 502 Bad Gateway: x"
        );
        assert_eq!(
            LlmProvider::Openai.http_error(reqwest::StatusCode::TOO_MANY_REQUESTS, limit),
            format!("HTTP 429 Too Many Requests: {limit}")
        );
    }
}
