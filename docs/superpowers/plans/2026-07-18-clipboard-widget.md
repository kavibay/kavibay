# Clipboard Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Clipboard history widget that background-captures text and images, persists up to 20 deduplicated entries, restores on click, and masks sensitive previews per entry with an eye toggle.

**Architecture:** Rust owns a boot-time clipboard poller (`arboard`), app-data JSON index + image files, and Tauri commands/events. Vue renders a shared list via `useClipboardState` (event-driven, not host `backendCommand` polling). Pure TS helpers cover preview/mask display only.

**Tech Stack:** Vue 3 + TypeScript, Vite, Tauri 2, `arboard`, `sha2`, `serde`/`serde_json`, existing `image` crate, `@tauri-apps/api` (`invoke`, `listen`, `convertFileSrc`).

## Global Constraints

- Registry id `clipboard`, title **Clipboard**, inside existing dark `WidgetCard`
- Background watch while Kavibay runs (overlay hidden or visible)
- Text + images only; ignore unsupported formats
- Max **20** entries; newest first; dedupe by content hash (bump + keep `revealed`)
- Click row → restore to system clipboard + bump + “Copied” flash; ignore self-writes
- Per-item eye: `revealed` default `true`; closed masks text as `••••••` and images as solid placeholder (no real pixels)
- Persist under `app_data/clipboard-widget/` (not localStorage); shared across widget instances
- Clear all wipes index + image files
- Text capture skip if > 100 KB; image skip if > 10 MB
- No settings panel; no search/pins/HTML kinds in V1
- Windows-first (same as Color Picker)
- No git repository in this workspace — skip all commit steps
- No test runner — verify with Node assert scripts, `npx vue-tsc --noEmit`, `cargo test -p kavibay_lib --lib clipboard_widget`, `cargo check`, and manual UI checks
- Spec: `docs/superpowers/specs/2026-07-18-clipboard-widget-design.md`

## File Structure

| File | Responsibility |
|------|----------------|
| `src/widgets/clipboardLogic.ts` | DTO types, preview truncate, mask helpers |
| `src/widgets/useClipboardState.ts` | Shared list state, listen `clipboard:updated`, restore/reveal/clear |
| `src/widgets/ClipboardWidget.vue` | List UI, eye buttons, clear all, copied flash |
| `src/widgets/registry.ts` | Register `clipboard` |
| `src-tauri/src/clipboard_widget.rs` | History core, persist, arboard I/O, watcher, commands |
| `src-tauri/src/lib.rs` | `mod clipboard_widget`; start watcher; register commands |
| `src-tauri/Cargo.toml` | Add `arboard`, `sha2` |

Asset protocol / CSP already cover `$APPDATA/**` — no `tauri.conf.json` change required unless thumbnails fail in manual test.

---

### Task 1: Pure frontend clipboard helpers

**Files:**
- Create: `src/widgets/clipboardLogic.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `export type ClipboardKind = "text" | "image"`
  - `export interface ClipboardEntry { id: string; kind: ClipboardKind; text?: string; imagePath?: string; hash: string; createdAt: number; revealed: boolean }`
  - `export const MAX_ENTRIES = 20`
  - `export const MASKED_TEXT = "••••••"`
  - `export function truncatePreview(text: string, maxChars?: number): string`
  - `export function displayText(entry: ClipboardEntry): string` — masked or truncated
  - `export function normalizeEntry(raw: unknown): ClipboardEntry | null`

- [ ] **Step 1: Create `src/widgets/clipboardLogic.ts`**

```ts
export type ClipboardKind = "text" | "image";

export interface ClipboardEntry {
  id: string;
  kind: ClipboardKind;
  text?: string;
  imagePath?: string;
  hash: string;
  createdAt: number;
  revealed: boolean;
}

export const MAX_ENTRIES = 20;
export const MASKED_TEXT = "••••••";
const DEFAULT_PREVIEW_CHARS = 48;

/** Truncate a single-line preview with ellipsis. */
export function truncatePreview(text: string, maxChars = DEFAULT_PREVIEW_CHARS): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= maxChars) return oneLine;
  return `${oneLine.slice(0, Math.max(0, maxChars - 1))}…`;
}

/** Text shown in a row: masked dots or truncated body. */
export function displayText(entry: ClipboardEntry): string {
  if (entry.kind !== "text") return "";
  if (!entry.revealed) return MASKED_TEXT;
  return truncatePreview(entry.text ?? "");
}

/** Normalize one entry from the backend payload; null if invalid. */
export function normalizeEntry(raw: unknown): ClipboardEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id.trim()) return null;
  if (typeof o.hash !== "string" || !o.hash.trim()) return null;
  if (typeof o.createdAt !== "number" || !Number.isFinite(o.createdAt)) return null;
  const revealed = o.revealed !== false;
  if (o.kind === "text" && typeof o.text === "string" && o.text.length > 0) {
    return {
      id: o.id,
      kind: "text",
      text: o.text,
      hash: o.hash,
      createdAt: o.createdAt,
      revealed,
    };
  }
  if (o.kind === "image" && typeof o.imagePath === "string" && o.imagePath.trim()) {
    return {
      id: o.id,
      kind: "image",
      imagePath: o.imagePath.trim(),
      hash: o.hash,
      createdAt: o.createdAt,
      revealed,
    };
  }
  return null;
}

/** Normalize a full list payload; drop invalids; cap length. */
export function normalizeList(raw: unknown): ClipboardEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ClipboardEntry[] = [];
  for (const item of raw) {
    const e = normalizeEntry(item);
    if (e) out.push(e);
    if (out.length >= MAX_ENTRIES) break;
  }
  return out;
}
```

- [ ] **Step 2: Verify with Node assert script**

Run (PowerShell):

```powershell
node --input-type=module -e @"
import assert from 'node:assert/strict';
import { displayText, truncatePreview, normalizeEntry, normalizeList, MASKED_TEXT, MAX_ENTRIES } from './src/widgets/clipboardLogic.ts';

assert.equal(truncatePreview('hello'), 'hello');
assert.equal(truncatePreview('a'.repeat(60)).endsWith('…'), true);
assert.equal(displayText({ id:'1', kind:'text', text:'secret', hash:'h', createdAt:1, revealed:false }), MASKED_TEXT);
assert.equal(displayText({ id:'1', kind:'text', text:'hello world', hash:'h', createdAt:1, revealed:true }), 'hello world');
assert.equal(normalizeEntry({ kind:'text' }), null);
assert.equal(normalizeEntry({ id:'1', kind:'text', text:'x', hash:'h', createdAt:1, revealed:true })?.text, 'x');
assert.equal(normalizeList(Array.from({length:25}, (_,i)=>({id:String(i), kind:'text', text:'t', hash:String(i), createdAt:i, revealed:true}))).length, MAX_ENTRIES);
console.log('ok');
"@
```

Expected: `ok`

If Node cannot import `.ts` directly, use `npx vite-node` with the same asserts.

- [ ] **Step 3: Typecheck**

Run: `npx vue-tsc --noEmit`  
Expected: no errors related to `clipboardLogic.ts`

---

### Task 2: Rust history core (pure + unit tests)

**Files:**
- Create: `src-tauri/src/clipboard_widget.rs` (core types + list ops first; I/O added in Task 3)

**Interfaces:**
- Consumes: nothing external yet
- Produces (Rust):
  - `pub const MAX_ENTRIES: usize = 20`
  - `pub const MAX_TEXT_BYTES: usize = 100 * 1024`
  - `pub const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024`
  - `pub struct ClipboardEntry { id, kind, text, image_path, hash, created_at, revealed }`
  - `pub enum ClipboardKind { Text, Image }`
  - `pub fn content_hash(kind_tag: &str, bytes: &[u8]) -> String`
  - `pub fn apply_new_entry(entries: &mut Vec<ClipboardEntry>, entry: ClipboardEntry) -> Vec<String>` — returns absolute image paths to delete after trim
  - `pub fn bump_existing(entries: &mut Vec<ClipboardEntry>, hash: &str, now_ms: u64) -> bool`

- [ ] **Step 1: Add crate deps**

In `src-tauri/Cargo.toml` under `[dependencies]`:

```toml
arboard = "3"
sha2 = "0.10"
```

- [ ] **Step 2: Create `src-tauri/src/clipboard_widget.rs` with pure core + tests**

```rust
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const MAX_ENTRIES: usize = 20;
pub const MAX_TEXT_BYTES: usize = 100 * 1024;
pub const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ClipboardKind {
    Text,
    Image,
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
    pub hash: String,
    pub created_at: u64,
    pub revealed: bool,
}

/// Stable hex sha256 over `kind_tag` + raw bytes (e.g. `"text"` / `"image"`).
pub fn content_hash(kind_tag: &str, bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(kind_tag.as_bytes());
    hasher.update([0]);
    hasher.update(bytes);
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

#[cfg(test)]
mod tests {
    use super::*;

    fn text_entry(id: &str, hash: &str, created_at: u64) -> ClipboardEntry {
        ClipboardEntry {
            id: id.into(),
            kind: ClipboardKind::Text,
            text: Some("hello".into()),
            image_path: None,
            hash: hash.into(),
            created_at,
            revealed: true,
        }
    }

    #[test]
    fn hash_is_stable() {
        assert_eq!(content_hash("text", b"abc"), content_hash("text", b"abc"));
        assert_ne!(content_hash("text", b"abc"), content_hash("text", b"abd"));
        assert_ne!(content_hash("text", b"abc"), content_hash("image", b"abc"));
    }

    #[test]
    fn bump_moves_to_front_keeps_revealed() {
        let mut entries = vec![
            text_entry("a", "h1", 1),
            text_entry("b", "h2", 2),
        ];
        entries[1].revealed = false;
        assert!(bump_existing(&mut entries, "h2", 99));
        assert_eq!(entries[0].id, "b");
        assert_eq!(entries[0].created_at, 99);
        assert!(!entries[0].revealed);
        assert_eq!(entries.len(), 2);
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
            hash: "imghash".into(),
            created_at: 0,
            revealed: true,
        });
        // push over cap via apply
        let orphans = apply_new_entry(&mut entries, text_entry("new", "newhash", 1000));
        assert_eq!(entries.len(), MAX_ENTRIES);
        assert_eq!(entries[0].id, "new");
        assert!(orphans.iter().any(|p| p.contains("x.png")));
    }
}
```

- [ ] **Step 3: Register the module (stub) in `lib.rs`**

At top of `src-tauri/src/lib.rs` with the other `mod` lines:

```rust
mod clipboard_widget;
```

Do **not** register commands or start the watcher yet (Task 3).

- [ ] **Step 4: Run unit tests**

Run: `cargo test -p kavibay_lib --lib clipboard_widget`  
Working directory: `src-tauri`  
Expected: all three tests PASS

---

### Task 3: Persist, arboard I/O, watcher, Tauri commands

**Files:**
- Modify: `src-tauri/src/clipboard_widget.rs` (add I/O + commands + watcher)
- Modify: `src-tauri/src/lib.rs` (manage state, spawn watcher, register commands)

**Interfaces:**
- Consumes: Task 2 core types/fns; `AppHandle`; `arboard::Clipboard`
- Produces:
  - Shared state `ClipboardState` managed in Tauri
  - `pub fn spawn_clipboard_watcher(app: AppHandle)`
  - Commands:
    - `clipboard_list() -> Result<Vec<ClipboardEntry>, String>`
    - `clipboard_restore(id: String) -> Result<(), String>`
    - `clipboard_set_revealed(id: String, revealed: bool) -> Result<(), String>`
    - `clipboard_clear() -> Result<(), String>`
  - Event: `clipboard:updated` with payload `Vec<ClipboardEntry>`

- [ ] **Step 1: Extend `clipboard_widget.rs` with store + watcher + commands**

Append (and keep Task 2 code). Implementation sketch — implement fully, not as comments:

```rust
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use arboard::{Clipboard, ImageData};
use tauri::{AppHandle, Emitter, Manager, State};

const POLL_MS: u64 = 400;
const INDEX_FILE: &str = "index.json";

struct Inner {
    entries: Vec<ClipboardEntry>,
    last_hash: Option<String>,
    /// After restore, skip capturing this hash for a few polls.
    ignore_hash: Option<String>,
    ignore_polls_left: u8,
    persist_error: Option<String>,
}

pub struct ClipboardState(pub Arc<Mutex<Inner>>);

impl Default for ClipboardState {
    fn default() -> Self {
        Self(Arc::new(Mutex::new(Inner {
            entries: Vec::new(),
            last_hash: None,
            ignore_hash: None,
            ignore_polls_left: 0,
            persist_error: None,
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
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("clipboard-widget"))
}

fn images_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(root_dir(app)?.join("images"))
}

fn index_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(root_dir(app)?.join(INDEX_FILE))
}

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

fn new_id() -> String {
    format!("{}-{}", now_ms(), &content_hash("id", &now_ms().to_le_bytes())[..8])
}

enum ClipSnapshot {
    Empty,
    Text(String),
    Image { bytes: Vec<u8>, width: usize, height: usize },
}

fn read_clipboard() -> ClipSnapshot {
    let mut cb = match Clipboard::new() {
        Ok(c) => c,
        Err(_) => return ClipSnapshot::Empty,
    };
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

fn write_text_clipboard(text: &str) -> Result<(), String> {
    let mut cb = Clipboard::new().map_err(|e| e.to_string())?;
    cb.set_text(text).map_err(|e| e.to_string())
}

fn write_image_clipboard(path: &Path) -> Result<(), String> {
    let dyn_img = image::open(path).map_err(|e| e.to_string())?;
    let rgba = dyn_img.to_rgba8();
    let (w, h) = rgba.dimensions();
    let mut cb = Clipboard::new().map_err(|e| e.to_string())?;
    let data = ImageData {
        width: w as usize,
        height: h as usize,
        bytes: rgba.into_raw().into(),
    };
    cb.set_image(data).map_err(|e| e.to_string())
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

fn ingest_snapshot(app: &AppHandle, state: &ClipboardState, snap: ClipSnapshot) {
    let (hash, build) = match snap {
        ClipSnapshot::Empty => return,
        ClipSnapshot::Text(text) => {
            let bytes = text.as_bytes();
            if bytes.len() > MAX_TEXT_BYTES {
                return;
            }
            let hash = content_hash("text", bytes);
            (hash.clone(), Some((hash, ClipboardKind::Text, Some(text), None)))
        }
        ClipSnapshot::Image {
            bytes,
            width,
            height,
        } => {
            if bytes.len() > MAX_IMAGE_BYTES {
                return;
            }
            let hash = content_hash("image", &bytes);
            (hash.clone(), Some((hash, ClipboardKind::Image, None, Some((bytes, width, height)))))
        }
    };

    let mut guard = state.0.lock().unwrap();
    if guard.ignore_polls_left > 0 {
        if guard.ignore_hash.as_deref() == Some(hash.as_str()) {
            guard.ignore_polls_left -= 1;
            guard.last_hash = Some(hash);
            return;
        }
        guard.ignore_polls_left -= 1;
    }
    if guard.last_hash.as_deref() == Some(hash.as_str()) {
        return;
    }

    let now = now_ms();
    if bump_existing(&mut guard.entries, &hash, now) {
        guard.last_hash = Some(hash);
        let entries = guard.entries.clone();
        drop(guard);
        if let Err(e) = save_index(app, &entries) {
            let mut g = state.0.lock().unwrap();
            g.persist_error = Some(e);
        }
        emit_updated(app, &entries);
        return;
    }

    let Some((_h, kind, text, image_raw)) = build else { return };
    let id = new_id();
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
        image_path,
        hash: hash.clone(),
        created_at: now,
        revealed: true,
    };
    let orphans = apply_new_entry(&mut guard.entries, entry);
    guard.last_hash = Some(hash);
    let entries = guard.entries.clone();
    drop(guard);
    delete_paths(&orphans);
    if let Err(e) = save_index(app, &entries) {
        let mut g = state.0.lock().unwrap();
        g.persist_error = Some(e);
    }
    emit_updated(app, &entries);
}

/// Start background clipboard polling (call once from `setup`).
pub fn spawn_clipboard_watcher(app: AppHandle, state: ClipboardState) {
    {
        let mut guard = state.0.lock().unwrap();
        guard.entries = load_index(&app);
        if let Some(first) = guard.entries.first() {
            guard.last_hash = Some(first.hash.clone());
        }
    }
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(Duration::from_millis(POLL_MS));
            let snap = read_clipboard();
            ingest_snapshot(&app, &state, snap);
        }
    });
}

#[tauri::command]
pub fn clipboard_list(state: State<'_, ClipboardState>) -> Result<Vec<ClipboardEntry>, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    Ok(guard.entries.clone())
}

#[tauri::command]
pub fn clipboard_restore(app: AppHandle, state: State<'_, ClipboardState>, id: String) -> Result<(), String> {
    let (hash, kind, text, image_path) = {
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
    }

    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    guard.ignore_hash = Some(hash.clone());
    guard.ignore_polls_left = 3;
    let now = now_ms();
    let _ = bump_existing(&mut guard.entries, &hash, now);
    guard.last_hash = Some(hash);
    let entries = guard.entries.clone();
    drop(guard);
    save_index(&app, &entries)?;
    emit_updated(&app, &entries);
    Ok(())
}

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
```

Fix compile issues as needed (`ImageEncoder` import path for `image` 0.25, `bytes` ownership for `ImageData`). Prefer matching patterns already used in this repo’s `image` dependency.

**Important arboard note:** On some platforms `get_text` succeeds with empty while an image is present — try image when text is empty. Prefer text when non-empty text is present (V1).

- [ ] **Step 2: Wire into `src-tauri/src/lib.rs`**

In `setup`, after other `app.manage(...)` calls:

```rust
let clipboard_state = clipboard_widget::ClipboardState::default();
app.manage(clipboard_state.clone());
clipboard_widget::spawn_clipboard_watcher(app.handle().clone(), clipboard_state);
```

`ClipboardState` must be `Clone` — implement by cloning the `Arc`:

```rust
#[derive(Clone)]
pub struct ClipboardState(pub Arc<Mutex<Inner>>);
```

Add to `invoke_handler`:

```rust
clipboard_widget::clipboard_list,
clipboard_widget::clipboard_restore,
clipboard_widget::clipboard_set_revealed,
clipboard_widget::clipboard_clear,
```

- [ ] **Step 3: Compile**

Run: `cargo check`  
Working directory: `src-tauri`  
Expected: success

- [ ] **Step 4: Re-run unit tests**

Run: `cargo test -p kavibay_lib --lib clipboard_widget`  
Expected: PASS

---

### Task 4: Shared clipboard composable

**Files:**
- Create: `src/widgets/useClipboardState.ts`

**Interfaces:**
- Consumes: `ClipboardEntry`, `normalizeList` from `clipboardLogic.ts`; `invoke`, `listen`
- Produces:
  - `export function useClipboardState()` → `{ entries, error, loading, copiedId, restore(id), setRevealed(id, revealed), clearAll() }`
  - Singleton subscription: first mount loads list + listens; last unmount cleans up

- [ ] **Step 1: Create `src/widgets/useClipboardState.ts`**

```ts
import { onMounted, onUnmounted, ref, type Ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { type ClipboardEntry, normalizeList } from "./clipboardLogic";

const entries: Ref<ClipboardEntry[]> = ref([]);
const error: Ref<string | null> = ref(null);
const loading: Ref<boolean> = ref(true);
const copiedId: Ref<string | null> = ref(null);

let subscriberCount = 0;
let unlisten: UnlistenFn | null = null;
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

const hasTauri = () => "__TAURI_INTERNALS__" in window;

/** Flash “Copied” on a row for ~1s. */
function flashCopied(id: string) {
  copiedId.value = id;
  if (copiedTimer) clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => {
    copiedId.value = null;
  }, 1000);
}

async function ensureSubscribed() {
  if (!hasTauri()) {
    loading.value = false;
    error.value = "Clipboard unavailable";
    return;
  }
  if (unlisten) return;
  try {
    const list = await invoke<unknown>("clipboard_list");
    entries.value = normalizeList(list);
    error.value = null;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
  unlisten = await listen<unknown>("clipboard:updated", (ev) => {
    entries.value = normalizeList(ev.payload);
  });
}

async function teardownIfUnused() {
  if (subscriberCount > 0) return;
  if (unlisten) {
    unlisten();
    unlisten = null;
  }
}

/** Shared clipboard history for all Clipboard widget instances. */
export function useClipboardState() {
  onMounted(() => {
    subscriberCount += 1;
    void ensureSubscribed();
  });
  onUnmounted(() => {
    subscriberCount = Math.max(0, subscriberCount - 1);
    void teardownIfUnused();
  });

  /** Restore entry to the system clipboard (backend bumps + emits). */
  async function restore(id: string) {
    try {
      await invoke("clipboard_restore", { id });
      flashCopied(id);
      error.value = null;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    }
  }

  /** Persist per-entry eye open/closed. */
  async function setRevealed(id: string, revealed: boolean) {
    const prev = entries.value;
    entries.value = prev.map((e) => (e.id === id ? { ...e, revealed } : e));
    try {
      await invoke("clipboard_set_revealed", { id, revealed });
      error.value = null;
    } catch (e) {
      entries.value = prev;
      error.value = e instanceof Error ? e.message : String(e);
    }
  }

  /** Wipe entire history. */
  async function clearAll() {
    try {
      await invoke("clipboard_clear");
      error.value = null;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    }
  }

  return { entries, error, loading, copiedId, restore, setRevealed, clearAll };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx vue-tsc --noEmit`  
Expected: clean for this file

---

### Task 5: Clipboard widget UI

**Files:**
- Create: `src/widgets/ClipboardWidget.vue`

**Interfaces:**
- Consumes: `WidgetProps`; `useClipboardState`; `displayText`; `convertFileSrc`
- Produces: Vue SFC registered later

- [ ] **Step 1: Create `src/widgets/ClipboardWidget.vue`**

```vue
<script setup lang="ts">
import { computed } from "vue";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { WidgetProps } from "./types";
import { displayText, type ClipboardEntry } from "./clipboardLogic";
import { useClipboardState } from "./useClipboardState";

defineProps<WidgetProps>();

const { entries, error, loading, copiedId, restore, setRevealed, clearAll } =
  useClipboardState();

const empty = computed(() => !loading.value && entries.value.length === 0);

/** Asset URL for a revealed image entry. */
function imageSrc(entry: ClipboardEntry): string | null {
  if (entry.kind !== "image" || !entry.imagePath) return null;
  try {
    return convertFileSrc(entry.imagePath);
  } catch {
    return null;
  }
}

/** Toggle eye without restoring. */
function onEyeClick(entry: ClipboardEntry, ev: Event) {
  ev.stopPropagation();
  void setRevealed(entry.id, !entry.revealed);
}
</script>

<template>
  <div class="clip">
    <div class="clip-toolbar">
      <button type="button" class="clip-clear" :disabled="empty" @click="clearAll">
        Clear all
      </button>
    </div>

    <p v-if="error" class="clip-error">{{ error }}</p>
    <p v-else-if="loading" class="clip-muted">Loading…</p>
    <p v-else-if="empty" class="clip-muted">Copy something to start</p>

    <ul v-else class="clip-list">
      <li
        v-for="entry in entries"
        :key="entry.id"
        class="clip-row"
        :class="{ 'is-copied': copiedId === entry.id }"
        role="button"
        tabindex="0"
        @click="restore(entry.id)"
        @keydown.enter.prevent="restore(entry.id)"
      >
        <div class="clip-preview">
          <template v-if="entry.kind === 'text'">
            <span class="clip-text" :class="{ masked: !entry.revealed }">{{
              displayText(entry)
            }}</span>
          </template>
          <template v-else>
            <div v-if="!entry.revealed" class="clip-img-mask" aria-hidden="true" />
            <img
              v-else-if="imageSrc(entry)"
              class="clip-img"
              :src="imageSrc(entry)!"
              alt=""
            />
            <div v-else class="clip-img-mask broken" title="Missing image" />
          </template>
        </div>

        <span class="clip-kind">{{ entry.kind === "text" ? "Aa" : "Img" }}</span>

        <button
          type="button"
          class="clip-eye"
          :aria-label="entry.revealed ? 'Hide preview' : 'Show preview'"
          :title="entry.revealed ? 'Hide' : 'Show'"
          @click="onEyeClick(entry, $event)"
        >
          <!-- Inline SVG eye / eye-off (no icon pack, no emoji). -->
          <svg
            v-if="entry.revealed"
            viewBox="0 0 24 24"
            width="16"
            height="16"
            aria-hidden="true"
          >
            <path
              fill="currentColor"
              d="M12 5c-5 0-9.27 3.11-11 7 1.73 3.89 6 7 11 7s9.27-3.11 11-7c-1.73-3.89-6-7-11-7zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 .001 6.001A3 3 0 0 0 12 9z"
            />
          </svg>
          <svg v-else viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              fill="currentColor"
              d="M2.1 3.51 3.51 2.1l18.39 18.39-1.41 1.41-3.27-3.27A12.8 12.8 0 0 1 12 19c-5 0-9.27-3.11-11-7a13.4 13.4 0 0 1 4.4-5.17L2.1 3.51zM12 7a5 5 0 0 1 4.9 4.05l-1.57-1.57A3 3 0 0 0 12 9c-.3 0-.59.05-.86.13L9.4 7.4A5 5 0 0 1 12 7zm9.9 5a13.3 13.3 0 0 1-3.16 3.86l-1.45-1.45c.46-.5.84-1.07 1.12-1.71-1.2-2.7-3.9-4.7-7.41-4.7-.5 0-1 .04-1.47.11L7.8 6.38A12.7 12.7 0 0 1 12 5c5 0 9.27 3.11 11 7z"
            />
          </svg>
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.clip {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 220px;
  max-width: 280px;
}

.clip-toolbar {
  display: flex;
  justify-content: flex-end;
}

.clip-clear {
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.55);
  font-size: 11px;
  cursor: pointer;
  padding: 2px 4px;
}

.clip-clear:hover:not(:disabled) {
  color: rgba(255, 255, 255, 0.85);
}

.clip-clear:disabled {
  opacity: 0.4;
  cursor: default;
}

.clip-muted,
.clip-error {
  margin: 0;
  font-size: 12px;
}

.clip-muted {
  color: rgba(255, 255, 255, 0.45);
}

.clip-error {
  color: #f87171;
}

.clip-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 168px; /* ~6 rows */
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.clip-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.2);
  cursor: pointer;
}

.clip-row:hover {
  background: rgba(255, 255, 255, 0.06);
}

.clip-row.is-copied {
  outline: 1px solid rgba(255, 255, 255, 0.35);
}

.clip-preview {
  min-width: 0;
  display: flex;
  align-items: center;
  min-height: 22px;
}

.clip-text {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.9);
}

.clip-text.masked {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.55);
}

.clip-img {
  width: 36px;
  height: 28px;
  object-fit: cover;
  border-radius: 4px;
  display: block;
}

.clip-img-mask {
  width: 36px;
  height: 28px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.12);
}

.clip-img-mask.broken {
  background: rgba(248, 113, 113, 0.25);
}

.clip-kind {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: rgba(255, 255, 255, 0.4);
}

.clip-eye {
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 2px;
  line-height: 0;
  color: rgba(255, 255, 255, 0.7);
  opacity: 0.85;
}

.clip-eye:hover {
  opacity: 1;
}
</style>
```

**Visual note:** Use the inline SVG eye / eye-off above — no emoji, no new icon dependency.

- [ ] **Step 2: Typecheck**

Run: `npx vue-tsc --noEmit`  
Expected: clean

---

### Task 6: Register widget + manual verification

**Files:**
- Modify: `src/widgets/registry.ts`

**Interfaces:**
- Consumes: `ClipboardWidget.vue`
- Produces: registry entry `clipboard`

- [ ] **Step 1: Register in `src/widgets/registry.ts`**

Add import:

```ts
import ClipboardWidget from "./ClipboardWidget.vue";
```

Append to `widgetRegistry` (place left stack under system-info / color-picker to reduce overlap):

```ts
  {
    id: "clipboard",
    title: "Clipboard",
    // Left of palette, below color-picker stack.
    position: { x: -480, y: 500 },
    component: ClipboardWidget,
  },
```

- [ ] **Step 2: Typecheck + cargo check**

Run:

```powershell
npx vue-tsc --noEmit
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: both succeed

- [ ] **Step 3: Manual UI checklist**

Run the app (`npm run tauri dev` or project’s usual command). Add the Clipboard widget from the palette if an existing layout has no instance.

1. Copy text outside Kavibay (overlay hidden) → entry appears when shown  
2. Copy the same text again → row bumps to top (no duplicate)  
3. Copy an image → thumbnail row  
4. Toggle eye closed on text → `••••••`; on image → solid mask  
5. Relaunch app → history + eye states restored  
6. Click a row → paste elsewhere matches; row flashes “Copied” / outline; no duplicate from self-write  
7. Clear all → empty state; image files gone from app data  
8. Duplicate the widget → both instances show the same list  

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Background capture | Task 3 watcher |
| Text + images | Task 3 read/write |
| Max 20 + delete orphan images | Task 2 trim + Task 3 delete_paths |
| Dedupe bump keep revealed | Task 2 `bump_existing` |
| Click restore + bump + ignore self-write | Task 3 `clipboard_restore` + ignore polls |
| Per-item eye persist | Task 3 `clipboard_set_revealed` + Task 5 UI |
| Masked previews | Task 1 `displayText` + Task 5 masks |
| Persist app data | Task 3 index + images |
| Shared across instances | Task 4 singleton |
| Clear all | Task 3 + Task 5 |
| Size caps 100KB / 10MB | Task 2 constants + Task 3 ingest |
| Empty state copy | Task 5 |
| Registry widget | Task 6 |

## Placeholder / consistency check

- Command names: `clipboard_list`, `clipboard_restore`, `clipboard_set_revealed`, `clipboard_clear`
- Event: `clipboard:updated`
- Serde fields camelCase to match TS (`imagePath`, `createdAt`)
- No commit steps (no git repo)
- Eye UI: inline SVG eye / eye-off — no emoji, no new deps
