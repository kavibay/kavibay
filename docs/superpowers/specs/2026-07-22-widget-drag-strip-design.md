# Widget Drag Strip — Design

**Date:** 2026-07-22  
**Status:** Approved  
**Tier:** S

## Goal

Make the widget move grip easier to grab by extending the top drag strip equally outside and inside the card.

## Behavior

- Shared host chrome in `WidgetCard.vue` (all widgets; not weather-only).
- Drag strip: **12px** tall — **6px outside** the card (`top: -6px`) + **6px inside**.
- Hit target is **always mounted** (not hover-gated) so OS click-through registers the overhang before hover.
- Highlight paints only while card chrome is visible; grab cursor on the full 12px.
- Glass (`backdrop-filter`) lives on an inner `.widget-card-surface` so the overhang is not clipped.
- No top-edge resize change (cards already omit top resize so the strip owns move).

## Out of scope

- Per-widget overrides, grip icons, other chrome UX.
