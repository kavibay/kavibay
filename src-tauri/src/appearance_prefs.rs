//! Durable storage for the onboarding tour's progress.
//!
//! WebView localStorage is convenient for immediate UI state, but its profile
//! can be recreated independently of the app data directory. Keep the actual
//! record in AppData so a new WebView never replays a finished tour.
//!
//! Appearance and Behavior used to live here too, in their own `appearance.json`
//! written alongside the localStorage copy. They are now one section of
//! `settings.json` (`settings_store`), reached through the same durable mirror
//! as everything else the frontend stores — one readable document instead of a
//! file per preference area, and one writer instead of two.
//!
//! The tour's progress has not moved: it is state, not a setting. Nobody wants
//! to hand-edit "has seen the tour", and putting it in the settings file would
//! invite exactly that.

use std::fs;
use std::path::PathBuf;

use tauri::AppHandle;

use crate::paths::data_dir;

fn onboarding_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("onboarding.json"))
}

#[tauri::command]
pub fn onboarding_preferences_load(app: AppHandle) -> Result<Option<String>, String> {
    match fs::read_to_string(onboarding_path(&app)?) {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn onboarding_preferences_save(app: AppHandle, value: String) -> Result<(), String> {
    let parsed: serde_json::Value = serde_json::from_str(&value)
        .map_err(|error| format!("invalid onboarding preferences: {error}"))?;
    if !parsed.is_object() {
        return Err("onboarding preferences must be an object".to_string());
    }
    fs::write(onboarding_path(&app)?, parsed.to_string()).map_err(|error| error.to_string())
}
