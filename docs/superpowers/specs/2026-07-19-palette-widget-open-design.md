# Palette Widget Open — Design

**Date:** 2026-07-19  
**Status:** Approved  
**Approach:** Hybrid type rows + instance rows; smart Enter; Ctrl+N for always-new

## Goal

Search for any registry widget by name (e.g. `snake`) even when no instance exists, and open it from the palette. Support focus, show-hidden, hide-shown, and open-new without a separate action panel.

## Requirements

### Type rows (catalog)

- When the query is **non-empty**, include one row per matching **extension** (id, title, keywords, description).
- Type rows appear even if the user has zero instances of that type.
- Selected type row shows an **`N`** badge (means “new”).
- **Enter / click** = **smart open**:
  1. If any instance of that type is **hidden** → show the first hidden + focus it
  2. Else if any instance is **visible** → focus the first visible (no duplicate)
  3. Else → **create** a new instance + focus it
- **Ctrl+N** (Windows) / **⌘N** (macOS) = always **create a new** instance + focus it  
  (Bare `n` stays in the search field so typing `snake` is not broken.)
- Subtitle reflects the smart action: `Show widget` / `Focus widget` / `Open widget`.
- Must not call `execute_action` or hide the Kavibay window.

### Instance rows (existing)

- Unchanged: one row per instance; subtitle `Show widget` / `Hide widget`; Enter toggles.
- No `N` badge on instance rows.
- Note-body snippet rows keep current focus behavior.

### Empty query

- Commands only (no type or instance widget flood).

### Ranking

- Reuse existing fuzzy scoring; type and instance rows compete with commands in one list.

## Out of scope

- Full Raycast-style action panel
- Renaming from search
- Listing widgets on empty query
- Changing the `+` add menu

## Architecture

### Result model

Extend `PaletteRow` with:

```ts
interface PaletteTypeRow {
  kind: "type";
  id: string;          // `type:${typeId}`
  typeId: string;
  title: string;
  subtitle: string;
  keywords: string[];
  /** Smart-open intent for subtitle / Enter. */
  smart: "show" | "focus" | "create";
  /** Instance to show/focus when smart is show|focus. */
  targetInstanceId?: string;
}
```

Helpers in `paletteResults.ts`:

- `buildTypeRows(extensions, instances)` — compute smart intent per type
- `filterPaletteRows` — include type rows when query non-empty

### Palette wiring

`CommandPalette.vue`:

- Build type rows from `listExtensions()` + `widgetInstances`
- Enter/click on `kind: "type"` → reveal/focus or `addWidget` then focus
- Ctrl/Meta+N on selected type row → always `addWidget` + focus
- Render `N` badge on selected type row

### Host

Reuse existing provides: `kavibayAddWidget`, `kavibayFocusWidget`, `kavibayToggleWidget`, `kavibayWidgetInstances`. No host API changes required (`focus` already reveals hidden).

## Error handling

| Case | Behavior |
|------|----------|
| Unknown typeId | Omit from type rows |
| addWidget fails / returns undefined | No-op |
| Smart target instance missing | Fall back to create |
| Ctrl+N on non-type row | Ignore (let browser/OS handle if any) |

## Testing

- Unit (assert script): `buildTypeRows` smart intents; filter includes Snake for query `snake` with zero instances; empty query has no type rows
- Manual: type `snake` → see Snake → Enter opens; with visible Snake → Enter focuses; Ctrl+N adds second; instance row still toggles hide/show

## Success criteria

1. Typing `snake` lists Snake with no prior instance.
2. Enter smart-opens; Ctrl+N always creates new; selected type row shows `N`.
3. Instance hide/show rows still work for every widget type.
