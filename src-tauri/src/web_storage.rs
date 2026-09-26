//! Durable copy of the WebView's `kavibay:` localStorage keyspace.
//!
//! Widget content — notes, alarms, timers, the desk layout — lived only in the
//! WebView profile, and that profile is not a reliable place to keep anything:
//! it can be recreated independently of the app data directory, and a WebView2
//! that never shuts down gracefully may hold writes in memory and lose them
//! with the process. `appearance_prefs` already exists for exactly that reason;
//! this is the same idea for everything else the frontend stores.
//!
//! The frontend keeps writing localStorage as its fast synchronous cache and
//! mirrors the keyspace here; on the next start it hydrates from this file.
//!
//! # At rest
//!
//! The payload is wrapped with the same OS-backed protection as credentials
//! (`security::secrets`: DPAPI on Windows, a Keychain-held key on macOS), so a
//! copy of this file cannot be read on another machine or under another account. That is the only
//! threat it addresses: anything running as this user can still read it, and so
//! can the WebView's own localStorage — see SECURITY.md.
//!
//! Where no secret backend exists (Linux today), the snapshot
//! is written in plaintext rather than not at all. Credentials fail closed there
//! because an unstored token is an inconvenience; this file is the *only* copy of
//! the user's notes, and refusing to write it would reintroduce the data loss it
//! was built to fix. The trade is deliberate, logged, and documented.

use std::fs;
use std::path::PathBuf;

use serde_json::{json, Value};
use tauri::AppHandle;

use crate::paths::data_dir;
use crate::security::secrets::{protect_secret, unprotect_secret};

/// Envelope field holding the protected payload.
///
/// An explicit marker rather than "try to decrypt, fall back to plaintext":
/// the file stays valid JSON in both shapes, the format is obvious to whoever
/// opens it, and a protected blob that fails to decrypt is never mistaken for
/// a plaintext snapshot to be replaced.
const PROTECTED_FIELD: &str = "protected";

fn storage_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("web-storage.json"))
}

/// A snapshot is a flat map of strings — localStorage has no other value type,
/// and refusing anything else keeps a malformed write from replacing a good file.
fn as_string_map(value: &Value) -> Option<&serde_json::Map<String, Value>> {
    let map = value.as_object()?;
    map.values().all(Value::is_string).then_some(map)
}

/// Move an unusable file aside instead of letting the next save overwrite it.
///
/// The data may still be recoverable — by hand, or by the user and machine
/// whose key it belongs to — and it never gets a second chance if the mirror writes
/// over it first.
fn quarantine(path: &PathBuf, reason: &str) -> Result<(), String> {
    let aside = path.with_extension("corrupt.json");
    fs::rename(path, &aside)
        .map_err(|error| format!("{reason}, and moving the file aside failed: {error}"))?;
    eprintln!("[web_storage] {reason}; kept as {}", aside.display());
    Ok(())
}

/// Read the durable snapshot, or `None` when there is nothing usable to restore.
#[tauri::command]
pub fn web_storage_load(app: AppHandle) -> Result<Option<String>, String> {
    let path = storage_path(&app)?;
    let raw = match fs::read_to_string(&path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };

    // A hand edit in Notepad leaves a BOM, which `JSON.parse` refuses.
    let text = raw.trim_start_matches('\u{feff}');
    let Ok(envelope) = serde_json::from_str::<Value>(text) else {
        quarantine(&path, "snapshot is not valid JSON")?;
        return Ok(None);
    };

    let protected = envelope
        .as_object()
        .and_then(|map| map.get(PROTECTED_FIELD))
        .and_then(Value::as_str);

    let Some(blob) = protected else {
        // No envelope: a plaintext snapshot, either from a build without a
        // secret backend or from before this file was protected. Usable as is —
        // the next save re-writes it in whatever shape this platform supports.
        return match as_string_map(&envelope) {
            Some(_) => Ok(Some(text.to_string())),
            None => {
                quarantine(&path, "snapshot is not a flat string map")?;
                Ok(None)
            }
        };
    };

    let Ok(payload) = unprotect_secret(blob) else {
        // Wrong user profile or wrong machine. Nothing to do here but keep it:
        // on the machine it came from, this file is still perfectly readable.
        quarantine(&path, "snapshot cannot be decrypted by this user")?;
        return Ok(None);
    };

    match serde_json::from_str::<Value>(&payload).ok().as_ref() {
        Some(value) if as_string_map(value).is_some() => Ok(Some(payload)),
        _ => {
            quarantine(&path, "decrypted snapshot is not a flat string map")?;
            Ok(None)
        }
    }
}

/// Replace the durable snapshot.
///
/// Written to a sibling temp file and renamed into place: this file is rewritten
/// on every debounce tick, and a half-written snapshot after a crash would lose
/// far more than the tick that was in flight. `fs::rename` replaces the target
/// atomically on both Windows and Unix.
#[tauri::command]
pub fn web_storage_save(app: AppHandle, value: String) -> Result<(), String> {
    let parsed: Value =
        serde_json::from_str(&value).map_err(|error| format!("invalid web storage: {error}"))?;
    if as_string_map(&parsed).is_none() {
        return Err("web storage must be an object of strings".to_string());
    }

    let payload = parsed.to_string();
    let body = match protect_secret(&payload) {
        Ok(blob) => json!({ PROTECTED_FIELD: blob }).to_string(),
        Err(error) => {
            // See the module docs: losing the notes is the worse failure.
            eprintln!("[web_storage] storing unprotected ({error})");
            payload
        }
    };

    let path = storage_path(&app)?;
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, body).map_err(|error| error.to_string())?;
    fs::rename(&temp, &path).map_err(|error| error.to_string())
}
