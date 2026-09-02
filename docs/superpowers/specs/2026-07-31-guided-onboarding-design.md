# Guided Onboarding Tour — Design

**Date:** 2026-07-31  
**Status:** Implemented (2026-07-31 — 3-step coach + replay; first-open no longer auto-spawns Gallery)  
**Approach:** Host-owned coach layer (outline bubble + dashed hand-drawn arrow) with hybrid advance

## Goal

Teach new users three core Kavibay habits in a short guided tour:

1. Run a command from the palette  
2. Open the Widget Gallery  
3. Add a widget from the gallery  

Each step shows an explanation bubble and a hand-drawn-style arrow. Progress appears in the command palette status bar as `Onboarding N/3`. The tour is replayable.

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| Advance model | **Hybrid** — auto-advance on the real action; each bubble has **Skip** (this step) and **Skip tour** |
| When it starts | First launch **and** replay later (Settings + palette command) |
| First-open Gallery | **Stop** auto-spawning Gallery on first open — palette + tour only; gallery is step 2’s goal |
| Visual style | **Outline only** — dashed mono bubble, dashed wobbly SVG arrow, no fill/sticky-note look |
| Progress UI | Status-bar label `Onboarding N/3` (no thick progress bar) |
| Spotlight / dim | **None** in v1 — bubble + arrow only |
| Architecture | Host-owned module under `core/app/onboarding/` |

## Revision note

This **supersedes** the gallery design’s first-open behavior (`onAddType("gallery")` on `consumeFirstOpen`). First open becomes palette + guided tour; Gallery is opened by the user in step 2 (command / Widgets menu). Permanent Gallery entry points (`open-gallery`, Widgets → Gallery) stay.

## Out of scope (v1)

- Animated path “draw-on” of the arrow  
- Full-screen dim / hole spotlight  
- Localized copy  
- macOS-specific wording  
- Auto-starting the tour for existing installs that already have `kavibay:first-open-done`  
- Multi-desk-aware copy  

## Flow & copy

### First open

`consumeFirstOpen()` still opens the cockpit (palette visible). It **must not** call `onAddType("gallery")`. If onboarding storage is missing, initialize `{ status: "active", step: 1 }` and show the coach.

### Steps

| Step | Status bar | Bubble title + body | Arrow target | Completes when |
|------|------------|---------------------|--------------|----------------|
| 1 | `Onboarding 1/3` | **Run a command.** Type something like `notepad` and press Enter to open Notes from the palette. | Palette search input (arrow tip outside the palette chrome, aimed at the input) | User runs **any** palette action that executes a command, launches an app, or focuses/opens a widget from search — **or** Skip |
| 2 | `Onboarding 2/3` | **Open the Widget Gallery.** Type `widget gallery` and press Enter — or choose Gallery from the Widgets menu. | Palette search input (same target; copy changes) | A gallery instance is mounted/visible on the active desk — **or** Skip |
| 3 | `Onboarding 3/3` | **Add a widget.** Pick any tile in the gallery and click Add — your desk fills up from here. | Gallery widget root (`data-onboarding-target="widget-gallery"`); fallback: Widgets status-bar button if gallery target missing | Any **non-gallery** widget is added to the active desk — **or** Skip |

### Controls

- **Skip** — mark current step done and advance (or complete if step 3).  
- **Skip tour** — set status to `completed`, hide coach and status label.  
- Auto-advance wins if the completion action happens before Skip.

### Done

Dismiss bubble + arrow; hide `Onboarding N/3`. No “You’re set” toast in v1.

### Mid-tour cockpit close

Hide the coach while the cockpit is closed. On next Ctrl+Space / open, show the **current** step again (progress kept). Coach only while cockpit is open (same session model as non-sticky widgets).

## State & persistence

**Key:** `kavibay:onboarding-v1` in `localStorage` (separate from `kavibay:first-open-done` and layout-v4).

```ts
type OnboardingState = {
  status: "active" | "completed";
  /** Meaningful only when status === "active". */
  step: 1 | 2 | 3;
};
```

### Rules

- Missing key + first open → `{ status: "active", step: 1 }`.  
- Advance past step 3 → `{ status: "completed" }` (drop or ignore `step`).  
- Skip tour and natural finish both use **`completed`** (no separate `skipped` status — replay does not care how they finished).  
- Existing installs with `first-open-done` already set and no onboarding key: **do not** auto-start. Replay only.  
- Replay: write `{ status: "active", step: 1 }`, open cockpit, show coach.

### Module layout

| Path | Role |
|------|------|
| `core/app/onboarding/onboardingLogic.ts` | Pure load/save/advance/skip/complete/replay helpers |
| `core/app/onboarding/onboardingLogic.assert.ts` | Colocated asserts |
| `core/app/onboarding/useOnboarding.ts` | Vue composable (reactive state, event handlers) |
| `core/app/onboarding/OnboardingCoach.vue` | Bubble + SVG arrow overlay |
| `core/app/onboarding/onboardingCopy.ts` | Step titles/bodies (single source for bubble + tests) |

## UI

### Bubble (outline style)

- Transparent fill  
- Dashed ~1.5px border using `rgba(var(--fg-rgb), ~0.55)`  
- Soft radius; short title + body from copy table  
- Footer: quiet text buttons `Skip` · `Skip tour`  
- Positioned **outside** palette chrome for steps 1–2 (typically above/left of search) so the arrow has room; step 3 near the gallery card  

### Arrow

- SVG path with slight wobble, dashed stroke, hand-drawn chevron tip  
- Geometry from bubble anchor → target `getBoundingClientRect()`  
- Recompute on resize, palette move, step change, and gallery mount  
- `pointer-events: none` (never steals clicks)  

### Status bar

When `status === "active"`, show `Onboarding N/3` in the palette status bar (left cluster / quiet label near Widgets). Match existing bar typography (small, muted). Hidden when not active.

### Hit testing

- Bubble root is `data-interactive` so click-through treats it as a real target.  
- Arrow is not interactive.  

### Target anchors

Stable attributes (no class fishing):

- Palette search input: `data-onboarding-target="palette-search"`  
- Gallery widget root: `data-onboarding-target="widget-gallery"`  
- Optional fallback: Widgets status-bar button `data-onboarding-target="widgets-button"`  

## Integration

| Event | Where | Effect |
|-------|--------|--------|
| First open | `WidgetHost` `consumeFirstOpen` path | Open cockpit; **remove** `onAddType("gallery")`; init onboarding if missing |
| Palette execute (command / app / widget open) | `CommandPalette` success path | If active step 1 → advance to 2 |
| Gallery mounted/visible | Host after gallery create/focus/reveal, or `open-gallery` | If active step 2 → advance to 3; if already mounted when entering step 2, auto-complete step 2 |
| Non-gallery widget added | `onAddType` / gallery Add path | If active step 3 and `typeId !== "gallery"` → complete |
| Skip / Skip tour | `OnboardingCoach` | Advance / complete |
| Replay | New command `replay-onboarding` + Settings control | Reset to step 1, open cockpit |

Host stays free of onboarding-specific `typeId` switches beyond treating `"gallery"` as the step-2 target / step-3 exclusion (already a known extension id).

## Replay entry points

1. Palette command: **Replay Onboarding** (`id: replay-onboarding`, keywords include `onboarding`, `tour`, `tutorial`).  
2. Settings: a single control (e.g. under General or Developer) that calls the same reset helper.  

Both share one function — no duplicated reset logic.

## Testing

- Pure logic asserts: init, advance 1→2→3→completed, skip step, skip tour, replay, refuse auto-start when first-open already consumed and key missing (helper that models that gate).  
- Manual smoke: first-open tour; Skip; Skip tour; full auto path (notepad → widget gallery → add Notes); replay from command; cockpit close/reopen mid-tour.  

## Open implementation notes (non-blocking)

- Exact pixel offset of the bubble relative to the search field can be tuned during implementation.  
- Settings placement (General vs Developer) can follow whichever settings section already holds “reset-ish” actions; default preference: **General** if a suitable row exists, else Developer.
