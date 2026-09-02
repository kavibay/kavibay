//! The one model catalog used by every LLM consumer in the app.
//!
//! Model metadata lives in `models.json`. Rust embeds and validates that file,
//! then adds only runtime state such as credentials and user preferences.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::OnceLock;
use tauri::AppHandle;

use crate::credentials::db::{self, CredentialState};
use crate::credentials::registry;
use crate::llm::prefs;

const CATALOG_JSON: &str = include_str!("models.json");
const CATALOG_SCHEMA_VERSION: u32 = 1;

/// Who serves the model — and therefore which credential and API it needs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LlmProvider {
    Anthropic,
    Openai,
    Cloudflare,
}

impl LlmProvider {
    pub fn credential_type(self) -> &'static str {
        match self {
            LlmProvider::Anthropic => registry::ANTHROPIC_API,
            LlmProvider::Openai => registry::OPENAI_API,
            LlmProvider::Cloudflare => registry::CLOUDFLARE_WORKERS_AI,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmContext {
    pub window_tokens: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_output_tokens: Option<u64>,
}

/// Token prices are self-describing so a future provider can use another
/// currency or unit without changing every model entry around it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmPricing {
    pub currency: String,
    pub unit_tokens: u64,
    pub input: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cached_input: Option<f64>,
    pub output: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub valid_until: Option<String>,
}

/// One offerable model, deserialized directly from `models.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmModelDef {
    pub provider: LlmProvider,
    /// Who built the model. This stays a string so adding a new open-model
    /// vendor is a JSON-only maintenance change.
    pub vendor: String,
    #[serde(rename = "model")]
    pub label: String,
    /// Exactly the identifier expected by the serving provider.
    pub api_id: String,
    pub note: String,
    pub description: String,
    pub context: LlmContext,
    pub pricing: LlmPricing,
    #[serde(default)]
    pub capabilities: Vec<String>,
    /// Reasoning-effort levels this model may be used with, in the provider's
    /// own words.
    ///
    /// DATA, NOT A RULE IN CODE. The two providers do not share a vocabulary —
    /// Anthropic takes `low | medium | high | xhigh | max` in
    /// `output_config.effort`, OpenAI takes `none | minimal | low | medium |
    /// high | xhigh | max` in `reasoning_effort` — and translating between them
    /// would mean inventing an equivalence nobody published.
    ///
    /// A SUBSET OF WHAT THE API TAKES, DELIBERATELY. `none` turns OpenAI's
    /// reasoning off entirely, and the wizard's job is to produce a complete
    /// package that survives validation. That is the same argument `authoring`
    /// already makes about small models: what comes back is a broken package,
    /// and a broken package reads as the wizard being broken rather than as a
    /// setting somebody chose. It is not cheaper either — the repair round
    /// spends a second request on the mess.
    ///
    /// Because this list is also what the host validates against, leaving a
    /// level out is a real refusal rather than a hidden button: a widget that
    /// sends it is turned down by the same rule.
    ///
    /// Empty means **do not offer it and never send it**, which is the safe
    /// default rather than a gap: Haiku 4.5 and Sonnet 4.5 return an error when
    /// the parameter is present at all, so a model whose support has not been
    /// checked stays out instead of failing somebody's generation.
    #[serde(default)]
    pub effort_levels: Vec<String>,
    /// Whether the Widget Wizard may use it to author a complete package.
    pub authoring: bool,
    /// The Wizard's preferred model for this provider.
    ///
    /// Data rather than a rule in code, for the same reason `effort_levels` is:
    /// "which model to start on" is a fact about the catalog that changes when
    /// the catalog changes, and a provider id spelled out in the widget would
    /// have to be found and edited by somebody who only edited this file.
    ///
    /// The picker otherwise takes the first configured model in catalog order,
    /// which puts "whichever happens to be listed first" in charge of what a
    /// generation costs.
    #[serde(default)]
    pub authoring_default: bool,
    pub source_url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelCatalogFile {
    schema_version: u32,
    last_verified: String,
    models: Vec<LlmModelDef>,
}

static MODELS: OnceLock<Vec<LlmModelDef>> = OnceLock::new();

/// Parse and validate the editable catalog before any model can be offered.
fn parse_catalog(json: &str) -> Result<Vec<LlmModelDef>, String> {
    let catalog: ModelCatalogFile = serde_json::from_str(json)
        .map_err(|error| format!("invalid LLM model catalog JSON: {error}"))?;
    if catalog.schema_version != CATALOG_SCHEMA_VERSION {
        return Err(format!(
            "unsupported LLM model catalog schema {}; expected {}",
            catalog.schema_version, CATALOG_SCHEMA_VERSION
        ));
    }
    if catalog.last_verified.trim().is_empty() {
        return Err("LLM model catalog lastVerified is empty".to_string());
    }
    if catalog.models.is_empty() {
        return Err("LLM model catalog contains no models".to_string());
    }

    let mut ids = HashSet::new();
    for model in &catalog.models {
        let id = model.api_id.trim();
        if id.is_empty() {
            return Err("LLM model catalog contains an empty apiId".to_string());
        }
        if !ids.insert(id) {
            return Err(format!("LLM model catalog contains duplicate apiId: {id}"));
        }
        for (field, value) in [
            ("model", model.label.as_str()),
            ("vendor", model.vendor.as_str()),
            ("note", model.note.as_str()),
            ("description", model.description.as_str()),
            ("sourceUrl", model.source_url.as_str()),
        ] {
            if value.trim().is_empty() {
                return Err(format!("{id} has an empty {field}"));
            }
        }
        if model.context.window_tokens == 0 {
            return Err(format!("{id} has no context window"));
        }
        if model.pricing.currency.trim().is_empty() || model.pricing.unit_tokens == 0 {
            return Err(format!("{id} has an invalid pricing unit"));
        }
        for (field, price) in [
            ("input", model.pricing.input),
            ("output", model.pricing.output),
        ] {
            if !price.is_finite() || price < 0.0 {
                return Err(format!("{id} has an invalid {field} price"));
            }
        }
        if model
            .pricing
            .cached_input
            .is_some_and(|price| !price.is_finite() || price < 0.0)
        {
            return Err(format!("{id} has an invalid cached input price"));
        }
        // A blank level would be offered as an empty entry in the picker and
        // sent to the provider as one.
        if model
            .effort_levels
            .iter()
            .any(|level| level.trim().is_empty())
        {
            return Err(format!("{id} has an empty effort level"));
        }
    }
    Ok(catalog.models)
}

/// The catalog in JSON order: strongest first within each provider.
pub fn models() -> &'static [LlmModelDef] {
    MODELS
        .get_or_init(|| {
            parse_catalog(CATALOG_JSON)
                .unwrap_or_else(|error| panic!("bundled LLM model catalog must be valid: {error}"))
        })
        .as_slice()
}

/// Look up a model by the exact provider API identifier.
pub fn find_model(id: &str) -> Option<&'static LlmModelDef> {
    models().iter().find(|model| model.api_id == id)
}

/// Catalog data plus the runtime state a picker needs.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmModelOption {
    /// Compatibility name used by existing saved picker values. This is the
    /// JSON model's `apiId`, not a second identifier.
    pub id: String,
    pub label: String,
    pub note: String,
    pub description: String,
    pub provider: LlmProvider,
    pub vendor: String,
    pub context: LlmContext,
    pub pricing: LlmPricing,
    pub capabilities: Vec<String>,
    pub effort_levels: Vec<String>,
    /// The Wizard starts on this model when its provider is connected.
    pub authoring_default: bool,
    pub source_url: String,
    pub credential_type: String,
    pub configured: bool,
    pub enabled: bool,
}

pub fn options(
    app: &AppHandle,
    include: impl Fn(&LlmModelDef) -> bool,
) -> Result<Vec<LlmModelOption>, String> {
    build(app, include, false)
}

pub fn all_options(app: &AppHandle) -> Result<Vec<LlmModelOption>, String> {
    build(app, |_| true, true)
}

pub fn is_enabled(app: &AppHandle, model_id: &str) -> bool {
    !prefs::disabled(app).contains(model_id)
}

fn build(
    app: &AppHandle,
    include: impl Fn(&LlmModelDef) -> bool,
    keep_disabled: bool,
) -> Result<Vec<LlmModelOption>, String> {
    let conn = db::open_db(app)?;
    crate::credentials::import::run_pending_imports(app, &conn);
    let disabled = prefs::disabled(app);

    let mut configured_types: Vec<(&'static str, bool)> = Vec::new();
    let mut options = Vec::new();
    for model in models().iter().filter(|model| include(model)) {
        let enabled = !disabled.contains(model.api_id.as_str());
        if !enabled && !keep_disabled {
            continue;
        }
        let credential_type = model.provider.credential_type();
        let configured = match configured_types
            .iter()
            .find(|(type_id, _)| *type_id == credential_type)
        {
            Some((_, configured)) => *configured,
            None => {
                let configured = db::find_by_type(&conn, credential_type)
                    .ok()
                    .flatten()
                    .is_some_and(|record| record.state == CredentialState::Connected);
                configured_types.push((credential_type, configured));
                configured
            }
        };
        options.push(LlmModelOption {
            id: model.api_id.clone(),
            label: model.label.clone(),
            note: model.note.clone(),
            description: model.description.clone(),
            provider: model.provider,
            vendor: model.vendor.clone(),
            context: model.context.clone(),
            pricing: model.pricing.clone(),
            capabilities: model.capabilities.clone(),
            effort_levels: model.effort_levels.clone(),
            authoring_default: model.authoring_default,
            source_url: model.source_url.clone(),
            credential_type: credential_type.to_string(),
            configured,
            enabled,
        });
    }
    Ok(options)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_json_parses_and_every_model_resolves() {
        let parsed = parse_catalog(CATALOG_JSON).expect("catalog JSON should be valid");
        assert_eq!(parsed.len(), models().len());
        for model in models() {
            assert!(find_model(&model.api_id).is_some());
        }
        assert!(find_model("claude-opus-9").is_none());
        assert!(find_model("gpt-4o").is_none());
        assert!(find_model("").is_none());
    }

    #[test]
    fn duplicate_api_ids_are_rejected() {
        let duplicate = CATALOG_JSON.replace("\"claude-opus-5\"", "\"claude-fable-5\"");
        assert!(parse_catalog(&duplicate)
            .unwrap_err()
            .contains("duplicate apiId"));
    }

    #[test]
    fn the_model_list_is_coherent() {
        for model in models() {
            assert!(registry::find(model.provider.credential_type()).is_some());
            assert_eq!(
                models()
                    .iter()
                    .filter(|other| other.api_id == model.api_id)
                    .count(),
                1,
                "{} is listed twice",
                model.api_id
            );
        }
    }

    #[test]
    fn every_provider_offers_something() {
        for provider in [
            LlmProvider::Anthropic,
            LlmProvider::Openai,
            LlmProvider::Cloudflare,
        ] {
            assert!(models().iter().any(|model| model.provider == provider));
        }
    }

    /// Effort is sent verbatim into the provider request, so the catalog is the
    /// only thing standing between a typo in JSON and a 400 on somebody's save.
    #[test]
    fn declared_effort_levels_belong_to_their_provider() {
        const ANTHROPIC: [&str; 5] = ["low", "medium", "high", "xhigh", "max"];
        const OPENAI: [&str; 7] = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

        for model in models() {
            let allowed: &[&str] = match model.provider {
                LlmProvider::Anthropic => &ANTHROPIC,
                LlmProvider::Openai => &OPENAI,
                // Nothing on Workers AI takes an effort level.
                LlmProvider::Cloudflare => &[],
            };
            for level in &model.effort_levels {
                assert!(
                    allowed.contains(&level.as_str()),
                    "{} offers {level:?}, which its provider does not take",
                    model.api_id
                );
            }
        }
    }

    /// `none` disables reasoning, which for this job produces a package that
    /// fails validation — the same reason small models are not offered at all.
    /// The list is what the host validates against, so leaving it out refuses
    /// it rather than merely hiding it.
    #[test]
    fn no_model_offers_reasoning_switched_off() {
        for model in models() {
            assert!(
                !model.effort_levels.iter().any(|level| level == "none"),
                "{} offers `none`, which asks a model to write a package without thinking",
                model.api_id
            );
        }
    }

    /// A model that returns an error when the parameter is present at all must
    /// list nothing — an empty list is what stops it being sent.
    #[test]
    fn models_that_refuse_effort_declare_none() {
        // Named rather than looped: there is one such model in the catalog
        // today, and a loop over one element reads as a list that is missing
        // entries.
        let api_id = "claude-haiku-4-5-20251001";
        let model = find_model(api_id).expect("catalog entry");
        assert!(
            model.effort_levels.is_empty(),
            "{api_id} errors when effort is sent, so it must offer no levels"
        );
    }

    /// At most one default per provider: two would make "the preferred model"
    /// depend on catalog order again, which is the thing the flag replaces.
    #[test]
    fn each_provider_names_at_most_one_authoring_default() {
        let mut seen: Vec<LlmProvider> = Vec::new();
        for model in models().iter().filter(|model| model.authoring_default) {
            assert!(
                model.authoring,
                "{} is the authoring default but is not an authoring model",
                model.api_id
            );
            assert!(
                !seen.contains(&model.provider),
                "{:?} names more than one authoring default",
                model.provider
            );
            seen.push(model.provider);
        }
    }

    #[test]
    fn authoring_models_exist_and_exclude_open_weight_models() {
        assert!(models().iter().any(|model| model.authoring));
        for model in models().iter().filter(|model| model.authoring) {
            assert_ne!(model.provider, LlmProvider::Cloudflare, "{}", model.api_id);
        }
    }

    #[test]
    fn workers_ai_ids_keep_their_prefix() {
        for model in models()
            .iter()
            .filter(|model| model.provider == LlmProvider::Cloudflare)
        {
            assert!(model.api_id.starts_with("@cf/"), "{}", model.api_id);
        }
    }

    #[test]
    fn provider_wire_names_are_stable() {
        assert_eq!(
            serde_json::to_string(&LlmProvider::Anthropic).unwrap(),
            "\"anthropic\""
        );
        assert_eq!(
            serde_json::to_string(&LlmProvider::Openai).unwrap(),
            "\"openai\""
        );
        assert_eq!(
            serde_json::to_string(&LlmProvider::Cloudflare).unwrap(),
            "\"cloudflare\""
        );
    }
}
