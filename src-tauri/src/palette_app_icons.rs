//! Disk cache for palette app icons under `{data_dir}/cache/palette-app-icons/`.
//!
//! In `cache/` rather than beside the settings because every file here is
//! re-extracted from the executable it belongs to. Deleting the folder costs a
//! few milliseconds the next time the palette draws that row, nothing else.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use sha2::{Digest, Sha256};
use tauri::AppHandle;

use crate::paths::cache_dir;

const CACHE_DIR: &str = "palette-app-icons";

/// Normalize a filesystem path for stable cache keys across platforms.
pub fn normalize_icon_path_key(path: &str) -> String {
    path.trim().replace('\\', "/").to_ascii_lowercase()
}

fn path_key_hash(normalized: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(normalized.as_bytes());
    hex_encode(hasher.finalize().as_slice())
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0xf) as usize] as char);
    }
    out
}

fn icons_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(cache_dir(app)?.join(CACHE_DIR))
}

/// Resolve `{data_dir}/cache/palette-app-icons/{sha256_hex}.png` for a launch path.
pub fn icon_cache_file(app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    let key = normalize_icon_path_key(path);
    let hash = path_key_hash(&key);
    Ok(icons_dir(app)?.join(format!("{hash}.png")))
}

/// Return a PNG data URL when a cached icon file exists on disk.
pub fn read_cached_app_icon(app: &AppHandle, path: &str) -> Option<String> {
    let file = icon_cache_file(app, path).ok()?;
    if !file.is_file() {
        return None;
    }
    let bytes = fs::read(&file).ok()?;
    if bytes.is_empty() {
        return None;
    }
    let b64 = STANDARD.encode(&bytes);
    Some(format!("data:image/png;base64,{b64}"))
}

/// Persist PNG bytes for a launch path (creates the cache directory if needed).
///
/// Only the platforms that can extract an icon in the first place ever write one.
#[cfg(any(windows, target_os = "macos"))]
pub fn write_cached_app_icon(app: &AppHandle, path: &str, png_bytes: &[u8]) -> Result<(), String> {
    let file = icon_cache_file(app, path)?;
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&file, png_bytes).map_err(|e| e.to_string())
}

/// Batch-read cached icons; only returns paths with disk hits (no shell extract).
#[tauri::command]
pub fn get_cached_app_icons(
    app: AppHandle,
    paths: Vec<String>,
) -> Result<HashMap<String, String>, String> {
    let mut out = HashMap::new();
    for path in paths {
        if let Some(url) = read_cached_app_icon(&app, &path) {
            out.insert(path, url);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_slashes() {
        assert_eq!(
            normalize_icon_path_key(r"C:\Apps\Foo.exe"),
            "c:/apps/foo.exe"
        );
        assert_eq!(
            normalize_icon_path_key("/Applications/Foo.app"),
            "/applications/foo.app"
        );
    }
}
