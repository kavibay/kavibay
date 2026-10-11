//! Folds one chat round's stream items into the assistant turn the provider
//! expects back next round, plus the tool calls the host has to run.
//!
//! The turn stays in the provider's own shape and is returned whole. Claude's
//! thinking blocks and their signatures must go back unchanged in a tool loop,
//! so nothing here rebuilds a turn from text and calls.

use crate::llm::catalog::LlmProvider;
use crate::llm::provider::SseParseItem;
use serde::Serialize;
use serde_json::{json, Value};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub input: Value,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Turn {
    /// The assistant message to send back next round, verbatim.
    pub assistant: Value,
    pub tool_calls: Vec<ToolCall>,
}

#[derive(Default)]
struct OpenAiCall {
    id: String,
    name: String,
    arguments: String,
}

pub struct TurnAssembler {
    provider: LlmProvider,
    /// Anthropic: content blocks in stream order. Blocks never interleave, so
    /// every delta belongs to the last one.
    blocks: Vec<Value>,
    /// Anthropic: `input_json_delta` text, one entry per block.
    tool_json: Vec<String>,
    /// OpenAI: answer text.
    text: String,
    /// OpenAI: calls by stream index.
    calls: Vec<OpenAiCall>,
}

impl TurnAssembler {
    pub fn new(provider: LlmProvider) -> Self {
        Self {
            provider,
            blocks: Vec::new(),
            tool_json: Vec::new(),
            text: String::new(),
            calls: Vec::new(),
        }
    }

    pub fn push(&mut self, item: &SseParseItem) {
        match item {
            SseParseItem::BlockStart(block) => {
                self.blocks.push(block.clone());
                self.tool_json.push(String::new());
            }
            SseParseItem::Text(text) if self.provider == LlmProvider::Anthropic => {
                match self.blocks.last_mut() {
                    Some(block) if block["type"] == "text" => append(block, "text", text),
                    // Text without an open text block: keep it rather than lose it.
                    _ => {
                        self.blocks.push(json!({ "type": "text", "text": text }));
                        self.tool_json.push(String::new());
                    }
                }
            }
            SseParseItem::Text(text) => self.text.push_str(text),
            SseParseItem::BlockDelta(delta) => {
                let Some(block) = self.blocks.last_mut() else {
                    return;
                };
                let fragment = |key: &str| delta[key].as_str().unwrap_or_default().to_string();
                match delta["type"].as_str() {
                    Some("thinking_delta") => append(block, "thinking", &fragment("thinking")),
                    Some("signature_delta") => append(block, "signature", &fragment("signature")),
                    Some("input_json_delta") => {
                        if let Some(json) = self.tool_json.last_mut() {
                            json.push_str(&fragment("partial_json"));
                        }
                    }
                    _ => {}
                }
            }
            SseParseItem::ToolCallDeltas(fragments) => {
                for fragment in fragments {
                    let index = fragment["index"].as_u64().unwrap_or(0) as usize;
                    if self.calls.len() <= index {
                        self.calls.resize_with(index + 1, OpenAiCall::default);
                    }
                    let call = &mut self.calls[index];
                    if let Some(id) = fragment["id"].as_str() {
                        call.id = id.to_string();
                    }
                    if let Some(name) = fragment.pointer("/function/name").and_then(Value::as_str)
                    {
                        call.name.push_str(name);
                    }
                    if let Some(arguments) = fragment
                        .pointer("/function/arguments")
                        .and_then(Value::as_str)
                    {
                        call.arguments.push_str(arguments);
                    }
                }
            }
            SseParseItem::Failure(_) | SseParseItem::Done => {}
        }
    }

    pub fn finish(self) -> Result<Turn, String> {
        if self.provider == LlmProvider::Anthropic {
            let mut blocks = self.blocks;
            let mut tool_calls = Vec::new();
            for (block, json) in blocks.iter_mut().zip(self.tool_json) {
                if block["type"] != "tool_use" {
                    continue;
                }
                let input = parse_arguments(&json)?;
                block["input"] = input.clone();
                tool_calls.push(ToolCall {
                    id: block["id"].as_str().unwrap_or_default().to_string(),
                    name: block["name"].as_str().unwrap_or_default().to_string(),
                    input,
                });
            }
            return Ok(Turn {
                assistant: json!({ "role": "assistant", "content": blocks }),
                tool_calls,
            });
        }
        let mut tool_calls = Vec::new();
        let mut wire = Vec::new();
        for call in self.calls {
            let input = parse_arguments(&call.arguments)?;
            wire.push(json!({
                "id": call.id,
                "type": "function",
                "function": { "name": call.name, "arguments": call.arguments },
            }));
            tool_calls.push(ToolCall {
                id: call.id,
                name: call.name,
                input,
            });
        }
        let content = if self.text.is_empty() {
            Value::Null
        } else {
            Value::String(self.text)
        };
        let mut assistant = json!({ "role": "assistant", "content": content });
        if !wire.is_empty() {
            assistant["tool_calls"] = Value::Array(wire);
        }
        Ok(Turn {
            assistant,
            tool_calls,
        })
    }
}

fn append(block: &mut Value, field: &str, text: &str) {
    let current = block[field].as_str().unwrap_or_default().to_string();
    block[field] = Value::String(current + text);
}

/// Empty arguments mean a call that takes none.
fn parse_arguments(raw: &str) -> Result<Value, String> {
    if raw.trim().is_empty() {
        return Ok(json!({}));
    }
    serde_json::from_str(raw).map_err(|_| "tool_arguments_not_json".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::catalog::LlmProvider;
    use crate::llm::provider::SseParseItem;
    use serde_json::{json, Value};

    fn feed(provider: LlmProvider, frames: &[&str]) -> Turn {
        let mut assembler = TurnAssembler::new(provider);
        for frame in frames {
            if let Some(item) = provider.parse_sse_data(frame) {
                assembler.push(&item);
            }
        }
        assembler.finish().unwrap()
    }

    /// A Claude round that thinks, says a sentence, then calls a tool.
    #[test]
    fn anthropic_round_keeps_the_thinking_signature_and_assembles_the_call() {
        let turn = feed(
            LlmProvider::Anthropic,
            &[
                r#"{"type":"message_start","message":{"id":"msg_1","role":"assistant","content":[]}}"#,
                r#"{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}"#,
                r#"{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":""}}"#,
                r#"{"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"EqQBCkgIBx"}}"#,
                r#"{"type":"content_block_stop","index":0}"#,
                r#"{"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}"#,
                r#"{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Checking the night."}}"#,
                r#"{"type":"content_block_stop","index":1}"#,
                r#"{"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"toolu_1","name":"fitbit_sleepHeartRate","input":{}}}"#,
                r#"{"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"{\"start\":\"2026-10-11T03:00\","}}"#,
                r#"{"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"\"end\":\"2026-10-11T04:00\"}"}}"#,
                r#"{"type":"content_block_stop","index":2}"#,
                r#"{"type":"message_delta","delta":{"stop_reason":"tool_use"}}"#,
                r#"{"type":"message_stop"}"#,
            ],
        );
        let content = turn.assistant["content"].as_array().unwrap();
        assert_eq!(turn.assistant["role"], "assistant");
        assert_eq!(content[0]["type"], "thinking");
        assert_eq!(content[0]["signature"], "EqQBCkgIBx");
        assert_eq!(
            content[0]["thinking"], "",
            "empty thinking text is still a block"
        );
        assert_eq!(content[1]["text"], "Checking the night.");
        assert_eq!(content[2]["input"]["end"], "2026-10-11T04:00");
        assert_eq!(
            turn.tool_calls,
            vec![ToolCall {
                id: "toolu_1".into(),
                name: "fitbit_sleepHeartRate".into(),
                input: json!({ "start": "2026-10-11T03:00", "end": "2026-10-11T04:00" }),
            }]
        );
    }

    #[test]
    fn anthropic_answer_without_tools_has_no_calls() {
        let turn = feed(
            LlmProvider::Anthropic,
            &[
                r#"{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}"#,
                r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"7 h 12 min."}}"#,
                r#"{"type":"message_stop"}"#,
            ],
        );
        assert!(turn.tool_calls.is_empty());
        assert_eq!(turn.assistant["content"][0]["text"], "7 h 12 min.");
    }

    #[test]
    fn openai_round_assembles_parallel_calls_by_index() {
        let turn = feed(
            LlmProvider::Openai,
            &[
                r#"{"choices":[{"delta":{"role":"assistant","content":null}}]}"#,
                r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","type":"function","function":{"name":"tado_zones","arguments":""}}]}}]}"#,
                r#"{"choices":[{"delta":{"tool_calls":[{"index":1,"id":"call_b","type":"function","function":{"name":"fitbit_sleepWeek","arguments":""}}]}}]}"#,
                r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{}"}}]}}]}"#,
                r#"{"choices":[{"delta":{},"finish_reason":"tool_calls"}]}"#,
                "[DONE]",
            ],
        );
        assert_eq!(turn.tool_calls.len(), 2);
        assert_eq!(turn.tool_calls[1].name, "fitbit_sleepWeek");
        assert_eq!(
            turn.tool_calls[1].input,
            json!({}),
            "no argument fragments means no arguments"
        );
        assert_eq!(turn.assistant["content"], Value::Null);
        assert_eq!(
            turn.assistant["tool_calls"][0]["function"]["arguments"],
            "{}"
        );
    }

    #[test]
    fn openai_text_answer_keeps_its_text() {
        let turn = feed(
            LlmProvider::Openai,
            &[r#"{"choices":[{"delta":{"content":"Gut."}}]}"#, "[DONE]"],
        );
        assert_eq!(turn.assistant["content"], "Gut.");
        assert!(turn.assistant.get("tool_calls").is_none());
    }

    #[test]
    fn broken_tool_arguments_fail_the_round() {
        let mut assembler = TurnAssembler::new(LlmProvider::Anthropic);
        assembler.push(&SseParseItem::BlockStart(
            json!({ "type": "tool_use", "id": "t", "name": "x", "input": {} }),
        ));
        assembler.push(&SseParseItem::BlockDelta(
            json!({ "type": "input_json_delta", "partial_json": "{\"a\":" }),
        ));
        assert_eq!(assembler.finish(), Err("tool_arguments_not_json".into()));
    }
}
