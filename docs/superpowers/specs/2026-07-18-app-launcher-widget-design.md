# App Launcher Widget — Design

**Date:** 2026-07-18  
**Status:** Approved for implementation planning  
**Approach:** Hybrid — `tauri-plugin-dialog` + Rust icon extract / launch + `localStorage` (approach 1)

## Goal

Add a horizontal app-launcher dock as a Kavibay widget: the user picks one or more local apps (or folders), sees clickable icons, and opens them with a click. Matches the wireframe (icon row + “+”) while staying inside the existing `WidgetCard` chrome.

## Requirements

### Behavior

- **Add:** “+” opens a small popover with **Dateien…** (multi-select `.exe` / `.lnk`) and **Ordner…** (folder picker; multi if the dialog plugin supports it, else single). Windows cannot mix files and folders in one native dialog.
- **Launch:** left-click icon → start executable / resolve shortcut / open folder in Explorer
- **Remove:** right-click icon → context menu with “Entfernen” only
- **Reorder:** drag-and-drop within the row; order persisted
- **Missing / broken path:** on launch failure, show a short error on the card and mark that icon muted until the entry is removed or relaunch succeeds; no proactive filesystem scan on mount in V1
- **Persistence:** per widget instance in `localStorage` (same pattern as Clock / Pomodoro)
- **Duplicate / Remove instance:** host wires seed/dispose like other per-instance widgets

### Visual

- Lives inside existing dark glass `WidgetCard`, title **Apps**
- Horizontal row of icon buttons + dashed “+” button at the end
- Tooltip = display name; no title overlays on icons
- Context menu on icons is widget-local (not the card ⋯ menu)

### Out of scope (V1)

- Start-menu / installed-apps search
- Launch arguments, working directory, “run as admin”
- Auto-start on Kavibay launch
- macOS / Linux
- Pinning to the Windows taskbar
- Custom dock chrome outside `WidgetCard` (approach B from brainstorm)

## Architecture

### Approach

| Layer | Responsibility |
|-------|----------------|
| Frontend `AppLauncherWidget.vue` | Dock UI: icons, +, context menu, drag-reorder |
| Logic `appLauncherLogic.ts` | Types, normalize, load/save, reorder helpers |
| Composable `useAppLauncherState.ts` | Per-`instanceId` cache (Clock/Pomodoro pattern) |
| Rust commands | `extract_app_icon`, `launch_path` |
| `tauri-plugin-dialog` | Multi file/folder picker |

No `backendCommand` / refresh polling. `invoke()` only on user actions (add, launch, icon extract at add time).

### Frontend files

| File | Role |
|------|------|
| `src/widgets/AppLauncherWidget.vue` | UI |
| `src/widgets/appLauncherLogic.ts` | Pure persistence + types |
| `src/widgets/useAppLauncherState.ts` | Instance cache, dispose, seed-on-duplicate |
| `src/widgets/registry.ts` | Register `app-launcher` |
| `src/widgets/WidgetHost.vue` | Duplicate/remove seed/dispose hooks |
| `src/widgets/layoutLogic.ts` | Default instance included when registry grows (via `defaultInstances`) |

Default offset: below the palette center (e.g. `{ x: 0, y: 220 }`); adjust at implementation to avoid overlap with existing widgets.

### Rust / Tauri

| Piece | Role |
|-------|------|
| `extract_app_icon(path) -> Result<String, String>` | Windows: icon from `.exe` / `.lnk` / folder → PNG data URL (`data:image/png;base64,…`) |
| `launch_path(path) -> Result<(), String>` | `ShellExecute` / equivalent: run exe, open lnk, open folder |
| `tauri-plugin-dialog` | Dialog API + capability permissions |
| Capabilities | Allow dialog + new commands |

Icon extraction failures fall back to a generic glyph in the UI; the entry is still added with `path` + `name`.

### Data model

```ts
type AppKind = "exe" | "lnk" | "folder";

interface LauncherApp {
  id: string;           // uuid
  path: string;         // absolute path
  kind: AppKind;
  name: string;         // display name (file/folder stem)
  iconDataUrl?: string; // cached at add time; optional if extract failed
}

interface AppLauncherState {
  apps: LauncherApp[];
}
```

Storage key: `kavibay:app-launcher:{instanceId}`.

Kind detection: directory → `folder`; extension `.lnk` → `lnk`; otherwise treat as `exe` (dialog filters limit picks).

### Add flow

1. User clicks “+” → popover: **Dateien…** | **Ordner…**
2. **Dateien…** → dialog multi-select filtered to `.exe` / `.lnk`  
   **Ordner…** → directory dialog (multi if available)
3. For each selected path: detect kind, derive name, `invoke("extract_app_icon")`, append to `apps`
4. Skip duplicates by normalized absolute path (case-insensitive on Windows)
5. Persist

### Launch flow

1. User left-clicks icon
2. Frontend `invoke("launch_path", { path })`
3. On error: show brief inline/toast-style message on the card (no modal)

### Reorder / remove

- HTML5 drag-and-drop or pointer-based reorder within the icon row only
- Right-click → “Entfernen” → remove by `id` → persist

## Widget contract

- Receives standard `WidgetProps` (unused for data loading)
- Does not use `backendCommand` / `refreshInterval`
- Settings panel: none in V1 (list managed in-widget)

## Error handling

| Case | Behavior |
|------|----------|
| Dialog cancelled | No-op |
| Icon extract fails | Entry added; generic fallback icon |
| Path missing / launch fails | Error string on the card; that icon marked muted until successful launch or remove |

No proactive path existence scan on mount in V1.

## Testing

- Logic unit tests: normalize, duplicate-path skip, reorder, remove, load/save round-trip
- Manual: add exe/lnk/folder, launch each, remove, reorder, restart app (persistence), duplicate widget instance

## Success criteria

1. User can add multiple local apps/folders via “+”
2. Icons (or fallbacks) are clickable and open the target
3. Right-click removes; drag reorders; both persist across restart
4. Widget lives in `WidgetCard` titled “Apps” and integrates with instance duplicate/remove
