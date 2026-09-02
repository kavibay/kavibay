# External Widget Menu (Move / Sticky / Context) — Design

**Date:** 2026-07-19  
**Status:** Approved for implementation planning  
**Approach:** Shared host chrome in `WidgetCard` + drag/sticky in `WidgetHost` (Approach 1)

## Goal

Move widget chrome controls **outside** the card container. Replace whole-card hover drag and the in-card `⋯` trigger with a hover-only row of three icons above every widget:

1. **Move** — drag handle only  
2. **Sticky** — toggle “always present” through outside-click hide  
3. **Menu** — open the existing context menu  

One shared change updates all registered widgets (no per-extension toolbar).

## Requirements

### External icon row

- Sits **above** the widget card, outside the glass/dark container (left-aligned with the card).
- Three icons, left → right: Move, Sticky, Menu.
- **Visibility:** shown while the widget or the icon row is hovered, or while the context menu / settings popover is open (same idea as today’s hover `⋯`).
- Remove the old in-card `⋯` trigger; Menu icon opens the same menu content (Duplicate, Settings, Hide title, extension `#menu` slot, Hide, Remove).
- Flush widgets (Now Playing, Image, Tado) must not clip the row; fix overflow/CSS only if needed.
- Icon row is click-through aware (`data-interactive` / region sync), same as the card.

### Move

- Drag starts **only** from the Move icon (`pointerdown` on that handle).
- Whole-card / `.widget-anchor` drag is removed.
- Grab cursor applies to the Move icon, not the card body (Notes already had `grabCursor: false`; that path simplifies).
- Clamp to viewport and persist offset on pointer-up remain unchanged.
- Interactive controls keep `@pointerdown.stop` where they already block accidental drags; Move handle is the sole drag source.

### Sticky

- Meaning: widget stays present when Kavibay would hide via **hide-on-outside-click**.
- Persist `sticky?: boolean` on `WidgetInstance` in `kavibay:layout-v3` (missing = `false`).
- Sticky icon toggles the flag and shows an on/off state.
- Outside-click dismiss behavior:
  1. Soft-hide every **non-sticky** visible instance (same as today’s Hide).
  2. Palette is not sticky (hide/leave as part of dismiss — window may stay open for sticky widgets).
  3. If **any sticky** instance remains visible → keep the Kavibay window open.
  4. If **none** → `window.hide()` as today.
- **Esc** still hides the whole window; sticky does not block Esc.
- Context-menu **Hide** and **Remove** still apply to sticky widgets.
- Sticky does not change OS always-on-top or click-through policy beyond keeping the window alive when sticky widgets remain.

### Scope: every widget

All registry types go through `WidgetHost` → `WidgetInstanceView` → `WidgetCard`. Updating those host files covers alarm, app-launcher, calculator, clipboard, clock, color-picker, image, notes, now-playing, pomodoro, stopwatch, system-info, tado, timer, weather.

## Architecture

### Data model

```ts
interface WidgetInstance {
  instanceId: string;
  typeId: string;
  offset: { x: number; y: number };
  title?: string;
  hideTitle?: boolean;
  hidden?: boolean;
  /** When true, survives hide-on-outside-click dismiss. */
  sticky?: boolean;
}
```

- `loadLayout` / `saveLayout`: round-trip `sticky` when present.
- `duplicateInstance`: copy `sticky` from the source (same as title / hideTitle).
- No storage key bump; omitted field means not sticky.

### Component responsibilities

| Piece | Responsibility |
|--------|----------------|
| `WidgetCard.vue` | External 3-icon row; Menu opens existing menu/settings; emit `toggle-sticky`; remove in-card `⋯` |
| `WidgetHost.vue` | Drag only from Move handle; persist sticky; expose/apply sticky-aware outside dismiss |
| `WidgetInstanceView.vue` | Pass `sticky` into card; wire toggle → host |
| `types.ts` / `layoutLogic.ts` | `sticky` on instance; load/save/duplicate |
| `App.vue` | Outside dismiss calls host sticky-aware path instead of always `window.hide()` |

### Outside dismiss flow

```
onDismissOutside (App.vue)
  → if settings open: return
  → WidgetHost.dismissNonSticky()
       soft-hide each visible instance where sticky !== true
       persist layout
       return whether any sticky instance is still visible
  → if no sticky left: window.hide()
  → else: keep window; resync click-through regions
```

**Palette:** sticky applies to widget instances only. On outside dismiss with sticky survivors: soft-hide all non-sticky instances; keep the window open; leave the command palette visible (no separate palette sticky flag).

### Drag flow

```
pointerdown on Move icon
  → stopPropagation so card handlers do not interfere
  → WidgetHost starts drag for that instanceId (existing clamp/persist)
pointerdown on card body
  → no drag
```

## UI notes

- Icons: simple monochrome glyphs matching existing widget chrome (move / pin-or-sticky / ⋯).
- Sticky on: filled or accent state on the center icon.
- Row gap and hit targets large enough for grab; does not sit inside the card background.
- Z-order: icon row above the card; context menu still overlays above both.

## Out of scope

- OS always-on-top / pin-to-desktop
- Sticky blocking Esc
- Per-type default sticky in manifests
- Redesign of context menu items
- Per-extension toolbar implementations
- Changing hide-on-outside-click settings UX beyond sticky interaction

## Success criteria

- Every widget shows the external Move / Sticky / Menu row on hover.
- Dragging only works from Move; clicking elsewhere on the card does not start a drag.
- Sticky toggles persist across reload.
- With hide-on-outside-click on: outside click soft-hides non-sticky widgets; sticky widgets stay; window hides only when no sticky widgets remain.
- Esc still hides the whole window.
- Existing context menu actions still work from the Menu icon.
