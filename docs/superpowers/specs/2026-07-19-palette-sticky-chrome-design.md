# Palette Sticky Chrome — Design

**Date:** 2026-07-19  
**Status:** Approved  

## Goal

Give the command palette the same hover chrome pattern as widgets for **Move** and **Sticky** (no Menu). Use a monochrome sticky icon on palette and widgets.

## Behavior

- Hover-only Move + Sticky above the search bar; replace the old centered grip as drag source.
- `paletteSticky?: boolean` on `kavibay:layout-v3` (missing = false).
- Outside dismiss keeps the window open if palette is sticky **or** any sticky widget remains.
- Esc still hides the whole window.
- Sticky icon: single-color SVG (`currentColor`) on palette and widget chrome.
