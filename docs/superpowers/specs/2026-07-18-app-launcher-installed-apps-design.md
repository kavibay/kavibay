# App Launcher — Installed Apps Picker — Design

**Date:** 2026-07-18  
**Status:** Approved for implementation planning  
**Parent:** [App Launcher Widget](./2026-07-18-app-launcher-widget-design.md)  
**Approach:** Rust enumeration (Start Menu + uninstall registry) + in-widget searchable multi-select panel

## Goal

Let the user add dock entries by picking from apps installed on the Windows machine—not only via the file dialog—using a searchable, multi-select list with a confirm step.

## Requirements

### Behavior

- **Entry point:** Add menu gains **Installed…** next to Dateien… / Ordner… / URL… / Taste…
- **Picker:** Panel under the dock with:
  - Live search filter (by display name)
  - Scrollable list: checkbox + icon + name
  - **Add** (enabled when ≥1 selected) and **Cancel**
- **Multi-select:** User can check several apps, then confirm once
- **Duplicates:** Apps already on the dock are shown muted / non-selectable (or skipped on confirm); same path-normalization rules as Dateien…
- **Sources (merged):**
  1. Start Menu `.lnk` trees (all-users + current-user Programs folders, recursive)
  2. Uninstall registry entries (HKLM/HKCU) that resolve to a launchable filesystem path
- **De-dupe:** By normalized target path (case-insensitive); prefer Start Menu display name and icon when both sources match
- **Add pipeline:** Selected paths use the existing ingest path (kind detection, `extract_app_icon`, `addEntries`, persistence)

### Visual

- Matches existing launcher overlays (add menu, key picker): dark glass, compact rows
- Icons: shell icons via existing extract path; missing icon → letter fallback
- Search field focused when the panel opens

### Out of scope

- Microsoft Store / UWP packages with no resolvable filesystem path
- macOS / Linux
- Background continuous scanning / watching for installs
- Launch arguments / “run as admin”
- Replacing Dateien… (file picker stays)

## Architecture

| Layer | Responsibility |
|-------|----------------|
| Rust `list_installed_apps` | Scan Start Menu + registry, merge/de-dupe, return list |
| Rust (existing) `extract_app_icon` | Icons for selected (or listed) paths |
| Frontend picker UI | Search, multi-select, confirm / cancel |
| Existing ingest | Turn confirmed paths into `LauncherApp` entries |

### Rust command shape

```ts
type InstalledApp = {
  name: string;
  path: string; // absolute .exe / .lnk / resolved target
};

// list_installed_apps() -> InstalledApp[]  (sorted by name)
```

Icons are **not** required on every list row for V1 if that makes the first open too slow; preferred UX:

1. Return name + path quickly (cache ~60s in Rust or frontend)
2. Optionally fill icons asynchronously for visible rows, or extract only on confirm (simpler, acceptable for V1)

**V1 decision:** Extract icons **on confirm** (batch for selected only). List rows use a letter avatar until then. Keeps `list_installed_apps` fast and avoids huge payloads.

### Start Menu scan

- `%ProgramData%\Microsoft\Windows\Start Menu\Programs\**\*.lnk`
- `%AppData%\Microsoft\Windows\Start Menu\Programs\**\*.lnk`
- Skip obvious non-apps (uninstallers, help links) when name/path matches common noise patterns (`uninstall`, `readme`, `help`, `website`) — best-effort, not perfect
- Display name: shortcut name (file stem) or shell display name if cheap

### Registry scan

- `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*`
- `HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*`
- `HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*`
- Require `DisplayName`
- Resolve path from, in order: `DisplayIcon` (strip `,0` suffix), `InstallLocation` + common exe guess only if unambiguous; skip entries with no usable path
- Skip `SystemComponent=1` and empty/garbage names when easy to detect

### Merge

```
key = normalize(path)  // lowercase, canonicalize if available
if start_menu and registry collide → keep start_menu name, keep path
sort by name (case-insensitive)
```

### Cache

- Process-local cache of the merged list, TTL ~60 seconds
- `list_installed_apps` returns cache if fresh; otherwise rescan
- No disk cache in V1

### Frontend files (touch)

| File | Change |
|------|--------|
| `AppLauncherWidget.vue` | Installed… menu item + picker panel |
| `app_launcher.rs` / `lib.rs` | `list_installed_apps` |
| (optional) `appLauncherLogic.ts` | Filter helper for search if kept pure |

### UI flow

1. User clicks **Installed…** → close add popover → open installed panel; focus search; `invoke('list_installed_apps')`
2. Loading state while scanning
3. Type to filter; toggle checkboxes
4. **Add** → ingest selected paths → close panel
5. **Cancel** / Escape / outside click → close without changes
6. Click-through pause + interactive rect sync while open (same as other overlays)

## Error handling

- Scan failure → short error on the launcher (“Installed apps unavailable”) + empty list / close
- Individual bad shortcuts skipped silently during scan
- Confirm with all duplicates → no-op add, close panel

## Testing

- Manual: open Installed…, search, multi-select, confirm; verify dock entries + launch
- Dedupe: same app from Start Menu + registry appears once
- Already-on-dock apps not duplicated
- Escape / outside dismiss

## Self-review notes

- No placeholders; V1 icon strategy explicit (on confirm only)
- Scope limited to Windows + resolvable paths
- Does not remove or change Dateien…
