//! The operating system's side of the clipboard: Kavibay's own reads and
//! writes, serialized by `CLIPBOARD_IO`, and what the history asks of the OS
//! around them (change counter, password-manager markers, foreground app).

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use arboard::Clipboard;
use tauri::AppHandle;

use super::ClipboardSourceApp;

const CLIPBOARD_WRITE_ATTEMPTS: usize = 4;
const CLIPBOARD_RETRY_DELAY: Duration = Duration::from_millis(20);
/// How long the history waits after the pasteboard changed before reading it
/// (see `read_clipboard_for_history`).
#[cfg(target_os = "macos")]
const PASTEBOARD_SETTLE: Duration = Duration::from_millis(50);

/// Serialize Kavibay's own clipboard reads and writes. Windows can reject a
/// write while another thread still has the clipboard open, and the watcher
/// deliberately runs independently from command handlers.
static CLIPBOARD_IO: Mutex<()> = Mutex::new(());

/// A single clipboard read, before dedup/hashing/persistence decisions.
pub(super) enum ClipSnapshot {
    Empty,
    Text(String),
    Files(Vec<String>),
    Image {
        bytes: Vec<u8>,
        width: usize,
        height: usize,
    },
}

/// Cheap "did the clipboard change at all?" probe.
///
/// `GetClipboardSequenceNumber` bumps on every system-wide clipboard write and
/// — unlike a read — does not open the clipboard, so it costs one syscall.
/// Gating the watcher on it matters a lot: `read_clipboard` + `content_hash`
/// convert, copy, and SHA-256 the *entire* payload, so without the gate a 4K
/// screenshot sitting on the clipboard meant ~33 MB of conversion, copying and
/// hashing every 400 ms, forever, only to conclude that nothing had changed.
///
/// Returns `None` when the value is unavailable (documented as 0 for a process
/// without clipboard access) so callers fail open and read as before.
#[cfg(windows)]
pub(crate) fn clipboard_sequence() -> Option<u32> {
    use windows::Win32::System::DataExchange::GetClipboardSequenceNumber;

    match unsafe { GetClipboardSequenceNumber() } {
        0 => None,
        n => Some(n),
    }
}

/// The general pasteboard's change count, which moves on every
/// `clearContents` a writer starts with. Only compared for equality, so the
/// truncation to `u32` is harmless.
#[cfg(target_os = "macos")]
pub(crate) fn clipboard_sequence() -> Option<u32> {
    Some(objc2_app_kit::NSPasteboard::generalPasteboard().changeCount() as u32)
}

#[cfg(not(any(windows, target_os = "macos")))]
pub(crate) fn clipboard_sequence() -> Option<u32> {
    None
}

#[cfg(any(windows, test))]
fn source_name_from_path(path: &str) -> Option<String> {
    let file_name = path
        .rsplit(['\\', '/'])
        .next()
        .filter(|name| !name.is_empty())?;
    let suffix_start = file_name.len().saturating_sub(4);
    let stem = file_name
        .get(..suffix_start)
        .filter(|_| {
            file_name
                .get(suffix_start..)
                .is_some_and(|suffix| suffix.eq_ignore_ascii_case(".exe"))
        })
        .unwrap_or(file_name);
    (!stem.is_empty()).then(|| stem.to_string())
}

/// Best-effort source identity for a new clipboard value. Windows does not
/// retain which pixels came from which window, so the foreground process at
/// the sequence change is the useful metadata available without image analysis.
#[cfg(windows)]
pub(super) fn foreground_source_app() -> Option<ClipboardSourceApp> {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            return None;
        }
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return None;
        }

        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut path_buf = [0u16; 1024];
        let mut path_len = path_buf.len() as u32;
        let result = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            PWSTR(path_buf.as_mut_ptr()),
            &mut path_len,
        );
        let _ = CloseHandle(handle);
        result.ok()?;

        let path = String::from_utf16_lossy(&path_buf[..path_len as usize]);
        let name = source_name_from_path(&path)?;
        Some(ClipboardSourceApp { name, path })
    }
}

#[cfg(not(windows))]
pub(super) fn foreground_source_app() -> Option<ClipboardSourceApp> {
    None
}

/// True when whoever wrote the clipboard asked history tools to stay out.
///
/// Password managers (1Password, Bitwarden, KeePass) mark a copied secret with
/// these registered formats, and the Windows clipboard history honours them.
/// Ignoring them put every copied password into `index.json` in plaintext.
#[cfg(windows)]
fn excluded_from_history() -> bool {
    use windows::core::w;
    use windows::Win32::Foundation::HGLOBAL;
    use windows::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
        RegisterClipboardFormatW,
    };
    use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};

    // SAFETY: plain Win32 calls. The handle from GetClipboardData is only read
    // while the clipboard is open, through GlobalLock, after checking its size.
    unsafe {
        // Presence alone means "skip".
        for marker in [
            w!("ExcludeClipboardContentFromMonitorProcessing"),
            w!("Clipboard Viewer Ignore"),
        ] {
            let format = RegisterClipboardFormatW(marker);
            if format != 0 && IsClipboardFormatAvailable(format).is_ok() {
                return true;
            }
        }

        // A DWORD: 0 excludes, anything else is an explicit opt-in.
        let history = RegisterClipboardFormatW(w!("CanIncludeInClipboardHistory"));
        if history == 0 || IsClipboardFormatAvailable(history).is_err() {
            return false;
        }
        if OpenClipboard(None).is_err() {
            // The writer set the flag; when it cannot be read, skip rather than guess.
            return true;
        }
        let allowed = GetClipboardData(history).ok().and_then(|handle| {
            let memory = HGLOBAL(handle.0);
            if GlobalSize(memory) < std::mem::size_of::<u32>() {
                return None;
            }
            let value = GlobalLock(memory) as *const u32;
            if value.is_null() {
                return None;
            }
            let allowed = value.read_unaligned() != 0;
            let _ = GlobalUnlock(memory);
            Some(allowed)
        });
        let _ = CloseClipboard();
        !allowed.unwrap_or(false)
    }
}

/// Pasteboard types a writer adds to keep a copy out of clipboard histories.
/// The `org.nspasteboard.*` pair is the nspasteboard.org convention, which
/// password managers and arboard's own `exclude_from_history` follow;
/// `com.agilebits.onepassword` is 1Password's older marker, and
/// `de.petermaurer.TransientPasteboardType` the name the transient type
/// started as.
#[cfg(any(target_os = "macos", test))]
const PASTEBOARD_HISTORY_MARKERS: &[&str] = &[
    "org.nspasteboard.ConcealedType",
    "org.nspasteboard.TransientType",
    "com.agilebits.onepassword",
    "de.petermaurer.TransientPasteboardType",
];

#[cfg(any(target_os = "macos", test))]
fn has_history_marker<S: AsRef<str>>(types: &[S]) -> bool {
    types
        .iter()
        .any(|kind| PASTEBOARD_HISTORY_MARKERS.contains(&kind.as_ref()))
}

#[cfg(target_os = "macos")]
fn excluded_from_history() -> bool {
    pasteboard_excluded(&objc2_app_kit::NSPasteboard::generalPasteboard())
}

#[cfg(target_os = "macos")]
fn pasteboard_excluded(pasteboard: &objc2_app_kit::NSPasteboard) -> bool {
    let types: Vec<String> = pasteboard
        .types()
        .map(|types| types.iter().map(|kind| kind.to_string()).collect())
        .unwrap_or_default();
    has_history_marker(&types)
}

/// No marker check here yet. Linux password managers mark a secret with the
/// `x-kde-passwordManagerHint` target, which arboard cannot read back, so the
/// history keeps nothing rather than every copied password.
#[cfg(not(any(windows, target_os = "macos")))]
fn excluded_from_history() -> bool {
    true
}

pub(crate) fn lock_clipboard_io() -> std::sync::MutexGuard<'static, ()> {
    CLIPBOARD_IO
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub(super) fn read_clipboard() -> ClipSnapshot {
    let _clipboard_io = lock_clipboard_io();
    read_clipboard_locked()
}

/// The watcher's read: only what a history may keep.
///
/// Not folded into `read_clipboard` — quick actions read the clipboard to put
/// the user's own content back afterwards, and a copied password must survive
/// that even though it never enters the history.
pub(super) fn read_clipboard_for_history() -> ClipSnapshot {
    // macOS has no open and close around a write. After `clearContents` a
    // writer adds its types one call at a time while the change count stays
    // put; arboard itself sets the text first and the concealed marker second.
    // The watcher only gets here after the count moved, so waiting a moment
    // lets such a write finish before the marker is looked for.
    #[cfg(target_os = "macos")]
    std::thread::sleep(PASTEBOARD_SETTLE);

    let _clipboard_io = lock_clipboard_io();
    let snap = read_clipboard_locked();
    // After the read, not before: a writer holds the clipboard open for its
    // whole write, so once our read got in, every marker belonging to what we
    // read is there. Checked first, a poll woken by the writer's
    // EmptyClipboard could see the text without its marker yet.
    if excluded_from_history() {
        return ClipSnapshot::Empty;
    }
    snap
}

/// Read the system clipboard once. Prefers non-empty text; falls back to
/// image content when text is empty (some platforms report an empty text
/// result even though an image is present).
fn read_clipboard_locked() -> ClipSnapshot {
    let mut cb = match Clipboard::new() {
        Ok(c) => c,
        Err(_) => return ClipSnapshot::Empty,
    };
    if let Ok(paths) = cb.get().file_list() {
        let paths: Option<Vec<String>> = paths
            .into_iter()
            .map(|path| path.into_os_string().into_string().ok())
            .collect();
        if let Some(paths) = paths.filter(|paths| !paths.is_empty()) {
            return ClipSnapshot::Files(paths);
        }
    }
    if let Ok(text) = cb.get_text() {
        if !text.is_empty() {
            return ClipSnapshot::Text(text);
        }
    }
    if let Ok(img) = cb.get_image() {
        let pixels = img.bytes.as_ref();
        if !pixels.is_empty() {
            return ClipSnapshot::Image {
                bytes: pixels.to_vec(),
                width: img.width,
                height: img.height,
            };
        }
    }
    ClipSnapshot::Empty
}

pub(crate) fn write_text_clipboard(text: &str) -> Result<(), String> {
    let _clipboard_io = CLIPBOARD_IO
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut last_error = String::from("unknown clipboard error");
    for attempt in 0..CLIPBOARD_WRITE_ATTEMPTS {
        match Clipboard::new().and_then(|mut cb| cb.set_text(text)) {
            Ok(()) => return Ok(()),
            Err(error) => {
                last_error = error.to_string();
                if attempt + 1 < CLIPBOARD_WRITE_ATTEMPTS {
                    std::thread::sleep(CLIPBOARD_RETRY_DELAY);
                }
            }
        }
    }
    Err(format!("could not write text to clipboard: {last_error}"))
}

/// The clipboard's current text, or `None` for empty / image / unreadable.
///
/// Quick actions (`quick_action`) borrow the clipboard for a copy and a paste;
/// this is what they put back afterwards.
pub(crate) fn clipboard_text() -> Option<String> {
    match read_clipboard() {
        ClipSnapshot::Text(text) => Some(text),
        _ => None,
    }
}

/// Put a PNG on the clipboard; on Windows as "PNG" plus CF_DIBV5, the pair
/// arboard's `set_image` writes.
///
/// Not through arboard on Windows: it opens the clipboard without an owner
/// window, and Windows lets any other ownerless open (a clipboard watcher in
/// another app) take that open over mid-write. SetClipboardData then fails
/// with 1418 "Thread does not have a clipboard open"; arboard encodes the PNG
/// in that window, which takes seconds in a debug build. Owned by the main
/// window, the clipboard refuses other opens until the write is done.
pub(crate) fn write_png_clipboard(app: &AppHandle, png: &[u8]) -> Result<(), String> {
    let image = image::load_from_memory_with_format(png, image::ImageFormat::Png)
        .map_err(|e| format!("could not read the image: {e}"))?
        .into_rgba8();
    if image.width() == 0 || image.height() == 0 {
        return Err("the image is empty".into());
    }
    #[cfg(windows)]
    let (owner, dib) = {
        use tauri::Manager;
        let owner = app
            .get_webview_window("main")
            .and_then(|window| window.hwnd().ok())
            .map_or(std::ptr::null_mut(), |hwnd| hwnd.0);
        (owner, dib_v5(&image))
    };
    #[cfg(not(windows))]
    let _ = app;
    let _clipboard_io = lock_clipboard_io();
    let mut last_error = String::from("unknown clipboard error");
    for attempt in 0..CLIPBOARD_WRITE_ATTEMPTS {
        #[cfg(windows)]
        let result = set_png_and_dib(owner, png, &dib);
        #[cfg(not(windows))]
        let result = Clipboard::new()
            .and_then(|mut cb| {
                cb.set_image(arboard::ImageData {
                    width: image.width() as usize,
                    height: image.height() as usize,
                    bytes: std::borrow::Cow::Borrowed(image.as_raw()),
                })
            })
            .map_err(|e| e.to_string());
        match result {
            Ok(()) => return Ok(()),
            Err(error) => {
                last_error = error.to_string();
                if attempt + 1 < CLIPBOARD_WRITE_ATTEMPTS {
                    std::thread::sleep(CLIPBOARD_RETRY_DELAY);
                }
            }
        }
    }
    Err(format!("could not write image to clipboard: {last_error}"))
}

/// One write: open for `owner`, then PNG first (apps paste the first format
/// they know, and PNG keeps alpha), then the DIB for everything else.
#[cfg(windows)]
fn set_png_and_dib(owner: *mut std::ffi::c_void, png: &[u8], dib: &[u8]) -> Result<(), String> {
    const CF_DIBV5: u32 = 17;
    let png_format = clipboard_win::register_format("PNG")
        .ok_or("could not register the PNG clipboard format")?;
    let _open = clipboard_win::Clipboard::new_attempts_for(owner, 10)
        .map_err(|e| format!("could not open the clipboard: {e}"))?;
    clipboard_win::raw::empty().map_err(|e| e.to_string())?;
    clipboard_win::raw::set_without_clear(png_format.get(), png).map_err(|e| e.to_string())?;
    clipboard_win::raw::set_without_clear(CF_DIBV5, dib).map_err(|e| e.to_string())
}

/// CF_DIBV5 as arboard lays it out: a V5 header with alpha, then BGRA rows
/// bottom-up (Word and WordPad refuse a top-down DIB).
#[cfg(windows)]
fn dib_v5(image: &image::RgbaImage) -> Vec<u8> {
    use windows::Win32::Graphics::Gdi::{BITMAPV5HEADER, BI_BITFIELDS, LCS_GM_IMAGES};
    // 'sRGB'; the windows crate does not define LCS_sRGB.
    const LCS_SRGB: u32 = 0x7352_4742;
    let (width, height) = image.dimensions();
    let header = BITMAPV5HEADER {
        bV5Size: std::mem::size_of::<BITMAPV5HEADER>() as u32,
        bV5Width: width as i32,
        bV5Height: height as i32,
        bV5Planes: 1,
        bV5BitCount: 32,
        bV5Compression: BI_BITFIELDS,
        bV5SizeImage: width * height * 4,
        bV5RedMask: 0x00ff_0000,
        bV5GreenMask: 0x0000_ff00,
        bV5BlueMask: 0x0000_00ff,
        bV5AlphaMask: 0xff00_0000,
        bV5CSType: LCS_SRGB,
        bV5Intent: LCS_GM_IMAGES as u32,
        ..Default::default()
    };
    let mut dib = Vec::with_capacity(header.bV5Size as usize + image.as_raw().len());
    // SAFETY: BITMAPV5HEADER is repr(C) of 4-byte fields after one u16 pair,
    // so all bV5Size bytes are initialized.
    dib.extend_from_slice(unsafe {
        std::slice::from_raw_parts(
            (&header as *const BITMAPV5HEADER).cast::<u8>(),
            header.bV5Size as usize,
        )
    });
    for row in image.as_raw().chunks_exact(width as usize * 4).rev() {
        for pixel in row.chunks_exact(4) {
            dib.extend_from_slice(&[pixel[2], pixel[1], pixel[0], pixel[3]]);
        }
    }
    dib
}

pub(super) fn write_file_clipboard(paths: &[String]) -> Result<(), String> {
    if paths.is_empty() {
        return Err("missing file references".into());
    }
    if let Some(path) = paths.iter().find(|path| !Path::new(path).exists()) {
        return Err(format!("referenced file no longer exists: {path}"));
    }

    let path_bufs: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
    let _clipboard_io = CLIPBOARD_IO
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut last_error = String::from("unknown clipboard error");
    for attempt in 0..CLIPBOARD_WRITE_ATTEMPTS {
        match Clipboard::new().and_then(|mut cb| cb.set().file_list(&path_bufs)) {
            Ok(()) => return Ok(()),
            Err(error) => {
                last_error = error.to_string();
                if attempt + 1 < CLIPBOARD_WRITE_ATTEMPTS {
                    std::thread::sleep(CLIPBOARD_RETRY_DELAY);
                }
            }
        }
    }
    Err(format!(
        "could not write file references to clipboard: {last_error}"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Another app's clipboard watcher opens the clipboard without an owner
    /// window, and Windows hands it an ownerless open mid-write — copying a
    /// preview failed with 1418. The watcher here is a thread that skips
    /// CLIPBOARD_IO, as another process would; a 4K DIB keeps the write open
    /// long enough for it to land.
    #[cfg(windows)]
    #[test]
    #[ignore = "replaces the real system clipboard; run with --ignored"]
    fn an_ownerless_watcher_cannot_take_over_an_image_write() {
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Arc;
        use windows::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DestroyWindow, HWND_MESSAGE, WINDOW_EX_STYLE, WINDOW_STYLE,
        };
        let owner = unsafe {
            CreateWindowExW(
                WINDOW_EX_STYLE(0),
                windows::core::w!("STATIC"),
                None,
                WINDOW_STYLE(0),
                0,
                0,
                0,
                0,
                Some(HWND_MESSAGE),
                None,
                None,
                None,
            )
        }
        .unwrap();
        let image = image::RgbaImage::from_pixel(3840, 2160, image::Rgba([40, 90, 160, 255]));
        let png = super::super::encode_png_rgba(3840, 2160, image.as_raw()).unwrap();
        let dib = dib_v5(&image);

        let done = Arc::new(AtomicBool::new(false));
        let watcher = {
            let done = done.clone();
            std::thread::spawn(move || {
                while !done.load(Ordering::Relaxed) {
                    drop(clipboard_win::Clipboard::new());
                    std::thread::sleep(Duration::from_millis(1));
                }
            })
        };
        let results: Vec<_> = (0..5)
            .map(|_| set_png_and_dib(owner.0, &png, &dib))
            .collect();
        done.store(true, Ordering::Relaxed);
        watcher.join().unwrap();
        unsafe { DestroyWindow(owner) }.unwrap();
        for result in results {
            result.unwrap();
        }
    }

    /// Writes the way a password manager does (arboard's exclusions are the
    /// same registered formats 1Password, Bitwarden and KeePass set) and checks
    /// the watcher's read comes back empty — and that plain text still counts.
    #[cfg(windows)]
    #[test]
    #[ignore = "replaces the real system clipboard; run with --ignored"]
    fn password_manager_copies_never_reach_the_history() {
        use arboard::SetExtWindows;
        let mut clipboard = Clipboard::new().unwrap();
        let before = clipboard.get_text().ok();

        clipboard
            .set()
            .exclude_from_history()
            .text("hunter2")
            .unwrap();
        assert!(matches!(read_clipboard_for_history(), ClipSnapshot::Empty));
        assert!(
            matches!(read_clipboard(), ClipSnapshot::Text(ref text) if text == "hunter2"),
            "quick actions still see it, to put it back"
        );

        clipboard
            .set()
            .exclude_from_monitoring()
            .text("hunter3")
            .unwrap();
        assert!(matches!(read_clipboard_for_history(), ClipSnapshot::Empty));

        clipboard.set_text("plain").unwrap();
        assert!(
            matches!(read_clipboard_for_history(), ClipSnapshot::Text(ref text) if text == "plain")
        );

        if let Some(before) = before {
            let _ = clipboard.set_text(before);
        }
    }

    #[test]
    fn a_pasteboard_marker_keeps_the_copy_out_of_the_history() {
        assert!(has_history_marker(&[
            "public.utf8-plain-text",
            "org.nspasteboard.ConcealedType",
        ]));
        assert!(has_history_marker(&["org.nspasteboard.TransientType"]));
        assert!(has_history_marker(&["com.agilebits.onepassword"]));
        assert!(!has_history_marker(&[
            "public.utf8-plain-text",
            "public.html"
        ]));
        assert!(!has_history_marker::<&str>(&[]));
    }

    /// A private pasteboard, so the test reads real pasteboard types without
    /// touching what the user copied.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_concealed_pasteboard_is_excluded() {
        use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString};
        use objc2_foundation::ns_string;

        let pasteboard = NSPasteboard::pasteboardWithUniqueName();
        pasteboard.clearContents();
        // SAFETY: an immutable AppKit constant.
        let text_type = unsafe { NSPasteboardTypeString };
        assert!(pasteboard.setString_forType(ns_string!("hunter2"), text_type));
        assert!(!pasteboard_excluded(&pasteboard));

        assert!(pasteboard
            .setString_forType(ns_string!(""), ns_string!("org.nspasteboard.ConcealedType")));
        assert!(pasteboard_excluded(&pasteboard));
        // Not bound by objc2-app-kit. Frees the pasteboard in the server,
        // which would otherwise keep it after the test ends.
        // SAFETY: a void, argument-free method NSPasteboard declares.
        unsafe {
            let _: () = objc2::msg_send![&*pasteboard, releaseGlobally];
        }
    }

    /// Writes the way arboard's `exclude_from_history` does on macOS, text
    /// first and the concealed marker second, and checks the watcher's read.
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "replaces the real system clipboard; run with --ignored"]
    fn concealed_copies_never_reach_the_history_on_macos() {
        use arboard::SetExtApple;
        let mut clipboard = Clipboard::new().unwrap();
        let before = clipboard.get_text().ok();

        clipboard
            .set()
            .exclude_from_history()
            .text("hunter2")
            .unwrap();
        assert!(matches!(read_clipboard_for_history(), ClipSnapshot::Empty));
        assert!(
            matches!(read_clipboard(), ClipSnapshot::Text(ref text) if text == "hunter2"),
            "quick actions still see it, to put it back"
        );

        clipboard.set_text("plain").unwrap();
        assert!(
            matches!(read_clipboard_for_history(), ClipSnapshot::Text(ref text) if text == "plain")
        );

        if let Some(before) = before {
            let _ = clipboard.set_text(before);
        }
    }

    #[test]
    fn source_name_comes_from_windows_or_unix_paths() {
        assert_eq!(
            source_name_from_path(r"C:\Tools\ShareX.exe").as_deref(),
            Some("ShareX")
        );
        assert_eq!(
            source_name_from_path("/Applications/Preview").as_deref(),
            Some("Preview")
        );
        assert_eq!(source_name_from_path(""), None);
    }
}
