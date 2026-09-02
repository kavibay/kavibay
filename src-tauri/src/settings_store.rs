//! The user's settings as one plain, hand-editable JSON document.
//!
//! Everything the user configured lives in `{dataDir}/settings.json`, in the
//! clear and pretty-printed, so it can be read and edited in any text editor —
//! the desktop-app equivalent of what VS Code keeps in its user profile.
//!
//! Explicitly *not* in here: widget content and app state. Notes, timers, the
//! desk layout and the palette history stay in the DPAPI-protected
//! `web-storage.json`, because that file is the only copy of what the user
//! typed. `core/app/system/settingsSections.ts` is the frontend half of that
//! split and decides which localStorage key lands where. Secrets never appear
//! in either: they live in the credential store.
//!
//! # Ownership
//!
//! This side owns the file. Two writers exist — the frontend on every settings
//! change, and Rust at boot for the sections it reads before the WebView is up —
//! so the write path merges top-level sections and never replaces the document.
//! That is also what keeps a section written by a newer build, or a comment-like
//! field a user added by hand, from being dropped by an older one.
//!
//! # Hand edits
//!
//! Read at startup, not watched. An edit made while the app runs is overwritten
//! by the next settings change; edit with the app closed.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{Map, Value};
use tauri::{AppHandle, Runtime};

use crate::paths::data_dir;

/// The file, relative to the data directory.
pub const SETTINGS_FILE: &str = "settings.json";

/// Format marker, owned by this module. A section may not be called this.
const VERSION_FIELD: &str = "version";

/// Current format. Bumped only for a change old builds cannot read.
const VERSION: u64 = 1;

/// Legacy single-purpose files, and the section each becomes.
///
/// An entry may only be added once its reader takes the value from the section
/// instead of the file. For `mcp-server.json` and `llm-models.json` the file is
/// the *only* copy and Rust the only reader, so migrating either one ahead of
/// its consumer would delete a preference that is still being read from the old
/// path — the entry and the switch have to land together.
const LEGACY_FILES: &[(&str, &str)] = &[
    ("appearance.json", "appearance"),
    ("mcp-server.json", "mcpServer"),
    ("llm-models.json", "ai"),
];

/// `{dataDir}/settings.json`.
fn settings_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join(SETTINGS_FILE))
}

/// Parse a document, tolerating what a text editor leaves behind.
///
/// Notepad writes a BOM, which `serde_json` and `JSON.parse` both refuse. Since
/// this file exists to be hand-edited, refusing the most common Windows editor
/// would be refusing the feature.
fn parse_document(raw: &str) -> Result<Map<String, Value>, String> {
    let text = raw.trim_start_matches('\u{feff}');
    let value: Value =
        serde_json::from_str(text).map_err(|error| format!("not valid JSON: {error}"))?;
    match value {
        Value::Object(map) => Ok(map),
        _ => Err("not a JSON object".to_string()),
    }
}

/// Move an unusable file aside instead of letting the next save overwrite it.
///
/// A hand edit that broke the syntax is still the user's settings, and the fix
/// is usually one character. Overwriting it with defaults would throw that away
/// at the exact moment they most want it back.
fn quarantine(path: &Path, reason: &str) -> Result<(), String> {
    let aside = path.with_extension("corrupt.json");
    fs::rename(path, &aside)
        .map_err(|error| format!("{reason}, and moving the file aside failed: {error}"))?;
    eprintln!("[settings] {reason}; kept as {}", aside.display());
    Ok(())
}

/// Read the document. Missing file, or one that had to be quarantined, is empty.
fn load_document(path: &Path) -> Result<Map<String, Value>, String> {
    let raw = match fs::read_to_string(path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Map::new()),
        Err(error) => return Err(error.to_string()),
    };
    match parse_document(&raw) {
        Ok(document) => Ok(document),
        Err(reason) => {
            quarantine(path, &format!("settings.json is {reason}"))?;
            Ok(Map::new())
        }
    }
}

/// Write the document, stamped and atomically.
///
/// Pretty-printed because a human reads it. Written to a sibling temp file and
/// renamed into place because this one file now holds *all* settings: a torn
/// write used to cost one preference and would now cost every one of them.
/// `fs::rename` replaces the target atomically on Windows and Unix alike.
fn write_document(path: &Path, document: &Map<String, Value>) -> Result<(), String> {
    let mut out = document.clone();
    out.insert(VERSION_FIELD.to_string(), Value::from(VERSION));
    let body = serde_json::to_string_pretty(&Value::Object(out))
        .map_err(|error| format!("could not serialize settings: {error}"))?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, body).map_err(|error| error.to_string())?;
    fs::rename(&temp, path).map_err(|error| error.to_string())
}

/// Merge top-level sections into the document, leaving every other one alone.
fn merge_into(path: &Path, sections: Map<String, Value>) -> Result<(), String> {
    if sections.contains_key(VERSION_FIELD) {
        return Err(format!("`{VERSION_FIELD}` is not a settings section"));
    }
    let mut document = load_document(path)?;
    for (name, value) in sections {
        document.insert(name, value);
    }
    write_document(path, &document)
}

/// One section, for Rust code that reads settings before the WebView exists.
pub fn read_section<R: Runtime>(app: &AppHandle<R>, name: &str) -> Result<Option<Value>, String> {
    Ok(load_document(&settings_path(app)?)?.get(name).cloned())
}

/// Replace one section, leaving the rest of the document untouched.
pub fn write_section<R: Runtime>(
    app: &AppHandle<R>,
    name: &str,
    value: Value,
) -> Result<(), String> {
    let mut sections = Map::new();
    sections.insert(name.to_string(), value);
    merge_into(&settings_path(app)?, sections)
}

/// Fold the legacy single-purpose files into `settings.json`.
///
/// Idempotent, and safe to run before anything reads settings: a legacy file is
/// removed only after the merged document is safely on disk, so an interruption
/// leaves the old file in place and the next start tries again.
///
/// `settings.json` wins where both hold a section — it is the newer format, and
/// the frontend may already have written to it this session. The legacy file is
/// then deleted unread, because the migration has already happened and keeping
/// it means retrying forever.
pub fn migrate_legacy_files<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    migrate_legacy_in(&data_dir(app)?)
}

fn migrate_legacy_in(dir: &Path) -> Result<(), String> {
    let path = dir.join(SETTINGS_FILE);

    for (file, section) in LEGACY_FILES {
        let legacy = dir.join(file);
        if !legacy.exists() {
            continue;
        }

        let document = load_document(&path)?;
        if !document.contains_key(*section) {
            let raw = fs::read_to_string(&legacy).map_err(|error| error.to_string())?;
            match parse_document(&raw) {
                Ok(value) => {
                    let mut sections = Map::new();
                    sections.insert((*section).to_string(), Value::Object(value));
                    merge_into(&path, sections)?;
                    eprintln!("[settings] migrated {file} into section `{section}`");
                }
                Err(reason) => {
                    // Not our format any more, and not ours to quarantine. Left
                    // where it is so it stays visible and recoverable.
                    eprintln!("[settings] {file} is {reason}; left in place, not migrated");
                    continue;
                }
            }
        }

        if let Err(error) = fs::remove_file(&legacy) {
            eprintln!("[settings] {file} was migrated but could not be removed: {error}");
        }
    }
    Ok(())
}

/// The whole document as text, or `None` when there is nothing usable to read.
#[tauri::command]
pub fn settings_load(app: AppHandle) -> Result<Option<String>, String> {
    let path = settings_path(&app)?;
    let document = load_document(&path)?;
    if document.is_empty() {
        return Ok(None);
    }
    serde_json::to_string(&Value::Object(document))
        .map(Some)
        .map_err(|error| error.to_string())
}

/// Merge top-level sections into the document.
///
/// Sections the caller does not name keep their current value — this is the
/// only write path, precisely so that the frontend saving its four sections
/// cannot drop the ones Rust owns, or vice versa.
#[tauri::command]
pub fn settings_save_sections(app: AppHandle, sections: Map<String, Value>) -> Result<(), String> {
    merge_into(&settings_path(&app)?, sections)
}

/// The path to the settings file, which is created first if it does not exist.
///
/// Materializing it is the point: this backs the palette commands, and one that
/// reports "no such file" on a fresh install would be worse than one that opens
/// a document holding only its version marker.
#[tauri::command]
pub fn settings_file_path(app: AppHandle) -> Result<String, String> {
    Ok(ensure_settings_file(&app)?.to_string_lossy().into_owned())
}

/// Open `settings.json` in whatever the system uses for `.json` files.
///
/// A command of its own rather than handing the path to a general "open this
/// path" command: the webview then cannot ask the host to launch an arbitrary
/// file, which is a capability this app has never had and does not need for a
/// palette entry that opens exactly one known document.
#[tauri::command]
pub fn settings_file_open(app: AppHandle) -> Result<(), String> {
    let path = ensure_settings_file(&app)?;
    open::that(&path).map_err(|error| format!("could not open {}: {error}", path.display()))
}

/// The settings file, created with just its version marker if absent.
fn ensure_settings_file<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        write_document(&path, &Map::new())?;
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir =
            std::env::temp_dir().join(format!("kavibay_settings_{}_{}", std::process::id(), nanos));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn section(path: &Path, name: &str) -> Option<Value> {
        load_document(path).unwrap().get(name).cloned()
    }

    fn sections(pairs: &[(&str, Value)]) -> Map<String, Value> {
        pairs
            .iter()
            .map(|(name, value)| ((*name).to_string(), value.clone()))
            .collect()
    }

    #[test]
    fn a_missing_file_reads_as_an_empty_document() {
        let dir = temp_dir();
        assert!(load_document(&dir.join(SETTINGS_FILE)).unwrap().is_empty());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_merge_leaves_every_other_section_alone() {
        let dir = temp_dir();
        let path = dir.join(SETTINGS_FILE);

        merge_into(
            &path,
            sections(&[("appearance", serde_json::json!({"fontId":"jakarta"}))]),
        )
        .unwrap();
        merge_into(
            &path,
            sections(&[("mcpServer", serde_json::json!({"port":43127}))]),
        )
        .unwrap();

        assert_eq!(
            section(&path, "appearance"),
            Some(serde_json::json!({"fontId":"jakarta"}))
        );
        assert_eq!(
            section(&path, "mcpServer"),
            Some(serde_json::json!({"port":43127}))
        );

        // The second writer replaces its own section without touching the first.
        merge_into(
            &path,
            sections(&[("mcpServer", serde_json::json!({"port":50000}))]),
        )
        .unwrap();
        assert_eq!(
            section(&path, "appearance"),
            Some(serde_json::json!({"fontId":"jakarta"}))
        );
        assert_eq!(
            section(&path, "mcpServer"),
            Some(serde_json::json!({"port":50000}))
        );

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_section_a_newer_build_wrote_survives_an_older_ones_save() {
        let dir = temp_dir();
        let path = dir.join(SETTINGS_FILE);
        fs::write(&path, r#"{"version":1,"telemetry":{"enabled":true}}"#).unwrap();

        merge_into(
            &path,
            sections(&[("appearance", serde_json::json!({"fontId":"manrope"}))]),
        )
        .unwrap();

        assert_eq!(
            section(&path, "telemetry"),
            Some(serde_json::json!({"enabled":true}))
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn the_version_field_is_stamped_and_cannot_be_written_as_a_section() {
        let dir = temp_dir();
        let path = dir.join(SETTINGS_FILE);

        merge_into(&path, sections(&[("appearance", serde_json::json!({}))])).unwrap();
        assert_eq!(section(&path, VERSION_FIELD), Some(Value::from(VERSION)));

        assert!(merge_into(&path, sections(&[(VERSION_FIELD, Value::from(99))])).is_err());
        assert_eq!(section(&path, VERSION_FIELD), Some(Value::from(VERSION)));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_broken_hand_edit_is_kept_aside_rather_than_overwritten() {
        let dir = temp_dir();
        let path = dir.join(SETTINGS_FILE);
        fs::write(&path, r#"{"appearance":{"fontId":"jakarta",}"#).unwrap();

        assert!(load_document(&path).unwrap().is_empty());

        let aside = path.with_extension("corrupt.json");
        assert!(aside.exists(), "the unreadable file must still be on disk");
        assert!(fs::read_to_string(&aside).unwrap().contains("jakarta"));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_document_that_is_not_an_object_is_refused() {
        assert!(parse_document("[1,2,3]").is_err());
        assert!(parse_document("\"text\"").is_err());
        assert!(parse_document("{}").is_ok());
    }

    #[test]
    fn a_byte_order_mark_from_a_text_editor_is_tolerated() {
        let parsed = parse_document("\u{feff}{\"appearance\":{}}").unwrap();
        assert!(parsed.contains_key("appearance"));
    }

    #[test]
    fn migration_moves_the_legacy_file_and_then_leaves_nothing_to_do() {
        let dir = temp_dir();
        let path = dir.join(SETTINGS_FILE);
        fs::write(dir.join("appearance.json"), r#"{"fontId":"jetbrains"}"#).unwrap();

        migrate_legacy_in(&dir).unwrap();
        assert_eq!(
            section(&path, "appearance"),
            Some(serde_json::json!({"fontId":"jetbrains"}))
        );
        assert!(!dir.join("appearance.json").exists());

        // Idempotent: a second pass changes nothing and does not fail.
        migrate_legacy_in(&dir).unwrap();
        assert_eq!(
            section(&path, "appearance"),
            Some(serde_json::json!({"fontId":"jetbrains"}))
        );

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn migration_does_not_overwrite_a_section_that_is_already_there() {
        let dir = temp_dir();
        let path = dir.join(SETTINGS_FILE);
        fs::write(&path, r#"{"appearance":{"fontId":"manrope"}}"#).unwrap();
        fs::write(dir.join("appearance.json"), r#"{"fontId":"jetbrains"}"#).unwrap();

        migrate_legacy_in(&dir).unwrap();

        assert_eq!(
            section(&path, "appearance"),
            Some(serde_json::json!({"fontId":"manrope"})),
            "settings.json is the newer format and wins"
        );
        assert!(
            !dir.join("appearance.json").exists(),
            "the legacy file is dead weight once the section exists"
        );

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn an_unreadable_legacy_file_is_left_where_it_is() {
        let dir = temp_dir();
        let path = dir.join(SETTINGS_FILE);
        fs::write(dir.join("appearance.json"), "{not json").unwrap();

        migrate_legacy_in(&dir).unwrap();

        assert_eq!(section(&path, "appearance"), None);
        assert!(
            dir.join("appearance.json").exists(),
            "a file we could not read is not a file we may delete"
        );

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn nothing_is_left_behind_by_the_atomic_write() {
        let dir = temp_dir();
        let path = dir.join(SETTINGS_FILE);
        merge_into(&path, sections(&[("appearance", serde_json::json!({}))])).unwrap();
        assert!(!path.with_extension("json.tmp").exists());
        let _ = fs::remove_dir_all(dir);
    }
}
