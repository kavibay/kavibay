# Hide / Show Widgets + Palette Search — Design

**Date:** 2026-07-18  
**Status:** Approved for implementation planning  
**Approach:** `hidden` flag on `WidgetInstance`; unmount when hidden; palette search toggles visibility per instance

## Goal

Let users **hide** widgets without deleting them, find both open and closed instances in the command palette search bar, and **toggle** visibility from search. Hard **Remove** remains available. Applies to every widget type uniformly.

## Requirements

### Hide vs Remove

| Action | Behavior |
|--------|----------|
| **Hide** | Soft-close: set `hidden: true`, persist layout; keep offset, title, `hideTitle`, and all per-instance settings storage |
| **Remove** | Hard-delete: splice instance from layout; clear typed settings / dispose (unchanged) |
| **Show** | Set `hidden: false`, remount at saved offset with existing settings |

Both **Hide** and **Remove** appear in the widget `⋯` menu. Hide is non-destructive; Remove stays destructive-styled.

### Pause while hidden

Hidden widgets are **not mounted**. Polling, timers, and other runtime work stop until shown again. Persisted settings and layout offsets are retained.

### Palette search

- Search results are a **unified list** of existing commands **plus** widget instances.
- **Each instance** is its own row (not one row per type).
- Selecting a widget row **toggles** `hidden` (open → hide, hidden → show).
- Widget selection must **not** call `execute_action` or hide the Kavibay window.
- **Empty query:** show commands only (current behavior). Widget rows appear when the query is non-empty.
- Match instance title (custom or registry), plus type keywords (registry title / id).
- Subtitle reflects next action: `Hide widget` when open, `Show widget` when hidden.
- Disambiguate duplicate display names among instances of the same type (e.g. `Clock`, `Clock 2`).

### Add widget

The `+` add menu still creates a **new** visible instance (unchanged). It does not restore a hidden one.

### Duplicate

Duplicates always start **visible** (`hidden` omitted / false), even if the source was hidden.

## Out of scope

- Undo after Remove
- Renaming instances from search (custom titles stay as today)
- Always listing widgets on empty query
- Separate closed-pool storage key or layout version bump beyond adding a field to v3
- Per-type hide APIs (must be uniform via host + instance flag)

## Architecture

### Approach

**`hidden?: boolean` on `WidgetInstance`** (Approach 1). Persist in existing `kavibay:layout-v3`. `WidgetHost` filters/mounts only non-hidden instances. Palette injects toggle + instance list for search.

Rejected:

- Separate `closedInstances[]` array — two lists to sync for little gain
- Status enum (`open | hidden | removed`) — overkill while Remove still hard-deletes

### Data model

```ts
interface WidgetInstance {
  instanceId: string;
  typeId: string;
  offset: WidgetPosition;
  title?: string;
  hideTitle?: boolean;
  /** When true, instance is not mounted; settings and offset are kept. */
  hidden?: boolean;
}
```

- Missing / undefined `hidden` ⇒ visible (backward compatible load).
- Storage key remains `kavibay:layout-v3` (no new key).
- `normalizeInstance` / `saveLayout` persist `hidden` when true.

### Host / card

- `WidgetCard` menu: **Hide** above **Remove**; emit `hide` (or `toggle-hidden`).
- `WidgetHost`:
  - `onHide(instanceId)` → set `hidden: true`, `saveLayout`
  - `onToggleWidget(instanceId)` → flip `hidden`, `saveLayout`
  - Render loop skips / `v-if`s instances with `hidden === true`
  - `provide("kavibayToggleWidget", …)` and a way for the palette to read all instances for search (provide reactive list or getter)

### Palette

- Extend result model beyond bare `Command` (e.g. discriminated union: command vs widget instance).
- Reuse existing fuzzy matching (`fuzzyMatch` / same scoring rules) against widget titles and keywords.
- `CommandPalette` handles Enter/click: commands as today; widget rows call toggle.

### Pause mechanism

Unmounting is the pause strategy: `useWidgetData` polling and widget-local timers stop with the component. No separate pause API per widget type.

## Error handling / edge cases

| Case | Behavior |
|------|----------|
| Remove while hidden | Allowed; same dispose path as remove while open |
| Unknown `typeId` | Skip render (as today); omit from search if not in registry |
| Reload | `hidden` restored from `layout-v3` |
| Click-through | Only mounted (visible) cards register interactive regions |
| Toggle unknown id | No-op |

## Testing

- Unit: `normalizeInstance` / load preserves `hidden: true`; missing field ⇒ visible
- Unit: search ranking includes widget rows for non-empty query; empty query has no widget rows
- Manual: Hide → card gone, settings intact → search show → remount at same offset
- Manual: Toggle via search open ↔ hidden
- Manual: Remove still deletes instance and typed storage
- Manual: Multiple instances of same type appear as separate rows with disambiguated titles

## Success criteria

1. Every widget type can be hidden without losing settings or position.
2. Search finds open and hidden instances; selecting toggles visibility.
3. Hidden widgets do not run polling/timers until shown.
4. Remove remains a separate destructive action.
