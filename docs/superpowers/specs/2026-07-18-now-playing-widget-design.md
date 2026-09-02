# Now Playing Widget — Design

**Date:** 2026-07-18  
**Status:** Approved for implementation planning  
**Approach:** Windows SMTC (Global System Media Transport Controls) + host polling (approach 1)

## Goal

Add a Now Playing widget to the Kavibay overlay that shows whatever media Windows reports as currently playing (Spotify, browser, etc.): source app, title, artist, album art, and working prev / play-pause / next controls. Visual target is the dark rounded Spotify-style card mockup (system source branding, not hard-coded Spotify).

## Requirements

### Behavior

- Registry widget `now-playing`, title “Now Playing”, inside existing `WidgetCard`
- **Source:** Windows SMTC current media session (same family of API as the OS media flyout)
- **Fields:** `app_name`, title, artist, album art (when available), `is_playing`, `has_session`
- **Refresh:** Poll ~1s via existing host `backendCommand` + `refreshInterval` while the widget is mounted
- **Controls:** Prev / play-pause / next invoke SMTC on the active session (not global media-key SendInput)
- **Play icon:** Pause glyph when playing; play glyph when paused
- **Chevron (›):** Open / focus the source app when resolvable; no-op otherwise
- **Empty state:** When no session — “Nothing playing” + short hint (“Start media on this PC”); controls and chevron disabled/dimmed; muted art placeholder
- **Missing art (with session):** Muted placeholder square (same size as art)
- **Source header:** Real app name + simple glyph/icon when available; fall back to “Now Playing”
- **Duplicates:** `allowDuplicate: false` (one card is enough)
- **Default chrome:** `flush: true`; default `hideTitle: true` so the mockup card is the visible surface (⋯ menu still available for rename / show title / hide / remove)

### Visual

- Custom dark card matching the approved mockup (`#282828`-class background, large corner radius ~20px, soft shadow)
- Header row: source logo/glyph + name (left); small rounded chevron button (right)
- Middle row: bold title + dimmer artist (left); square rounded album art (right)
- Bottom row: three centered transport icons (prev / play-pause / next)
- Empty state keeps the same layout skeleton with muted copy and disabled controls
- Widget sits in flush `WidgetCard` so Kavibay chrome does not add a second title bar by default

### Out of scope (V1)

- Progress bar / scrubbing
- Volume control
- Lyrics, queue, or playlist UI
- Spotify Web API / OAuth
- macOS / Linux media session APIs (Windows-first, like the rest of Kavibay)
- Settings panel for poll interval
- Background watcher while overlay is hidden (poll only while widget is mounted; acceptable for V1)

## Architecture

### Approach

| Layer | Responsibility |
|-------|----------------|
| Rust `now_playing` module | Query SMTC session manager; map metadata + thumbnail; TryPlay/Pause/SkipPrevious/SkipNext; open source app |
| Host polling | `useWidgetData` + `backendCommand: "widget_now_playing"` + `refreshInterval: 1000` |
| `NowPlayingWidget.vue` | Mockup UI; invoke control / open-source commands |
| `nowPlayingLogic.ts` | Types + display helpers (empty labels, icon state) |
| `registry.ts` | Register widget; default offset away from existing cards |

### Frontend files

| File | Role |
|------|------|
| `src/widgets/NowPlayingWidget.vue` | UI (playing + empty) |
| `src/widgets/nowPlayingLogic.ts` | Pure types + helpers |
| `src/widgets/registry.ts` | Register `now-playing` |
| `src/widgets/layoutLogic.ts` | Default instance offset when registry grows |

Default offset: place to avoid overlap (e.g. right of palette under calculator/notes stack); adjust at implementation.

### Rust / Tauri

| Piece | Role |
|-------|------|
| `src-tauri/src/now_playing.rs` | SMTC snapshot + control helpers |
| `widget_now_playing() -> NowPlayingInfo` | Snapshot for host polling |
| `now_playing_prev()` | Skip previous on active session |
| `now_playing_play_pause()` | Play or pause based on current state |
| `now_playing_next()` | Skip next on active session |
| `now_playing_open_source()` | Launch / focus source app when possible |
| Cargo `windows` features | WinRT Media Control APIs (e.g. `Media_Control`, related Foundation/Storage streams for thumbnails) |

Rules:

1. Prefer the system “current” media session when multiple exist
2. No session → return `has_session: false` with empty strings / null art (not an error)
3. Thumbnail: encode as base64 data URL (or PNG bytes + base64) for V1 simplicity; omit if unavailable
4. Control commands no-op cleanly when no session
5. Open-source: best-effort; failure returns a soft error string the UI can ignore or flash briefly

### Data model

```ts
interface NowPlayingInfo {
  has_session: boolean;
  app_name: string;
  title: string;
  artist: string;
  /** data:image/...;base64,... or empty when missing */
  album_art_data_url: string | null;
  is_playing: boolean;
}
```

Serde on Rust uses snake_case field names to match System Info / existing widgets.

### Snapshot flow

1. Host calls `widget_now_playing` on an interval (~1s) while mounted
2. Rust reads SMTC current session + properties
3. Frontend renders playing layout or empty layout from `has_session`

### Control flow

1. User clicks prev / play-pause / next
2. Frontend `invoke("now_playing_*")`
3. Rust calls the matching SMTC Try* method on the active session
4. Next poll (~1s) refreshes play state / track metadata (optional: immediate re-fetch after invoke for snappier UI)

### Chevron flow

1. User clicks ›
2. `invoke("now_playing_open_source")`
3. Rust resolves source app identity and activates it when possible

## Error handling

- SMTC unavailable / API failure: surface `error` via host props once; prefer empty state over a hard crash
- No session: not an error — empty UI
- Control failure: ignore quietly or brief status; do not leave UI stuck
- Bad/missing thumbnail: placeholder square
- Open-source failure: no-op (optional brief flash)

## Testing

- Manual: play Spotify track → title/artist/art/source update; pause → icon flips; skip → next track; stop all media → empty state
- Manual: play YouTube/browser media → source name updates; controls still work when SMTC exposes them
- Manual: chevron focuses Spotify / browser when resolvable
- Unit (TS): empty-state helpers / normalize null session payload

## Success criteria

- Widget matches the approved mockup layout (playing + empty)
- Shows system-wide now playing with real source branding when available
- Transport controls affect the active session
- Quiet empty state when nothing is playing
- Fits existing widget host (registry, flush card, polling) without a new event bus
