# Widget Gallery + defaultSize — Design

**Date:** 2026-07-24  
**Status:** Implemented (revised: desk widget)  
**Approach:** First-party `extensions/gallery/` desk widget with `intro.mp4` previews; `defaultSize` on manifest for Add placement

## Goal

Give Kavibay an onboarding + permanent widget picker: a **desk widget** (move / resize / sticky like peers) that shows short muted intro videos for extensions that ship `intro.mp4`, and a minimal contract field `defaultSize` so “Add” places widgets at a sensible starting size.

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| Size units | CSS pixels via `defaultSize: { w, h }` (not grid cells) |
| Gallery home | First-party extension `extensions/gallery/` — normal card chrome; Sonderform only for entry points |
| Open entry points | First-Open creates one gallery instance + **(+)** → Gallery smart-opens (create/show/focus); palette command `open-gallery` same path |
| Tile content v1 | Video preview only — **no** live demo / `demoData` / `mode` |
| Video convention | `extensions/<id>/intro.mp4` |
| Tile aspect | **4:3** (`aspect-ratio: 4 / 3`) matching 640×480 source videos |
| v1 layout | CSS grid **3 columns**, auto rows (4:3 tiles) |
| Featured set | Any extension with `intro.mp4`; currently: **notes**, **pomodoro**, **moodist**, **now-playing**, **todo**, **snake** |
| Playback | Autoplay, muted, loop, `playsinline`; hover lifts tile + shows Add |
| Missing video | Extension omitted from gallery (no placeholder tile); gallery id never a tile |

## Out of scope (v1)

- Live widget rendering in gallery tiles / `demoData` / host `mode: 'live' \| 'demo'`
- Masonry / variable tile aspect from `defaultSize` (fixed 1×3 cells at 4:3)
- Showing all registry types without video
- Sound on hover
- Dedicated keyboard shortcut beyond existing palette discovery
- Runtime (community) packages in the gallery
- Host overlay / modal gallery (superseded)

## Revision note (2026-07-24)

Gallery is no longer a host overlay. It is `extensions/gallery/` with `allowDuplicate: false`, discovered like any other widget. Host-only specials: first-open `onAddType("gallery")` and the (+) **Gallery** button.

## Contract: `defaultSize`

### Shape

Add to `ExtensionManifest.ui` (and mirrored on `RegisteredExtension`):

```ts
defaultSize: { w: number; h: number } // CSS pixels
```

Required for first-party extensions in v1.

### Host use

1. **Add / create instance** — `createInstance` / `onAddType` sets instance `width`/`height` from `defaultSize` (replaces the playground hardcode `220×220`; playground still forces square resize behavior via existing `playground` flag).
2. **`hugHeight` widgets** — apply `w` as instance width; do **not** force `h` (height stays content-driven).
3. **Gallery tiles** — v1 does **not** size tiles from `defaultSize` (fixed 1×3). Field is still required so Add from gallery is correct.

### Proposed values (CSS px)

| id | w × h |
|----|-------|
| alarm | 240 × 160 |
| app-launcher | 232 × 120 |
| ask-llm | 360 × 420 |
| calculator | 200 × 280 |
| calendar | 260 × 320 |
| clipboard | 260 × 200 |
| clock | 200 × 120 |
| color-picker | 200 × 160 |
| emoji-picker | 288 × 280 |
| focus-tracker | 300 × 220 |
| github-actions | 300 × 280 |
| image | 220 × 140 |
| moodist | 280 × 360 |
| notes | 280 × 200 |
| now-playing | 320 × 120 |
| pomodoro | 200 × 260 |
| redacted | 240 × 160 |
| snake | 220 × 220 |
| snapshots | 320 × 220 |
| stocks | 280 × 240 |
| stopwatch | 200 × 180 |
| system-info | 280 × 200 |
| tado | 120 × 118 |
| time-tracker | 340 × 320 |
| timer | 200 × 160 |
| todo | 280 × 260 |
| weather | 260 × 200 |

Where an extension already has `DEFAULT_WIDTH` / `DEFAULT_HEIGHT` in logic, prefer those numbers over the table if they diverge at implement time.

## Gallery UX

### Layout

- Overlay/panel centered (or palette-adjacent) over the desk; dimmed/blocked background click closes or focuses chrome — match existing host overlay patterns where possible.
- Inner grid: `grid-template-columns: repeat(3, 1fr)`; one row.
- Each cell: video (object-fit cover), extension title, hover chrome.

### Tile interaction

- Video is non-interactive for clicks (`pointer-events: none` on `<video>`).
- Whole-tile hover: slight lift + border emphasis; **Add** button fades in at bottom.
- **Add** label (not “Open”); click → existing `kavibayAddWidget(typeId)` path with `defaultSize` applied.
- After Add: keep gallery open (user may add several) unless First-Open flow prefers dismiss — implementer’s choice, default **stay open**.

### Discovery of videos

- Vite eager glob: `/extensions/*/intro.mp4` (or `?url` imports).
- Map path → extension `id` (= folder name).
- Join with `listExtensions()` / registry for title + add target.
- Only ids present in **both** registry and glob appear as tiles.
- If fewer than three videos exist, show fewer tiles (grid still 1×3 with empty tracks or shrink — prefer **only render existing tiles**, leave empty columns).

### Assets

- Authors place `intro.mp4` next to `manifest.json`.
- v1 expects files under `extensions/notes/`, `extensions/pomodoro/`, `extensions/moodist/`.
- Large binaries: follow repo norms (LFS or documented size limit if already established; otherwise commit as normal media unless maintainer says otherwise).

## Architecture

| Piece | Responsibility |
|-------|----------------|
| `sdk/extension/types.ts` | `defaultSize` on manifest + registered shape |
| `core/app/extensions/loadExtensions.ts` | Parse/validate `ui.defaultSize`; fail closed or warn+skip if missing (prefer **warn in dev, require for first-party**) |
| Host add path (`WidgetHost` / `layoutLogic.createInstance`) | Apply `defaultSize` on create |
| `core/app/.../gallery/` (new host module) | Glob videos, gallery panel Vue, open/close state |
| `CommandPalette.vue` / widget manager | Entry points: command + (+) affordance |
| First-open (`consumeFirstOpen` / `WidgetHost`) | Open gallery once instead of (or in addition to) only revealing search |

No `typeId` switches in the host for per-widget gallery behavior. Video presence is data-driven via glob.

## Testing

- Assert: manifest merge exposes `defaultSize`; createInstance gets width/height (and hugHeight only width).
- Assert: video glob → id list; gallery membership = registry ∩ videos.
- Manual: First-Open shows gallery; Palette / Manager open it; three muted looping videos; hover Add; Add places notes/pomodoro/moodist at `defaultSize`; desk widgets remain interactive underneath after close.

## Docs to update when implementing

- `docs/extensions.md` — `defaultSize` + optional `intro.mp4`
- `.cursor/skills/kavibay-widget/reference.md` — checklist fields
- Canonical narrative touch in `docs/superpowers/specs/2026-07-18-extension-system-design.md` only if that doc lists `ui` fields exhaustively
