# Clipboard Widget — Design

**Date:** 2026-07-18  
**Status:** Approved for implementation planning  
**Approach:** Rust background watcher + app-data store (approach 1)

## Goal

Add a clipboard history widget to the Kavibay overlay: continuously capture system clipboard changes (text and images) even when the overlay is hidden, keep up to 20 deduplicated entries persisted across restarts, restore on click, and let the user hide sensitive previews per entry with an eye open/closed control.

## Requirements

### Behavior

- Registry widget `clipboard`, title “Clipboard”, inside existing `WidgetCard`
- **Background capture:** Rust watches the system clipboard while Kavibay is running (overlay visible or not)
- **Kinds:** text and images; unsupported formats (files, HTML-only, etc.) are ignored
- **History:** newest first, soft cap **20**; dropping an entry deletes its image file if any
- **Deduplicate:** same content hash → move existing entry to top (update timestamp); keep its `revealed` flag; do not create a second row
- **Click row:** write that entry back to the system clipboard, bump it to top, brief “Copied” flash (~1s)
- **Ignore self-writes:** restores must not immediately re-capture as a new/changed event
- **Eye (per item):** open = show real preview; closed = mask preview. Preference persisted per entry. New items start **eye open** (`revealed: true`)
- **Empty state:** short “Copy something to start” message
- **Clear all:** wipe history index + image files on disk
- **Shared history:** one app-global list (not per widget instance); duplicate widgets show the same data

### Visual

- Dark glass `WidgetCard` chrome; no custom outer chrome
- Scrollable list (~5–6 rows visible)
- Each row: preview | eye toggle | small kind hint (text / image)
- Text preview: single truncated line
- Image preview: small thumbnail
- Masked text: monospace dots (`••••••`), not the real characters
- Masked image: solid muted placeholder block (do not render blurred real pixels)
- “Copied” flash on the clicked row (~1s)

### Out of scope (V1)

- Cross-device / cloud sync
- Search, filter, or permanent pins
- Rich HTML / RTF as separate history kinds
- Global hotkey dedicated to clipboard (overlay show/hide already exists)
- macOS / Linux-specific polish beyond what Tauri / arboard already provide (Windows-first, like the rest of Kavibay)
- Settings panel for poll interval or caps

## Architecture

### Approach

| Layer | Responsibility |
|-------|----------------|
| Rust clipboard watcher | Poll system clipboard (~300–500ms); detect text/image changes; hash + dedupe; persist; emit updates |
| App data store | `app_data/clipboard-widget/index.json` + `images/{id}.{ext}` |
| Frontend `ClipboardWidget.vue` | List UI, eye toggles, click-to-restore, clear all |
| Logic `clipboardLogic.ts` | Types, normalize, preview helpers |
| Composable `useClipboardState.ts` | Subscribe to backend events, local UI state (copied flash), eye toggle invoke |
| Clipboard read/write | Native via `arboard` (or equivalent) inside Rust commands |

No `backendCommand` / `refreshInterval` polling from the widget host. The watcher is a long-lived Rust task started at app boot; the frontend listens for events and calls `invoke` for restore / reveal / clear.

### Frontend files

| File | Role |
|------|------|
| `src/widgets/ClipboardWidget.vue` | UI |
| `src/widgets/clipboardLogic.ts` | Pure types + helpers |
| `src/widgets/useClipboardState.ts` | Event subscription, actions |
| `src/widgets/registry.ts` | Register `clipboard` |
| `src/widgets/layoutLogic.ts` | Default instance offset when registry grows |

Default offset: place to avoid overlap with existing widgets (e.g. left of palette below weather/system-info stack); adjust at implementation.

### Rust / Tauri

| Piece | Role |
|-------|------|
| `clipboard_widget.rs` | Watcher task, persist, commands |
| `clipboard_list() -> Vec<ClipboardEntryDto>` | Initial load for UI |
| `clipboard_restore(id)` | Write entry to system clipboard; mark ignore token for next poll |
| `clipboard_set_revealed(id, revealed)` | Persist eye state |
| `clipboard_clear()` | Wipe index + image directory |
| Event `clipboard:updated` | Payload: full ordered list (simple V1; list ≤ 20) |
| Asset protocol + `convertFileSrc` | Display thumbnails for image entries |
| Cargo dep | `arboard` for text + image read/write on Windows (custom watcher; not the JS clipboard API) |

Watcher rules:

1. Start once at app setup (same place other backend services start)
2. Poll every ~300–500ms; compare content hash to last seen hash
3. On change: if hash matches an existing entry → bump to top; else prepend new entry
4. Enforce max 20; delete orphaned image files for dropped entries
5. After `clipboard_restore`, set a short “ignore next matching hash” so the restore is not treated as a user copy
6. Text over ~100 KB: skip capturing
7. Images over ~10 MB: skip capturing
8. Image files stored under `app_data/clipboard-widget/images/`; index holds relative paths

### Data model

```ts
type ClipboardKind = "text" | "image";

interface ClipboardEntry {
  id: string;
  kind: ClipboardKind;
  /** Full text when kind === "text" */
  text?: string;
  /** Absolute path under app data when kind === "image" */
  imagePath?: string;
  /** Content hash for dedupe */
  hash: string;
  createdAt: number;
  /** Eye open = true (show preview). Default true for new entries. */
  revealed: boolean;
}
```

Persistence: single JSON index at `app_data/clipboard-widget/index.json` (not `localStorage`), because images live on disk and the watcher owns the source of truth.

Frontend DTO may omit full huge text if needed later; V1 sends full text for entries under the capture cap.

Normalize:

- `kind === "text"` → require non-empty `text`; drop `imagePath`
- `kind === "image"` → require non-empty `imagePath`; drop `text`
- Cap list length at 20 after every mutation

### Capture flow

1. User copies text or an image outside (or inside) Kavibay
2. Watcher reads clipboard; computes hash
3. If hash equals last-seen → no-op
4. If hash matches existing entry → bump `createdAt`, move to index 0, emit update
5. Else create entry, persist text or write image bytes to `images/{id}.png` (or original ext), prepend, trim to 20, emit update
6. UI refreshes from event payload

### Restore flow

1. User clicks a row
2. Frontend `invoke("clipboard_restore", { id })`
3. Rust writes text or image to system clipboard; records ignore-hash for next poll cycle(s)
4. Rust bumps entry to top; emits `clipboard:updated`
5. Frontend shows “Copied” on that row

### Reveal flow

1. User toggles eye on a row
2. Frontend `invoke("clipboard_set_revealed", { id, revealed })`
3. Rust updates index; emits `clipboard:updated` (or UI optimistically updates then confirms)

### Clear flow

1. User triggers Clear all
2. `invoke("clipboard_clear")` → delete images dir contents + empty index; emit empty list

## Error handling

- Persist write failure: keep in-memory history; surface a one-shot error string to the UI
- Restore failure: do not bump; frontend flashes error on the row
- Unreadable clipboard / empty clipboard: ignore quietly
- Missing image file for an entry: show broken-image placeholder; allow delete via clear or future per-row delete (V1: clear all only)

## Testing

- Unit: hash/dedupe/cap logic (pure Rust or TS helpers)
- Manual: copy text → appears; copy same text → bumps; copy image → thumbnail; eye closed → masked; click → paste elsewhere matches; quit/relaunch → history restored; clear all → empty

## Success criteria

- New copies appear without the overlay being visible
- Text and images both in history, max 20, deduped
- Per-item eye masks previews and persists across restart
- Click restores to system clipboard and bumps without duplicating
- History survives app restart
