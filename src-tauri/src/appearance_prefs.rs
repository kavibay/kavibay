//! Durable storage for Settings → Appearance and Settings → Behavior.
//!
//! WebView localStorage is convenient for immediate UI state, but its profile
//! can be recreated independently of the app data directory. Keep the actual
//! user preference in AppData so a new WebView never resets it to defaults.

use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

fn prefs_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join("appearance.json"))
}

fn onboarding_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join("onboarding.json"))
}

#[tauri::command]
pub fn appearance_preferences_load(app: AppHandle) -> Result<Option<String>, String> {
    let path = prefs_path(&app)?;
    match fs::read_to_string(path) {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn appearance_preferences_save(app: AppHandle, value: String) -> Result<(), String> {
    let parsed: serde_json::Value = serde_json::from_str(&value)
        .map_err(|error| format!("invalid appearance preferences: {error}"))?;
    if !parsed.is_object() {
        return Err("appearance preferences must be an object".to_string());
    }
    fs::write(prefs_path(&app)?, parsed.to_string()).map_err(|error| error.to_string())
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
