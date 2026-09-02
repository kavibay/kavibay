# Image Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Image widget with empty “+” state, upload (copy into app data) or URL, cover display including GIFs, and hover Change/Remove — persisted per instance.

**Architecture:** Pure helpers in `imageLogic.ts`; per-instance cache in `useImageState.ts`; Vue UI in `ImageWidget.vue`; Rust `image_widget` module copies/clears files under app data; `tauri-plugin-dialog` for pick; asset protocol + `convertFileSrc` for local `<img>` src.

**Tech Stack:** Vue 3 + TypeScript, Vite, Tauri 2, `@tauri-apps/plugin-dialog`, `@tauri-apps/api` (`invoke`, `convertFileSrc`).

## Global Constraints

- Widget inside existing dark `WidgetCard`, title **Image**
- Empty: centered “+”; click → popover **Hochladen…** | **URL…**
- Upload: dialog filters `png`/`jpg`/`jpeg`/`gif`/`webp`; Rust copies into `app_data/image-widget/{instanceId}/`
- URL: only `http:` / `https:`; clear previous local file when switching from file → url
- Filled: `object-fit: cover`; GIFs animate via browser
- Hover overlay: **Ändern** / **Entfernen** (not card ⋯ menu)
- Persist `kavibay:image-widget:{instanceId}`; seed/dispose on duplicate/remove; file duplicate = re-import copy
- No settings panel; no crop/gallery/drag-drop in V1
- No git repository in this workspace — skip all commit steps
- No test runner — verify with Node assert scripts, `npx vue-tsc --noEmit`, `cargo check`, and manual UI checks
- Spec: `docs/superpowers/specs/2026-07-18-image-widget-design.md`

## File Structure

| File | Responsibility |
|------|----------------|
| `src/widgets/imageLogic.ts` | Types, normalize, URL validation, load/save/clear |
| `src/widgets/useImageState.ts` | Per-`instanceId` cache; dispose; async seed-on-duplicate |
| `src/widgets/ImageWidget.vue` | Empty +, popover, cover image, hover overlay, dialog/URL flows |
| `src/widgets/registry.ts` | Register `image` |
| `src/widgets/WidgetHost.vue` | Duplicate/remove seed/dispose for `image` |
| `src-tauri/src/image_widget.rs` | `image_widget_import`, `image_widget_clear` |
| `src-tauri/src/lib.rs` | `mod image_widget`; register commands |
| `src-tauri/tauri.conf.json` | Enable `assetProtocol` + CSP `img-src` for asset/http(s) |
| `src-tauri/capabilities/default.json` | Ensure dialog + new commands allowed (dialog already present) |

---

### Task 1: Pure image logic

**Files:**
- Create: `src/widgets/imageLogic.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `export type ImageSource = "file" | "url"`
  - `export interface ImageWidgetState { source: ImageSource | null; path?: string; url?: string }`
  - `export const EMPTY_STATE: ImageWidgetState` — `{ source: null }`
  - `export function storageKey(instanceId: string): string`
  - `export function isValidImageUrl(value: string): boolean`
  - `export function normalizeState(raw: unknown): ImageWidgetState`
  - `export function loadState(instanceId: string): ImageWidgetState`
  - `export function saveState(instanceId: string, state: ImageWidgetState): void`
  - `export function clearState(instanceId: string): void`

- [ ] **Step 1: Create `src/widgets/imageLogic.ts`**

```ts
export type ImageSource = "file" | "url";

export interface ImageWidgetState {
  source: ImageSource | null;
  /** Absolute path inside app data when source === "file" */
  path?: string;
  /** Remote URL when source === "url" */
  url?: string;
}

export const EMPTY_STATE: ImageWidgetState = { source: null };

/** localStorage key for one widget instance. */
export function storageKey(instanceId: string): string {
  return `kavibay:image-widget:${instanceId}`;
}

/** Accept only http(s) absolute URLs. */
export function isValidImageUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const u = new URL(trimmed);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Normalize raw persisted JSON into a safe state. */
export function normalizeState(raw: unknown): ImageWidgetState {
  if (!raw || typeof raw !== "object") return { ...EMPTY_STATE };
  const o = raw as Record<string, unknown>;
  if (o.source === "file" && typeof o.path === "string" && o.path.trim()) {
    return { source: "file", path: o.path.trim() };
  }
  if (o.source === "url" && typeof o.url === "string" && isValidImageUrl(o.url)) {
    return { source: "url", url: o.url.trim() };
  }
  return { ...EMPTY_STATE };
}

/** Load persisted state for an instance (empty on miss/corrupt). */
export function loadState(instanceId: string): ImageWidgetState {
  try {
    const raw = localStorage.getItem(storageKey(instanceId));
    if (!raw) return { ...EMPTY_STATE };
    return normalizeState(JSON.parse(raw) as unknown);
  } catch {
    return { ...EMPTY_STATE };
  }
}

/** Persist state for an instance. */
export function saveState(instanceId: string, state: ImageWidgetState): void {
  localStorage.setItem(storageKey(instanceId), JSON.stringify(normalizeState(state)));
}

/** Remove persisted state (widget instance removed). */
export function clearState(instanceId: string): void {
  localStorage.removeItem(storageKey(instanceId));
}
```

- [ ] **Step 2: Verify logic with Node assert script**

Run (PowerShell):

```powershell
node --input-type=module -e @"
import assert from 'node:assert/strict';
import { isValidImageUrl, normalizeState, storageKey, EMPTY_STATE } from './src/widgets/imageLogic.ts';

assert.equal(storageKey('abc'), 'kavibay:image-widget:abc');
assert.equal(isValidImageUrl('https://example.com/a.gif'), true);
assert.equal(isValidImageUrl('http://x/y.png'), true);
assert.equal(isValidImageUrl('ftp://x'), false);
assert.equal(isValidImageUrl('not a url'), false);
assert.deepEqual(normalizeState(null), EMPTY_STATE);
assert.deepEqual(normalizeState({ source: 'file', path: 'C:\\a.gif', url: 'https://x' }), { source: 'file', path: 'C:\\a.gif' });
assert.deepEqual(normalizeState({ source: 'url', url: 'https://x/a.gif' }), { source: 'url', url: 'https://x/a.gif' });
assert.deepEqual(normalizeState({ source: 'url', url: 'nope' }), EMPTY_STATE);
console.log('ok');
"@
```

Expected: `ok`

If Node cannot import `.ts` directly, run the same asserts after temporarily compiling with `npx vite-node` or paste the functions into a one-off `.mjs` — goal is green asserts before Task 2.

- [ ] **Step 3: Typecheck**

Run: `npx vue-tsc --noEmit`  
Expected: no errors related to `imageLogic.ts`

---

### Task 2: Per-instance image state composable

**Files:**
- Create: `src/widgets/useImageState.ts`

**Interfaces:**
- Consumes: `ImageWidgetState`, `loadState`, `saveState`, `clearState`, `normalizeState`, `EMPTY_STATE` from `imageLogic.ts`
- Produces:
  - `export function useImageState(instanceId: string)` → `{ state, error, setError, setFile(path), setUrl(url), clear() }`
  - `export function disposeImageState(instanceId: string): void`
  - `export function clearImageState(instanceId: string): void`
  - `export async function seedImageStateFrom(fromId: string, toId: string): Promise<void>`

- [ ] **Step 1: Create `src/widgets/useImageState.ts`**

```ts
import { type Ref, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import {
  type ImageWidgetState,
  EMPTY_STATE,
  clearState,
  loadState,
  normalizeState,
  saveState,
} from "./imageLogic";

interface ImageCache {
  state: Ref<ImageWidgetState>;
  error: Ref<string | null>;
}

const cache = new Map<string, ImageCache>();

function ensure(instanceId: string): ImageCache {
  let existing = cache.get(instanceId);
  if (!existing) {
    existing = {
      state: ref(loadState(instanceId)),
      error: ref(null),
    };
    cache.set(instanceId, existing);
  }
  return existing;
}

/** Per-instance image source shared by the widget UI. */
export function useImageState(instanceId: string) {
  const { state, error } = ensure(instanceId);

  function persist() {
    saveState(instanceId, state.value);
  }

  function setError(message: string | null) {
    error.value = message;
  }

  /** Persist a local app-data path as the image source. */
  function setFile(path: string) {
    state.value = normalizeState({ source: "file", path });
    persist();
    setError(null);
  }

  /** Persist a remote URL as the image source. */
  function setUrl(url: string) {
    state.value = normalizeState({ source: "url", url });
    persist();
    setError(null);
  }

  /** Clear to empty state (does not call Rust — caller clears file if needed). */
  function clear() {
    state.value = { ...EMPTY_STATE };
    persist();
    setError(null);
  }

  return { state, error, setError, setFile, setUrl, clear };
}

/** Drop in-memory cache entry (after Remove). */
export function disposeImageState(instanceId: string): void {
  cache.delete(instanceId);
}

/** Clear persisted storage for an instance. */
export function clearImageState(instanceId: string): void {
  clearState(instanceId);
}

/**
 * Seed target instance from source after Duplicate.
 * URL: copy string. File: re-import so each instance owns its own copy.
 */
export async function seedImageStateFrom(fromId: string, toId: string): Promise<void> {
  const from = ensure(fromId);
  const src = normalizeState(from.state.value);

  if (src.source === "url" && src.url) {
    const next: ImageWidgetState = { source: "url", url: src.url };
    cache.set(toId, { state: ref(next), error: ref(null) });
    saveState(toId, next);
    return;
  }

  if (src.source === "file" && src.path) {
    try {
      const dest = await invoke<string>("image_widget_import", {
        instanceId: toId,
        sourcePath: src.path,
      });
      const next: ImageWidgetState = { source: "file", path: dest };
      cache.set(toId, { state: ref(next), error: ref(null) });
      saveState(toId, next);
      return;
    } catch {
      // Fall through to empty if copy fails
    }
  }

  cache.set(toId, { state: ref({ ...EMPTY_STATE }), error: ref(null) });
  saveState(toId, { ...EMPTY_STATE });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx vue-tsc --noEmit`  
Expected: PASS (Rust command not required for tsc)

---

### Task 3: Rust import/clear + asset protocol

**Files:**
- Create: `src-tauri/src/image_widget.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod image_widget`; register commands)
- Modify: `src-tauri/tauri.conf.json` (asset protocol + CSP)
- Modify: `src-tauri/capabilities/default.json` only if command ACLs require explicit allow-list beyond `core:default`

**Interfaces:**
- Consumes: Tauri `AppHandle` / `path().app_data_dir()`
- Produces:
  - `#[tauri::command] image_widget_import(app, instance_id: String, source_path: String) -> Result<String, String>`
  - `#[tauri::command] image_widget_clear(app, instance_id: String) -> Result<(), String>`

- [ ] **Step 1: Create `src-tauri/src/image_widget.rs`**

```rust
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
    if s.contains("..") || s.contains('/') || s.contains('\\') {
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
```

- [ ] **Step 2: Wire module + commands in `src-tauri/src/lib.rs`**

Add near other `mod` lines:

```rust
mod image_widget;
```

Add to `invoke_handler![...]`:

```rust
image_widget::image_widget_import,
image_widget::image_widget_clear,
```

- [ ] **Step 3: Enable asset protocol + CSP in `src-tauri/tauri.conf.json`**

Replace the `app.security` block with:

```json
"security": {
  "csp": "default-src 'self'; img-src 'self' asset: http://asset.localhost https: http: data: blob:; connect-src ipc: http://ipc.localhost; style-src 'self' 'unsafe-inline'; script-src 'self'",
  "assetProtocol": {
    "enable": true,
    "scope": ["$APPDATA/**", "$APPLOCALDATA/**"]
  }
}
```

If the existing CSP/`null` is required for other reasons, keep `null` only if `convertFileSrc` still works in manual test; prefer explicit CSP above when images fail to load.

- [ ] **Step 4: `cargo check`**

Run from `src-tauri`:

```powershell
cargo check
```

Expected: success (warnings OK)

---

### Task 4: ImageWidget.vue UI

**Files:**
- Create: `src/widgets/ImageWidget.vue`

**Interfaces:**
- Consumes: `WidgetProps`, `widgetInstanceId` inject, `useImageState`, `isValidImageUrl`, `open` from dialog plugin, `invoke`, `convertFileSrc`
- Produces: Vue SFC registered later in Task 5

- [ ] **Step 1: Create `src/widgets/ImageWidget.vue`**

```vue
<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref } from "vue";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { WidgetProps } from "./types";
import { isValidImageUrl } from "./imageLogic";
import { useImageState } from "./useImageState";

defineProps<WidgetProps>();

const instanceId = inject<string>("widgetInstanceId");
if (!instanceId) throw new Error("widgetInstanceId missing");

const { state, error, setError, setFile, setUrl, clear } = useImageState(instanceId);

const menuOpen = ref(false);
const urlMode = ref(false);
const urlDraft = ref("");
const urlError = ref<string | null>(null);
const loadError = ref(false);
const rootEl = ref<HTMLElement | null>(null);

const hasTauri = () => "__TAURI_INTERNALS__" in window;

const displaySrc = computed(() => {
  if (state.value.source === "file" && state.value.path) {
    return convertFileSrc(state.value.path);
  }
  if (state.value.source === "url" && state.value.url) {
    return state.value.url;
  }
  return null;
});

const isFilled = computed(() => displaySrc.value != null);

/** Open/close the + / Ändern popover. */
function toggleMenu() {
  menuOpen.value = !menuOpen.value;
  if (!menuOpen.value) {
    urlMode.value = false;
    urlDraft.value = "";
    urlError.value = null;
  }
}

/** Show URL input inside the popover. */
function startUrl() {
  urlMode.value = true;
  urlDraft.value = state.value.source === "url" ? state.value.url ?? "" : "";
  urlError.value = null;
}

/** Pick a local image and import into app data. */
async function pickUpload() {
  menuOpen.value = false;
  urlMode.value = false;
  if (!hasTauri()) {
    setError("Upload nicht verfügbar");
    return;
  }
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
  });
  if (selected == null) return;
  const sourcePath = Array.isArray(selected) ? selected[0] : selected;
  if (!sourcePath) return;
  try {
    const dest = await invoke<string>("image_widget_import", {
      instanceId,
      sourcePath,
    });
    setFile(dest);
    loadError.value = false;
  } catch (e) {
    setError(typeof e === "string" ? e : "Import fehlgeschlagen");
  }
}

/** Confirm URL from draft. */
async function confirmUrl() {
  if (!isValidImageUrl(urlDraft.value)) {
    urlError.value = "Ungültige URL";
    return;
  }
  const url = urlDraft.value.trim();
  if (state.value.source === "file" && hasTauri()) {
    try {
      await invoke("image_widget_clear", { instanceId });
    } catch {
      /* still switch to URL */
    }
  }
  setUrl(url);
  loadError.value = false;
  menuOpen.value = false;
  urlMode.value = false;
  urlDraft.value = "";
  urlError.value = null;
}

/** Clear image and delete local file if any. */
async function onRemove() {
  if (state.value.source === "file" && hasTauri()) {
    try {
      await invoke("image_widget_clear", { instanceId });
    } catch (e) {
      setError(typeof e === "string" ? e : "Löschen fehlgeschlagen");
    }
  }
  clear();
  loadError.value = false;
  menuOpen.value = false;
}

function onImgError() {
  loadError.value = true;
}

function onImgLoad() {
  loadError.value = false;
}

function onDocPointerDown(e: PointerEvent) {
  const t = e.target as Node | null;
  if (rootEl.value && t && !rootEl.value.contains(t)) {
    menuOpen.value = false;
    urlMode.value = false;
  }
}

onMounted(() => {
  document.addEventListener("pointerdown", onDocPointerDown, true);
});
onUnmounted(() => {
  document.removeEventListener("pointerdown", onDocPointerDown, true);
});
</script>

<template>
  <div ref="rootEl" class="image-widget" data-interactive>
    <p v-if="error" class="image-error">{{ error }}</p>

    <!-- Empty state -->
    <button
      v-if="!isFilled"
      type="button"
      class="image-plus"
      aria-label="Bild hinzufügen"
      @click="toggleMenu"
    >
      +
    </button>

    <!-- Filled state -->
    <div v-else class="image-frame">
      <img
        v-if="!loadError"
        class="image-img"
        :src="displaySrc!"
        alt=""
        draggable="false"
        @error="onImgError"
        @load="onImgLoad"
      />
      <div v-else class="image-broken">
        <span>Bild nicht ladbar</span>
      </div>
      <div class="image-hover">
        <button type="button" class="image-hover-btn" @click="toggleMenu">Ändern</button>
        <button type="button" class="image-hover-btn image-hover-btn--danger" @click="onRemove">
          Entfernen
        </button>
      </div>
    </div>

    <!-- Popover -->
    <div v-if="menuOpen" class="image-menu" data-interactive>
      <template v-if="!urlMode">
        <button type="button" class="image-menu-item" @click="pickUpload">Hochladen…</button>
        <button type="button" class="image-menu-item" @click="startUrl">URL…</button>
      </template>
      <template v-else>
        <input
          v-model="urlDraft"
          class="image-url-input"
          type="url"
          placeholder="https://…"
          aria-label="Bild-URL"
          @keydown.enter.prevent="confirmUrl"
        />
        <p v-if="urlError" class="image-url-error">{{ urlError }}</p>
        <div class="image-url-actions">
          <button type="button" class="image-menu-item" @click="confirmUrl">OK</button>
          <button
            type="button"
            class="image-menu-item"
            @click="urlMode = false; urlError = null"
          >
            Abbrechen
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.image-widget {
  position: relative;
  width: 220px;
  height: 140px;
}

.image-plus {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  border: 1px dashed rgba(255, 255, 255, 0.22);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.15);
  color: rgba(255, 255, 255, 0.65);
  font-size: 36px;
  line-height: 1;
  cursor: pointer;
}

.image-plus:hover {
  border-color: rgba(255, 255, 255, 0.35);
  color: rgba(255, 255, 255, 0.9);
}

.image-frame {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 10px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.25);
}

.image-img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  user-select: none;
}

.image-broken {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: rgba(255, 255, 255, 0.55);
  font-size: 12px;
}

.image-hover {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 8px;
  padding: 10px;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.65));
  opacity: 0;
  transition: opacity 0.15s ease;
}

.image-frame:hover .image-hover {
  opacity: 1;
}

.image-hover-btn {
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  padding: 6px 10px;
  background: rgba(28, 28, 32, 0.9);
  color: rgba(255, 255, 255, 0.92);
  font-size: 12px;
  cursor: pointer;
}

.image-hover-btn--danger {
  color: #f87171;
}

.image-menu {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  z-index: 5;
  min-width: 160px;
  padding: 6px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(28, 28, 32, 0.95);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}

.image-menu-item {
  display: block;
  width: 100%;
  margin: 0;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: rgba(255, 255, 255, 0.9);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.image-menu-item:hover {
  background: rgba(255, 255, 255, 0.08);
}

.image-url-input {
  box-sizing: border-box;
  width: 100%;
  margin-bottom: 6px;
  padding: 8px 10px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.3);
  color: rgba(255, 255, 255, 0.95);
  font-size: 13px;
  outline: none;
}

.image-url-error {
  margin: 0 0 6px;
  font-size: 11px;
  color: #f87171;
}

.image-url-actions {
  display: flex;
  gap: 4px;
}

.image-error {
  position: absolute;
  left: 0;
  right: 0;
  top: -2px;
  margin: 0;
  transform: translateY(-100%);
  font-size: 11px;
  color: #f87171;
}
</style>
```

- [ ] **Step 2: Typecheck**

Run: `npx vue-tsc --noEmit`  
Expected: PASS

---

### Task 5: Registry + WidgetHost wiring

**Files:**
- Modify: `src/widgets/registry.ts`
- Modify: `src/widgets/WidgetHost.vue`

**Interfaces:**
- Consumes: `ImageWidget.vue`, `seedImageStateFrom`, `disposeImageState`, `clearImageState`, and on remove also `invoke("image_widget_clear")`
- Produces: widget available in Add-widget menu; default layout includes it for fresh installs via `defaultInstances`

- [ ] **Step 1: Register in `src/widgets/registry.ts`**

Add import:

```ts
import ImageWidget from "./ImageWidget.vue";
```

Append registry entry (position below Apps, slightly right to avoid overlap):

```ts
{
  id: "image",
  title: "Image",
  // Below app launcher, slightly right of center.
  position: { x: 200, y: 380 },
  component: ImageWidget,
},
```

- [ ] **Step 2: Wire duplicate/remove in `src/widgets/WidgetHost.vue`**

Add imports:

```ts
import {
  clearImageState,
  disposeImageState,
  seedImageStateFrom,
} from "./useImageState";
import { invoke } from "@tauri-apps/api/core";
```

(If `invoke` is already imported elsewhere in the file, reuse that import.)

In `onDuplicate`, after other type branches:

```ts
if (source.typeId === "image") {
  void seedImageStateFrom(source.instanceId, copy.instanceId);
}
```

In `onRemove`, after other type branches:

```ts
if (removed.typeId === "image") {
  disposeImageState(removed.instanceId);
  clearImageState(removed.instanceId);
  void invoke("image_widget_clear", { instanceId: removed.instanceId }).catch(() => {});
}
```

- [ ] **Step 3: Final verification**

Run:

```powershell
npx vue-tsc --noEmit
cd src-tauri; cargo check
```

Expected: both succeed.

Manual (via `npm run tauri dev`):

1. Add Image widget → only centered “+”
2. Hochladen PNG → cover image; GIF → animates
3. Hover → Ändern / Entfernen
4. URL… → remote image
5. Restart → image still there
6. Duplicate file-backed instance → both show image; remove one → other stays
7. Entfernen → back to “+”

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Empty “+” + popover Hochladen/URL | Task 4 |
| Upload copy to app data | Task 3 + 4 |
| URL http(s) | Task 1 + 4 |
| `object-fit: cover` + GIF | Task 4 |
| Hover Ändern/Entfernen | Task 4 |
| localStorage persistence | Task 1 + 2 |
| Duplicate file copy / remove clear | Task 2 + 5 |
| Asset protocol / convertFileSrc | Task 3 + 4 |
| Browser-dev upload unavailable | Task 4 |
| Registry + WidgetCard | Task 5 |
| No settings / no gallery (out of scope) | — intentional |

## Placeholder / type consistency check

- Commands: `image_widget_import` / `image_widget_clear` with args `{ instanceId, sourcePath }` / `{ instanceId }` — camelCase for Tauri serde rename (default).
- State shape `{ source, path?, url? }` consistent across logic, composable, widget.
- No TBD/TODO placeholders left in steps.
