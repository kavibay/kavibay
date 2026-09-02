# Long-press × → Remove — Design

**Date:** 2026-07-25  
**Status:** Approved for implementation planning  
**Tier:** S  
**Approach:** 750ms hold on chrome × morphs it to trash; release on trash removes (same as menu)

## Goal

Offer a fast path from the chrome close control to real remove, without changing the short-click soft-hide behavior.

## Requirements

### Gesture (chrome × only)

| Condition | Result |
|-----------|--------|
| `pointerup` on × before 750ms | Soft-hide (`hide` emit) — unchanged |
| Hold ≥ **750ms** while pointer still on × | × **morphs in place** to trash icon (armed) |
| `pointerup` on the control after armed | Remove — same path as menu trash |
| `pointerup` off the control after armed | **Cancel** (no hide, no remove); restore × |
| `pointercancel` / Escape while holding or armed | Cancel; restore × |

### Remove semantics

Identical to the existing ⋯ → Remove action:

- Single-desk: dispose (`remove` with `"everywhere"`)
- Multi-desk: open the existing “Remove from / This desk only / All desks” chooser (`removeChoiceOpen`)

### UX details

- Morph uses the same trash SVG as the menu Remove tool
- Armed state: danger tint (match `.widget-menu-tool--danger`)
- Optional short scale/pulse when the morph fires (keep subtle)
- Compact-chrome menu **Hide** row stays a normal click (no long-press)
- Short click must not fire both hide and remove

### Out of scope

- Long-press on menu Hide / Remove
- Drag-to-separate trash target beside ×
- Changing soft-hide persistence or palette restore

## Host integration

All logic lives in `WidgetCard.vue` on the chrome × button:

1. Replace `@click="onHide"` with pointerdown/up/leave/cancel handlers
2. Tiny state machine: `idle` → `pressing` → `armed` → resolve on up / cancel
3. Timer: `setTimeout` 750ms; clear on early up / leave / cancel
4. Reuse existing `onHide()` and `onRemove()` (no new host emits)

Pure helpers (optional, if it keeps the card thin): `hidePressLogic.ts` with arm delay constant + “should hide vs remove vs cancel” from press phase — only if the card handler would otherwise get noisy; otherwise keep the machine inline.

## Testing & verification

- Manual smoke:
  - Quick click × → widget soft-hides
  - Hold 750ms → morph to trash; release on it → remove (multi-desk shows chooser)
  - Hold 750ms, drag off, release → still visible (cancel)
  - Hold &lt; 750ms, release → hide
- `npm run build` green

## Success criteria

- Short-click hide unchanged
- Armed release removes via the same code path as menu Remove
- Abandoned long-press never hides
