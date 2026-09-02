# Tray + Exit (gear menu) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a palette gear dropdown (Settings + Exit) and a system tray with Open / Exit; Exit fully quits the process.

**Architecture:** Tray and Open/Exit live in Rust (`TrayIconBuilder`, shared Open helper, `app_exit` command). The Vue palette gear becomes a small dropdown that calls Settings or `invoke("app_exit")`. Tray Open uses show/focus/fit + `palette:show` (open-only, not Ctrl+Space toggle).

**Tech Stack:** Tauri 2 (`tray-icon` feature, `tauri::tray`, `tauri::menu`), Vue 3 `CommandPalette.vue`, existing `invoke` / `palette:show` events.

**Spec:** `docs/superpowers/specs/2026-07-22-tray-and-exit-design.md`

## Global Constraints

- Gear menu labels: **Settings**, **Exit**
- Tray menu labels: **Open**, **Exit**
- Exit = full quit via `app.exit(0)` (not hide)
- Esc / outside-click hide behavior unchanged
- Tray double-click → Open; single-click / right-click → menu
- Tray uses existing app / default window icon + tooltip `"Kavibay"`
- Prefer tray fully in Rust; no JS TrayIcon API
- Comment new Rust/TS helpers with a short purpose note
- Commit after each task; do not stage unrelated dirty files
- On Windows commits, use `& "C:\Program Files\Git\cmd\git.exe"` if `git commit` fails on `--trailer`

## File Structure

| File | Responsibility |
|------|----------------|
| `src-tauri/Cargo.toml` | Enable `tray-icon` on `tauri` |
| `src-tauri/src/commands.rs` | `app_exit` command |
| `src-tauri/src/lib.rs` | Open helper, tray setup, register `app_exit`, refactor shortcut to share show path where useful |
| `src/palette/CommandPalette.vue` | Gear dropdown UI + Exit invoke |

---

### Task 1: Rust `app_exit` + Open helper + system tray

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: existing `fit_window_to_monitor`, `open_monitor_target`, `SharedOpenMonitor`, `PaletteHotkeyPayload` / `palette:show` emit path, `RunEvent::Exit` cleanup
- Produces:
  - `commands::app_exit(app: AppHandle)` → calls `app.exit(0)`
  - `fn reveal_main_window(app: &AppHandle)` — clear click-through, show+focus+fit using settings open-monitor target, emit `"palette:show"` on the main window (open-only; does **not** emit `palette:hotkey` so Open never toggles closed)
  - Tray menu ids: `"open"`, `"exit"`
  - Shortcut handler behavior unchanged from the user’s perspective (still emits `palette:hotkey` for toggle)

- [ ] **Step 1: Enable tray feature**

In `src-tauri/Cargo.toml`, change:

```toml
tauri = { version = "2", features = ["protocol-asset"] }
```

to:

```toml
tauri = { version = "2", features = ["protocol-asset", "tray-icon"] }
```

- [ ] **Step 2: Add `app_exit` command**

In `src-tauri/src/commands.rs`, add:

```rust
use tauri::AppHandle;

/// Fully quit the app (gear menu / shared exit path).
#[tauri::command]
pub fn app_exit(app: AppHandle) {
    app.exit(0);
}
```

(Keep existing imports; merge `AppHandle` into the `tauri::` import style already used in the file — today it uses `tauri::State` only, so add `AppHandle` beside `State`.)

- [ ] **Step 3: Add `reveal_main_window` helper in `lib.rs`**

Near the other window helpers, add:

```rust
/// Show + focus the main window for tray Open (not a cockpit toggle).
fn reveal_main_window(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.set_ignore_cursor_events(false);
    let target = open_monitor_target(&window);
    let _ = window.show();
    let _ = window.set_focus();
    let _ = fit_window_to_monitor(&window, target);
    let _ = window.emit("palette:show", ());
}
```

Note: Spec mentioned `palette:hotkey` + `revealed`; this plan intentionally uses `palette:show` so Open cannot close an already-open cockpit (hotkey is a toggle). Document that deviation in the commit message.

- [ ] **Step 4: Create tray in `.setup`**

After shortcuts are registered (and before `Ok(())`), add tray construction. Use these imports at the top of `lib.rs` (adjust to match existing style):

```rust
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, RunEvent,
};
```

(`Emitter` may already be available via prelude — use whatever the crate already imports; ensure `emit` compiles.)

Tray setup sketch:

```rust
let open_i = MenuItem::with_id(app, "open", "Open", true, None::<&str>)?;
let exit_i = MenuItem::with_id(app, "exit", "Exit", true, None::<&str>)?;
let menu = Menu::with_items(app, &[&open_i, &exit_i])?;

let icon = app
    .default_window_icon()
    .cloned()
    .expect("default window icon must exist for tray");

TrayIconBuilder::new()
    .icon(icon)
    .tooltip("Kavibay")
    .menu(&menu)
    .show_menu_on_left_click(true)
    .on_menu_event(|app, event| match event.id().as_ref() {
        "open" => reveal_main_window(app),
        "exit" => app.exit(0),
        _ => {}
    })
    .on_tray_icon_event(|tray, event| {
        if let TrayIconEvent::DoubleClick {
            button: MouseButton::Left,
            ..
        } = event
        {
            reveal_main_window(tray.app_handle());
        }
    })
    .build(app)?;
```

If `default_window_icon()` is `None` in some builds, fall back to logging and skip tray (do not fail app setup):

```rust
let Some(icon) = app.default_window_icon().cloned() else {
    eprintln!("[tray] no default window icon; skipping tray");
    // skip builder
    // ...
};
```

Prefer: try build; on error `eprintln` and continue rather than failing `.setup`.

- [ ] **Step 5: Register command**

Add `commands::app_exit` to `tauri::generate_handler![...]`.

- [ ] **Step 6: Verify Rust compiles**

```powershell
$env:PATH = "C:\Users\Alex\.cargo\bin;" + $env:PATH
Remove-Item Env:CARGO_TARGET_DIR -ErrorAction SilentlyContinue
cd src-tauri
cargo check
```

Expected: exit 0 (warnings OK).

- [ ] **Step 7: Commit**

```powershell
& "C:\Program Files\Git\cmd\git.exe" add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/commands.rs src-tauri/src/lib.rs
& "C:\Program Files\Git\cmd\git.exe" commit -m "feat: add system tray Open/Exit and app_exit command."
```

---

### Task 2: Palette gear dropdown (Settings + Exit)

**Files:**
- Modify: `src/palette/CommandPalette.vue`

**Interfaces:**
- Consumes: `commands::app_exit` via `invoke("app_exit")`; existing `openSettings()`, add-menu dismiss patterns
- Produces: gear toggle menu with Settings + Exit; no tray UI in Vue

- [ ] **Step 1: Add gear menu state**

Near `addMenuOpen`:

```ts
const settingsMenuOpen = ref(false);
```

- [ ] **Step 2: Wire open/close helpers**

```ts
/** Toggle the gear dropdown (Settings / Exit). */
function toggleSettingsMenu() {
  settingsMenuOpen.value = !settingsMenuOpen.value;
  if (settingsMenuOpen.value) {
    addMenuOpen.value = false;
  }
}

/** Quit the app from the gear menu. */
async function onExitApp() {
  settingsMenuOpen.value = false;
  await invoke("app_exit");
}
```

Update `openSettings()` to also close the gear menu:

```ts
function openSettings() {
  query.value = "";
  selectedIndex.value = 0;
  addMenuOpen.value = false;
  settingsMenuOpen.value = false;
  showSettings();
}
```

- [ ] **Step 3: Extend dismiss listeners**

In `onDocumentPointerDown`, also close `settingsMenuOpen` when the pointer is outside `addBarEl` (gear lives in the statusbar — same `addBarEl` root already wraps left/center/right; confirm the gear is inside `ref="addBarEl"` `.palette-statusbar`. It is — so the existing `!addBarEl.contains(target)` close for add menu should also set `settingsMenuOpen.value = false`).

In `onDocumentKeydown` Escape branch, close `settingsMenuOpen` before/alongside add menu (same preventDefault pattern).

In `syncDocListeners`, treat `settingsMenuOpen` like `addMenuOpen`:

```ts
const need = addMenuOpen.value || settingsMenuOpen.value || deskCtxMenu.value !== null;
```

Update the `watch([...])` deps to include `settingsMenuOpen`.

On `palette:show` listener, also set `settingsMenuOpen.value = false`.

When opening add menu (`toggleAddMenu`), close settings menu:

```ts
function toggleAddMenu() {
  addMenuOpen.value = !addMenuOpen.value;
  if (addMenuOpen.value) settingsMenuOpen.value = false;
}
```

- [ ] **Step 4: Replace gear button template**

Replace the settings button block in `.palette-statusbar-right` with:

```vue
<div class="palette-settings-wrap">
  <button
    type="button"
    class="palette-bar-btn palette-settings-btn"
    title="Settings"
    aria-label="Settings menu"
    aria-haspopup="menu"
    :aria-expanded="settingsMenuOpen"
    @pointerdown.stop
    @click.stop="toggleSettingsMenu"
  >
    <!-- keep existing SVG -->
  </button>
  <div
    v-if="settingsMenuOpen"
    class="palette-add-menu palette-settings-menu"
    data-interactive
    role="menu"
    @pointerdown.stop
  >
    <button
      type="button"
      role="menuitem"
      class="palette-add-item"
      @click="openSettings"
    >
      Settings
    </button>
    <button
      type="button"
      role="menuitem"
      class="palette-add-item"
      @click="onExitApp"
    >
      Exit
    </button>
  </div>
</div>
```

- [ ] **Step 5: Position CSS**

Add scoped styles so the gear menu opens upward/left-aligned under the gear (mirror add-menu anchoring):

```css
.palette-settings-wrap {
  position: relative;
}

.palette-settings-menu {
  right: 0;
  left: auto;
  bottom: calc(100% + 6px);
  top: auto;
}
```

(Inspect existing `.palette-add-menu` rules — if it already uses `position: absolute; bottom: …`, only override `right` / `left` for the settings variant.)

- [ ] **Step 6: Typecheck**

```powershell
npx vue-tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 7: Manual smoke (dev)**

```powershell
$env:PATH = "C:\Users\Alex\.cargo\bin;" + $env:PATH
Remove-Item Env:CARGO_TARGET_DIR -ErrorAction SilentlyContinue
npm run tauri dev
```

Check: gear → Settings; gear → Exit quits; tray appears; tray Open / double-click shows UI; tray Exit quits; Esc still hides only.

- [ ] **Step 8: Commit**

```powershell
& "C:\Program Files\Git\cmd\git.exe" add src/palette/CommandPalette.vue
& "C:\Program Files\Git\cmd\git.exe" commit -m "feat: add Settings/Exit gear menu on the palette."
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Gear Settings + Exit | Task 2 |
| Exit = `app.exit` | Task 1 (`app_exit` + tray exit) |
| Tray Open / Exit menu | Task 1 |
| Double-click Open | Task 1 |
| Single-click menu (`show_menu_on_left_click`) | Task 1 |
| Hide unchanged | Task 2 (no Esc changes except dismiss menu) |
| Shared Open helper | Task 1 `reveal_main_window` |
| Tray icon + tooltip | Task 1 |

## Self-review notes

- Deviation from spec emit path: Open uses `palette:show` instead of `palette:hotkey` + `revealed` so Open never toggles the cockpit closed. Intent matches the approved UX.
- No automated tray tests (manual smoke in Task 2).
- `Cargo.lock` may change when enabling `tray-icon` — include it in Task 1 commit if updated.
