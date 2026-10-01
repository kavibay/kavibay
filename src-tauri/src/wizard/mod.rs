//! Widget-Wizard: the model side of authoring a widget by describing it.
//!
//! Package roots and drafts: `docs/widget-wizard.md`.
//!
//! This module only turns a conversation into text. It never writes a file —
//! the wizard widget hands the model's output to
//! `runtime_extensions::drafts`, which is the layer that cannot escape the
//! custom root. Keeping generation and writing apart is what makes "the model
//! decided to overwrite an installed package" impossible rather than unlikely:
//! the code that talks to the model has no path to the disk.

pub mod prompt;
pub mod providers;
pub mod store;

use tauri::AppHandle;

use crate::llm::catalog::{self, LlmModelOption};
use providers::{WizardMessage, WizardReply};

/// Models the wizard can use, with their setup state.
///
/// The shared catalog, narrowed to the models that can author a whole package —
/// same list the other LLM widgets read, so a key entered once is a key
/// everywhere. The state is included so the widget can say "add a key in
/// Settings" instead of letting the user pick a provider and then fail at send
/// time.
#[tauri::command]
pub fn wizard_models(
    app: AppHandle,
    instance_id: Option<String>,
) -> Result<Vec<LlmModelOption>, String> {
    let owner = instance_id
        .map(|id| format!("widget:{id}"))
        .unwrap_or_else(|| crate::credentials::bindings::HOST_OWNER.into());
    catalog::options_for_owner(&app, &owner, |model| model.authoring)
}

/// Which of the two package formats a turn is authoring.
///
/// A format, not a prompt. The caller says what kind of widget is wanted and
/// the host decides what the model is told — keeping the rule that a caller
/// cannot loosen what the output will be validated against.
///
/// Defaults to the runtime package, so a caller that says nothing gets the
/// format that already existed rather than the newer one.
#[derive(Debug, Clone, Copy, Default, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WidgetFormat {
    /// Declared endpoints and key-value storage. No connected account.
    #[default]
    RuntimePackage,
    /// Reads from a provider — a connected account like tado°. Read-only.
    ContractPackage,
}

/// One authoring turn: conversation in, model text out.
///
/// The system prompt is not a parameter. It is built here from the embedded
/// package documentation, so a caller cannot loosen the rules the generated
/// package will be validated against.
#[tauri::command(rename_all = "camelCase")]
pub async fn wizard_complete(
    app: AppHandle,
    instance_id: String,
    model: String,
    messages: Vec<WizardMessage>,
    format: Option<WidgetFormat>,
    providers: Option<Vec<String>>,
    effort: Option<String>,
) -> Result<WizardReply, String> {
    // Ids, not blocks. What the model reads about a provider is embedded (see
    // `prompt::PROVIDER_BLOCKS`); the caller only says which ones, so the rule
    // above — the system prompt is not a parameter — still holds.
    let providers = providers.unwrap_or_default();
    let system = match format.unwrap_or_default() {
        WidgetFormat::RuntimePackage => prompt::system_prompt(),
        WidgetFormat::ContractPackage => prompt::contract_system_prompt(&providers),
    };
    providers::complete(
        &app,
        &format!("widget:{instance_id}"),
        &model,
        &system,
        &messages,
        effort.as_deref(),
    )
    .await
}
