# Widget Grid Snap — Design

**Date:** 2026-07-23  
**Status:** Approved for implementation planning  
**Tier:** S  
**Approach:** Live 15px invisible grid during move/resize; free-hand remains default; toggle in Behavior settings

## Goal

Offer a second layout mode alongside today’s free-hand pixel positioning: an invisible 15px grid that snaps widget position and size while dragging. Both modes are available in Settings → Behavior.

## Requirements

### Modes

| Mode | Behavior |
|------|----------|
| `freehand` | Current behavior — position and size are pixel-exact |
| `grid` | During move/resize, snap geometry to a 15px invisible grid |

- Default: `freehand` (new installs and existing users without the field)
- Changing the setting does **not** relocate existing widgets; snap applies only on the next move/resize gesture
- Grid gap: **15px** constant (`GRID_GAP = 15`); not exposed in UI for now
- Grid is invisible (no overlay)

### What snaps (grid mode only)

- **Move:** widget (and palette / Ctrl·Cmd group-move paths that rewrite screen positions)
- **Resize:** width and height, plus the position shift from center-anchored resize (`deltaOffset`)
- Applies after existing viewport clamps / resize clamps; snap must not defeat min-size rules (clamp after snap if needed)

### Settings UX

- Location: **Behavior** panel (alongside hide-on-outside-click)
- Control: two options — **Free-hand** / **Snap to grid** (radio or equivalent segmented choice; live-apply, no Save)
- Persist with appearance prefs under `kavibay:appearance-v1`

## Snap math

Widgets are center-anchored (`palettePos + offset`). Snapping the center alone leaves edges off-grid for odd sizes. Therefore:

1. Convert center + size → top-left box `{ x, y, width, height }` in **screen pixels**
2. Snap each of `x`, `y`, `width`, `height` to the nearest multiple of `GRID_GAP`
3. Convert back to center; write `offset` / `palettePos` / size as today’s host already does

Pure helpers live in `core/app/host/gridSnap.ts` (e.g. `snapValue`, `snapBox`). Callers pass screen geometry; helpers stay free of Vue / DOM.

## Host integration

- `WidgetHost` (move path in `onPointerMove`): after clamp, if mode is `grid`, snap the dragged box, then write offsets as today
- Resize path (`onResizeInstance` after `applyResizeDelta`): if mode is `grid`, snap resulting size + implied box position, then apply
- Existing behaviors unchanged: hugHeight, no top resize edge, content-scale (Ctrl), click-through pause, persist/undo timing
- Mode is read from `useAppearance()` (same pattern as `hideOnOutsideClick`)

## Persistence

Extend `AppearanceState`:

```ts
widgetLayoutMode: 'freehand' | 'grid'  // default 'freehand'
```

- `DEFAULT_APPEARANCE`, `normalizeAppearance`, load/save, and `useAppearance` setter mirror other fields
- Invalid / missing → `freehand`

## Testing & verification

- Colocated `gridSnap.assert.ts` — snap value/box edge cases (midpoint rounding, zeros, already-on-grid)
- `npm run build` green
- Manual smoke: toggle both modes; move + resize a widget; free-hand stays pixel-perfect; grid snaps to 15px; switching mode does not jump widgets until the next gesture; Ctrl group-move still works

## Out of scope

- Visible grid overlay
- Configurable gap in UI
- Magnetic edges / sibling alignment guides
- Snapping all widgets when the setting changes
- New settings nav section
- Dock-specific snap rules beyond the shared geometry path
