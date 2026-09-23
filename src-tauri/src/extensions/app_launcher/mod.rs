//! Launch local paths / URLs and extract icons (shell or HTML page).

use super::ExtensionRust;

/// The uniform entry point: which root folder this belongs to, and what the
/// host declares on its behalf. Empty lists are the statement, not an
/// omission — this extension reaches no network host through the host layer.
pub const EXTENSION: ExtensionRust = ExtensionRust {
    folder: "launcher-buttons",
    capabilities: &[],
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use image::{imageops::FilterType, DynamicImage};
use regex::Regex;
use std::io::Cursor;
use std::path::Path;
use std::sync::OnceLock;
use tauri::AppHandle;
use url::Url;

#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;
// Only `rgba_to_png_data_url` needs these, and that is the shell-icon path.
#[cfg(windows)]
use image::{ImageBuffer, RgbaImage};

/// True for http(s) launcher targets (skip filesystem existence checks).
#[cfg(any(windows, target_os = "macos"))]
fn is_http_url(path: &str) -> bool {
    let p = path.trim().to_ascii_lowercase();
    p.starts_with("http://") || p.starts_with("https://")
}

/// True for `shell:AppsFolder\…` Start-apps targets (not real filesystem paths).
#[cfg(windows)]
fn is_shell_apps_folder(path: &str) -> bool {
    path.trim()
        .to_ascii_lowercase()
        .starts_with("shell:appsfolder\\")
        || path
            .trim()
            .to_ascii_lowercase()
            .starts_with("shell:appsfolder/")
}

/// Open a file, shortcut, folder, or http(s) URL with the shell (`ShellExecuteW` / `open`).
#[tauri::command]
pub fn launch_path(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        launch_path_windows(&path)
    }
    #[cfg(target_os = "macos")]
    {
        return launch_path_macos(&path);
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = path;
        Err("App launcher launch is only supported on Windows and macOS".into())
    }
}

/// Open Windows Search (`search-ms:`) with an optional query string.
#[tauri::command]
pub fn open_windows_search(query: String) -> Result<(), String> {
    #[cfg(not(windows))]
    {
        let _ = query;
        return Err("Windows Search is only supported on Windows".into());
    }
    #[cfg(windows)]
    {
        open_windows_search_windows(&query)
    }
}

/// Extract the shell icon for a path and return a PNG data URL.
/// Returns a disk cache hit when available; writes PNG to cache after extract.
#[tauri::command]
pub fn extract_app_icon(app: AppHandle, path: String) -> Result<String, String> {
    if let Some(cached) = crate::palette_app_icons::read_cached_app_icon(&app, &path) {
        return Ok(cached);
    }

    #[cfg(windows)]
    {
        let url = extract_app_icon_windows(&path)?;
        if let Some(png) = decode_png_data_url(&url) {
            let _ = crate::palette_app_icons::write_cached_app_icon(&app, &path, &png);
        }
        Ok(url)
    }
    #[cfg(target_os = "macos")]
    {
        let url = extract_app_icon_macos(&path)?;
        if let Some(png) = decode_png_data_url(&url) {
            let _ = crate::palette_app_icons::write_cached_app_icon(&app, &path, &png);
        }
        return Ok(url);
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = (app, path);
        Err("App launcher icons are only supported on Windows and macOS".into())
    }
}

/// Decode `data:image/png;base64,…` into raw PNG bytes (for disk cache writes).
#[cfg(any(windows, target_os = "macos"))]
fn decode_png_data_url(url: &str) -> Option<Vec<u8>> {
    const PREFIX: &str = "data:image/png;base64,";
    if !url.starts_with(PREFIX) {
        return None;
    }
    STANDARD.decode(&url[PREFIX.len()..]).ok()
}

/// Max raw GIF size kept as-is (animation preserved). Larger files become a still PNG frame.
const MAX_GIF_PASS_THROUGH_BYTES: usize = 2 * 1024 * 1024;

/// Load a user-picked image file and return a data URL for a custom launcher icon.
/// GIFs are kept as `image/gif` when small enough so animation still plays in the dock.
#[tauri::command]
pub fn load_local_icon(path: String) -> Result<String, String> {
    let p = Path::new(path.trim());
    if !p.is_file() {
        return Err("Datei nicht gefunden".into());
    }
    let bytes = std::fs::read(p).map_err(|e| e.to_string())?;

    if is_gif_bytes(&bytes, p) && bytes.len() <= MAX_GIF_PASS_THROUGH_BYTES {
        let b64 = STANDARD.encode(&bytes);
        return Ok(format!("data:image/gif;base64,{b64}"));
    }

    let img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?;
    // Cap huge uploads so persisted data URLs stay reasonable.
    let img = if img.width() > 256 || img.height() > 256 {
        img.resize(256, 256, FilterType::Lanczos3)
    } else {
        img
    };
    let mut png_bytes = Cursor::new(Vec::new());
    img.write_to(&mut png_bytes, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    let b64 = STANDARD.encode(png_bytes.into_inner());
    Ok(format!("data:image/png;base64,{b64}"))
}

/// True when the file looks like a GIF (extension and/or magic header).
fn is_gif_bytes(bytes: &[u8], path: &Path) -> bool {
    let by_ext = path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("gif"));
    let by_magic = bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a");
    by_ext || by_magic
}

/// Encodes a path as a null-terminated UTF-16 buffer for Win32 wide-string APIs.
#[cfg(windows)]
fn wide(path: &str) -> Vec<u16> {
    std::ffi::OsStr::new(path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

/// Send a curated virtual key (media / browser / system) via `SendInput`.
#[tauri::command]
pub fn send_virtual_key(key_id: String) -> Result<(), String> {
    #[cfg(not(windows))]
    {
        let _ = key_id;
        return Err("Virtual keys are only supported on Windows".into());
    }
    #[cfg(windows)]
    {
        send_virtual_key_windows(key_id.trim())
    }
}

/// Map catalog id → Windows VK code (must stay in sync with `appLauncherKeys.ts`).
#[cfg(windows)]
fn virtual_key_code(key_id: &str) -> Option<u16> {
    // https://learn.microsoft.com/en-us/windows/win32/inputdev/virtual-key-codes
    Some(match key_id {
        "media_next" => 0xB0,       // VK_MEDIA_NEXT_TRACK
        "media_prev" => 0xB1,       // VK_MEDIA_PREV_TRACK
        "media_stop" => 0xB2,       // VK_MEDIA_STOP
        "media_play_pause" => 0xB3, // VK_MEDIA_PLAY_PAUSE
        "vol_mute" => 0xAD,         // VK_VOLUME_MUTE
        "vol_down" => 0xAE,         // VK_VOLUME_DOWN
        "vol_up" => 0xAF,           // VK_VOLUME_UP
        "browser_back" => 0xA6,     // VK_BROWSER_BACK
        "browser_forward" => 0xA7,  // VK_BROWSER_FORWARD
        "browser_refresh" => 0xA8,  // VK_BROWSER_REFRESH
        "browser_home" => 0xAC,     // VK_BROWSER_HOME
        "browser_search" => 0xAA,   // VK_BROWSER_SEARCH
        "launch_mail" => 0xB4,      // VK_LAUNCH_MAIL
        "launch_media" => 0xB5,     // VK_LAUNCH_MEDIA_SELECT
        "print_screen" => 0x2C,     // VK_SNAPSHOT
        "escape" => 0x1B,           // VK_ESCAPE
        _ => return None,
    })
}

/// Press and release a single virtual key system-wide.
#[cfg(windows)]
fn send_virtual_key_windows(key_id: &str) -> Result<(), String> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
        VIRTUAL_KEY,
    };

    let vk = virtual_key_code(key_id).ok_or_else(|| format!("Unbekannte Taste: {key_id}"))?;

    let key_down = INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(vk),
                wScan: 0,
                dwFlags: KEYBD_EVENT_FLAGS(0),
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    let key_up = INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(vk),
                wScan: 0,
                dwFlags: KEYEVENTF_KEYUP,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    let inputs = [key_down, key_up];

    // SAFETY: `inputs` is a valid KEYBOARD INPUT pair for SendInput.
    let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
    if sent as usize != inputs.len() {
        return Err("Tastendruck fehlgeschlagen".into());
    }
    Ok(())
}

/// Fetch a page's best site icon (apple-touch / rel=icon; favicon last) as a PNG data URL.
/// Intentionally ignores og/twitter images — those are wide promo art, not square icons.
#[tauri::command]
pub async fn fetch_url_icon(url: String) -> Result<String, String> {
    fetch_url_icon_impl(url.trim()).await
}

/// The site's own icons, best first; `/favicon.ico` when its HTML names none.
///
/// Only the site is asked. Google's and DuckDuckGo's favicon services used to
/// go first, which told both of them the host of every button — an intranet
/// one included.
async fn fetch_url_icon_impl(url: &str) -> Result<String, String> {
    let page_url = Url::parse(url).map_err(|e| format!("Ungültige URL: {e}"))?;
    if page_url.scheme() != "http" && page_url.scheme() != "https" {
        return Err("Nur http(s) URLs werden unterstützt".into());
    }

    // 1) <link rel=icon|apple-touch-icon> from a size-capped HTML fetch —
    //    usually a 180px touch icon, far sharper than a favicon.ico.
    if let Ok(html) = fetch_html_head(&page_url).await {
        let mut candidates = collect_icon_candidates(&html, &page_url);
        candidates.sort_by(|a, b| b.pixels.cmp(&a.pixels).then(b.priority.cmp(&a.priority)));
        for cand in &candidates {
            if let Ok(data_url) = download_as_png_data_url(&cand.href).await {
                return Ok(data_url);
            }
        }
    }

    // 2) Classic /favicon.ico on the site origin.
    if let Ok(favicon) = page_url.join("/favicon.ico") {
        if let Ok(data_url) = download_as_png_data_url(&favicon).await {
            return Ok(data_url);
        }
    }

    Err("Kein Icon gefunden".into())
}

const ICON_FETCH_REDIRECTS: usize = 5;

/// One GET with every hop dialled at an address `net_guard` allowed.
///
/// The page url is the user's, but its redirects and the icon links in its
/// HTML are the site's: without this, a page could send the host process to
/// 169.254.169.254 or anything else this machine can reach. `UserSupplied`
/// keeps the router and the intranet reachable — people add those as buttons
/// on purpose — and refuses link-local.
async fn vetted_get(url: &Url) -> Result<reqwest::Response, String> {
    let mut url = url.clone();
    for _ in 0..=ICON_FETCH_REDIRECTS {
        if url.scheme() != "http" && url.scheme() != "https" {
            return Err("Nur http(s) URLs werden unterstützt".into());
        }
        let address = crate::runtime_extensions::http::vetted_address_with(
            &url,
            crate::runtime_extensions::net_guard::AddressPolicy::UserSupplied,
        )
        .await?;
        let host = url.host_str().ok_or("Ungültige URL")?.to_string();
        let response = reqwest::Client::builder()
            .user_agent("KavibayAppLauncher/1.0")
            .timeout(std::time::Duration::from_secs(6))
            .redirect(reqwest::redirect::Policy::none())
            .resolve(&host, address)
            .build()
            .map_err(|e| e.to_string())?
            .get(url.clone())
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !response.status().is_redirection() {
            return Ok(response);
        }
        let location = response
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|value| value.to_str().ok())
            .ok_or("Weiterleitung ohne Ziel")?;
        url = url.join(location).map_err(|e| e.to_string())?;
    }
    Err("Zu viele Weiterleitungen".into())
}

/// Download only the start of the document (icons live in <head>).
async fn fetch_html_head(page_url: &Url) -> Result<String, String> {
    const MAX_BYTES: usize = 64 * 1024;
    let mut response = vetted_get(page_url)
        .await
        .map_err(|e| format!("Seite nicht erreichbar: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Seite nicht erreichbar: {e}"))?;

    let mut buf = Vec::with_capacity(MAX_BYTES.min(8 * 1024));
    while buf.len() < MAX_BYTES {
        match response.chunk().await {
            Ok(Some(chunk)) => {
                let take = (MAX_BYTES - buf.len()).min(chunk.len());
                buf.extend_from_slice(&chunk[..take]);
                if take < chunk.len() {
                    break;
                }
            }
            Ok(None) => break,
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

struct IconCandidate {
    href: Url,
    /// Estimated edge length in pixels (larger preferred).
    pixels: u32,
    /// Tie-breaker: apple-touch > sized icon > bare favicon.
    priority: u8,
}

/// Parse `<link rel="icon|apple-touch-icon|…">` from HTML (no og/twitter images).
fn collect_icon_candidates(html: &str, base: &Url) -> Vec<IconCandidate> {
    let mut out = Vec::new();
    let link_re = link_tag_regex();
    for tag in link_re.find_iter(html) {
        let tag = tag.as_str();
        let rel = attr_value(tag, "rel")
            .unwrap_or_default()
            .to_ascii_lowercase();
        let href = match attr_value(tag, "href") {
            Some(h) => h,
            None => continue,
        };
        let sizes = attr_value(tag, "sizes");
        let (pixels, priority) = score_link_rel(&rel, sizes.as_deref());
        if priority == 0 {
            continue;
        }
        if let Ok(abs) = base.join(&href) {
            out.push(IconCandidate {
                href: abs,
                pixels,
                priority,
            });
        }
    }

    out
}

fn link_tag_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"(?is)<link\b[^>]*>"#).expect("link regex"))
}

fn attr_value(tag: &str, name: &str) -> Option<String> {
    let pattern = format!(
        r#"(?i)\b{}\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))"#,
        regex::escape(name)
    );
    let re = Regex::new(&pattern).ok()?;
    let caps = re.captures(tag)?;
    caps.get(1)
        .or_else(|| caps.get(2))
        .or_else(|| caps.get(3))
        .map(|m| m.as_str().trim().to_string())
}

/// Score a `<link rel>`: prefer apple-touch and large sized icons; demote bare favicons.
fn score_link_rel(rel: &str, sizes: Option<&str>) -> (u32, u8) {
    let tokens: Vec<&str> = rel.split_whitespace().collect();
    let size = parse_max_size(sizes);

    if tokens.iter().any(|t| t.contains("apple-touch-icon")) {
        return (size.unwrap_or(180), 100);
    }
    if tokens.contains(&"icon") {
        // Sized icons (e.g. 192x192) beat unknown/small favicons.
        if let Some(px) = size {
            return (px, 90);
        }
        return (32, 40);
    }
    if tokens.iter().any(|t| t.contains("shortcut")) {
        return (size.unwrap_or(16), 20);
    }
    (0, 0)
}

fn parse_max_size(sizes: Option<&str>) -> Option<u32> {
    let sizes = sizes?;
    if sizes.eq_ignore_ascii_case("any") {
        return Some(512);
    }
    let mut max = 0u32;
    for part in sizes.split_whitespace() {
        let part = part.to_ascii_lowercase();
        let Some((w, h)) = part.split_once('x') else {
            continue;
        };
        let (Ok(w), Ok(h)) = (w.parse::<u32>(), h.parse::<u32>()) else {
            continue;
        };
        max = max.max(w.max(h));
    }
    if max > 0 {
        Some(max)
    } else {
        None
    }
}

/// Download an image URL and encode a (optionally downscaled) PNG data URL.
async fn download_as_png_data_url(href: &Url) -> Result<String, String> {
    let bytes = vetted_get(href)
        .await?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;

    if bytes.is_empty() {
        return Err("leeres Icon".into());
    }

    // Skip SVG (not supported by the image crate without extra tooling).
    let looks_svg = bytes.starts_with(b"<svg")
        || bytes.starts_with(b"<?xml")
        || href.path().to_ascii_lowercase().ends_with(".svg");
    if looks_svg {
        return Err("SVG nicht unterstützt".into());
    }

    let img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?;
    let img = downscale_icon(img);
    let mut png_bytes = Cursor::new(Vec::new());
    img.write_to(&mut png_bytes, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    let b64 = STANDARD.encode(png_bytes.into_inner());
    Ok(format!("data:image/png;base64,{b64}"))
}

/// Cap the longest edge so og:image-sized assets stay dock-friendly.
fn downscale_icon(img: DynamicImage) -> DynamicImage {
    const MAX: u32 = 128;
    let w = img.width();
    let h = img.height();
    if w <= MAX && h <= MAX {
        return img;
    }
    let (nw, nh) = if w >= h {
        (
            MAX,
            (h as f32 * MAX as f32 / w as f32).round().max(1.0) as u32,
        )
    } else {
        (
            (w as f32 * MAX as f32 / h as f32).round().max(1.0) as u32,
            MAX,
        )
    };
    img.resize(nw, nh, FilterType::Lanczos3)
}

#[cfg(windows)]
fn launch_path_windows(path: &str) -> Result<(), String> {
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    if !is_http_url(path) && !is_shell_apps_folder(path) && !Path::new(path).exists() {
        return Err("Pfad nicht gefunden".into());
    }

    let file = wide(path);
    let operation: Vec<u16> = "open".encode_utf16().chain(std::iter::once(0)).collect();

    // SAFETY: path/operation are null-terminated wide strings; ShellExecuteW is the
    // standard way to open files/folders/shortcuts with the default association.
    let result = unsafe {
        ShellExecuteW(
            None,
            PCWSTR(operation.as_ptr()),
            PCWSTR(file.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };

    // Per MSDN, return value > 32 means success.
    if (result.0 as usize) <= 32 {
        return Err(format!("Start fehlgeschlagen (code {})", result.0 as usize));
    }
    Ok(())
}

#[cfg(windows)]
fn open_windows_search_windows(query: &str) -> Result<(), String> {
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let term = query.trim();
    let uri = if term.is_empty() {
        "search-ms:".to_string()
    } else {
        // search-ms: expects encodeURIComponent-style encoding (%20 for spaces, not +).
        let encoded: String = term
            .chars()
            .map(|c| match c {
                'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
                _ => {
                    let mut buf = [0u8; 4];
                    let s = c.encode_utf8(&mut buf);
                    s.as_bytes()
                        .iter()
                        .map(|b| format!("%{b:02X}"))
                        .collect::<String>()
                }
            })
            .collect();
        format!("search-ms:query={encoded}")
    };

    let file = wide(&uri);
    let operation: Vec<u16> = "open".encode_utf16().chain(std::iter::once(0)).collect();

    // SAFETY: null-terminated wide strings for ShellExecuteW open.
    let result = unsafe {
        ShellExecuteW(
            None,
            PCWSTR(operation.as_ptr()),
            PCWSTR(file.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };

    if (result.0 as usize) <= 32 {
        return Err(format!(
            "Windows Search failed (code {})",
            result.0 as usize
        ));
    }
    Ok(())
}

/// Target pixel size for extracted dock / picker icons (high-DPI source).
#[cfg(windows)]
const EXTRACT_ICON_PX: i32 = 256;

/// True when `path` is a `.lnk` shortcut file.
#[cfg(windows)]
fn path_is_lnk(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("lnk"))
}

/// Ensure COM is initialized on this thread (Tauri may already have done so).
#[cfg(windows)]
fn ensure_com() {
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
    // SAFETY: process-wide COM init; ignore already-initialized / mode-changed HRESULTs.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
    }
}

/// Expand `%VAR%` segments in a path (common in shortcut icon locations).
#[cfg(windows)]
fn expand_env_path(path: &str) -> String {
    use windows::core::PCWSTR;
    use windows::Win32::System::Environment::ExpandEnvironmentStringsW;

    let wide_in = wide(path);
    // SAFETY: null-terminated input; first call sizes the buffer.
    let needed = unsafe { ExpandEnvironmentStringsW(PCWSTR(wide_in.as_ptr()), None) };
    if needed == 0 {
        return path.to_string();
    }
    let mut buf = vec![0u16; needed as usize];
    let written = unsafe { ExpandEnvironmentStringsW(PCWSTR(wide_in.as_ptr()), Some(&mut buf)) };
    if written == 0 {
        return path.to_string();
    }
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..end])
}

/// Decode a UTF-16 buffer that may contain a trailing NUL into a Rust string.
#[cfg(windows)]
fn wide_to_string(buf: &[u16]) -> String {
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..end])
}

/// Encode RGBA pixels as a PNG data URL.
#[cfg(windows)]
fn rgba_to_png_data_url(width: u32, height: u32, mut pixels: Vec<u8>) -> Result<String, String> {
    // Older/legacy icons without alpha: treat non-black pixels as opaque.
    let fully_transparent = pixels.as_chunks::<4>().0.iter().all(|p| p[3] == 0);
    if fully_transparent {
        for chunk in pixels.as_chunks_mut::<4>().0 {
            if chunk[0] != 0 || chunk[1] != 0 || chunk[2] != 0 {
                chunk[3] = 255;
            }
        }
    }

    let img: RgbaImage = ImageBuffer::from_raw(width, height, pixels)
        .ok_or_else(|| "ImageBuffer failed".to_string())?;
    let mut png_bytes = Cursor::new(Vec::new());
    img.write_to(&mut png_bytes, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    let b64 = STANDARD.encode(png_bytes.into_inner());
    Ok(format!("data:image/png;base64,{b64}"))
}

/// Rasterize an `HICON` into a PNG data URL at `size`×`size`.
#[cfg(windows)]
pub(crate) fn hicon_to_png_data_url(
    hicon: windows::Win32::UI::WindowsAndMessaging::HICON,
    size: i32,
) -> Result<String, String> {
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, GetDIBits, ReleaseDC,
        SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
    };
    use windows::Win32::UI::WindowsAndMessaging::{DrawIconEx, DI_NORMAL};

    // SAFETY: GDI objects created below are released before returning.
    unsafe {
        let screen_dc = GetDC(None);
        if screen_dc.is_invalid() {
            return Err("GetDC failed".into());
        }
        let mem_dc = CreateCompatibleDC(Some(screen_dc));
        if mem_dc.is_invalid() {
            ReleaseDC(None, screen_dc);
            return Err("CreateCompatibleDC failed".into());
        }

        let header = BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: size,
            biHeight: -size, // top-down DIB
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            biSizeImage: 0,
            biXPelsPerMeter: 0,
            biYPelsPerMeter: 0,
            biClrUsed: 0,
            biClrImportant: 0,
        };
        let mut bmi = BITMAPINFO {
            bmiHeader: header,
            bmiColors: [Default::default()],
        };

        // 32bpp DIB section keeps a real alpha channel for DrawIconEx.
        let mut bits_ptr: *mut core::ffi::c_void = std::ptr::null_mut();
        let bmp = match CreateDIBSection(Some(mem_dc), &bmi, DIB_RGB_COLORS, &mut bits_ptr, None, 0)
        {
            Ok(bmp) if !bmp.is_invalid() && !bits_ptr.is_null() => bmp,
            _ => {
                let _ = DeleteDC(mem_dc);
                ReleaseDC(None, screen_dc);
                return Err("CreateDIBSection failed".into());
            }
        };
        std::ptr::write_bytes(bits_ptr as *mut u8, 0, (size * size * 4) as usize);

        let old = SelectObject(mem_dc, HGDIOBJ(bmp.0));
        let drawn = DrawIconEx(mem_dc, 0, 0, hicon, size, size, 0, None, DI_NORMAL);
        if drawn.is_err() {
            SelectObject(mem_dc, old);
            let _ = DeleteObject(HGDIOBJ(bmp.0));
            let _ = DeleteDC(mem_dc);
            ReleaseDC(None, screen_dc);
            return Err("DrawIconEx failed".into());
        }

        let mut pixels = vec![0u8; (size * size * 4) as usize];
        let lines = GetDIBits(
            mem_dc,
            bmp,
            0,
            size as u32,
            Some(pixels.as_mut_ptr() as *mut _),
            &mut bmi,
            DIB_RGB_COLORS,
        );

        SelectObject(mem_dc, old);
        let _ = DeleteObject(HGDIOBJ(bmp.0));
        let _ = DeleteDC(mem_dc);
        ReleaseDC(None, screen_dc);

        if lines == 0 {
            return Err("GetDIBits failed".into());
        }

        // BGRA → RGBA
        for chunk in pixels.as_chunks_mut::<4>().0 {
            chunk.swap(0, 2);
        }

        rgba_to_png_data_url(size as u32, size as u32, pixels)
    }
}

/// Convert a shell `HBITMAP` (typically 32bpp BGRA) into a PNG data URL; destroys the bitmap.
#[cfg(windows)]
fn hbitmap_to_png_data_url(hbmp: windows::Win32::Graphics::Gdi::HBITMAP) -> Result<String, String> {
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC,
        BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
    };

    // SAFETY: `hbmp` is owned by the caller; we always DeleteObject before return.
    unsafe {
        let mut bm = BITMAP::default();
        let got = GetObjectW(
            HGDIOBJ(hbmp.0),
            std::mem::size_of::<BITMAP>() as i32,
            Some(&mut bm as *mut _ as *mut _),
        );
        if got == 0 || bm.bmWidth <= 0 || bm.bmHeight == 0 {
            let _ = DeleteObject(HGDIOBJ(hbmp.0));
            return Err("GetObjectW failed".into());
        }

        let width = bm.bmWidth;
        let height = bm.bmHeight.abs();

        let screen_dc = GetDC(None);
        if screen_dc.is_invalid() {
            let _ = DeleteObject(HGDIOBJ(hbmp.0));
            return Err("GetDC failed".into());
        }
        let mem_dc = CreateCompatibleDC(Some(screen_dc));
        if mem_dc.is_invalid() {
            ReleaseDC(None, screen_dc);
            let _ = DeleteObject(HGDIOBJ(hbmp.0));
            return Err("CreateCompatibleDC failed".into());
        }

        let header = BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            biSizeImage: 0,
            biXPelsPerMeter: 0,
            biYPelsPerMeter: 0,
            biClrUsed: 0,
            biClrImportant: 0,
        };
        let mut bmi = BITMAPINFO {
            bmiHeader: header,
            bmiColors: [Default::default()],
        };

        let mut pixels = vec![0u8; (width * height * 4) as usize];
        let lines = GetDIBits(
            mem_dc,
            hbmp,
            0,
            height as u32,
            Some(pixels.as_mut_ptr() as *mut _),
            &mut bmi,
            DIB_RGB_COLORS,
        );

        let _ = DeleteDC(mem_dc);
        ReleaseDC(None, screen_dc);
        let _ = DeleteObject(HGDIOBJ(hbmp.0));

        if lines == 0 {
            return Err("GetDIBits failed".into());
        }

        for chunk in pixels.as_chunks_mut::<4>().0 {
            chunk.swap(0, 2);
        }

        rgba_to_png_data_url(width as u32, height as u32, pixels)
    }
}

/// Extract an icon from a file + resource index at `size` (no shortcut overlay).
#[cfg(windows)]
fn extract_icon_from_file_index(icon_file: &str, index: i32, size: i32) -> Result<String, String> {
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::SHDefExtractIconW;
    use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, HICON};

    let expanded = expand_env_path(icon_file.trim());
    if expanded.is_empty() || !Path::new(&expanded).exists() {
        return Err("Icon file not found".into());
    }

    let wide_file = wide(&expanded);
    let mut large = HICON::default();
    // Low word = large size, high word = small size (same for square icons).
    let niconsize = (size as u32) | ((size as u32) << 16);

    // SAFETY: null-terminated path; we DestroyIcon `large` on success.
    let hr = unsafe {
        SHDefExtractIconW(
            PCWSTR(wide_file.as_ptr()),
            index,
            0,
            Some(&mut large),
            None,
            niconsize,
        )
    };
    if hr.is_err() || large.is_invalid() {
        return Err("SHDefExtractIconW failed".into());
    }

    let result = hicon_to_png_data_url(large, size);
    unsafe {
        let _ = DestroyIcon(large);
    }
    result
}

/// Resolve a `.lnk` to its icon location / target and extract without the overlay arrow.
#[cfg(windows)]
fn extract_icon_from_lnk(lnk_path: &str, size: i32) -> Result<String, String> {
    use windows::core::{Interface, PCWSTR};
    use windows::Win32::System::Com::{
        CoCreateInstance, IPersistFile, CLSCTX_INPROC_SERVER, STGM_READ,
    };
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

    ensure_com();

    // SAFETY: COM objects released when `link` drops.
    let link: IShellLinkW = unsafe { CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER) }
        .map_err(|e| e.to_string())?;
    let persist: IPersistFile = link.cast().map_err(|e| e.to_string())?;
    let wide_lnk = wide(lnk_path);
    unsafe { persist.Load(PCWSTR(wide_lnk.as_ptr()), STGM_READ) }.map_err(|e| e.to_string())?;

    let mut icon_buf = vec![0u16; 260];
    let mut icon_index = 0i32;
    unsafe { link.GetIconLocation(&mut icon_buf, &mut icon_index) }.map_err(|e| e.to_string())?;
    let mut icon_file = wide_to_string(&icon_buf);

    if icon_file.trim().is_empty() {
        use windows::Win32::Storage::FileSystem::WIN32_FIND_DATAW;
        let mut target_buf = vec![0u16; 260];
        let mut find_data = WIN32_FIND_DATAW::default();
        unsafe { link.GetPath(&mut target_buf, &mut find_data, 0) }.map_err(|e| e.to_string())?;
        icon_file = wide_to_string(&target_buf);
        icon_index = 0;
    }

    extract_icon_from_file_index(&icon_file, icon_index, size)
}

/// High-res icon via `IShellItemImageFactory` (great for AppsFolder / exe / folders).
#[cfg(windows)]
fn extract_icon_shell_item(path: &str, size: i32) -> Result<String, String> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::SIZE;
    use windows::Win32::UI::Shell::{
        IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_BIGGERSIZEOK, SIIGBF_ICONONLY,
    };

    ensure_com();
    let wide_path = wide(path);
    // SAFETY: parsing name is null-terminated; bitmap ownership transferred to us.
    let factory: IShellItemImageFactory =
        unsafe { SHCreateItemFromParsingName(PCWSTR(wide_path.as_ptr()), None) }
            .map_err(|e| e.to_string())?;

    let hbmp = unsafe {
        factory.GetImage(
            SIZE { cx: size, cy: size },
            SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK,
        )
    }
    .map_err(|e| e.to_string())?;

    hbitmap_to_png_data_url(hbmp)
}

/// Fallback: `SHGetFileInfo` large icon (may include shortcut overlay for `.lnk`).
#[cfg(windows)]
fn extract_icon_shgetfileinfo(path: &str, size: i32) -> Result<String, String> {
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES;
    use windows::Win32::UI::Shell::{SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON};
    use windows::Win32::UI::WindowsAndMessaging::DestroyIcon;

    let wide_path = wide(path);
    let mut info = SHFILEINFOW::default();

    // SAFETY: SHGetFileInfoW fills SHFILEINFOW; DestroyIcon below.
    let icon_flags = unsafe {
        SHGetFileInfoW(
            PCWSTR(wide_path.as_ptr()),
            FILE_FLAGS_AND_ATTRIBUTES(0),
            Some(&mut info),
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_LARGEICON,
        )
    };
    if icon_flags == 0 || info.hIcon.is_invalid() {
        return Err("Icon could not be read".into());
    }

    let result = hicon_to_png_data_url(info.hIcon, size);
    unsafe {
        let _ = DestroyIcon(info.hIcon);
    }
    result
}

/// Launch a path or http(s) URL via macOS `open`.
#[cfg(target_os = "macos")]
fn launch_path_macos(path: &str) -> Result<(), String> {
    if !is_http_url(path) && !Path::new(path).exists() {
        return Err("Pfad nicht gefunden".into());
    }

    std::process::Command::new("open")
        .arg(path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Encode raw PNG bytes as a `data:image/png;base64,…` URL (macOS icon extract).
#[cfg(target_os = "macos")]
fn png_bytes_to_data_url(png_bytes: &[u8]) -> Result<String, String> {
    if png_bytes.is_empty() {
        return Err("empty PNG".into());
    }
    let b64 = STANDARD.encode(png_bytes);
    Ok(format!("data:image/png;base64,{b64}"))
}

/// True when `path` points at a `.app` bundle directory.
#[cfg(target_os = "macos")]
fn path_is_app_bundle(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("app"))
        && path.is_dir()
}

/// Resolve `Contents/Resources/{CFBundleIconFile}.icns` from a bundle `Info.plist`.
#[cfg(target_os = "macos")]
fn macos_bundle_icns_path(app_bundle: &Path) -> Option<std::path::PathBuf> {
    let plist_path = app_bundle.join("Contents/Info.plist");
    let file = std::fs::File::open(&plist_path).ok()?;
    let value = plist::Value::from_reader(file).ok()?;
    let dict = value.as_dictionary()?;

    let icon_name = ["CFBundleIconFile", "CFBundleIconName"]
        .iter()
        .find_map(|key| dict.get(*key))
        .and_then(|v| v.as_string())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())?;

    let resources = app_bundle.join("Contents/Resources");
    let candidates = if icon_name.ends_with(".icns") {
        vec![resources.join(&icon_name)]
    } else {
        vec![
            resources.join(format!("{icon_name}.icns")),
            resources.join(&icon_name),
        ]
    };

    candidates.into_iter().find(|p| p.is_file())
}

/// Convert an on-disk image (`.icns`, `.app`, etc.) to PNG bytes via `/usr/bin/sips`.
#[cfg(target_os = "macos")]
fn sips_to_png_bytes(source: &Path) -> Result<Vec<u8>, String> {
    let out = std::env::temp_dir().join(format!(
        "kavibay-icon-{}.png",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));

    let status = std::process::Command::new("/usr/bin/sips")
        .arg("-s")
        .arg("format")
        .arg("png")
        .arg(source)
        .arg("--out")
        .arg(&out)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map_err(|e| format!("sips spawn failed: {e}"))?;

    if !status.success() {
        let _ = std::fs::remove_file(&out);
        return Err("sips conversion failed".into());
    }

    let bytes = std::fs::read(&out).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&out);
    if bytes.is_empty() {
        return Err("empty PNG from sips".into());
    }
    Ok(bytes)
}

/// Extract a `.app` bundle icon: `Info.plist` → `.icns`, then `sips`; fallback `sips` on the bundle.
#[cfg(target_os = "macos")]
fn extract_macos_app_icon_png(app_bundle: &Path) -> Result<Vec<u8>, String> {
    if let Some(icns_path) = macos_bundle_icns_path(app_bundle) {
        if let Ok(png) = sips_to_png_bytes(&icns_path) {
            return Ok(png);
        }
    }
    sips_to_png_bytes(app_bundle)
}

/// Extract an icon for a non-bundle path (file/folder) via `sips`.
#[cfg(target_os = "macos")]
fn extract_macos_file_icon_png(path: &Path) -> Result<Vec<u8>, String> {
    sips_to_png_bytes(path)
}

/// Extract a shell / bundle icon as a PNG data URL (macOS).
#[cfg(target_os = "macos")]
fn extract_app_icon_macos(path: &str) -> Result<String, String> {
    let p = Path::new(path);
    if !p.exists() {
        return Err("Path not found".into());
    }

    let png = if path_is_app_bundle(p) {
        extract_macos_app_icon_png(p)?
    } else {
        extract_macos_file_icon_png(p)?
    };
    png_bytes_to_data_url(&png)
}

/// Extract a high-res shell icon as a PNG data URL (no shortcut overlay when possible).
#[cfg(windows)]
fn extract_app_icon_windows(path: &str) -> Result<String, String> {
    if !is_shell_apps_folder(path) && !Path::new(path).exists() {
        return Err("Path not found".into());
    }

    let size = EXTRACT_ICON_PX;

    // Shortcuts: resolve target/icon location so Windows does not paint the link arrow.
    if path_is_lnk(path) {
        if let Ok(url) = extract_icon_from_lnk(path, size) {
            return Ok(url);
        }
    }

    // Prefer the modern shell image factory (256px, AppsFolder-friendly).
    if let Ok(url) = extract_icon_shell_item(path, size) {
        return Ok(url);
    }

    // Last resort — may still show the overlay for unresolved .lnk files.
    extract_icon_shgetfileinfo(path, size)
}

#[cfg(test)]
mod tests {
    use super::vetted_get;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use url::Url;

    /// Serves one canned response on loopback and returns its url.
    async fn one_response(reply: &'static str) -> Url {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tauri::async_runtime::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0u8; 1024];
            let _ = socket.read(&mut request).await;
            socket.write_all(reply.as_bytes()).await.unwrap();
        });
        Url::parse(&format!("http://{address}/")).unwrap()
    }

    #[test]
    fn a_page_cannot_send_the_icon_fetch_to_link_local() {
        tauri::async_runtime::block_on(async {
            let metadata = Url::parse("http://169.254.169.254/latest/meta-data").unwrap();
            assert_eq!(vetted_get(&metadata).await.unwrap_err(), "blocked_address");

            let page = one_response(
                "HTTP/1.1 302 Found\r\nLocation: http://169.254.169.254/latest/meta-data\r\n\
                 Content-Length: 0\r\nConnection: close\r\n\r\n",
            )
            .await;
            assert_eq!(
                vetted_get(&page).await.unwrap_err(),
                "blocked_address",
                "a redirect is vetted like the url itself"
            );

            let router =
                one_response("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok")
                    .await;
            assert_eq!(
                vetted_get(&router).await.unwrap().status(),
                200,
                "the user's own network stays reachable"
            );
        });
    }
}
