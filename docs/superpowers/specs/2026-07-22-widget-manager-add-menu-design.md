# Widget Manager (+ Menu) — Design

**Date:** 2026-07-22  
**Status:** Approved  
**Approach:** Filter chips + smart type rows with action subtitles (reuse search-bar `resolveTypeSmart`)

## Goal

Turn the palette **+** menu into a lightweight widget manager: filter types by All / Open / Hidden, show soft-hidden widgets or create new ones with the same smart action as the search bar, while keeping **Also on this desk**.

## Requirements

### Filters (chips under search)

| Chip | Label (UI) | Membership (active desk) |
|------|------------|--------------------------|
| `all` | All | Every enabled registry type |
| `open` | Open | ≥1 visible (non-hidden) instance of that type |
| `hidden` | Hidden | ≥1 soft-hidden instance of that type |

- Default: **All** when the menu opens (session-only; not persisted).
- A type with both visible and hidden instances appears under **Open** and **Hidden**.
- Chip UI may use short labels (`All` / `Open` / `Hidden`); full meaning is “All / Open / Hidden widgets”.

### Rows

- One row per matching **type** (not per instance).
- Click = search-bar smart action via `resolveTypeSmart`: Show (first hidden) → else Focus (first visible) → else New.
- Subtitle / trailing label: `Show` / `Focus` / `New`.
- Search field still filters by title / id / keywords within the active chip.

### Also on this desk

- Unchanged section below the type list for every filter (preview + type-to-filter).

## Out of scope

- Per-row explicit New when an instance already exists
- Persisting the selected filter
- Instance-level listing in this menu
- Changing main search-bar behavior

## Architecture

- Helpers in `paletteResults.ts`: `typeMatchesAddFilter`, short action label helper (or reuse existing primary labels).
- `CommandPalette.vue`: `addMenuFilter` ref; build filtered smart rows; click → existing `runTypeRow` / focus path; close menu after action.
- No new host APIs.

## Testing

- Assert: filter membership for all / open / hidden; both-visible-and-hidden appears in open + hidden.
- Manual: Hidden → Show reopens; Open → Focus; All with no instance → New; Also on this desk still works.
