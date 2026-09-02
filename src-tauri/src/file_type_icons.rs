//! Per-extension file icons from the Windows shell.
//!
//! Keyed by extension, never by path: `SHGetFileInfoW` with
//! `SHGFI_USEFILEATTRIBUTES` resolves an icon from a *name* alone, without the
//! file existing or being touched. That is what makes this usable while
//! scrolling a folder — a 200-entry listing asks for a dozen icons, not 200,
//! and each one is answered once per session.
//!
//! Icons are whatever the user's machine has registered for that type, so they
//! match Explorer instead of imitating it.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

/// Key for entries with no extension (`LICENSE`, `Makefile`).
///
/// Directories have no key on purpose: every folder icon is the same shape, so
/// the palette's own drawn one says as much and keeps folders visually apart
/// from the colorful file icons next to them.
const FILE_KEY: &str = "file";

/// Rendered icons by `(key, size)`; a miss is cached as `None` so a type the
/// shell cannot answer for is not retried on every keystroke.
type IconCache = HashMap<(String, i32), Option<String>>;

fn cache() -> &'static Mutex<IconCache> {
    static CACHE: OnceLock<Mutex<IconCache>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Normalize a caller-supplied key: lowercase, no leading dot, no path parts.
fn normalize_key(raw: &str) -> Option<String> {
    let key = raw.trim().trim_start_matches('.').to_lowercase();
    if key.is_empty() {
        return None;
    }
    if key == FILE_KEY {
        return Some(key);
    }
    // Extensions only — anything with a separator would be a path, and a path
    // is exactly what this API is built to avoid needing.
    if key.contains('\\') || key.contains('/') || key.contains(':') || key.contains('\0') {
        return None;
    }
    Some(key)
}

/// PNG data URLs for the requested file-type keys (an extension, or `file`).
/// Keys the shell has no icon for are simply absent from the map.
#[tauri::command]
pub fn get_file_type_icons(
    keys: Vec<String>,
    size: Option<i32>,
) -> Result<HashMap<String, String>, String> {
    let size = size.unwrap_or(32).clamp(16, 256);
    let mut out = HashMap::new();

    for raw in keys.iter().take(64) {
        let Some(key) = normalize_key(raw) else {
            continue;
        };
        let cached = cache()
            .lock()
            .map_err(|_| "icon_cache_poisoned")?
            .get(&(key.clone(), size))
            .cloned();
        let icon = match cached {
            Some(hit) => hit,
            None => {
                let rendered = render_icon(&key, size);
                cache()
                    .lock()
                    .map_err(|_| "icon_cache_poisoned")?
                    .insert((key.clone(), size), rendered.clone());
                rendered
            }
        };
        if let Some(url) = icon {
            out.insert(key, url);
        }
    }

    Ok(out)
}

/// Ask the shell for one key's icon. `None` when this platform / type has none.
#[cfg(windows)]
fn render_icon(key: &str, size: i32) -> Option<String> {
    use crate::extensions::app_launcher::hicon_to_png_data_url;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::FILE_ATTRIBUTE_NORMAL;
    use windows::Win32::UI::Shell::{
        SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON, SHGFI_USEFILEATTRIBUTES,
    };
    use windows::Win32::UI::WindowsAndMessaging::DestroyIcon;

    // A name, not a path: with SHGFI_USEFILEATTRIBUTES the shell classifies by
    // the extension and never looks at the disk.
    let name = if key == FILE_KEY {
        "file".to_string()
    } else {
        format!("file.{key}")
    };
    let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
    let mut info = SHFILEINFOW::default();

    // SAFETY: `wide` is null-terminated and outlives the call; the returned
    // HICON is ours to destroy, which happens below on every path.
    let ok = unsafe {
        SHGetFileInfoW(
            PCWSTR(wide.as_ptr()),
            FILE_ATTRIBUTE_NORMAL,
            Some(&mut info),
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_LARGEICON | SHGFI_USEFILEATTRIBUTES,
        )
    };
    if ok == 0 || info.hIcon.is_invalid() {
        return None;
    }

    let rendered = hicon_to_png_data_url(info.hIcon, size).ok();
    unsafe {
        let _ = DestroyIcon(info.hIcon);
    }
    rendered
}

/// Other platforms fall back to the palette's own drawn icons.
#[cfg(not(windows))]
fn render_icon(_key: &str, _size: i32) -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::{get_file_type_icons, normalize_key};

    #[test]
    fn normalizes_extensions() {
        assert_eq!(normalize_key(".PDF").as_deref(), Some("pdf"));
        assert_eq!(normalize_key("  mp4 ").as_deref(), Some("mp4"));
        assert_eq!(normalize_key("file").as_deref(), Some("file"));
        assert_eq!(normalize_key(""), None);
        assert_eq!(normalize_key("."), None);
    }

    #[test]
    fn rejects_paths_masquerading_as_extensions() {
        assert_eq!(normalize_key("C:\\Windows\\notepad.exe"), None);
        assert_eq!(normalize_key("../secret"), None);
    }

    #[cfg(windows)]
    #[test]
    fn returns_icons_for_common_types() {
        let icons = get_file_type_icons(vec![".txt".into(), "pdf".into(), "file".into()], Some(32))
            .unwrap();
        for key in ["txt", "pdf", "file"] {
            let url = icons
                .get(key)
                .unwrap_or_else(|| panic!("no icon for {key}"));
            assert!(
                url.starts_with("data:image/png;base64,"),
                "{key} is a PNG url"
            );
        }
    }

    #[test]
    fn unknown_keys_are_absent_not_errors() {
        let icons = get_file_type_icons(vec!["".into(), "a/b".into()], Some(32)).unwrap();
        assert!(icons.is_empty());
    }
}
