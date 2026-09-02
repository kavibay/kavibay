# App Launcher Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a horizontal Apps dock widget (icon row + “+”) that lets users pick `.exe` / `.lnk` / folders, shows icons, launches on click, removes via right-click, and reorders via drag — persisted per instance.

**Architecture:** Pure list helpers in `appLauncherLogic.ts`; per-instance cache in `useAppLauncherState.ts`; Vue dock UI in `AppLauncherWidget.vue`; Rust `app_launcher` module for Windows icon extract + `ShellExecute` launch; `tauri-plugin-dialog` for file/folder pickers.

**Tech Stack:** Vue 3 + TypeScript, Vite, Tauri 2, `@tauri-apps/plugin-dialog`, `windows` crate (Shell/GDI), `image` + `base64` for PNG data URLs.

## Global Constraints

- Widget lives inside existing dark `WidgetCard`, title **Apps** (chrome approach A)
- “+” popover: **Dateien…** (multi `.exe`/`.lnk`) and **Ordner…** (directory dialog, `multiple: true`)
- Left-click launches; right-click → **Entfernen** only; drag-reorder within the row
- Persist under `kavibay:app-launcher:{instanceId}`; skip duplicate paths (case-insensitive)
- Icons cached as data URLs at add time; extract failure → generic fallback glyph
- Launch failure → short error on the card + mute that icon until success/remove
- No proactive path scan on mount; no settings panel; Windows-first
- No git repository in this workspace — skip all commit steps
- No test runner — verify with `npx vue-tsc --noEmit`, `cargo check`, and manual UI checks
- Spec: `docs/superpowers/specs/2026-07-18-app-launcher-widget-design.md`

## File Structure

| File | Responsibility |
|------|----------------|
| `src/widgets/appLauncherLogic.ts` | Types, normalize, kind/name helpers, load/save/clear, add/remove/reorder |
| `src/widgets/useAppLauncherState.ts` | Per-`instanceId` reactive cache; dispose; seed-on-duplicate |
| `src/widgets/AppLauncherWidget.vue` | Dock UI, dialogs, context menu, drag-reorder, invoke launch/icon |
| `src/widgets/registry.ts` | Register `app-launcher` |
| `src/widgets/WidgetHost.vue` | Duplicate/remove seed/dispose for `app-launcher` |
| `src-tauri/src/app_launcher.rs` | `extract_app_icon`, `launch_path` (Windows) |
| `src-tauri/src/lib.rs` | `mod app_launcher`; register commands; init dialog plugin |
| `src-tauri/Cargo.toml` | `tauri-plugin-dialog`, `image`, `base64`; extra `windows` features |
| `package.json` | `@tauri-apps/plugin-dialog` |
| `src-tauri/capabilities/default.json` | `dialog:default` (or `dialog:allow-open`) |

---

### Task 1: Pure app-launcher logic

**Files:**
- Create: `src/widgets/appLauncherLogic.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `export type AppKind = "exe" | "lnk" | "folder"`
  - `export interface LauncherApp { id: string; path: string; kind: AppKind; name: string; iconDataUrl?: string; muted?: boolean }`
  - `export interface AppLauncherState { apps: LauncherApp[] }`
  - `export function storageKey(instanceId: string): string`
  - `export function normalizePath(path: string): string`
  - `export function detectKind(path: string, isDirectory: boolean): AppKind`
  - `export function displayName(path: string): string`
  - `export function normalizeState(raw: unknown): AppLauncherState`
  - `export function loadState(instanceId: string): AppLauncherState`
  - `export function saveState(instanceId: string, state: AppLauncherState): void`
  - `export function clearState(instanceId: string): void`
  - `export function hasPath(apps: LauncherApp[], path: string): boolean`
  - `export function addApps(apps: LauncherApp[], entries: LauncherApp[]): LauncherApp[]`
  - `export function removeApp(apps: LauncherApp[], id: string): LauncherApp[]`
  - `export function reorderApps(apps: LauncherApp[], fromIndex: number, toIndex: number): LauncherApp[]`
  - `export function setMuted(apps: LauncherApp[], id: string, muted: boolean): LauncherApp[]`
  - `export function newAppId(): string`

- [ ] **Step 1: Create `src/widgets/appLauncherLogic.ts`**

```ts
export type AppKind = "exe" | "lnk" | "folder";

export interface LauncherApp {
  id: string;
  path: string;
  kind: AppKind;
  name: string;
  iconDataUrl?: string;
  muted?: boolean;
}

export interface AppLauncherState {
  apps: LauncherApp[];
}

/** localStorage key for one widget instance. */
export function storageKey(instanceId: string): string {
  return `kavibay:app-launcher:${instanceId}`;
}

/** Windows-insensitive path key for duplicate detection. */
export function normalizePath(path: string): string {
  return path.trim().replace(/\//g, "\\").toLowerCase();
}

/** Derive kind from path + directory flag. */
export function detectKind(path: string, isDirectory: boolean): AppKind {
  if (isDirectory) return "folder";
  const lower = path.toLowerCase();
  if (lower.endsWith(".lnk")) return "lnk";
  return "exe";
}

/** File/folder stem for display (strip trailing separators). */
export function displayName(path: string): string {
  const cleaned = path.replace(/[\\/]+$/, "");
  const parts = cleaned.split(/[\\/]/);
  const base = parts[parts.length - 1] || cleaned;
  return base.replace(/\.(exe|lnk)$/i, "") || base;
}

/** Cryptographically random id when available. */
export function newAppId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `app-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isAppKind(v: unknown): v is AppKind {
  return v === "exe" || v === "lnk" || v === "folder";
}

/** Normalize raw persisted JSON into a safe state. */
export function normalizeState(raw: unknown): AppLauncherState {
  if (!raw || typeof raw !== "object") return { apps: [] };
  const appsRaw = (raw as { apps?: unknown }).apps;
  if (!Array.isArray(appsRaw)) return { apps: [] };

  const apps: LauncherApp[] = [];
  for (const item of appsRaw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.path !== "string") continue;
    if (!isAppKind(o.kind) || typeof o.name !== "string") continue;
    const entry: LauncherApp = {
      id: o.id,
      path: o.path,
      kind: o.kind,
      name: o.name,
    };
    if (typeof o.iconDataUrl === "string") entry.iconDataUrl = o.iconDataUrl;
    if (o.muted === true) entry.muted = true;
    apps.push(entry);
  }
  return { apps };
}

/** Load persisted state for an instance (empty on miss/corrupt). */
export function loadState(instanceId: string): AppLauncherState {
  try {
    const raw = localStorage.getItem(storageKey(instanceId));
    if (!raw) return { apps: [] };
    return normalizeState(JSON.parse(raw) as unknown);
  } catch {
    return { apps: [] };
  }
}

/** Persist state for an instance. */
export function saveState(instanceId: string, state: AppLauncherState): void {
  localStorage.setItem(storageKey(instanceId), JSON.stringify(normalizeState(state)));
}

/** Remove persisted state (widget instance removed). */
export function clearState(instanceId: string): void {
  localStorage.removeItem(storageKey(instanceId));
}

/** True if path already exists in the list (case-insensitive). */
export function hasPath(apps: LauncherApp[], path: string): boolean {
  const key = normalizePath(path);
  return apps.some((a) => normalizePath(a.path) === key);
}

/** Append entries, skipping duplicate paths. */
export function addApps(apps: LauncherApp[], entries: LauncherApp[]): LauncherApp[] {
  const next = [...apps];
  for (const entry of entries) {
    if (hasPath(next, entry.path)) continue;
    next.push(entry);
  }
  return next;
}

/** Remove one app by id. */
export function removeApp(apps: LauncherApp[], id: string): LauncherApp[] {
  return apps.filter((a) => a.id !== id);
}

/** Move item fromIndex → toIndex (clamped). */
export function reorderApps(
  apps: LauncherApp[],
  fromIndex: number,
  toIndex: number,
): LauncherApp[] {
  if (
    fromIndex < 0 ||
    fromIndex >= apps.length ||
    toIndex < 0 ||
    toIndex >= apps.length ||
    fromIndex === toIndex
  ) {
    return apps;
  }
  const next = [...apps];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

/** Set or clear muted flag on one app. */
export function setMuted(
  apps: LauncherApp[],
  id: string,
  muted: boolean,
): LauncherApp[] {
  return apps.map((a) => {
    if (a.id !== id) return a;
    if (muted) return { ...a, muted: true };
    const { muted: _m, ...rest } = a;
    return rest;
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx vue-tsc --noEmit`  
Expected: PASS (or only pre-existing errors unrelated to this file)

- [ ] **Step 3: Commit** — skip (no git repo)

---

### Task 2: Per-instance state composable

**Files:**
- Create: `src/widgets/useAppLauncherState.ts`

**Interfaces:**
- Consumes: all exports from Task 1 `appLauncherLogic.ts`
- Produces:
  - `export function useAppLauncherState(instanceId: string)` → `{ apps, error, setError, replaceApps, addEntries, remove, reorder, mute, clearMute, persist }`
  - `export function disposeAppLauncherState(instanceId: string): void`
  - `export function seedAppLauncherStateFrom(fromId: string, toId: string): void`
  - `export function clearAppLauncherState(instanceId: string): void` (alias wrapping `clearState`)

- [ ] **Step 1: Create `src/widgets/useAppLauncherState.ts`**

```ts
import { type Ref, ref } from "vue";
import {
  type LauncherApp,
  addApps,
  clearState,
  loadState,
  normalizeState,
  removeApp,
  reorderApps,
  saveState,
  setMuted,
} from "./appLauncherLogic";

interface LauncherCache {
  apps: Ref<LauncherApp[]>;
  error: Ref<string | null>;
}

const cache = new Map<string, LauncherCache>();

function ensure(instanceId: string): LauncherCache {
  let existing = cache.get(instanceId);
  if (!existing) {
    existing = {
      apps: ref(loadState(instanceId).apps),
      error: ref(null),
    };
    cache.set(instanceId, existing);
  }
  return existing;
}

/** Per-instance launcher list shared by the widget UI. */
export function useAppLauncherState(instanceId: string) {
  const { apps, error } = ensure(instanceId);

  function persist() {
    saveState(instanceId, { apps: apps.value });
  }

  function setError(message: string | null) {
    error.value = message;
  }

  function replaceApps(next: LauncherApp[]) {
    apps.value = next;
    persist();
  }

  function addEntries(entries: LauncherApp[]) {
    apps.value = addApps(apps.value, entries);
    persist();
  }

  function remove(id: string) {
    apps.value = removeApp(apps.value, id);
    persist();
  }

  function reorder(fromIndex: number, toIndex: number) {
    apps.value = reorderApps(apps.value, fromIndex, toIndex);
    persist();
  }

  function mute(id: string) {
    apps.value = setMuted(apps.value, id, true);
    persist();
  }

  function clearMute(id: string) {
    apps.value = setMuted(apps.value, id, false);
    persist();
  }

  return {
    apps,
    error,
    setError,
    replaceApps,
    addEntries,
    remove,
    reorder,
    mute,
    clearMute,
    persist,
  };
}

/** Drop in-memory cache entry (after Remove). */
export function disposeAppLauncherState(instanceId: string): void {
  cache.delete(instanceId);
}

/** Clear persisted storage for an instance. */
export function clearAppLauncherState(instanceId: string): void {
  clearState(instanceId);
}

/** Ensure target cache matches source after Duplicate. */
export function seedAppLauncherStateFrom(fromId: string, toId: string): void {
  const from = ensure(fromId);
  const cloned = normalizeState({ apps: from.apps.value }).apps.map((a) => ({
    ...a,
  }));
  cache.set(toId, {
    apps: ref(cloned),
    error: ref(null),
  });
  saveState(toId, { apps: cloned });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx vue-tsc --noEmit`  
Expected: PASS

- [ ] **Step 3: Commit** — skip (no git repo)

---

### Task 3: Rust launch + icon extract

**Files:**
- Create: `src-tauri/src/app_launcher.rs`
- Modify: `src-tauri/src/lib.rs` (mod + invoke_handler)
- Modify: `src-tauri/Cargo.toml` (deps + windows features)

**Interfaces:**
- Consumes: Windows Shell/GDI APIs
- Produces:
  - `#[tauri::command] pub fn extract_app_icon(path: String) -> Result<String, String>` — `data:image/png;base64,…`
  - `#[tauri::command] pub fn launch_path(path: String) -> Result<(), String>`

- [ ] **Step 1: Update `src-tauri/Cargo.toml` dependencies**

Under `[dependencies]` add:

```toml
base64 = "0.22"
image = { version = "0.25", default-features = false, features = ["png"] }
tauri-plugin-dialog = "2"
```

Extend the Windows `windows` features list to include:

```toml
"Win32_UI_Shell",
"Win32_Graphics_Gdi",
"Win32_UI_WindowsAndMessaging",
"Win32_Foundation",
"Win32_Storage_FileSystem",
```

(Keep existing features; merge, do not replace the whole block.)

- [ ] **Step 2: Create `src-tauri/src/app_launcher.rs`**

```rust
//! Launch local paths and extract Windows shell icons as PNG data URLs.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use image::{ImageBuffer, RgbaImage};
use std::io::Cursor;
use std::path::Path;

#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;

/// Open a file, shortcut, or folder with the shell (`ShellExecuteW` / open verb).
#[tauri::command]
pub fn launch_path(path: String) -> Result<(), String> {
    #[cfg(not(windows))]
    {
        let _ = path;
        return Err("App launcher launch is only supported on Windows".into());
    }
    #[cfg(windows)]
    {
        launch_path_windows(&path)
    }
}

/// Extract the shell icon for a path and return a PNG data URL.
#[tauri::command]
pub fn extract_app_icon(path: String) -> Result<String, String> {
    #[cfg(not(windows))]
    {
        let _ = path;
        return Err("App launcher icons are only supported on Windows".into());
    }
    #[cfg(windows)]
    {
        extract_app_icon_windows(&path)
    }
}

#[cfg(windows)]
fn wide(path: &str) -> Vec<u16> {
    std::ffi::OsStr::new(path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

#[cfg(windows)]
fn launch_path_windows(path: &str) -> Result<(), String> {
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    if !Path::new(path).exists() {
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
fn extract_app_icon_windows(path: &str) -> Result<String, String> {
    use windows::core::PCWSTR;
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
        ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
    };
    use windows::Win32::UI::Shell::{SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON};
    use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, DrawIconEx, DI_NORMAL};

    if !Path::new(path).exists() {
        return Err("Pfad nicht gefunden".into());
    }

    let wide_path = wide(path);
    let mut info = SHFILEINFOW::default();

    // SAFETY: SHGetFileInfoW fills SHFILEINFOW; we DestroyIcon the returned handle.
    let ok = unsafe {
        SHGetFileInfoW(
            PCWSTR(wide_path.as_ptr()),
            windows::Win32::Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES(0),
            Some(&mut info),
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_LARGEICON,
        )
    };
    if ok == 0 || info.hIcon.is_invalid() {
        return Err("Icon konnte nicht gelesen werden".into());
    }

    let size = 32i32;
    let result = (|| -> Result<String, String> {
        // SAFETY: GDI objects created below are released before return.
        unsafe {
            let screen_dc = GetDC(None);
            if screen_dc.is_invalid() {
                return Err("GetDC fehlgeschlagen".into());
            }
            let mem_dc = CreateCompatibleDC(Some(screen_dc));
            if mem_dc.is_invalid() {
                ReleaseDC(None, screen_dc);
                return Err("CreateCompatibleDC fehlgeschlagen".into());
            }
            let bmp = CreateCompatibleBitmap(screen_dc, size, size);
            if bmp.is_invalid() {
                let _ = DeleteDC(mem_dc);
                ReleaseDC(None, screen_dc);
                return Err("CreateCompatibleBitmap fehlgeschlagen".into());
            }
            let old = SelectObject(mem_dc, HGDIOBJ(bmp.0));

            let drawn = DrawIconEx(
                mem_dc,
                0,
                0,
                info.hIcon,
                size,
                size,
                0,
                None,
                DI_NORMAL,
            );
            if drawn.is_err() {
                SelectObject(mem_dc, old);
                let _ = DeleteObject(HGDIOBJ(bmp.0));
                let _ = DeleteDC(mem_dc);
                ReleaseDC(None, screen_dc);
                return Err("DrawIconEx fehlgeschlagen".into());
            }

            let mut header = BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: size,
                biHeight: -size, // top-down
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0 as u32,
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
                return Err("GetDIBits fehlgeschlagen".into());
            }

            // BGRA → RGBA
            for chunk in pixels.chunks_exact_mut(4) {
                chunk.swap(0, 2);
            }

            let img: RgbaImage = ImageBuffer::from_raw(size as u32, size as u32, pixels)
                .ok_or_else(|| "ImageBuffer fehlgeschlagen".into())?;
            let mut png_bytes = Cursor::new(Vec::new());
            img.write_to(&mut png_bytes, image::ImageFormat::Png)
                .map_err(|e| e.to_string())?;
            let b64 = STANDARD.encode(png_bytes.into_inner());
            Ok(format!("data:image/png;base64,{b64}"))
        }
    })();

    // SAFETY: destroy icon from SHGetFileInfoW
    unsafe {
        let _ = DestroyIcon(info.hIcon);
    }

    result
}
```

**Note for implementer:** The `windows` 0.61 API surface for `ShellExecuteW` / `SHGetFileInfoW` / GDI may need small signature tweaks (`Option` vs raw, `BOOL` checks). Adjust until `cargo check` passes; keep the same command signatures and PNG data-URL contract.

If `DrawIconEx` / alpha looks wrong on some icons, shipping opaque icons is acceptable for V1.

- [ ] **Step 3: Wire module in `src-tauri/src/lib.rs`**

Add near other mods:

```rust
mod app_launcher;
```

In `invoke_handler`, add:

```rust
app_launcher::extract_app_icon,
app_launcher::launch_path,
```

- [ ] **Step 4: Verify Rust compiles**

Run: `cd src-tauri && cargo check`  
Expected: PASS (fix any windows API mismatches until clean)

- [ ] **Step 5: Commit** — skip (no git repo)

---

### Task 4: Dialog plugin + capabilities

**Files:**
- Modify: `package.json` / lockfile via npm
- Modify: `src-tauri/Cargo.toml` (already has `tauri-plugin-dialog` from Task 3)
- Modify: `src-tauri/src/lib.rs` (`.plugin(tauri_plugin_dialog::init())`)
- Modify: `src-tauri/capabilities/default.json`

**Interfaces:**
- Consumes: Task 3 Cargo dep
- Produces: Frontend can `import { open } from "@tauri-apps/plugin-dialog"`

- [ ] **Step 1: Install JS package**

Run: `npm install @tauri-apps/plugin-dialog`  
Expected: dependency listed in `package.json`

- [ ] **Step 2: Register plugin in `lib.rs` builder chain**

After `.plugin(tauri_plugin_global_shortcut::…)` (or before `setup`), add:

```rust
.plugin(tauri_plugin_dialog::init())
```

- [ ] **Step 3: Add capability permission**

In `src-tauri/capabilities/default.json` `permissions` array, add:

```json
"dialog:default"
```

- [ ] **Step 4: Verify**

Run: `cd src-tauri && cargo check`  
Expected: PASS

- [ ] **Step 5: Commit** — skip (no git repo)

---

### Task 5: AppLauncherWidget UI

**Files:**
- Create: `src/widgets/AppLauncherWidget.vue`

**Interfaces:**
- Consumes:
  - `useAppLauncherState` from Task 2
  - `detectKind`, `displayName`, `newAppId` from Task 1
  - `invoke` from `@tauri-apps/api/core`
  - `open` from `@tauri-apps/plugin-dialog`
  - `WidgetProps` from `./types`
  - `inject("widgetInstanceId")`
- Produces: Vue SFC registered later in Task 6

- [ ] **Step 1: Create `src/widgets/AppLauncherWidget.vue`**

```vue
<script setup lang="ts">
import { inject, onMounted, onUnmounted, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { WidgetProps } from "./types";
import {
  type LauncherApp,
  detectKind,
  displayName,
  newAppId,
} from "./appLauncherLogic";
import { useAppLauncherState } from "./useAppLauncherState";

defineProps<WidgetProps>();

const instanceId = inject<string>("widgetInstanceId");
if (!instanceId) throw new Error("widgetInstanceId missing");

const {
  apps,
  error,
  setError,
  addEntries,
  remove,
  reorder,
  mute,
  clearMute,
} = useAppLauncherState(instanceId);

const addMenuOpen = ref(false);
const ctx = ref<{ id: string; x: number; y: number } | null>(null);
const dragFrom = ref<number | null>(null);
const rootEl = ref<HTMLElement | null>(null);

/** Normalize dialog return into a path list. */
function asPaths(selected: string | string[] | null): string[] {
  if (selected == null) return [];
  return Array.isArray(selected) ? selected : [selected];
}

/** Build launcher entries for selected paths (extract icons when possible). */
async function ingestPaths(paths: string[], isDirectory: boolean) {
  const entries: LauncherApp[] = [];
  for (const path of paths) {
    const kind = detectKind(path, isDirectory);
    let iconDataUrl: string | undefined;
    try {
      iconDataUrl = await invoke<string>("extract_app_icon", { path });
    } catch {
      // fallback glyph in template when missing
    }
    entries.push({
      id: newAppId(),
      path,
      kind,
      name: displayName(path),
      ...(iconDataUrl ? { iconDataUrl } : {}),
    });
  }
  addEntries(entries);
  setError(null);
}

/** Open multi file picker for .exe / .lnk. */
async function pickFiles() {
  addMenuOpen.value = false;
  const selected = await open({
    multiple: true,
    directory: false,
    filters: [{ name: "Apps", extensions: ["exe", "lnk"] }],
  });
  await ingestPaths(asPaths(selected), false);
}

/** Open multi folder picker. */
async function pickFolders() {
  addMenuOpen.value = false;
  const selected = await open({
    multiple: true,
    directory: true,
  });
  await ingestPaths(asPaths(selected), true);
}

/** Launch path; mute icon on failure. */
async function launch(app: LauncherApp) {
  setError(null);
  try {
    await invoke("launch_path", { path: app.path });
    clearMute(app.id);
  } catch (e) {
    mute(app.id);
    setError(typeof e === "string" ? e : "Start fehlgeschlagen");
  }
}

function onContextMenu(e: MouseEvent, id: string) {
  e.preventDefault();
  ctx.value = { id, x: e.clientX, y: e.clientY };
}

function onRemoveCtx() {
  if (!ctx.value) return;
  remove(ctx.value.id);
  ctx.value = null;
}

function onDragStart(index: number) {
  dragFrom.value = index;
}

function onDragOver(e: DragEvent) {
  e.preventDefault();
}

function onDrop(index: number) {
  if (dragFrom.value == null) return;
  reorder(dragFrom.value, index);
  dragFrom.value = null;
}

function onDocPointerDown(e: PointerEvent) {
  const t = e.target as Node | null;
  if (rootEl.value && t && !rootEl.value.contains(t)) {
    addMenuOpen.value = false;
    ctx.value = null;
  } else if (ctx.value) {
    // close context menu on any outside click inside widget too
    const el = e.target as HTMLElement | null;
    if (!el?.closest?.("[data-app-ctx]")) ctx.value = null;
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
  <div ref="rootEl" class="launcher" data-interactive>
    <p v-if="error" class="launcher-error">{{ error }}</p>

    <div class="launcher-row">
      <button
        v-for="(app, index) in apps"
        :key="app.id"
        type="button"
        class="launcher-icon"
        :class="{ 'launcher-icon--muted': app.muted }"
        :title="app.name"
        draggable="true"
        @click="launch(app)"
        @contextmenu="onContextMenu($event, app.id)"
        @dragstart="onDragStart(index)"
        @dragover="onDragOver"
        @drop="onDrop(index)"
      >
        <img v-if="app.iconDataUrl" :src="app.iconDataUrl" alt="" class="launcher-img" />
        <span v-else class="launcher-fallback">{{ app.name.slice(0, 1).toUpperCase() }}</span>
      </button>

      <div class="launcher-add-wrap">
        <button
          type="button"
          class="launcher-add"
          title="Hinzufügen"
          aria-label="Hinzufügen"
          @click="addMenuOpen = !addMenuOpen"
        >
          +
        </button>
        <div v-if="addMenuOpen" class="launcher-menu" data-interactive>
          <button type="button" class="launcher-menu-item" @click="pickFiles">Dateien…</button>
          <button type="button" class="launcher-menu-item" @click="pickFolders">Ordner…</button>
        </div>
      </div>
    </div>

    <div
      v-if="ctx"
      class="launcher-ctx"
      data-app-ctx
      data-interactive
      :style="{ left: ctx.x + 'px', top: ctx.y + 'px' }"
      @pointerdown.stop
    >
      <button type="button" class="launcher-menu-item launcher-menu-item--danger" @click="onRemoveCtx">
        Entfernen
      </button>
    </div>
  </div>
</template>

<style scoped>
.launcher {
  position: relative;
  min-width: 160px;
}

.launcher-error {
  margin: 0 0 8px;
  font-size: 11px;
  color: #f0a0a0;
}

.launcher-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.launcher-icon {
  width: 40px;
  height: 40px;
  padding: 0;
  border: none;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.06);
  cursor: pointer;
  display: grid;
  place-items: center;
  overflow: hidden;
}

.launcher-icon:hover {
  background: rgba(255, 255, 255, 0.12);
}

.launcher-icon--muted {
  opacity: 0.4;
}

.launcher-img {
  width: 28px;
  height: 28px;
  object-fit: contain;
  pointer-events: none;
}

.launcher-fallback {
  font-size: 14px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.75);
}

.launcher-add-wrap {
  position: relative;
}

.launcher-add {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  border: 1.5px dashed rgba(255, 255, 255, 0.35);
  background: transparent;
  color: rgba(255, 255, 255, 0.55);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}

.launcher-add:hover {
  border-color: rgba(255, 255, 255, 0.55);
  color: rgba(255, 255, 255, 0.85);
}

.launcher-menu {
  position: absolute;
  left: 0;
  bottom: calc(100% + 6px);
  min-width: 120px;
  padding: 4px;
  border-radius: 8px;
  background: rgba(24, 24, 28, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.4);
  z-index: 5;
}

.launcher-menu-item {
  display: block;
  width: 100%;
  padding: 6px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.9);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.launcher-menu-item:hover {
  background: rgba(255, 255, 255, 0.08);
}

.launcher-menu-item--danger {
  color: #f0a0a0;
}

.launcher-ctx {
  position: fixed;
  z-index: 50;
  min-width: 120px;
  padding: 4px;
  border-radius: 8px;
  background: rgba(24, 24, 28, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.4);
}
</style>
```

**Context menu position note:** `position: fixed` with `clientX/Y` is correct for overlay fullscreen. If the menu is clipped, keep fixed.

- [ ] **Step 2: Typecheck**

Run: `npx vue-tsc --noEmit`  
Expected: PASS

- [ ] **Step 3: Commit** — skip (no git repo)

---

### Task 6: Registry + WidgetHost wiring

**Files:**
- Modify: `src/widgets/registry.ts`
- Modify: `src/widgets/WidgetHost.vue`

**Interfaces:**
- Consumes: `AppLauncherWidget.vue`, `disposeAppLauncherState`, `seedAppLauncherStateFrom`, `clearAppLauncherState`
- Produces: widget type `app-launcher` available in host / add-widget flow

- [ ] **Step 1: Register widget in `src/widgets/registry.ts`**

Add import:

```ts
import AppLauncherWidget from "./AppLauncherWidget.vue";
```

Append registry entry:

```ts
{
  id: "app-launcher",
  title: "Apps",
  // Centered under the palette (~640px wide).
  position: { x: 0, y: 220 },
  component: AppLauncherWidget,
},
```

- [ ] **Step 2: Wire duplicate/remove in `WidgetHost.vue`**

Add import:

```ts
import {
  clearAppLauncherState,
  disposeAppLauncherState,
  seedAppLauncherStateFrom,
} from "./useAppLauncherState";
```

In `onDuplicate`, after pomodoro block:

```ts
if (source.typeId === "app-launcher") {
  seedAppLauncherStateFrom(source.instanceId, copy.instanceId);
}
```

In `onRemove`, after pomodoro block:

```ts
if (removed.typeId === "app-launcher") {
  disposeAppLauncherState(removed.instanceId);
  clearAppLauncherState(removed.instanceId);
}
```

- [ ] **Step 3: Full verify**

Run:

```bash
npx vue-tsc --noEmit
cd src-tauri && cargo check
```

Expected: both PASS

- [ ] **Step 4: Manual UI checklist**

1. `npm run tauri dev` — overlay opens with Ctrl+Space  
2. Add Apps widget if not on layout (or reset layout / add via palette if supported)  
3. “+” → Dateien… → pick 1+ `.exe` / `.lnk` → icons appear  
4. “+” → Ordner… → pick folder → icon appears  
5. Left-click opens target  
6. Right-click → Entfernen removes  
7. Drag reorder persists after restart  
8. Duplicate widget copies apps; remove clears storage  

- [ ] **Step 5: Commit** — skip (no git repo)

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| WidgetCard + title Apps | Task 5–6 |
| Dateien… / Ordner… popover | Task 5 |
| Launch on click | Task 3 + 5 |
| Right-click Entfernen | Task 5 |
| Drag reorder + persist | Task 1–2 + 5 |
| Icon extract + fallback | Task 3 + 5 |
| Launch error + mute | Task 1–2 + 5 |
| Per-instance localStorage | Task 1–2 |
| Duplicate/remove host hooks | Task 6 |
| Dialog plugin + capabilities | Task 4 |
| Out of scope (args, macOS, …) | not implemented |

**Placeholder scan:** none intentional.  
**Type consistency:** `LauncherApp`, `extract_app_icon`, `launch_path`, storage key `kavibay:app-launcher:{instanceId}` match across tasks.
