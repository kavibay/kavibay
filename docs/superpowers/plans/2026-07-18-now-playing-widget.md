# Now Playing Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Now Playing overlay widget that shows the Windows SMTC current session (source, title, artist, art) with working prev / play-pause / next and a quiet empty state, matching the approved dark-card mockup.

**Architecture:** Rust reads/controls the active SMTC session via the `windows` crate (`Media_Control`). The widget host polls `widget_now_playing` every 1s (`useWidgetData`). Vue renders a flush mockup card; transport and chevron call dedicated Tauri commands.

**Tech Stack:** Vue 3 + TypeScript, Vite, Tauri 2, `windows` 0.61 (`Media_Control`, `Foundation`, `Storage_Streams`), existing `base64` crate.

## Global Constraints

- Registry id `now-playing`, title **Now Playing**
- System-wide SMTC (not Spotify OAuth)
- Working prev / play-pause / next via SMTC Try* APIs (not global media-key SendInput)
- Chevron opens/focuses source app best-effort
- Empty state: “Nothing playing” + “Start media on this PC”; controls dimmed/disabled
- Visual: dark `#282828` card, header + art + centered controls (approved mockup)
- `flush: true`, `allowDuplicate: false`, default `hideTitle: true`
- Poll ~1000ms while mounted; no background watcher in V1
- No progress bar, volume, lyrics, queue, settings panel
- Windows-first; non-Windows returns empty session (not an error)
- No git repository in this workspace — skip all commit steps
- No test runner — verify with Node assert scripts, `npx vue-tsc --noEmit`, `cargo check`, and manual UI checks
- Spec: `docs/superpowers/specs/2026-07-18-now-playing-widget-design.md`

## File Structure

| File | Responsibility |
|------|----------------|
| `src/widgets/nowPlayingLogic.ts` | DTO type, empty helpers, display-name cleanup |
| `src/widgets/NowPlayingWidget.vue` | Mockup UI + control/chevron invokes |
| `src/widgets/types.ts` | Optional `defaultHideTitle` on definitions |
| `src/widgets/layoutLogic.ts` | Seed `hideTitle` from `defaultHideTitle` |
| `src/widgets/registry.ts` | Register `now-playing` |
| `src-tauri/src/now_playing.rs` | SMTC snapshot + control + open-source commands |
| `src-tauri/src/lib.rs` | `mod now_playing`; register commands |
| `src-tauri/Cargo.toml` | Extra `windows` features |

---

### Task 1: Pure frontend helpers

**Files:**
- Create: `src/widgets/nowPlayingLogic.ts`
- Test: run via `node --input-type=module` assert script (no test runner)

**Interfaces:**
- Consumes: nothing
- Produces:
  - `export interface NowPlayingInfo { has_session: boolean; app_name: string; title: string; artist: string; album_art_data_url: string | null; is_playing: boolean }`
  - `export function emptyNowPlaying(): NowPlayingInfo`
  - `export function normalizeNowPlaying(raw: unknown): NowPlayingInfo`
  - `export function displayAppName(appName: string): string`
  - `export function headerLabel(info: NowPlayingInfo): string`

- [ ] **Step 1: Create `src/widgets/nowPlayingLogic.ts`**

```ts
/**
 * Types and display helpers for the Now Playing widget.
 * Field names match Rust serde snake_case (same as System Info).
 */

export interface NowPlayingInfo {
  has_session: boolean;
  app_name: string;
  title: string;
  artist: string;
  /** data:image/...;base64,... or null when missing */
  album_art_data_url: string | null;
  is_playing: boolean;
}

/** Quiet empty payload when nothing is playing. */
export function emptyNowPlaying(): NowPlayingInfo {
  return {
    has_session: false,
    app_name: "",
    title: "",
    artist: "",
    album_art_data_url: null,
    is_playing: false,
  };
}

/**
 * Turn an AUMID / exe-ish id into a short label.
 * Examples: "Spotify.exe" → "Spotify"; "Foo.Bar_x!App" → "App" or "Foo.Bar".
 */
export function displayAppName(appName: string): string {
  const raw = appName.trim();
  if (!raw) return "";
  const afterBang = raw.includes("!") ? (raw.split("!").pop() ?? raw) : raw;
  const base = afterBang.replace(/\.exe$/i, "").trim();
  return base || raw;
}

/** Header text: cleaned app name, or "Now Playing" when empty / no session. */
export function headerLabel(info: NowPlayingInfo): string {
  if (!info.has_session) return "Now Playing";
  return displayAppName(info.app_name) || "Now Playing";
}

/** Normalize backend JSON into a safe NowPlayingInfo. */
export function normalizeNowPlaying(raw: unknown): NowPlayingInfo {
  if (!raw || typeof raw !== "object") return emptyNowPlaying();
  const o = raw as Record<string, unknown>;
  const has_session = o.has_session === true;
  if (!has_session) return emptyNowPlaying();
  const art = o.album_art_data_url;
  return {
    has_session: true,
    app_name: typeof o.app_name === "string" ? o.app_name : "",
    title: typeof o.title === "string" ? o.title : "",
    artist: typeof o.artist === "string" ? o.artist : "",
    album_art_data_url: typeof art === "string" && art.startsWith("data:image/") ? art : null,
    is_playing: o.is_playing === true,
  };
}
```

- [ ] **Step 2: Verify helpers with a Node assert script**

Run:

```bash
node --input-type=module -e "
import { emptyNowPlaying, displayAppName, headerLabel, normalizeNowPlaying } from './src/widgets/nowPlayingLogic.ts';
import assert from 'node:assert/strict';

assert.equal(displayAppName('Spotify.exe'), 'Spotify');
assert.equal(displayAppName('Foo.Bar_x!Spotify'), 'Spotify');
assert.equal(headerLabel(emptyNowPlaying()), 'Now Playing');
assert.equal(headerLabel(normalizeNowPlaying({ has_session: true, app_name: 'Chrome.exe', title: 'T', artist: 'A', album_art_data_url: null, is_playing: true })), 'Chrome');
assert.equal(normalizeNowPlaying(null).has_session, false);
assert.equal(normalizeNowPlaying({ has_session: true, title: 'X' }).title, 'X');
console.log('ok');
"
```

If Vite/TS import fails under plain Node, rewrite the script to read/eval is unnecessary — instead duplicate the three pure functions inline in the `-e` script for verification, or run:

```bash
npx --yes tsx -e "import { displayAppName, headerLabel, emptyNowPlaying, normalizeNowPlaying } from './src/widgets/nowPlayingLogic.ts'; ..."
```

Expected: prints `ok`

- [ ] **Step 3: Commit (skip — no git repo)**

---

### Task 2: `defaultHideTitle` wiring

**Files:**
- Modify: `src/widgets/types.ts`
- Modify: `src/widgets/layoutLogic.ts`
- Modify: `src/widgets/WidgetHost.vue` (`onAddType`)

**Interfaces:**
- Consumes: `WidgetDefinition`, `createInstance`
- Produces:
  - `WidgetDefinition.defaultHideTitle?: boolean`
  - `defaultInstances` / `createInstance` seed `hideTitle: true` when set
  - `createInstance(typeId, baseOffset, opts?: { hideTitle?: boolean })`

- [ ] **Step 1: Add optional flag on `WidgetDefinition` in `types.ts`**

After `compact?: boolean;` add:

```ts
  /** When true, new instances start with the title row hidden. */
  defaultHideTitle?: boolean;
```

- [ ] **Step 2: Update `layoutLogic.ts`**

Replace `defaultInstances` and `createInstance` with:

```ts
/** One instance per registry entry using registry default positions. */
export function defaultInstances(registry: WidgetDefinition[]): WidgetInstance[] {
  return registry.map((def) => ({
    instanceId: newInstanceId(),
    typeId: def.id,
    offset: { ...def.position },
    ...(def.defaultHideTitle ? { hideTitle: true } : {}),
  }));
}

/** New instance at base offset with small random jitter. */
export function createInstance(
  typeId: string,
  baseOffset: WidgetPosition,
  opts?: { hideTitle?: boolean },
): WidgetInstance {
  return {
    instanceId: newInstanceId(),
    typeId,
    offset: { x: jitter(baseOffset.x), y: jitter(baseOffset.y) },
    ...(opts?.hideTitle ? { hideTitle: true } : {}),
  };
}
```

- [ ] **Step 3: Update `WidgetHost.vue` `onAddType`**

```ts
function onAddType(typeId: string) {
  const def = defFor(typeId);
  if (!def) return;
  instances.push(
    createInstance(typeId, def.position, {
      hideTitle: Boolean(def.defaultHideTitle),
    }),
  );
  persist();
  scheduleRegionSync();
}
```

- [ ] **Step 4: Typecheck**

Run: `npx vue-tsc --noEmit`  
Expected: PASS (no new errors)

- [ ] **Step 5: Commit (skip — no git repo)**

---

### Task 3: Rust SMTC module + Cargo features

**Files:**
- Create: `src-tauri/src/now_playing.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `windows` Media Control APIs, `base64`
- Produces Tauri commands:
  - `widget_now_playing() -> Result<NowPlayingInfo, String>`
  - `now_playing_prev() -> Result<(), String>`
  - `now_playing_play_pause() -> Result<(), String>`
  - `now_playing_next() -> Result<(), String>`
  - `now_playing_open_source() -> Result<(), String>`

- [ ] **Step 1: Extend `windows` features in `src-tauri/Cargo.toml`**

Replace the windows dependency features block with:

```toml
[target.'cfg(windows)'.dependencies]
windows = { version = "0.61", features = [
  "Win32_Foundation",
  "Win32_Graphics_Gdi",
  "Win32_UI_WindowsAndMessaging",
  "Win32_UI_Input_KeyboardAndMouse",
  "Win32_UI_Shell",
  "Win32_Storage_FileSystem",
  "Foundation",
  "Media_Control",
  "Storage_Streams",
] }
```

- [ ] **Step 2: Create `src-tauri/src/now_playing.rs`**

```rust
//! Now Playing widget: Windows SMTC snapshot + transport controls.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct NowPlayingInfo {
    pub has_session: bool,
    pub app_name: String,
    pub title: String,
    pub artist: String,
    pub album_art_data_url: Option<String>,
    pub is_playing: bool,
}

impl NowPlayingInfo {
    fn empty() -> Self {
        Self {
            has_session: false,
            app_name: String::new(),
            title: String::new(),
            artist: String::new(),
            album_art_data_url: None,
            is_playing: false,
        }
    }
}

/// Poll snapshot for the widget host (`backendCommand`).
#[tauri::command]
pub fn widget_now_playing() -> Result<NowPlayingInfo, String> {
    #[cfg(windows)]
    {
        return snapshot_windows().map_err(|e| e.to_string());
    }
    #[cfg(not(windows))]
    {
        Ok(NowPlayingInfo::empty())
    }
}

#[tauri::command]
pub fn now_playing_prev() -> Result<(), String> {
    #[cfg(windows)]
    {
        return control_windows(Control::Prev).map_err(|e| e.to_string());
    }
    #[cfg(not(windows))]
    {
        Ok(())
    }
}

#[tauri::command]
pub fn now_playing_play_pause() -> Result<(), String> {
    #[cfg(windows)]
    {
        return control_windows(Control::PlayPause).map_err(|e| e.to_string());
    }
    #[cfg(not(windows))]
    {
        Ok(())
    }
}

#[tauri::command]
pub fn now_playing_next() -> Result<(), String> {
    #[cfg(windows)]
    {
        return control_windows(Control::Next).map_err(|e| e.to_string());
    }
    #[cfg(not(windows))]
    {
        Ok(())
    }
}

/// Best-effort: open/focus the source app via AppsFolder AUMID.
#[tauri::command]
pub fn now_playing_open_source() -> Result<(), String> {
    #[cfg(windows)]
    {
        return open_source_windows().map_err(|e| e.to_string());
    }
    #[cfg(not(windows))]
    {
        Ok(())
    }
}

#[cfg(windows)]
enum Control {
    Prev,
    PlayPause,
    Next,
}

#[cfg(windows)]
fn snapshot_windows() -> windows::core::Result<NowPlayingInfo> {
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSessionManager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus,
    };
    use windows::Storage::Streams::{DataReader, IRandomAccessStreamWithContentType};

    let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?.get()?;
    let session = match manager.GetCurrentSession() {
        Ok(s) => s,
        Err(_) => return Ok(NowPlayingInfo::empty()),
    };

    let app_name = session
        .SourceAppUserModelId()
        .map(|s| s.to_string())
        .unwrap_or_default();

    let props = session.TryGetMediaPropertiesAsync()?.get()?;
    let title = props.Title().map(|s| s.to_string()).unwrap_or_default();
    let artist = props.Artist().map(|s| s.to_string()).unwrap_or_default();

    let album_art_data_url = match props.Thumbnail() {
        Ok(thumb) => match thumb.OpenReadAsync() {
            Ok(op) => match op.get() {
                Ok(stream) => read_thumbnail_data_url(stream).ok(),
                Err(_) => None,
            },
            Err(_) => None,
        },
        Err(_) => None,
    };

    let is_playing = session
        .GetPlaybackInfo()
        .ok()
        .and_then(|info| info.PlaybackStatus().ok())
        .map(|st| st == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing)
        .unwrap_or(false);

    // Treat empty metadata with no useful fields as "nothing playing".
    let has_session = !title.is_empty() || !artist.is_empty() || !app_name.is_empty() || is_playing;

    if !has_session {
        return Ok(NowPlayingInfo::empty());
    }

    let _ = IRandomAccessStreamWithContentType::IID; // keep import used if needed

    Ok(NowPlayingInfo {
        has_session: true,
        app_name,
        title,
        artist,
        album_art_data_url,
        is_playing,
    })
}

#[cfg(windows)]
fn read_thumbnail_data_url(
    stream: windows::Storage::Streams::IRandomAccessStreamWithContentType,
) -> windows::core::Result<String> {
    use windows::Storage::Streams::DataReader;

    let size = stream.Size()?;
    if size == 0 || size > 8 * 1024 * 1024 {
        return Err(windows::core::Error::from(windows::core::HRESULT(0)));
    }
    let content_type = stream
        .ContentType()
        .map(|s| s.to_string())
        .unwrap_or_else(|_| "image/png".to_string());
    let mime = if content_type.starts_with("image/") {
        content_type
    } else {
        "image/png".to_string()
    };

    let reader = DataReader::CreateDataReader(&stream)?;
    reader.LoadAsync(size as u32)?.get()?;
    let mut buf = vec![0u8; size as usize];
    reader.ReadBytes(&mut buf)?;
    Ok(format!("data:{};base64,{}", mime, B64.encode(buf)))
}

#[cfg(windows)]
fn control_windows(action: Control) -> windows::core::Result<()> {
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSessionManager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus,
    };

    let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?.get()?;
    let session = manager.GetCurrentSession()?;

    match action {
        Control::Prev => {
            let _ = session.TrySkipPreviousAsync()?.get()?;
        }
        Control::Next => {
            let _ = session.TrySkipNextAsync()?.get()?;
        }
        Control::PlayPause => {
            let playing = session
                .GetPlaybackInfo()
                .ok()
                .and_then(|info| info.PlaybackStatus().ok())
                .map(|st| st == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing)
                .unwrap_or(false);
            if playing {
                let _ = session.TryPauseAsync()?.get()?;
            } else {
                let _ = session.TryPlayAsync()?.get()?;
            }
        }
    }
    Ok(())
}

#[cfg(windows)]
fn open_source_windows() -> windows::core::Result<()> {
    use windows::core::HSTRING;
    use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?.get()?;
    let session = manager.GetCurrentSession()?;
    let aumid = session.SourceAppUserModelId()?.to_string();
    if aumid.is_empty() {
        return Ok(());
    }

    // Classic pattern: shell:AppsFolder\<AUMID>
    let target = format!("shell:AppsFolder\\{aumid}");
    let file = HSTRING::from(target.as_str());
    unsafe {
        ShellExecuteW(
            Some(HWND::default()),
            windows::core::w!("open"),
            &file,
            None,
            None,
            SW_SHOWNORMAL,
        );
    }
    Ok(())
}
```

**Implementation note for the agent:** If `cargo check` complains about APIs (nullable `GetCurrentSession`, `Thumbnail` Option wrappers, `ShellExecuteW` signatures, unused imports), fix locally to match `windows` 0.61 — keep the same command names and `NowPlayingInfo` shape. Remove the dummy `IRandomAccessStreamWithContentType::IID` line if unused. Prefer compiling over matching this snippet whitespace-perfect.

**Important empty-session rule:** If `GetCurrentSession` fails → return `empty()` with `Ok`, not `Err`. Only return `Err` for unexpected SMTC failures the UI should surface once.

- [ ] **Step 3: Wire module + commands in `lib.rs`**

Add near other `mod` lines:

```rust
mod now_playing;
```

Add to `invoke_handler![...]` list:

```rust
            now_playing::widget_now_playing,
            now_playing::now_playing_prev,
            now_playing::now_playing_play_pause,
            now_playing::now_playing_next,
            now_playing::now_playing_open_source,
```

- [ ] **Step 4: Compile check**

Run: `cargo check`  
Working directory: `src-tauri`  
Expected: PASS (fix any windows-rs API mismatches until clean)

- [ ] **Step 5: Commit (skip — no git repo)**

---

### Task 4: `NowPlayingWidget.vue`

**Files:**
- Create: `src/widgets/NowPlayingWidget.vue`

**Interfaces:**
- Consumes: `WidgetProps<NowPlayingInfo>`, `normalizeNowPlaying`, `headerLabel`, Tauri `invoke` for controls
- Produces: mockup UI (playing + empty)

- [ ] **Step 1: Create the widget component**

```vue
<script setup lang="ts">
import { computed } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type { WidgetProps } from "./types";
import {
  type NowPlayingInfo,
  headerLabel,
  normalizeNowPlaying,
} from "./nowPlayingLogic";

const props = defineProps<WidgetProps<NowPlayingInfo>>();

const info = computed(() =>
  props.data ? normalizeNowPlaying(props.data) : normalizeNowPlaying(null),
);

const label = computed(() => headerLabel(info.value));
const active = computed(() => info.value.has_session);

/** Prev / pause-or-play / next via SMTC commands. */
async function onPrev() {
  if (!active.value) return;
  try {
    await invoke("now_playing_prev");
  } catch {
    /* ignore */
  }
}

async function onPlayPause() {
  if (!active.value) return;
  try {
    await invoke("now_playing_play_pause");
  } catch {
    /* ignore */
  }
}

async function onNext() {
  if (!active.value) return;
  try {
    await invoke("now_playing_next");
  } catch {
    /* ignore */
  }
}

async function onOpenSource() {
  if (!active.value) return;
  try {
    await invoke("now_playing_open_source");
  } catch {
    /* ignore */
  }
}
</script>

<template>
  <div class="np" :class="{ 'np--empty': !active }">
    <div class="np-header">
      <div class="np-source">
        <span class="np-glyph" aria-hidden="true">♪</span>
        <span class="np-app">{{ label }}</span>
      </div>
      <button
        type="button"
        class="np-chevron"
        title="Open source app"
        aria-label="Open source app"
        :disabled="!active"
        @pointerdown.stop
        @click.stop="onOpenSource"
      >
        ›
      </button>
    </div>

    <div class="np-main">
      <div class="np-meta">
        <template v-if="active">
          <p class="np-title">{{ info.title || "Unknown title" }}</p>
          <p class="np-artist">{{ info.artist || "Unknown artist" }}</p>
        </template>
        <template v-else>
          <p class="np-title np-title--muted">Nothing playing</p>
          <p class="np-artist">Start media on this PC</p>
        </template>
      </div>
      <div class="np-art" aria-hidden="true">
        <img
          v-if="active && info.album_art_data_url"
          class="np-art-img"
          :src="info.album_art_data_url"
          alt=""
        />
      </div>
    </div>

    <div class="np-controls">
      <button
        type="button"
        class="np-btn"
        aria-label="Previous"
        :disabled="!active"
        @pointerdown.stop
        @click.stop="onPrev"
      >
        ⏮
      </button>
      <button
        type="button"
        class="np-btn np-btn--main"
        :aria-label="info.is_playing ? 'Pause' : 'Play'"
        :disabled="!active"
        @pointerdown.stop
        @click.stop="onPlayPause"
      >
        {{ active && info.is_playing ? "⏸" : "▶" }}
      </button>
      <button
        type="button"
        class="np-btn"
        aria-label="Next"
        :disabled="!active"
        @pointerdown.stop
        @click.stop="onNext"
      >
        ⏭
      </button>
    </div>

    <p v-if="error && !data" class="np-error">{{ error }}</p>
  </div>
</template>

<style scoped>
.np {
  box-sizing: border-box;
  width: 320px;
  padding: 20px 22px 18px;
  background: #282828;
  color: #fff;
  line-height: 1.3;
  font-family: inherit;
}

.np-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
}

.np-source {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.np-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #1db954;
  color: #000;
  font-size: 10px;
  font-weight: 700;
  flex-shrink: 0;
}

.np--empty .np-glyph {
  background: #555;
  color: transparent;
}

.np-app {
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.np--empty .np-app {
  color: rgba(255, 255, 255, 0.55);
}

.np-chevron {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 8px;
  background: #3a3a3a;
  color: #fff;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  flex-shrink: 0;
}

.np-chevron:disabled {
  color: rgba(255, 255, 255, 0.35);
  cursor: default;
}

.np-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 22px;
}

.np-meta {
  min-width: 0;
  flex: 1;
}

.np-title {
  margin: 0 0 4px;
  font-size: 26px;
  font-weight: 700;
  line-height: 1.15;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.np-title--muted {
  font-size: 20px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.45);
}

.np-artist {
  margin: 0;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.65);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.np--empty .np-artist {
  color: rgba(255, 255, 255, 0.3);
}

.np-art {
  width: 72px;
  height: 72px;
  border-radius: 12px;
  flex-shrink: 0;
  background: #3a3a3a;
  overflow: hidden;
}

.np-art-img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.np-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 36px;
}

.np-btn {
  border: none;
  padding: 0;
  background: transparent;
  color: #fff;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.np-btn--main {
  font-size: 22px;
}

.np-btn:disabled {
  color: rgba(255, 255, 255, 0.25);
  cursor: default;
}

.np-error {
  margin: 10px 0 0;
  font-size: 12px;
  color: #ff8080;
}
</style>
```

**Note:** Transport glyphs may be replaced with inline SVGs later for pixel fidelity; emoji/unicode is acceptable for V1 if visual smoke looks fine. Prefer simple SVG paths matching the mockup if unicode looks wrong on Windows.

- [ ] **Step 2: Typecheck**

Run: `npx vue-tsc --noEmit`  
Expected: PASS

- [ ] **Step 3: Commit (skip — no git repo)**

---

### Task 5: Register the widget

**Files:**
- Modify: `src/widgets/registry.ts`

**Interfaces:**
- Consumes: `NowPlayingWidget`, Task 2 `defaultHideTitle`
- Produces: registry entry `now-playing`

- [ ] **Step 1: Import and register**

Add import:

```ts
import NowPlayingWidget from "./NowPlayingWidget.vue";
```

Append to `widgetRegistry` (before or after `image` is fine; prefer after `pomodoro` / right stack):

```ts
  {
    id: "now-playing",
    title: "Now Playing",
    // Right of palette, below notes stack — adjust if it overlaps.
    position: { x: 480, y: 740 },
    component: NowPlayingWidget,
    backendCommand: "widget_now_playing",
    refreshInterval: 1000,
    flush: true,
    allowDuplicate: false,
    defaultHideTitle: true,
  },
```

- [ ] **Step 2: Typecheck**

Run: `npx vue-tsc --noEmit`  
Expected: PASS

- [ ] **Step 3: Commit (skip — no git repo)**

---

### Task 6: Manual verification

**Files:** none (smoke only)

- [ ] **Step 1: Run the app**

```bash
npm run tauri dev
```

- [ ] **Step 2: Smoke checklist**

1. Add / reveal **Now Playing** — flush dark card, no title row by default  
2. With nothing playing — “Nothing playing” / “Start media on this PC”; controls disabled  
3. Play a Spotify track — source ≈ Spotify, title/artist/art update within ~1s  
4. Pause — center icon becomes play; play again resumes  
5. Prev / next change tracks when the session supports it  
6. Chevron opens/focuses Spotify (or AppsFolder activation) best-effort  
7. Play YouTube/browser media — header source changes; controls work if SMTC exposes them  
8. Stop all media — returns to empty state  
9. ⋯ menu still works (Show title / Hide / Remove)

- [ ] **Step 3: Commit (skip — no git repo)**

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| System-wide SMTC metadata | Task 3 |
| Working transport controls | Task 3 + 4 |
| Dynamic source header | Task 1 + 3 + 4 |
| Empty state copy | Task 4 |
| Mockup layout / flush / hideTitle | Task 2 + 4 + 5 |
| Chevron open source | Task 3 + 4 |
| Poll 1s via host | Task 5 (`backendCommand` + `refreshInterval`) |
| `allowDuplicate: false` | Task 5 |
| No progress/volume/OAuth/macOS | Out of scope — not tasked |
| Windows-first empty elsewhere | Task 3 `cfg` stubs |
