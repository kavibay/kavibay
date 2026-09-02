//! Tauri commands for provider-neutral LLM chat streaming.
//!
//! Keys come from the shared credential layer (`credentials::resolve_for_type`,
//! one type per provider) — never from the frontend.

use crate::credentials::{resolve_for_type, ResolveError};
use crate::llm::api::stream_chat;
use crate::llm::catalog::{self, LlmModelOption};
use crate::llm::prefs;
use crate::llm::provider::ChatMessage;
use crate::llm::state::LlmState;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LlmErrorPayload {
    instance_id: String,
    request_id: String,
    message: String,
}

/// Emits the single chat-stream error event and returns the matching command error.
fn emit_chat_error(
    app: &AppHandle,
    instance_id: &str,
    request_id: &str,
    message: String,
) -> Result<(), String> {
    let _ = app.emit(
        "llm:error",
        LlmErrorPayload {
            instance_id: instance_id.to_string(),
            request_id: request_id.to_string(),
            message: message.clone(),
        },
    );
    Err(message)
}

/// Every model the app can stream, with its setup state.
///
/// The same catalog the Wizard reads, unfiltered: a widget that only rewrites
/// text can use the small open-weight models the Wizard cannot.
#[tauri::command]
pub fn llm_models(app: AppHandle) -> Result<Vec<LlmModelOption>, String> {
    catalog::options(&app, |_| true)
}

/// The whole catalog for Settings → AI, switched-off models included.
///
/// Separate from `llm_models` because it is the one place that must show what
/// is *not* offered — everywhere else a disabled model simply does not exist.
#[tauri::command]
pub fn llm_catalog(app: AppHandle) -> Result<Vec<LlmModelOption>, String> {
    catalog::all_options(&app)
}

/// Switches one catalog model on or off for every widget at once.
///
/// Unknown ids are refused rather than stored: a typo would otherwise sit in
/// the prefs file forever, disabling nothing and explaining nothing.
#[tauri::command]
pub fn llm_model_set_enabled(
    app: AppHandle,
    model_id: String,
    enabled: bool,
) -> Result<(), String> {
    let model =
        catalog::find_model(model_id.trim()).ok_or_else(|| format!("unknown model: {model_id}"))?;
    prefs::set_enabled(&app, &model.api_id, enabled)
}

/// The model selection quick actions run on.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickModel {
    /// What the user picked in Settings → AI; empty means "choose for me".
    pub selected: String,
    /// What would actually be sent to; empty when nothing is usable.
    pub resolved: String,
}

/// Which model the Ctrl+Alt+Q popup uses.
///
/// Two fields rather than two commands because the two readers want different
/// answers: Settings has to show "Automatic" as a choice, the popup only cares
/// what that choice currently resolves to.
#[tauri::command]
pub fn llm_quick_model(app: AppHandle) -> Result<QuickModel, String> {
    let selected = prefs::quick_model(&app).unwrap_or_default();
    // Only models that are switched on *and* have a key: the popup has no room
    // to explain a 401, and the paste it would have produced never happens.
    let usable = catalog::options(&app, |_| true)?;
    let resolved = usable
        .iter()
        .find(|model| model.id == selected && model.configured)
        .or_else(|| usable.iter().find(|model| model.configured))
        .map(|model| model.id.clone())
        .unwrap_or_default();
    Ok(QuickModel { selected, resolved })
}

/// Stores the quick-action model; an empty id returns to automatic selection.
#[tauri::command]
pub fn llm_quick_model_set(app: AppHandle, model_id: String) -> Result<(), String> {
    let trimmed = model_id.trim();
    if trimmed.is_empty() {
        return prefs::set_quick_model(&app, None);
    }
    let model = catalog::find_model(trimmed).ok_or_else(|| format!("unknown model: {model_id}"))?;
    prefs::set_quick_model(&app, Some(model.api_id.clone()))
}

/// Starts a chat stream for `model` and emits its lifecycle events.
///
/// Returns as soon as the request is accepted. Holding the command until the
/// HTTP body ended made every `llm:chunk` arrive in one burst after `done`,
/// which the widget rendered as a single full response.
///
/// The provider comes from the catalog rather than from the caller: a widget
/// that could name both would eventually pair an Anthropic model with a
/// Cloudflare key, and the resulting 401 says nothing about which half is wrong.
#[tauri::command]
pub fn llm_chat_stream(
    app: AppHandle,
    instance_id: String,
    request_id: String,
    model: String,
    messages: Vec<ChatMessage>,
) -> Result<(), String> {
    let Some(model_def) = catalog::find_model(model.trim()) else {
        return emit_chat_error(
            &app,
            &instance_id,
            &request_id,
            format!("unknown model: {model}"),
        );
    };
    // A widget can still hold a selection made before the model was switched
    // off; the picker drops it on its next load, but the pending send would
    // otherwise go through and make the setting look like it did nothing.
    if !catalog::is_enabled(&app, &model_def.api_id) {
        return emit_chat_error(
            &app,
            &instance_id,
            &request_id,
            "This model is switched off in Settings → AI".to_string(),
        );
    }
    let provider = model_def.provider;

    let app_for_task = app.clone();
    tauri::async_runtime::spawn(async move {
        let credential = match resolve_for_type(&app_for_task, provider.credential_type()).await {
            Ok(credential) => credential,
            Err(ResolveError::NotConfigured) => {
                let _ = emit_chat_error(
                    &app_for_task,
                    &instance_id,
                    &request_id,
                    "This provider is not configured".to_string(),
                );
                return;
            }
            Err(error) => {
                let _ =
                    emit_chat_error(&app_for_task, &instance_id, &request_id, error.to_string());
                return;
            }
        };

        let state = app_for_task.state::<LlmState>().inner().clone();
        if let Err(message) = stream_chat(
            &app_for_task,
            &state,
            provider,
            &credential,
            &instance_id,
            &request_id,
            &model,
            &messages,
        )
        .await
        {
            let _ = emit_chat_error(&app_for_task, &instance_id, &request_id, message);
        }
    });

    Ok(())
}

/// Requests cancellation of an in-flight chat stream for `request_id`.
#[tauri::command]
pub fn llm_chat_cancel(state: State<'_, LlmState>, request_id: String) -> Result<(), String> {
    if request_id.trim().is_empty() {
        return Err("request_id is empty".into());
    }
    state.cancel(request_id.trim());
    Ok(())
}
