# App Launcher Installed Apps Implementation Plan

> **For agentic workers:** Execute task-by-task. Spec: `docs/superpowers/specs/2026-07-18-app-launcher-installed-apps-design.md`

**Goal:** Add **Installed…** to the Apps dock add menu — searchable multi-select of Start Menu + registry apps.

**Architecture:** Rust `list_installed_apps` (scan + 60s cache) → Vue picker panel → existing `ingestPaths` on confirm.

## Tasks

### Task 1: Rust `list_installed_apps`
- Add `winreg` (Windows)
- Implement scan Start Menu `.lnk` + uninstall registry
- Merge/de-dupe, sort, cache ~60s
- Register command in `lib.rs`

### Task 2: Vue picker UI
- **Installed…** menu item
- Panel: search, checkboxes, Add / Cancel
- Wire overlays (Esc, outside, click-through)
- Confirm → `ingestPaths`

### Task 3: Verify
- `vue-tsc` + `cargo check`
