# Image Widget — Design

**Date:** 2026-07-18  
**Status:** Approved for implementation planning  
**Approach:** Dialog plugin + Rust copy into app data + `localStorage` (approach 1)

## Goal

Add an image widget to the Kavibay overlay: empty state with a centered “+”, then upload a local image (including GIF) or set an HTTP(S) URL. Local uploads are copied into the app data directory. Filled state shows the image with `object-fit: cover`; hover reveals Change / Remove.

## Requirements

### Behavior

- Registry widget `image`, title “Image”, inside existing `WidgetCard`
- **Empty:** centered “+” only; click opens a small popover: **Hochladen…** | **URL…**
- **Upload:** native file dialog filtered to image types (`png`, `jpg`, `jpeg`, `gif`, `webp`) → Rust copies into `app_data/image-widget/{instanceId}/…`
- **URL:** short inline field + confirm; persist only valid `http:` / `https:` URLs
- **Filled:** `<img>` with `object-fit: cover` (GIFs animate normally via browser)
- **Hover (filled):** overlay with **Ändern** (re-open popover) and **Entfernen** (clear state + delete local file if any)
- **Persistence:** per widget instance in `localStorage` (Clock / Pomodoro / App Launcher pattern)
- **Duplicate / Remove instance:** host wires seed/dispose like other per-instance widgets

### Visual

- Lives inside existing dark glass `WidgetCard`
- Empty: large centered “+” affordance
- Filled: image fills the card content area (`cover`); no letterboxing
- Hover overlay: semi-transparent bar/actions over the image; does not use the card ⋯ menu for Change/Remove
- Match existing chrome; no custom outer chrome

### Out of scope (V1)

- Crop / resize UI
- Image gallery / multiple images per widget
- Drag-and-drop onto the widget
- Settings panel / object-fit toggle
- macOS / Linux-specific file UX beyond what Tauri dialog already provides
- Offline caching of remote URLs

## Architecture

### Approach

| Layer | Responsibility |
|-------|----------------|
| Frontend `ImageWidget.vue` | Empty +, popover, cover image, hover overlay |
| Logic `imageLogic.ts` | Types, normalize, load/save, URL validation helpers |
| Composable `useImageState.ts` | Per-`instanceId` cache, dispose, seed-on-duplicate |
| Rust `image_widget.rs` | Import (copy into app data), clear (delete file) |
| `tauri-plugin-dialog` | Image file picker |
| Asset protocol + `convertFileSrc` | Display local files in `<img>` |

No `backendCommand` / refresh polling. `invoke()` only on user actions (import, clear).

### Frontend files

| File | Role |
|------|------|
| `src/widgets/ImageWidget.vue` | UI |
| `src/widgets/imageLogic.ts` | Pure persistence + types + URL checks |
| `src/widgets/useImageState.ts` | Instance cache, dispose, seed-on-duplicate |
| `src/widgets/registry.ts` | Register `image` |
| `src/widgets/WidgetHost.vue` | Duplicate/remove seed/dispose hooks |
| `src/widgets/layoutLogic.ts` | Default instance when registry grows (via `defaultInstances`) |

Default offset: place to avoid overlap with existing widgets (e.g. left or below palette); adjust at implementation.

### Rust / Tauri

| Piece | Role |
|-------|------|
| `image_widget_import(instance_id, source_path) -> Result<String, String>` | Copy source into `app_data_dir/image-widget/{instance_id}/` with a stable filename; replace any previous file for that instance; return absolute destination path |
| `image_widget_clear(instance_id) -> Result<(), String>` | Delete the instance’s image directory/files if present |
| `tauri-plugin-dialog` | Already initialized in `lib.rs`; capability `dialog:default` already present |
| Asset protocol | Enable in `tauri.conf.json` with scope covering the app data `image-widget` path; CSP allows `img-src` for `asset:`, `http://asset.localhost`, `https:`, `http:` as needed |
| Frontend dep | `@tauri-apps/plugin-dialog` (and use `@tauri-apps/api` `convertFileSrc`) |

Import rules:

1. Ensure destination directory exists
2. On replace, remove previous files in that instance directory before copying
3. Preserve original extension (needed for GIF decoding in the webview)
4. Reject non-image extensions server-side as a safety net

### Data model

```ts
type ImageSource = "file" | "url";

interface ImageWidgetState {
  source: ImageSource | null;
  /** Absolute path inside app data when source === "file" */
  path?: string;
  /** Remote URL when source === "url" */
  url?: string;
}
```

Storage key: `kavibay:image-widget:{instanceId}`.

Normalize:

- `source === null` → clear `path` / `url`
- `source === "file"` → require non-empty `path`; drop `url`
- `source === "url"` → require valid http(s) `url`; drop `path`

### Upload flow

1. User clicks “+” (or **Ändern**) → popover: **Hochladen…** | **URL…**
2. **Hochladen…** → dialog single-select, image filters
3. On path: `invoke("image_widget_import", { instanceId, sourcePath })`
4. Persist `{ source: "file", path }`
5. Display via `convertFileSrc(path)`

### URL flow

1. User chooses **URL…** → inline input + confirm / cancel
2. Validate `http:` / `https:`
3. If previous source was `file`, call `image_widget_clear`
4. Persist `{ source: "url", url }`
5. Display via `<img :src="url">`

### Change / remove

- **Ändern:** same popover as empty state; new file/URL replaces previous
- **Entfernen:** clear state; if `source === "file"`, `image_widget_clear`; return to empty “+”

### Duplicate / remove instance

- **Duplicate:** seed `localStorage` for the new `instanceId`. If `source === "file"`, call `image_widget_import` with the existing app-data path as source so the new instance gets its own copy (independent clear). If `source === "url"`, copy the URL string only.
- **Remove instance:** dispose in-memory cache, delete `localStorage` key, call `image_widget_clear` for that `instanceId`

## Widget contract

- Receives standard `WidgetProps` (unused for data loading)
- Does not use `backendCommand` / `refreshInterval`
- Settings panel: none in V1 (managed in-widget)
- `instanceId` via existing `provide("widgetInstanceId")` from `WidgetCard`

## Error handling

| Case | Behavior |
|------|----------|
| Dialog cancelled | No-op |
| Import fails | Short error string on the card |
| Invalid URL | Inline validation; do not persist |
| Image `onerror` (broken file/URL) | Placeholder + short message; keep state so user can Change/Remove |
| Missing file after restart | Same as load error; Clear available |
| Browser-only Vite (no Tauri) | Upload shows “nicht verfügbar”; URL path still works |

## Testing

- Logic: normalize, URL validation, load/save round-trip, clear shape
- Manual: upload PNG/GIF, set URL, hover Change/Remove, restart persistence, duplicate/remove instance, broken URL / deleted file

## Success criteria

1. New empty Image widget shows only a centered “+”
2. User can set an image via upload (copied to app data) or URL
3. Filled widget shows the image with `cover`, including animated GIFs
4. Hover offers Change and Remove; Remove returns to empty state
5. State and local file survive app restart; duplicate/remove instances behave correctly
