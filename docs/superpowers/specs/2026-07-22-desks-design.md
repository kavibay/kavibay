# Desks — Design

**Date:** 2026-07-22  
**Status:** Approved for implementation planning  
**Approach:** Global widget catalog + per-desk placements (`layout-v4`); compact desk tabs in the palette footer

## Goal

Introduce **desks**: named layout contexts. Each desk has its own open set of widgets (placements), palette chrome, and per-placement geometry. The same widget **instance** (shared content) can appear on multiple desks with different size/position/hidden/sticky. Users switch and rename desks from a row at the bottom of the command palette.

## Requirements

### Desks

- Dynamic set: start with one desk (default name `"1"`); users can add and delete
- Cannot delete the last remaining desk
- Inline rename via double-click on the desk tab (Enter commit, Esc cancel, blur commit)
- Switching desks swaps active palette chrome and which placements are mounted
- Terminology in UI and code comments: **desk** (not workspace)

### Shared instances

- One catalog entry per widget instance (`instanceId`, `typeId`, title, …)
- Content storage remains `kavibay:<widget>:<instanceId>` — shared across desks by design
- Geometry (`offset`, `width`, `height`, `contentScale`), `hidden`, and `sticky` are **per desk placement**, not on the catalog entry
- Creating a widget adds a catalog entry + placement on the **active** desk only
- Explicit **Also on this desk** (palette / catalog action) places an existing catalog instance onto the **active** desk (new placement; no-op if already placed there)
- Duplicate creates a **new** catalog entry + placement on the active desk only (not auto-shared)

### Remove / delete

- Remove when the instance is on **2+ desks** → prompt: **This desk only** | **All desks**
- Remove when only on the current desk → dispose path as today (catalog + content keys)
- Delete desk → confirm; dispose catalog entries that exist **only** on that desk; drop placements that were exclusive to it; if deleting the active desk, switch to another remaining desk first

### Palette chrome

- Palette position, width, list height, and sticky are **per desk**

### Out of scope

- Desk reordering / drag-reorder of tabs
- Keyboard shortcuts to switch desks (can follow later)
- Syncing desks across machines / cloud
- Max desk hard-cap (soft practical limit only via UI density)
- Moving exclusive widgets to another desk on delete (dispose instead)

## Architecture

### Approach

**Catalog + per-desk placements (Approach 1).**

Rejected:

- Full layout snapshot per desk with content aliasing — drifts easily; dispose rules messy
- Single mega-list with `deskIds[]` on each instance — fat objects; awkward delete-desk cleanup

### Data model

```ts
interface DeskPlacement {
  instanceId: string;
  offset: WidgetPosition;
  width?: number;
  height?: number;
  contentScale?: number;
  hidden?: boolean;
  sticky?: boolean;
}

interface Desk {
  id: string;
  name: string; // inline-renamable; defaults "1", "2", …
  palette: WidgetPosition;
  paletteSticky?: boolean;
  paletteWidth?: number;
  paletteListHeight?: number;
  placements: DeskPlacement[];
}

interface WidgetCatalogEntry {
  instanceId: string;
  typeId: string;
  title?: string;
  hideTitle?: boolean;
}

interface SavedLayoutV4 {
  activeDeskId: string;
  desks: Desk[];
  catalog: WidgetCatalogEntry[];
}
```

Storage key: `kavibay:layout-v4`.

### Host behavior

- `WidgetHost` owns `layout-v4` and derives a live `instances[]` for the active desk by joining catalog + placements (so palette rows and existing inject APIs keep working)
- Mutators that change geometry / hidden / sticky write the **active desk’s** placement
- Mutators that change title / hideTitle write the **catalog**
- Extension lifecycle: `onCreate` / `onDispose` follow catalog membership; switching desks does not dispose shared content; “this desk only” remove skips `onDispose`
- Geometry undo/redo is scoped to the **active** desk
- Cockpit open/closed and in-memory focus/preview remain **session-level** (not persisted per desk)
- Disabled extensions: placements retained; mount filter still respects `isEnabled`
- Empty desks are allowed (palette only)

### Migration (`layout-v3` → `v4`)

1. Create one desk with id + name `"1"`, set `activeDeskId` to it
2. Each v3 instance → one catalog entry + one placement (copy geometry / hidden / sticky / sizes)
3. Move palette fields onto that desk
4. Write `kavibay:layout-v4`; keep `kavibay:layout-v3` unread as fallback until v4 loads successfully thereafter

### Palette UI

Footer (`palette-statusbar`):

| Left | Center | Right |
|------|--------|-------|
| Existing **+** (add widget) | Compact desk tabs + trailing dashed **+** (add desk) | Settings gear |

- Click tab → switch desk  
- Double-click tab → inline rename  
- Right-click tab → Delete desk… (with confirm)  
- Trailing **+** → create desk with next numeric default name, switch to it  

Palette / catalog actions:

- **Also on this desk** — lists catalog instances that are **not** already placed on the active desk (e.g. from another desk); selecting one adds a placement on the active desk with a default offset
- **Remove** (widget card / palette) — when the instance is on 2+ desks, prompt: this desk only vs all desks

## Testing / verification

- Migrate a real `layout-v3` blob → one desk, all instances present
- Add desk, rename inline, switch: palette position and widget set differ per desk
- Place same Notes instance on two desks; edit content on one; other desk shows same text; sizes independent
- Remove → This desk only leaves catalog; All desks disposes content keys
- Delete desk with exclusive widget → confirm → content gone; shared widget survives on remaining desks
- Cannot delete last desk
- `npx vue-tsc --noEmit`

## Files (expected touch list)

| File | Role |
|------|------|
| `src/core/host/types.ts` | v4 types; keep v3 types for migration |
| `src/core/host/layoutLogic.ts` | load/save/migrate; catalog + placement helpers |
| `src/core/host/deskLogic.ts` (new) | add/rename/delete/switch desk; also-on-desk; remove prompts helpers |
| `src/core/host/WidgetHost.vue` | own v4 state; derive active instances |
| `src/core/host/layoutHistory.ts` | scope undo to active desk |
| `src/palette/CommandPalette.vue` | desk tab row in status bar |
| `src/core/host/WidgetCard.vue` (or menu) | Also on this desk; remove prompt |
| Spec / plan under `docs/superpowers/` | this design + thin implementation plan |
