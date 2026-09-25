//! POST a provider's chat endpoint with `stream: true` and emit text deltas.

use crate::credentials::ResolvedCredential;
use crate::llm::catalog::LlmProvider;
use crate::llm::provider::{ChatMessage, SseParseItem};
use crate::llm::sse::push_sse_bytes;
use crate::llm::state::LlmState;
use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LlmChunkPayload {
    instance_id: String,
    request_id: String,
    text: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LlmLifecyclePayload {
    instance_id: String,
    request_id: String,
}

/// Streams a chat completion and emits chunk / done / cancelled events.
// Eight parameters, none of which travel together elsewhere: bundling them into
// a struct would exist only to satisfy the lint. Same call as
// `credentials::oauth::device_code`.
#[allow(clippy::too_many_arguments)]
pub async fn stream_chat(
    app: &AppHandle,
    state: &LlmState,
    provider: LlmProvider,
    credential: &ResolvedCredential,
    instance_id: &str,
    request_id: &str,
    model: &str,
    messages: &[ChatMessage],
) -> Result<(), String> {
    let model = model.trim();
    if model.is_empty() {
        return Err("model is empty".into());
    }

    state.clear_cancel(request_id);

    let mut request = streaming_http_client()?
        .post(provider.endpoint(credential, model)?)
        // Providers otherwise gzip the whole SSE body as one member, so every
        // token would sit in the decoder until the response ends.
        .header("Accept", "text/event-stream")
        .header("Accept-Encoding", "identity")
        .json(&provider.body(model, messages)?);
    for (name, value) in provider.extra_headers() {
        request = request.header(*name, *value);
    }
    // The API key is attached by the credential type's declared injection.
    let response = credential
        .apply(request)?
        .send()
        .await
        .map_err(|error| error.to_string())?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("HTTP {status}: {body}"));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = Vec::new();
    while let Some(item) = stream.next().await {
        if emit_if_cancelled(app, state, instance_id, request_id) {
            // Dropping `stream` / response ends the HTTP body read.
            return Ok(());
        }

        let bytes = item.map_err(|error| error.to_string())?;
        if emit_parsed_items(
            app,
            state,
            instance_id,
            request_id,
            push_sse_bytes(&mut buffer, &bytes, provider)?,
        )? {
            return Ok(());
        }
    }

    // A last `data:` line may arrive without a trailing newline.
    if !buffer.is_empty() {
        buffer.push(b'\n');
        if emit_parsed_items(
            app,
            state,
            instance_id,
            request_id,
            push_sse_bytes(&mut buffer, &[], provider)?,
        )? {
            return Ok(());
        }
    }

    if state.is_cancelled(request_id) {
        emit_lifecycle(app, "llm:cancelled", instance_id, request_id);
    } else {
        emit_lifecycle(app, "llm:done", instance_id, request_id);
    }
    state.finish(request_id);
    Ok(())
}

/// Emits parsed SSE items. `true` means the stream already sent `done`.
fn emit_parsed_items(
    app: &AppHandle,
    state: &LlmState,
    instance_id: &str,
    request_id: &str,
    items: Vec<SseParseItem>,
) -> Result<bool, String> {
    for parsed in items {
        if emit_if_cancelled(app, state, instance_id, request_id) {
            return Ok(true);
        }
        match parsed {
            SseParseItem::Text(text) => {
                let _ = app.emit(
                    "llm:chunk",
                    LlmChunkPayload {
                        instance_id: instance_id.to_string(),
                        request_id: request_id.to_string(),
                        text,
                    },
                );
            }
            SseParseItem::Failure(message) => {
                state.finish(request_id);
                return Err(message);
            }
            SseParseItem::Done => {
                emit_lifecycle(app, "llm:done", instance_id, request_id);
                state.finish(request_id);
                return Ok(true);
            }
        }
    }
    Ok(false)
}

/// HTTP client for SSE: compression off, so tokens are not held until `done`.
fn streaming_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .gzip(false)
        .brotli(false)
        .build()
        .map_err(|error| error.to_string())
}

/// Emits `llm:cancelled` and clears the flag when the frontend asked to stop.
fn emit_if_cancelled(
    app: &AppHandle,
    state: &LlmState,
    instance_id: &str,
    request_id: &str,
) -> bool {
    if !state.is_cancelled(request_id) {
        return false;
    }
    emit_lifecycle(app, "llm:cancelled", instance_id, request_id);
    state.finish(request_id);
    true
}

fn emit_lifecycle(app: &AppHandle, event: &str, instance_id: &str, request_id: &str) {
    let _ = app.emit(
        event,
        LlmLifecyclePayload {
            instance_id: instance_id.to_string(),
            request_id: request_id.to_string(),
        },
    );
}
