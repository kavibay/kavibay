# Palette installed Windows apps search — Design

**Date:** 2026-07-22  
**Status:** Approved for implementation  
**Approach:** Warm `list_installed_apps` cache + client-side fuzzy in the command palette

## Goal

Type in the Kavibay palette to find and launch installed Windows apps, with Spotlight-style mixing into normal search. Must feel instant on keystrokes.

## Design

- Reuse Rust `list_installed_apps` (Start apps + Start Menu + registry, ~60s server cache)
- Frontend module holds an in-memory copy; warm on palette mount / `palette:show`
- Non-empty query: fuzzy-match app names (existing `fuzzyMatch`); cap ~12 hits
- New `PaletteAppRow`; Enter → `launch_path` + hide window
- Empty query: still no rows
- No icons in V1 (speed)

## Out of scope

- Prefix mode, uninstall/pin UI, non-Windows, per-keystroke Rust IPC
