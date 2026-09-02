# Tray + Exit (gear menu) — Design

**Date:** 2026-07-22  
**Status:** Approved for planning  
**App:** Kavibay (Tauri 2 + Vue)

## Goal

Let users fully quit Kavibay from the palette gear menu, and control the app from a system tray icon with **Open** and **Exit**.

## Decisions

| Topic | Choice |
|-------|--------|
| Palette entry | Gear button becomes a dropdown (Settings + Exit), not a right-click on the search input |
| Exit meaning | Full process quit (`app.exit`) — releases hotkeys, removes tray, stops background work |
| Hide behavior | Unchanged: Esc / outside-click still hide only |
| Tray double-click | Open (show + focus) |
| Tray single-click / right-click | Show menu with Open + Exit |
| Tray implementation | Tauri 2 `TrayIconBuilder` in Rust setup |

## Scope

### In scope

- Gear dropdown: **Settings**, **Exit**
- System tray icon + native menu: **Open**, **Exit**
- Shared Open / Exit helpers (one quit path, one reveal path)
- Minimal capability / command wiring for Exit from the frontend

### Out of scope

- Autostart / “start with Windows”
- Tray toggles in Settings
- macOS menu-bar extras beyond standard Tauri tray
- Changing Esc / outside-click hide semantics
- Custom tray icon asset beyond the existing app icon (use default window / bundle icon)

## Architecture

### Palette gear (`src/palette/CommandPalette.vue`)

- Gear click toggles a compact dropdown (reuse `palette-add-menu` / statusbar menu visual language)
- Items:
  - **Settings** → existing `openSettings()`
  - **Exit** → invoke Rust command that calls `app.exit(0)`
- Dismiss on outside pointerdown / Escape (same pattern as the + add menu)
- Opening Settings closes the gear menu first

### Exit command (Rust)

- Register a small command, e.g. `app_exit`, that calls `app_handle.exit(0)`
- Gear invokes `app_exit`; tray **Exit** menu handler calls the same `exit(0)` on the app handle (identical effect; no separate quit semantics)
- Existing `RunEvent::Exit` cleanup (e.g. focus-tracker join) continues to run

### Open helper (Rust)

- Extract / share reveal logic with the global-shortcut handler:
  1. Clear click-through (`set_ignore_cursor_events(false)`)
  2. If hidden: `show`, `set_focus`, fit to open-monitor target, `revealed = true`
  3. Emit `palette:hotkey` with `{ revealed }` so the frontend opens the cockpit consistently
- Tray **Open** and tray **DoubleClick** call this helper
- If already visible: still focus and emit so a closed cockpit can reopen

### System tray (Rust `setup`)

- Enable Tauri feature `tray-icon` on the `tauri` dependency
- `TrayIconBuilder` with app default icon + tooltip `"Kavibay"`
- Menu items (ids): `open` → “Open”, `exit` → “Exit”
- `show_menu_on_left_click(true)` where supported so single-click shows the menu; right-click shows the menu on Windows
- `on_menu_event`: `open` → Open helper; `exit` → `app.exit(0)`
- `on_tray_icon_event`: `DoubleClick` → Open helper
- If tray build fails: log and continue (app remains usable; gear Exit still works)

### Capabilities / frontend API

- Prefer tray fully in Rust (no JS tray API required)
- Frontend Exit: invoke `app_exit` (add command allowlist permission if required by the project’s ACL)
- No change to hide/show window permissions beyond what already exists

## UX copy

| Surface | Labels |
|---------|--------|
| Gear menu | Settings, Exit |
| Tray menu | Open, Exit |

## Verification (manual)

- [ ] Gear → Settings opens the settings modal
- [ ] Gear → Exit quits; no leftover `kavibay.exe`; Ctrl+Space released
- [ ] Tray icon present while window is hidden
- [ ] Tray Open / double-click shows Kavibay and focuses palette
- [ ] Tray Exit fully quits
- [ ] Esc / outside-click still hide only (do not quit)

## Future (not this pass)

- Autostart with OS login
- Optional “Quit” confirmation
- Custom tray icon / theme-aware icons
