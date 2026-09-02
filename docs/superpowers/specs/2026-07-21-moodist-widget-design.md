# Moodist Ambient Mixer Widget — Design

**Date:** 2026-07-21  
**Status:** Approved for implementation planning  
**Tier:** M — client-only extension; non-trivial mixer UI + audio state; no new Rust  
**Approach:** HTMLAudioElement per sound; curated local catalog first; dense browse layout

## Goal

Add a compact Kavibay widget for mixing looping ambient sounds (focused work), inspired by [Moodist](https://github.com/remvze/moodist). Same core mixer behavior as Moodist, denser UX that fits a ~280px widget.

## Decisions

| Topic | Choice |
|-------|--------|
| Catalog (v1) | Nature + Rain + Noise only (~20–30 sounds); data-driven for full catalog later |
| Assets | Vendored into the extension/repo (offline); no remote fetch |
| Licenses | Ship notes: Moodist MIT; third-party sounds under Pixabay Content License and/or CC0 |
| Features (v1) | Core mixer + persistence (volumes / active mix); no favorites |
| Layout | Dense browse list: category icons, Play/Clear, scrollable sound rows with inline volume |
| Audio | One looping `HTMLAudioElement` per active sound (lazy create) |
| Settings UI | None in v1 |
| Duplicate | `allowDuplicate: true`; copy volumes + category; audio starts stopped |

## Requirements

### Behavior

- Extension id `moodist`, catalog name **Moodist**, category `productivity`
- Browse by category via a compact icon strip (Nature / Rain / Noise)
- Tap a sound row to toggle it into the mix; active rows show a subtle highlight and an enabled volume slider
- Setting volume > 0 on an inactive sound activates it into the mix
- Multiple sounds layer simultaneously
- Global **Play / Pause** controls the whole mix; **Clear** sets all volumes to 0 and stops audio
- Switching category only changes the browse list; sounds from other categories keep playing if active
- Persist mix (volumes + last category) per widget instance; **do not autoplay** on restore — user presses Play
- On dispose: stop and release all audio; clear instance storage

### Visual

- Live inside existing dark glass `WidgetCard` chrome (~280px wide)
- Match Kavibay overlays (rgba white borders/fills); monochrome Moodist-like hierarchy, not a new theme
- Top: category icon strip (selected = filled/highlighted)
- Row: Play/Pause pill + circular Clear
- Optional small category title under controls
- Scrollable list of dense rows: icon · label · thin volume slider
- Inactive rows are muted visually; active rows have a light border/background

### Out of scope (v1)

- Favorites / hearts
- Named presets, shareable URLs
- Binaural / isochronic generators
- Sleep timer, fade-out shutdown
- Remaining Moodist categories (animals, urban, places, transport, things) — add later via catalog data + assets
- Widget gear settings panel
- Master volume separate from per-sound volumes
- Web Audio API / third-party audio libraries

## Architecture

### Layers

```
catalog.ts (categories + sound metadata + local src)
        ↓
useMoodistState (per-instance volumes, playing, category, Audio map)
        ↓
MoodistWidget.vue (dense browse UI)
        ↓
localStorage kavibay:moodist-widget:{instanceId}
```

### Files

| File | Responsibility |
|------|----------------|
| `src/extensions/moodist/manifest.json` | Extension metadata + UI flags |
| `src/extensions/moodist/index.ts` | Module export + lifecycle hooks |
| `src/extensions/moodist/catalog.ts` | v1 categories/sounds (ids, labels, icon keys, asset paths) |
| `src/extensions/moodist/moodistLogic.ts` | Types, normalize, load, save, clear |
| `src/extensions/moodist/useMoodistState.ts` | Per-instance reactive cache, debounce persist, audio create/play/pause/volume/dispose |
| `src/extensions/moodist/MoodistWidget.vue` | Dense browse UI |
| `src/extensions/moodist/sounds/**` | Vendored mp3s (nature, rain, noise) matching Moodist paths/names |
| `src/extensions/moodist/LICENSES.md` | Attribution: Moodist MIT; Pixabay Content License; CC0 |

Host discovery stays automatic (`import.meta.glob`). No `WidgetHost` / registry special cases.

### Catalog shape

- `Category`: `{ id, title, icon, sounds: Sound[] }`
- `Sound`: `{ id, label, icon, src }` where `src` is a bundled asset URL
- Export a single `categories` array; widget never hardcodes category ids beyond what’s in the catalog
- Adding a category later = new catalog entry + sound files (no architecture change)

### Persisted state

```ts
{
  version: 1,
  activeCategoryId: string,
  volumes: Record<string, number> // 0..1; > 0 means in the mix
}
```

- `playing` is **not** persisted (always start paused after load/restart)
- Default: empty volumes, first catalog category selected
- Debounce saves (~300ms) on volume/category changes

### Audio lifecycle

- Lazily create `HTMLAudioElement` when a sound’s volume becomes > 0 (or on Play if already in mix)
- `loop = true`; set `volume` from state
- Global Play: play all sounds with volume > 0  
- Global Pause: pause all without clearing volumes  
- Clear: volumes → 0, pause and discard or mute all elements  
- Dispose / onDispose: pause, clear `src`, drop references, remove storage key

### Duplicate / suspend

- `onDuplicate`: seed new instance volumes + category from source; `playing = false`
- `onSuspend` / `onResume`: pause on suspend; on resume restore paused state only (no autoplay)

## Edge cases

- Missing or failed audio load: leave row inactive-looking; ignore play for that sound; do not crash the widget
- Browser/Tauri autoplay restrictions: Play button is the user gesture that starts playback
- Empty mix + Play: no-op (button may still show Pause after press only if at least one sound started — prefer stay on Play if nothing to play)
- Very long category lists: scroll within the widget body; keep chrome fixed

## Verification

- Pure helpers: normalize/load/save round-trip via small Node assert script if needed
- `npx vue-tsc --noEmit`
- Manual: add from palette, layer 2+ sounds across categories, adjust volumes, pause/play, clear, restart app (mix restored, not playing), duplicate + dispose

## Reference

- Moodist upstream: https://github.com/remvze/moodist (MIT)
- Sounds: https://github.com/remvze/moodist/tree/main/public/sounds
- Extension patterns: `.cursor/skills/kavibay-widget/`; clone lifecycle from `pomodoro` / `clock`
