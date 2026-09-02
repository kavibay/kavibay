# Appearance Shadow Styles — Design

**Date:** 2026-07-22  
**Status:** Approved  
**Tier:** M

## Goal

Add selectable drop-shadow presets in Appearance (CSS Scan gallery), while keeping the strength slider.

## Behavior

- Preset picker (preview cards) + existing strength slider (0–1).
- Presets: **Default** (current Kavibay) + CSS Scan **#0–#15 except #7 and #14**.
- Persist `surfaceShadowStyle` in `kavibay:appearance-v1` (missing → `default`).
- Apply via `--surface-box-shadow`; strength via `--surface-shadow`.
- Preset CSS uses `rgba(var(--shadow-rgb), calc(α * var(--surface-shadow)))`.
- Widgets, palette glass, and settings modal use `box-shadow: var(--surface-box-shadow)`.

## Out of scope

- #7 / #14, custom CSS editor, per-widget shadows.
