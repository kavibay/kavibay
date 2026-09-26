use super::ExtensionRust;

/// The uniform entry point: which root folder this belongs to, and what the
/// host declares on its behalf. Empty lists are the statement, not an
/// omission — this extension reaches no network host through the host layer.
pub const EXTENSION: ExtensionRust = ExtensionRust {
    folder: "clipboard",
    capabilities: &[],
};

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use arboard::{Clipboard, ImageData};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, State};

use crate::paths::data_dir;

pub const MAX_ENTRIES: usize = 20;
pub const MAX_TEXT_BYTES: usize = 100 * 1024;
pub const MAX_FILES_PER_ENTRY: usize = 100;
pub const MAX_FILE_PATH_BYTES: usize = 100 * 1024;
/// Cap on the *stored* (encoded PNG) image size — this is the user-facing
/// "images over ~10MB are skipped" limit from the spec.
pub const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;
/// Sanity bound on the *raw* RGBA buffer, applied before we spend CPU
/// encoding it. Uncompressed RGBA is width*height*4, so this is far larger
/// than MAX_IMAGE_BYTES on purpose: a 4K screenshot (~33MB raw) still
/// encodes down to a small PNG and should not be dropped here.
pub const MAX_RAW_IMAGE_BYTES: usize = 200 * 1024 * 1024;
/// Sanity bound on pixel count (width * height) to avoid attempting to
/// encode absurdly large bitmaps that could OOM during PNG encoding.
pub const MAX_IMAGE_PIXELS: usize = 50_000_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ClipboardKind {
    Text,
    Image,
    File,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardSourceApp {
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardEntry {
    pub id: String,
    pub kind: ClipboardKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_path: Option<String>,
    /// Existing filesystem paths from the OS file-list clipboard format.
    /// These are references only; Kavibay never copies the file payloads.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_paths: Option<Vec<String>>,
    pub hash: String,
    pub created_at: u64,
    pub revealed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_app: Option<ClipboardSourceApp>,
}

/// Stable hex sha256 over `kind_tag` + raw bytes (e.g. `"text"` / `"image"`).
pub fn content_hash(kind_tag: &str, bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(kind_tag.as_bytes());
    hasher.update([0]);
    hasher.update(bytes);
    hex_encode(hasher.finalize().as_slice())
}

fn file_paths_hash(paths: &[String]) -> String {
    // Windows paths cannot contain NUL, so this preserves list boundaries
    // without making the persisted entry depend on filesystem contents.
    content_hash("files", paths.join("\0").as_bytes())
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

/// If hash exists, move to front and refresh `created_at`; keep `revealed`.
pub fn bump_existing(entries: &mut Vec<ClipboardEntry>, hash: &str, now_ms: u64) -> bool {
    if let Some(pos) = entries.iter().position(|e| e.hash == hash) {
        let mut entry = entries.remove(pos);
        entry.created_at = now_ms;
        entries.insert(0, entry);
        return true;
    }
    false
}

/// A repeated copy belongs to the latest source that supplied it. Missing
/// foreground metadata does not erase a source captured earlier.
fn bump_existing_from_source(
    entries: &mut Vec<ClipboardEntry>,
    hash: &str,
    now_ms: u64,
    source_app: Option<&ClipboardSourceApp>,
) -> bool {
    if !bump_existing(entries, hash, now_ms) {
        return false;
    }
    if let Some(source_app) = source_app {
        entries[0].source_app = Some(source_app.clone());
    }
    true
}

/// Prepend a new entry (caller ensures hash is new). Trim to MAX_ENTRIES.
/// Returns absolute image paths from dropped entries (for file deletion).
pub fn apply_new_entry(entries: &mut Vec<ClipboardEntry>, entry: ClipboardEntry) -> Vec<String> {
    entries.insert(0, entry);
    trim_to_max(entries)
}

fn trim_to_max(entries: &mut Vec<ClipboardEntry>) -> Vec<String> {
    let mut orphan_paths = Vec::new();
    while entries.len() > MAX_ENTRIES {
        if let Some(removed) = entries.pop() {
            if removed.kind == ClipboardKind::Image {
                if let Some(path) = removed.image_path {
                    orphan_paths.push(path);
                }
            }
        }
    }
    orphan_paths
}

const POLL_MS: u64 = 400;
const INDEX_FILE: &str = "index.json";
const CLIPBOARD_WRITE_ATTEMPTS: usize = 4;
const CLIPBOARD_RETRY_DELAY: Duration = Duration::from_millis(20);

/// Serialize Kavibay's own clipboard reads and writes. Windows can reject a
/// write while another thread still has the clipboard open, and the watcher
/// deliberately runs independently from command handlers.
static CLIPBOARD_IO: Mutex<()> = Mutex::new(());

/// Mutable watcher/store state guarded by a mutex.
pub(crate) struct Inner {
    entries: Vec<ClipboardEntry>,
    last_hash: Option<String>,
    /// After a restore, skip capturing this hash for a few polls so the
    /// watcher doesn't immediately re-ingest the entry we just wrote back.
    ignore_hash: Option<String>,
    ignore_polls_left: u8,
    persist_error: Option<String>,
    /// True while Kavibay itself is driving the clipboard (see `pause_capture`).
    capture_paused: bool,
}

/// Shared clipboard-widget state, managed by Tauri and cloned into the
/// watcher thread. Cheap to clone since it just clones the inner `Arc`.
#[derive(Clone)]
pub struct ClipboardState(pub Arc<Mutex<Inner>>);

impl Default for ClipboardState {
    fn default() -> Self {
        Self(Arc::new(Mutex::new(Inner {
            entries: Vec::new(),
            last_hash: None,
            ignore_hash: None,
            ignore_polls_left: 0,
            persist_error: None,
            capture_paused: false,
        })))
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn root_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("clipboard-widget"))
}

fn images_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(root_dir(app)?.join("images"))
}

fn index_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(root_dir(app)?.join(INDEX_FILE))
}

/// Load the persisted entry list, or an empty list if missing/corrupt.
fn load_index(app: &AppHandle) -> Vec<ClipboardEntry> {
    let path = match index_path(app) {
        Ok(p) => p,
        Err(_) => return Vec::new(),
    };
    let Ok(bytes) = fs::read(&path) else {
        return Vec::new();
    };
    serde_json::from_slice::<Vec<ClipboardEntry>>(&bytes).unwrap_or_default()
}

/// Persist the entry list atomically (write to a temp file, then rename).
fn save_index(app: &AppHandle, entries: &[ClipboardEntry]) -> Result<(), String> {
    let dir = root_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = index_path(app)?;
    let tmp = path.with_extension("json.tmp");
    let data = serde_json::to_vec_pretty(entries).map_err(|e| e.to_string())?;
    fs::write(&tmp, data).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

fn delete_paths(paths: &[String]) {
    for p in paths {
        let _ = fs::remove_file(p);
    }
}

fn emit_updated(app: &AppHandle, entries: &[ClipboardEntry]) {
    let _ = app.emit("clipboard:updated", entries);
}

/// Surface a one-shot persist failure to the frontend (in addition to the
/// `persist_error` field stored on `Inner` for any future polling reader).
fn emit_error(app: &AppHandle, message: &str) {
    let _ = app.emit("clipboard:error", message);
}

fn new_id() -> String {
    format!(
        "{}-{}",
        now_ms(),
        &content_hash("id", &now_ms().to_le_bytes())[..8]
    )
}

/// A single clipboard read, before dedup/hashing/persistence decisions.
enum ClipSnapshot {
    Empty,
    Text(String),
    Files(Vec<String>),
    Image {
        bytes: Vec<u8>,
        width: usize,
        height: usize,
    },
}

/// Read the system clipboard once. Prefers non-empty text; falls back to
/// image content when text is empty (some platforms report an empty text
/// result even though an image is present).
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

#[cfg(not(windows))]
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
fn foreground_source_app() -> Option<ClipboardSourceApp> {
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
fn foreground_source_app() -> Option<ClipboardSourceApp> {
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

#[cfg(not(windows))]
fn excluded_from_history() -> bool {
    false
}

fn lock_clipboard_io() -> std::sync::MutexGuard<'static, ()> {
    CLIPBOARD_IO
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn read_clipboard() -> ClipSnapshot {
    let _clipboard_io = lock_clipboard_io();
    read_clipboard_locked()
}

/// The watcher's read: only what a history may keep.
///
/// Not folded into `read_clipboard` — quick actions read the clipboard to put
/// the user's own content back afterwards, and a copied password must survive
/// that even though it never enters the history.
fn read_clipboard_for_history() -> ClipSnapshot {
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

/// Stop writing history entries while Kavibay drives the clipboard itself.
///
/// A quick action displaces the clipboard three times in a second (copy the
/// selection, paste the answer, put the original back). None of those is
/// something the user chose to copy, so none belongs in the history — and the
/// existing one-slot `ignore_hash` cannot cover three writes at once.
pub(crate) fn pause_capture(state: &ClipboardState) {
    if let Ok(mut guard) = state.0.lock() {
        guard.capture_paused = true;
    }
}

/// Resume capture, normally ignoring whatever we left on the clipboard.
///
/// The watcher skipped its polls while paused, so its next one *will* see a
/// changed sequence number. Marking the current content as ignored is what
/// keeps that poll from filing our restore as a fresh copy.
///
/// `keep_current` turns that off, for the one case where the clipboard content
/// is the point: a quick action over read-only text cannot paste, so it leaves
/// the answer there on purpose and the history should record it.
pub(crate) fn resume_capture(state: &ClipboardState, keep_current: bool) {
    let hash = if keep_current {
        None
    } else {
        match read_clipboard() {
            ClipSnapshot::Text(text) => Some(content_hash("text", text.as_bytes())),
            ClipSnapshot::Files(paths) => Some(file_paths_hash(&paths)),
            ClipSnapshot::Image { bytes, .. } => Some(content_hash("image", &bytes)),
            ClipSnapshot::Empty => None,
        }
    };
    if let Ok(mut guard) = state.0.lock() {
        guard.capture_paused = false;
        if let Some(hash) = hash {
            guard.ignore_hash = Some(hash.clone());
            guard.ignore_polls_left = 5;
            guard.last_hash = Some(hash);
        }
    }
}

/// Whether history capture is currently suspended.
fn capture_paused(state: &ClipboardState) -> bool {
    state
        .0
        .lock()
        .map(|guard| guard.capture_paused)
        .unwrap_or(false)
}

fn write_image_clipboard(path: &Path) -> Result<(), String> {
    let dyn_img = image::open(path).map_err(|e| format!("could not read saved image: {e}"))?;
    let rgba = dyn_img.to_rgba8();
    let (w, h) = rgba.dimensions();
    let bytes = rgba.into_raw();
    let _clipboard_io = CLIPBOARD_IO
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut last_error = String::from("unknown clipboard error");
    for attempt in 0..CLIPBOARD_WRITE_ATTEMPTS {
        let data = ImageData {
            width: w as usize,
            height: h as usize,
            bytes: bytes.clone().into(),
        };
        match Clipboard::new().and_then(|mut cb| cb.set_image(data)) {
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

fn write_file_clipboard(paths: &[String]) -> Result<(), String> {
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

fn encode_png_rgba(width: usize, height: usize, bytes: &[u8]) -> Result<Vec<u8>, String> {
    use image::ImageEncoder;
    let mut buf = Vec::new();
    let enc = image::codecs::png::PngEncoder::new(&mut buf);
    enc.write_image(
        bytes,
        width as u32,
        height as u32,
        image::ExtendedColorType::Rgba8,
    )
    .map_err(|e| e.to_string())?;
    Ok(buf)
}

fn persist_image(app: &AppHandle, id: &str, png: &[u8]) -> Result<String, String> {
    let dir = images_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join(format!("{id}.png"));
    fs::write(&dest, png).map_err(|e| e.to_string())?;
    dest.into_os_string()
        .into_string()
        .map_err(|_| "non-utf8 image path".into())
}

/// Turn a raw clipboard snapshot into a store mutation: dedup against the
/// last-seen hash / an in-flight restore, bump an existing entry to the
/// front, or persist a brand-new entry (writing a PNG to disk for images).
/// Persists the index and emits `clipboard:updated` on any change.
fn ingest_snapshot(
    app: &AppHandle,
    state: &ClipboardState,
    snap: ClipSnapshot,
    source_app: Option<ClipboardSourceApp>,
) {
    let (hash, build) = match snap {
        ClipSnapshot::Empty => return,
        ClipSnapshot::Text(text) => {
            let bytes = text.as_bytes();
            if bytes.len() > MAX_TEXT_BYTES {
                return;
            }
            let hash = content_hash("text", bytes);
            (
                hash.clone(),
                Some((hash, ClipboardKind::Text, Some(text), None, None)),
            )
        }
        ClipSnapshot::Files(paths) => {
            let path_bytes = paths.iter().map(|path| path.len()).sum::<usize>();
            if paths.len() > MAX_FILES_PER_ENTRY || path_bytes > MAX_FILE_PATH_BYTES {
                return;
            }
            let hash = file_paths_hash(&paths);
            (
                hash.clone(),
                Some((hash, ClipboardKind::File, None, Some(paths), None)),
            )
        }
        ClipSnapshot::Image {
            bytes,
            width,
            height,
        } => {
            // Sanity guards only — the real "skip images over ~10MB" cap is
            // enforced on the *encoded* PNG further down. Checking the raw
            // RGBA buffer against that same 10MB limit here would drop
            // ordinary 1440p/4K screenshots before they ever get a chance
            // to compress.
            let pixel_count = width.checked_mul(height);
            if pixel_count.map(|p| p > MAX_IMAGE_PIXELS).unwrap_or(true) {
                return;
            }
            if bytes.len() > MAX_RAW_IMAGE_BYTES {
                return;
            }
            let hash = content_hash("image", &bytes);
            (
                hash.clone(),
                Some((
                    hash,
                    ClipboardKind::Image,
                    None,
                    None,
                    Some((bytes, width, height)),
                )),
            )
        }
    };

    let now = now_ms();

    // First lock: ignore/dedupe bookkeeping only, no I/O or CPU-heavy work
    // while held. Determines whether this snapshot is a no-op, a bump of an
    // existing entry, or a genuinely new entry that still needs encoding.
    enum Decision {
        Skip,
        Bumped(Vec<ClipboardEntry>),
        New,
    }
    let decision = {
        let mut guard = state.0.lock().unwrap();
        if guard.ignore_polls_left > 0 {
            let matched_ignore = guard.ignore_hash.as_deref() == Some(hash.as_str());
            guard.ignore_polls_left -= 1;
            if matched_ignore {
                guard.last_hash = Some(hash.clone());
                Decision::Skip
            } else if guard.last_hash.as_deref() == Some(hash.as_str()) {
                Decision::Skip
            } else if bump_existing_from_source(&mut guard.entries, &hash, now, source_app.as_ref())
            {
                guard.last_hash = Some(hash.clone());
                Decision::Bumped(guard.entries.clone())
            } else {
                Decision::New
            }
        } else if guard.last_hash.as_deref() == Some(hash.as_str()) {
            Decision::Skip
        } else if bump_existing_from_source(&mut guard.entries, &hash, now, source_app.as_ref()) {
            guard.last_hash = Some(hash.clone());
            Decision::Bumped(guard.entries.clone())
        } else {
            Decision::New
        }
    };

    let entries = match decision {
        Decision::Skip => return,
        Decision::Bumped(entries) => entries,
        Decision::New => {
            let Some((_h, kind, text, file_paths, image_raw)) = build else {
                return;
            };
            let id = new_id();

            // Encode + write to disk *before* touching the shared lock again —
            // this is the CPU/I/O-heavy part and must not block
            // clipboard_list/restore/set_revealed/clear while it runs.
            let image_path = if let Some((rgba, w, h)) = image_raw {
                let png = match encode_png_rgba(w, h, &rgba) {
                    Ok(p) => p,
                    Err(_) => return,
                };
                if png.len() > MAX_IMAGE_BYTES {
                    return;
                }
                match persist_image(app, &id, &png) {
                    Ok(p) => Some(p),
                    Err(_) => return,
                }
            } else {
                None
            };

            let entry = ClipboardEntry {
                id,
                kind,
                text,
                image_path: image_path.clone(),
                file_paths,
                hash: hash.clone(),
                created_at: now,
                revealed: true,
                source_app: source_app.clone(),
            };

            let mut guard = state.0.lock().unwrap();
            // Defensive re-check: if this hash was inserted by another path
            // while we were encoding/writing (not expected with a single
            // watcher thread today, but cheap to guard against), just bump
            // instead of double-inserting, and orphan the file we wrote.
            if bump_existing_from_source(&mut guard.entries, &hash, now_ms(), source_app.as_ref()) {
                guard.last_hash = Some(hash.clone());
                let entries = guard.entries.clone();
                drop(guard);
                if let Some(p) = &image_path {
                    let _ = fs::remove_file(p);
                }
                entries
            } else {
                let orphans = apply_new_entry(&mut guard.entries, entry);
                guard.last_hash = Some(hash.clone());
                let entries = guard.entries.clone();
                drop(guard);
                delete_paths(&orphans);
                entries
            }
        }
    };

    if let Err(e) = save_index(app, &entries) {
        let mut g = state.0.lock().unwrap();
        g.persist_error = Some(e.clone());
        drop(g);
        emit_error(app, &e);
    }
    emit_updated(app, &entries);
}

/// Load the persisted index and start background clipboard polling.
/// Call once from `setup`, after `app.manage(state.clone())`.
pub fn spawn_clipboard_watcher(app: AppHandle, state: ClipboardState) {
    {
        let mut guard = state.0.lock().unwrap();
        guard.entries = load_index(&app);
        if let Some(first) = guard.entries.first() {
            guard.last_hash = Some(first.hash.clone());
        }
    }
    std::thread::spawn(move || {
        // Starts unset so the very first poll always reads: whatever was copied
        // before Kavibay launched still gets captured, as it did before.
        let mut last_seq: Option<u32> = None;
        let mut observed_once = false;

        loop {
            std::thread::sleep(Duration::from_millis(POLL_MS));

            // A quick action is mid-flight: everything on the clipboard right
            // now was put there by us. `resume_capture` reinstates the baseline.
            if capture_paused(&state) {
                continue;
            }

            // Untouched clipboard: skip the read/hash path entirely. A `None`
            // sequence number means "cannot tell", so we read (fail open).
            if let Some(seq) = clipboard_sequence() {
                if last_seq == Some(seq) {
                    continue;
                }
                last_seq = Some(seq);
            }

            // The first read may be clipboard content from before Kavibay
            // started, so it has no trustworthy current foreground source.
            let source_app = observed_once.then(foreground_source_app).flatten();
            observed_once = true;
            let snap = read_clipboard_for_history();
            // Replaced after the read: the exclusion check may describe other
            // content than `snap`. The next poll sees the new number and reads
            // again.
            if matches!((clipboard_sequence(), last_seq), (Some(now), Some(read)) if now != read) {
                continue;
            }
            ingest_snapshot(&app, &state, snap, source_app);
        }
    });
}

/// Return the current clipboard history, most recent first.
#[tauri::command]
pub fn clipboard_list(state: State<'_, ClipboardState>) -> Result<Vec<ClipboardEntry>, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    Ok(guard.entries.clone())
}

/// Write an entry's content back onto the system clipboard, bump it to the
/// front of the history, and briefly ignore its hash so the watcher doesn't
/// re-ingest the very write we just performed.
#[tauri::command]
pub fn clipboard_restore(
    app: AppHandle,
    state: State<'_, ClipboardState>,
    id: String,
) -> Result<(), String> {
    let (hash, kind, text, image_path, file_paths) = {
        let guard = state.0.lock().map_err(|e| e.to_string())?;
        let entry = guard
            .entries
            .iter()
            .find(|e| e.id == id)
            .ok_or_else(|| "entry not found".to_string())?
            .clone();
        (
            entry.hash,
            entry.kind,
            entry.text,
            entry.image_path,
            entry.file_paths,
        )
    };

    match kind {
        ClipboardKind::Text => {
            let t = text.ok_or_else(|| "missing text".to_string())?;
            write_text_clipboard(&t)?;
        }
        ClipboardKind::Image => {
            let p = image_path.ok_or_else(|| "missing image".to_string())?;
            write_image_clipboard(Path::new(&p))?;
        }
        ClipboardKind::File => {
            let paths = file_paths.ok_or_else(|| "missing file references".to_string())?;
            write_file_clipboard(&paths)?;
        }
    }

    // Re-read the clipboard we just wrote to and hash what's *actually*
    // there. OS round-trips (e.g. arboard's Windows DIB conversion for
    // images) can alter raw bytes even though we just wrote them, so the
    // pre-write entry hash may not match what the watcher observes on its
    // next poll. Ignoring the real post-write hash — not the pre-write one
    // — is what actually prevents the watcher from re-capturing our own
    // restore as a spurious new duplicate entry.
    let actual_hash = match read_clipboard() {
        ClipSnapshot::Text(t) => Some(content_hash("text", t.as_bytes())),
        ClipSnapshot::Files(paths) => Some(file_paths_hash(&paths)),
        ClipSnapshot::Image { bytes, .. } => Some(content_hash("image", &bytes)),
        ClipSnapshot::Empty => None,
    };
    let ignore_target = actual_hash.unwrap_or_else(|| hash.clone());

    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    guard.ignore_hash = Some(ignore_target.clone());
    guard.ignore_polls_left = 5;
    let now = now_ms();
    let _ = bump_existing(&mut guard.entries, &hash, now);
    guard.last_hash = Some(ignore_target);
    let entries = guard.entries.clone();
    drop(guard);
    save_index(&app, &entries)?;
    emit_updated(&app, &entries);
    Ok(())
}

/// Toggle whether a text entry is shown in the clear vs. masked in the UI.
#[tauri::command]
pub fn clipboard_set_revealed(
    app: AppHandle,
    state: State<'_, ClipboardState>,
    id: String,
    revealed: bool,
) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let entry = guard
        .entries
        .iter_mut()
        .find(|e| e.id == id)
        .ok_or_else(|| "entry not found".to_string())?;
    entry.revealed = revealed;
    let entries = guard.entries.clone();
    drop(guard);
    save_index(&app, &entries)?;
    emit_updated(&app, &entries);
    Ok(())
}

/// Remove one history entry and its persisted image payload, when present.
#[tauri::command]
pub fn clipboard_delete(
    app: AppHandle,
    state: State<'_, ClipboardState>,
    id: String,
) -> Result<(), String> {
    let (entries, image_path) = {
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        let position = guard
            .entries
            .iter()
            .position(|entry| entry.id == id)
            .ok_or_else(|| "entry not found".to_string())?;
        let removed = guard.entries.remove(position);
        (guard.entries.clone(), removed.image_path)
    };

    save_index(&app, &entries)?;
    // Image paths are persisted state, so keep cleanup confined to our own
    // clipboard image directory even if the index was edited externally.
    if let Some(path) = image_path {
        let image_dir = images_dir(&app)?;
        let candidate = PathBuf::from(path);
        if candidate.starts_with(&image_dir) {
            let _ = fs::remove_file(candidate);
        }
    }
    emit_updated(&app, &entries);
    Ok(())
}

/// Clear all history: wipe in-memory state, delete persisted images, and
/// persist the now-empty index.
#[tauri::command]
pub fn clipboard_clear(app: AppHandle, state: State<'_, ClipboardState>) -> Result<(), String> {
    {
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        guard.entries.clear();
        guard.last_hash = None;
        guard.ignore_hash = None;
        guard.ignore_polls_left = 0;
    }
    if let Ok(dir) = images_dir(&app) {
        if dir.exists() {
            let _ = fs::remove_dir_all(&dir);
        }
    }
    save_index(&app, &[])?;
    emit_updated(&app, &[]);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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

    fn text_entry(id: &str, hash: &str, created_at: u64) -> ClipboardEntry {
        ClipboardEntry {
            id: id.into(),
            kind: ClipboardKind::Text,
            text: Some("hello".into()),
            image_path: None,
            file_paths: None,
            hash: hash.into(),
            created_at,
            revealed: true,
            source_app: None,
        }
    }

    #[test]
    fn hash_is_stable() {
        assert_eq!(content_hash("text", b"abc"), content_hash("text", b"abc"));
        assert_ne!(content_hash("text", b"abc"), content_hash("text", b"abd"));
        assert_ne!(content_hash("text", b"abc"), content_hash("image", b"abc"));
    }

    #[test]
    fn file_hash_preserves_path_boundaries_and_order() {
        let two = vec!["C:\\a".into(), "C:\\b".into()];
        let joined = vec!["C:\\aC:\\b".into()];
        let reversed = vec!["C:\\b".into(), "C:\\a".into()];
        assert_ne!(file_paths_hash(&two), file_paths_hash(&joined));
        assert_ne!(file_paths_hash(&two), file_paths_hash(&reversed));
    }

    #[test]
    fn bump_moves_to_front_keeps_revealed() {
        let mut entries = vec![text_entry("a", "h1", 1), text_entry("b", "h2", 2)];
        entries[1].revealed = false;
        assert!(bump_existing(&mut entries, "h2", 99));
        assert_eq!(entries[0].id, "b");
        assert_eq!(entries[0].created_at, 99);
        assert!(!entries[0].revealed);
        assert_eq!(entries.len(), 2);
    }

    #[test]
    fn repeated_copy_updates_the_source_app() {
        let mut entries = vec![text_entry("a", "h1", 1), text_entry("b", "h2", 2)];
        let source = ClipboardSourceApp {
            name: "Code".into(),
            path: r"C:\Program Files\Microsoft VS Code\Code.exe".into(),
        };
        assert!(bump_existing_from_source(
            &mut entries,
            "h2",
            99,
            Some(&source)
        ));
        assert_eq!(entries[0].source_app.as_ref(), Some(&source));
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

    #[test]
    fn apply_trims_and_returns_image_orphans() {
        let mut entries: Vec<ClipboardEntry> = (0..MAX_ENTRIES)
            .map(|i| text_entry(&format!("t{i}"), &format!("h{i}"), i as u64))
            .collect();
        // oldest image at end
        entries.push(ClipboardEntry {
            id: "img".into(),
            kind: ClipboardKind::Image,
            text: None,
            image_path: Some("C:/tmp/x.png".into()),
            file_paths: None,
            hash: "imghash".into(),
            created_at: 0,
            revealed: true,
            source_app: None,
        });
        // push over cap via apply
        let orphans = apply_new_entry(&mut entries, text_entry("new", "newhash", 1000));
        assert_eq!(entries.len(), MAX_ENTRIES);
        assert_eq!(entries[0].id, "new");
        assert!(orphans.iter().any(|p| p.contains("x.png")));
    }
}
