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

use tauri::AppHandle;

use crate::paths::data_dir;

const ALLOWED_EXT: &[&str] = &["png", "jpg", "jpeg", "gif", "webp"];

/// Sanitize instance id for use as a single path segment.
fn safe_instance_id(instance_id: &str) -> Result<String, String> {
    let s = instance_id.trim();
    if s.is_empty() {
        return Err("empty instance id".into());
    }
    // `:` because on Windows `base.join("C:")` is the drive's working directory,
    // and `image_widget_clear` runs `remove_dir_all` on whatever this yields.
    if s == "." || s.contains("..") || s.contains(['/', '\\', ':', '\0']) {
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
    let base = data_dir(app)?.join("image-widget").join(id);
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

#[cfg(test)]
mod tests {
    use super::safe_instance_id;

    #[test]
    fn instance_ids_stay_one_folder_under_the_widget_dir() {
        assert!(safe_instance_id("0b6c1f3e-7a52-4c1d-9e8f-2a4b6c8d0e1f").is_ok());
        assert!(safe_instance_id("inst-1730000000000-abc123").is_ok());
        for escape in [
            "",
            ".",
            "..",
            "a/b",
            "a\\b",
            "C:",
            "C:x",
            "\\\\server\\share",
        ] {
            assert!(
                safe_instance_id(escape).is_err(),
                "{escape:?} must be refused"
            );
        }
    }
}
