use super::ExtensionRust;

/// The uniform entry point: which root folder this belongs to, and what the
/// host declares on its behalf. Empty lists are the statement, not an
/// omission — this extension reaches no network host through the host layer.
pub const EXTENSION: ExtensionRust = ExtensionRust {
    folder: "image",
    capabilities: &[],
};

use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

const ALLOWED_EXT: &[&str] = &["png", "jpg", "jpeg", "gif", "webp"];

/// Sanitize instance id for use as a single path segment.
fn safe_instance_id(instance_id: &str) -> Result<String, String> {
    let s = instance_id.trim();
    if s.is_empty() {
        return Err("empty instance id".into());
    }
    if s == "." || s == ".." || s.contains("..") || s.contains('/') || s.contains('\\') {
        return Err("invalid instance id".into());
    }
    Ok(s.to_string())
}

fn extension_ok(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| ALLOWED_EXT.iter().any(|a| e.eq_ignore_ascii_case(a)))
        .unwrap_or(false)
}

fn instance_dir(app: &AppHandle, instance_id: &str) -> Result<PathBuf, String> {
    let id = safe_instance_id(instance_id)?;
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("image-widget")
        .join(id);
    Ok(base)
}

/// Copy a local image into app data for this instance; replace any previous file.
/// Returns the absolute destination path.
#[tauri::command]
pub fn image_widget_import(
    app: AppHandle,
    instance_id: String,
    source_path: String,
) -> Result<String, String> {
    let src = PathBuf::from(source_path.trim());
    if !src.is_file() {
        return Err("source is not a file".into());
    }
    if !extension_ok(&src) {
        return Err("unsupported image type".into());
    }

    let dir = instance_dir(&app, &instance_id)?;
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("bin")
        .to_ascii_lowercase();
    let dest = dir.join(format!("image.{ext}"));
    fs::copy(&src, &dest).map_err(|e| e.to_string())?;

    dest.into_os_string()
        .into_string()
        .map_err(|_| "non-utf8 destination path".into())
}

/// Delete this instance’s image directory if present.
#[tauri::command]
pub fn image_widget_clear(app: AppHandle, instance_id: String) -> Result<(), String> {
    let dir = instance_dir(&app, &instance_id)?;
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}
