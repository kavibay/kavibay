//! Which catalog models the user switched off in Settings → AI.
//!
//! Backend-side on purpose. The model list is read by first-party widgets under
//! `extensions/`, and those may not import host settings modules (license
//! boundary, AGENTS.md). A `localStorage` preference would therefore apply to
//! the settings screen and to nothing that actually sends a request.
//!
//! Only the *disabled* ids are stored, so a model added to the catalog later
//! starts switched on instead of invisible.
//!
//! The same file holds the model selection-quick-actions run on. That one has
//! no widget to hang off — the Ctrl+Alt+Q popup is headless — so it needs a
//! home, and it belongs next to the switches that decide what it may pick.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

use crate::settings_store;

/// Section of `settings.json` these preferences live in.
const SECTION: &str = "ai";

/// On-disk shape of `{appData}/llm-models.json`.
#[derive(Debug, Default, Deserialize, Serialize)]
struct StoredPrefs {
    #[serde(default)]
    disabled: Vec<String>,
    /// Model for selection quick actions. Absent / empty = pick automatically.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    quick_model: Option<String>,
    /// Global shortcut for selection quick actions; absent keeps the default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    quick_shortcut: Option<String>,
    /// Quick-action manifest ids hidden from the selection popup only.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    disabled_quick_actions: Vec<String>,
}

/// Reads the stored ids. A file that cannot be parsed means "nothing disabled":
/// the failure mode of the opposite default is an empty model picker with no
/// explanation anywhere in the UI.
pub fn parse_disabled(raw: &str) -> BTreeSet<String> {
    parse(raw)
        .disabled
        .into_iter()
        .filter(|id| !id.trim().is_empty())
        .collect()
}

/// Reads the quick-action model. Empty / absent means "pick automatically".
pub fn parse_quick_model(raw: &str) -> Option<String> {
    parse(raw)
        .quick_model
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
}

pub fn parse_quick_shortcut(raw: &str) -> Option<String> {
    parse(raw)
        .quick_shortcut
        .map(|shortcut| shortcut.trim().to_string())
        .filter(|shortcut| !shortcut.is_empty())
}

pub fn parse_disabled_quick_actions(raw: &str) -> BTreeSet<String> {
    parse(raw)
        .disabled_quick_actions
        .into_iter()
        .filter(|id| !id.trim().is_empty())
        .collect()
}

/// One tolerant read for both fields — an unparsable file is all defaults.
fn parse(raw: &str) -> StoredPrefs {
    serde_json::from_str::<StoredPrefs>(raw).unwrap_or_default()
}

/// Serializes the set back; sorted by `BTreeSet`, so the file does not churn.
///
/// `quick_model` is carried through rather than taken as a parameter: every
/// caller changes exactly one of the two settings, and a signature that made
/// them restate the other is a signature that eventually drops it.
pub fn render_disabled(
    disabled: &BTreeSet<String>,
    quick_model: Option<String>,
    quick_shortcut: Option<String>,
    disabled_quick_actions: &BTreeSet<String>,
) -> String {
    serde_json::to_string_pretty(&StoredPrefs {
        disabled: disabled.iter().cloned().collect(),
        quick_model,
        quick_shortcut,
        disabled_quick_actions: disabled_quick_actions.iter().cloned().collect(),
    })
    .unwrap_or_else(|_| "{\"disabled\":[]}".to_string())
}

/// Adds or removes one id (immutable, so the caller can compare before writing).
pub fn apply(disabled: &BTreeSet<String>, model_id: &str, enabled: bool) -> BTreeSet<String> {
    let mut next = disabled.clone();
    if enabled {
        next.remove(model_id);
    } else {
        next.insert(model_id.to_string());
    }
    next
}

/// The section as JSON text, or an empty string when there is nothing to read.
///
/// Text rather than a `Value` so the tolerant `parse_*` helpers below — and the
/// tests that pin them — keep working unchanged: the section *is* the object
/// they used to read out of `llm-models.json`.
fn read_raw(app: &AppHandle) -> String {
    settings_store::read_section(app, SECTION)
        .ok()
        .flatten()
        .map(|value| value.to_string())
        .unwrap_or_default()
}

/// Store what `render_disabled` produced, as a section rather than a file.
fn write_raw(app: &AppHandle, rendered: &str) -> Result<(), String> {
    let value: Value = serde_json::from_str(rendered)
        .map_err(|error| format!("could not serialize ai preferences: {error}"))?;
    settings_store::write_section(app, SECTION, value)
}

/// The ids currently switched off. A missing or unreadable file reads as empty.
pub fn disabled(app: &AppHandle) -> BTreeSet<String> {
    parse_disabled(&read_raw(app))
}

/// The stored quick-action model, or `None` for "pick automatically".
pub fn quick_model(app: &AppHandle) -> Option<String> {
    parse_quick_model(&read_raw(app))
}

pub fn quick_shortcut(app: &AppHandle) -> Option<String> {
    parse_quick_shortcut(&read_raw(app))
}

pub fn disabled_quick_actions(app: &AppHandle) -> BTreeSet<String> {
    parse_disabled_quick_actions(&read_raw(app))
}

/// Switches one model on or off and persists the result.
pub fn set_enabled(app: &AppHandle, model_id: &str, enabled: bool) -> Result<(), String> {
    let raw = read_raw(app);
    let next = apply(&parse_disabled(&raw), model_id, enabled);
    write_raw(
        app,
        &render_disabled(
            &next,
            parse_quick_model(&raw),
            parse_quick_shortcut(&raw),
            &parse_disabled_quick_actions(&raw),
        ),
    )
}

/// Stores the quick-action model; `None` returns to automatic selection.
pub fn set_quick_model(app: &AppHandle, model_id: Option<String>) -> Result<(), String> {
    let raw = read_raw(app);
    write_raw(
        app,
        &render_disabled(
            &parse_disabled(&raw),
            model_id,
            parse_quick_shortcut(&raw),
            &parse_disabled_quick_actions(&raw),
        ),
    )
}

pub fn set_quick_shortcut(app: &AppHandle, shortcut: String) -> Result<(), String> {
    let raw = read_raw(app);
    write_raw(
        app,
        &render_disabled(
            &parse_disabled(&raw),
            parse_quick_model(&raw),
            Some(shortcut),
            &parse_disabled_quick_actions(&raw),
        ),
    )
}

pub fn set_disabled_quick_actions(
    app: &AppHandle,
    action_ids: BTreeSet<String>,
) -> Result<(), String> {
    let raw = read_raw(app);
    write_raw(
        app,
        &render_disabled(
            &parse_disabled(&raw),
            parse_quick_model(&raw),
            parse_quick_shortcut(&raw),
            &action_ids,
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stored_ids_round_trip() {
        let mut set = BTreeSet::new();
        set.insert("claude-opus-5".to_string());
        set.insert("@cf/meta/llama-3.2-1b-instruct".to_string());
        assert_eq!(
            parse_disabled(&render_disabled(&set, None, None, &BTreeSet::new())),
            set
        );
    }

    #[test]
    fn quick_model_round_trips_and_defaults_to_automatic() {
        let empty = BTreeSet::new();
        let raw = render_disabled(
            &empty,
            Some("claude-sonnet-5".to_string()),
            None,
            &BTreeSet::new(),
        );
        assert_eq!(parse_quick_model(&raw), Some("claude-sonnet-5".to_string()));

        assert_eq!(
            parse_quick_model(&render_disabled(&empty, None, None, &BTreeSet::new())),
            None
        );
        assert_eq!(parse_quick_model("{{{"), None);
        assert_eq!(parse_quick_model("{\"quick_model\":\"  \"}"), None);
    }

    #[test]
    fn quick_shortcut_round_trips_and_defaults_to_none() {
        let raw = render_disabled(
            &BTreeSet::new(),
            None,
            Some("Ctrl+Shift+Space".to_string()),
            &BTreeSet::new(),
        );
        assert_eq!(
            parse_quick_shortcut(&raw),
            Some("Ctrl+Shift+Space".to_string())
        );
        assert_eq!(parse_quick_shortcut("{}"), None);
        assert_eq!(parse_quick_shortcut("{\"quick_shortcut\":\"  \"}"), None);
    }

    #[test]
    fn disabled_quick_actions_round_trip() {
        let disabled = BTreeSet::from([
            "one-purpose-llm/translate".to_string(),
            "one-purpose-llm/correct-grammar".to_string(),
        ]);
        let raw = render_disabled(&BTreeSet::new(), None, None, &disabled);
        assert_eq!(parse_disabled_quick_actions(&raw), disabled);
        assert!(
            parse_disabled_quick_actions("{\"disabled_quick_actions\":[\"\",\"  \"]}").is_empty()
        );
    }

    /// Writing one setting must not silently drop the other — they share a file.
    #[test]
    fn the_two_settings_survive_each_other() {
        let mut set = BTreeSet::new();
        set.insert("gpt-5.6-luna".to_string());
        let raw = render_disabled(
            &set,
            Some("claude-opus-5".to_string()),
            None,
            &BTreeSet::new(),
        );

        // What `set_enabled` does: re-render with the parsed quick model.
        let after_toggle = render_disabled(
            &apply(&parse_disabled(&raw), "claude-sonnet-5", false),
            parse_quick_model(&raw),
            parse_quick_shortcut(&raw),
            &parse_disabled_quick_actions(&raw),
        );
        assert_eq!(
            parse_quick_model(&after_toggle),
            Some("claude-opus-5".to_string())
        );
        assert_eq!(parse_disabled(&after_toggle).len(), 2);

        // And what `set_quick_model` does: re-render with the parsed switches.
        let after_pick = render_disabled(
            &parse_disabled(&after_toggle),
            None,
            parse_quick_shortcut(&after_toggle),
            &parse_disabled_quick_actions(&after_toggle),
        );
        assert_eq!(parse_disabled(&after_pick).len(), 2);
        assert_eq!(parse_quick_model(&after_pick), None);
    }

    /// A corrupt file must not switch every model off — an empty picker with no
    /// error is the one outcome the user cannot debug.
    #[test]
    fn unreadable_prefs_disable_nothing() {
        assert!(parse_disabled("").is_empty());
        assert!(parse_disabled("{{{").is_empty());
        assert!(parse_disabled("[]").is_empty());
        assert!(parse_disabled("{\"disabled\":\"nope\"}").is_empty());
        assert!(parse_disabled("{}").is_empty());
    }

    #[test]
    fn blank_entries_are_dropped() {
        assert!(parse_disabled("{\"disabled\":[\"\",\"  \"]}").is_empty());
    }

    #[test]
    fn apply_toggles_one_id_and_is_idempotent() {
        let empty = BTreeSet::new();
        let off = apply(&empty, "gpt-5.6-luna", false);
        assert!(off.contains("gpt-5.6-luna"));
        assert_eq!(apply(&off, "gpt-5.6-luna", false), off);

        let on = apply(&off, "gpt-5.6-luna", true);
        assert!(on.is_empty());
        assert_eq!(apply(&on, "gpt-5.6-luna", true), on);
    }
}
