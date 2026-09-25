// Builder setup: window size/position, global shortcuts, and command registration.
// main.rs remains a pure entry point (see PLAN.md §1).

mod appearance_prefs;
mod autostart;
mod commands;
mod credentials;
mod ctrl_double_tap;
mod extension_providers;
mod extensions;
mod file_search;
mod file_type_icons;
mod installed_apps;
mod llm;
mod mcp;
mod notifications;
mod palette_app_icons;
mod paths;
mod quick_action;
mod runtime_extensions;
mod security;
mod settings_store;
mod web_storage;
mod wizard;

/// The per-extension Rust backends, named here so the command list below reads
/// as it did before the move. `extensions::` is the whole difference, and the
/// grouping is the point — see `extensions/mod.rs` for what earns a place.
use extensions::{
    ai_usage, app_launcher, clipboard_widget, color_picker, focus_tracker, image_widget, kill_port,
    now_playing, system_info,
};

use std::sync::{Arc, Mutex};
use std::time::Duration;

// `Emitter` must be imported so `window.emit()` is available (trait method).
use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, PhysicalPosition, PhysicalSize, RunEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, ShortcutState};

use commands::{
    click_through_needs_write, cursor_position_is_reliable, next_watch_tick_ms, ClickThrough,
    OpenMonitor, SharedActiveWindow, SharedClickThrough, SharedOpenMonitor, WATCH_HIDDEN_TICK_MS,
    WATCH_TICK_MS,
};

/// What asked for a cockpit toggle.
///
/// One value rather than the free-form demo label this used to be, because two
/// consumers now need it: the presentation overlay, which shows the keystroke,
/// and the guided tour, whose second step is passed by bringing the window back
/// *with this gesture* and by nothing else. A label plus a separate flag would
/// be two things that have to agree, and eventually would not.
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
enum CockpitTrigger {
    /// Double tap on Ctrl — the gesture the tour teaches.
    CtrlDoubleTap,
    /// Shift+Ctrl+Space, which always opens on the screen under the mouse.
    CursorHotkey,
    /// Tray icon, palette command, first open — anything with no keystroke of
    /// its own to show or to teach.
    App,
}

impl CockpitTrigger {
    /// Keystroke for the presentation overlay; None when there is none to show.
    fn demo_label(self) -> Option<&'static str> {
        match self {
            Self::CtrlDoubleTap => Some("CTRL+CTRL"),
            Self::CursorHotkey => Some("CTRL+SHIFT+SPACE"),
            Self::App => None,
        }
    }
}

/// The keystroke that can bring a hidden cockpit back on *this* machine.
///
/// Not a constant, because two things it depends on are only known at start-up.
/// The Ctrl double tap needs a `WH_KEYBOARD_LL` hook and therefore Windows; on
/// every other platform the fallback is Shift+Ctrl+Space, which is an ordinary
/// accelerator — and which another program may already own, in which case there
/// is no keystroke at all and the tray icon is the only way in.
///
/// The guided tour asks for this before it teaches the gesture. Teaching a key
/// this machine cannot deliver is worse than teaching none: the user hides
/// Kavibay on the first instruction and then cannot get it back.
struct RevealGesture(Option<CockpitTrigger>);

/// Which keystroke reveals the cockpit here, or null when none does.
#[tauri::command]
fn cockpit_reveal_gesture(gesture: tauri::State<'_, RevealGesture>) -> Option<CockpitTrigger> {
    gesture.0
}

/// Payload for `palette:hotkey` — `revealed` means Rust just showed a hidden window.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PaletteHotkeyPayload {
    revealed: bool,
    trigger: CockpitTrigger,
}

/// Presentation aid controlled from the command palette, off by default.
struct DemoMode(Mutex<bool>);

#[tauri::command]
fn demo_mode_enabled(demo_mode: tauri::State<'_, DemoMode>) -> bool {
    demo_mode.0.lock().map(|enabled| *enabled).unwrap_or(false)
}

fn set_demo_mode(app: &tauri::AppHandle, demo_mode: &DemoMode, enabled: bool) {
    if let Ok(mut current) = demo_mode.0.lock() {
        *current = enabled;
        let _ = app.emit("demo:mode", enabled);
    }
}

#[tauri::command]
fn enable_demo_mode(app: tauri::AppHandle, demo_mode: tauri::State<'_, DemoMode>) {
    set_demo_mode(&app, &demo_mode, true);
}

#[tauri::command]
fn disable_demo_mode(app: tauri::AppHandle, demo_mode: tauri::State<'_, DemoMode>) {
    set_demo_mode(&app, &demo_mode, false);
}

fn show_demo_hotkey(app: &tauri::AppHandle, label: &str) {
    if app
        .try_state::<DemoMode>()
        .is_some_and(|demo_mode| demo_mode.0.lock().is_ok_and(|enabled| *enabled))
    {
        let _ = app.emit("demo:hotkey", label);
    }
}

/// Make the window take clicks now, and tell the click-through watcher.
///
/// Only a stopgap until the frontend answers — it pauses click-through while it
/// opens. The watcher must hear about the write: it rewrites only when its own
/// answer changes, so an unannounced write left it believing the window was
/// still click-through. With nothing on screen the answer never changed again,
/// and a frontend that did not respond (a dev reload, a crashed renderer) left
/// a fullscreen window over the taskbar that swallowed every click.
fn make_interactive(window: &tauri::WebviewWindow) {
    let _ = window.set_ignore_cursor_events(false);
    if let Some(state) = window.try_state::<SharedClickThrough>() {
        if let Ok(mut s) = state.lock() {
            s.generation = s.generation.wrapping_add(1);
        }
    }
}

/// Show/hide the cockpit — the one path behind every trigger.
///
/// Extracted from the shortcut handler so the `--toggle` CLI and the Ctrl double
/// tap can reach it too. On Wayland no client may grab a global key, so users
/// bind a key themselves in the desktop's keyboard settings and it runs
/// `kavibay --toggle`; the compositor owns the key and only launches the
/// command. Every entry point must behave identically, hence one function rather
/// than copies that drift.
///
/// `demo_label` is what the presentation overlay shows, and the trigger passes it
/// in because this function cannot know it: the same open happens on a double
/// tap, on Shift+Ctrl+Space, and on a second launch with `--toggle`, where no key
/// was pressed at all.
fn toggle_cockpit(app: &tauri::AppHandle, force_cursor: bool, trigger: CockpitTrigger) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    // Always clear click-through before the frontend toggles. A stuck
    // ignore_cursor_events=true makes the window look "closed" while
    // is_visible() is still true, so the open path never ran.
    make_interactive(&window);

    let target = if force_cursor {
        OpenMonitor::Cursor
    } else {
        open_monitor_target(&window)
    };

    // If we reveal a hidden window here, tell the frontend so it does
    // not treat the hotkey as "close" (stale cockpitOpen after hide).
    let mut revealed = false;
    if !window.is_visible().unwrap_or(false) {
        revealed = true;
        // Show immediately, then place — waiting on two fits before
        // show made opening feel laggy on multi-DPI setups.
        let _ = window.show();
        let _ = window.set_focus();
        let _ = fit_window_to_monitor(&window, target);
    }

    // Single frontend entry: open cockpit or close (pinned may remain).
    let _ = window.emit("palette:hotkey", PaletteHotkeyPayload { revealed, trigger });
    if let Some(label) = trigger.demo_label() {
        show_demo_hotkey(app, label);
    }
}

/// Payload for `cockpit:peek` — `active` is the press half, `revealed` says Rust
/// had to show a hidden window for it.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CockpitPeekPayload {
    active: bool,
    revealed: bool,
}

/// The hold-to-peek hotkey: widgets while the key is down, gone when it comes up.
///
/// This is the one shortcut that acts on release too, which is why it cannot go
/// through `toggle_cockpit`: a toggle has no idea which of two events it is
/// seeing. Rust only ever *shows* here — whether the release may hide the window
/// depends on pinned widgets, and that rule lives in the host's `closeCockpit`
/// rather than being copied into a second place that would drift from it.
fn peek_cockpit(app: &tauri::AppHandle, active: bool) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let mut revealed = false;
    if active {
        // Same reason as in `toggle_cockpit`: a stuck ignore_cursor_events makes a
        // visible window look closed, and the peek would show nothing.
        make_interactive(&window);
        if !window.is_visible().unwrap_or(false) {
            revealed = true;
            let _ = window.show();
            let _ = window.set_focus();
            let _ = fit_window_to_monitor(&window, open_monitor_target(&window));
        }
    }

    let _ = window.emit("cockpit:peek", CockpitPeekPayload { active, revealed });
    if active {
        show_demo_hotkey(app, "CTRL+SPACE");
    }
}

/// Registers a global shortcut, reporting failure instead of propagating it.
///
/// A taken combination is a normal condition on a shared desktop, not a broken
/// install: the user has another tool bound to it. Losing one accelerator is a
/// degradation; refusing to start is not.
fn register_optional_shortcut(app: &tauri::AppHandle, accelerator: &str) -> bool {
    match app.global_shortcut().register(accelerator) {
        Ok(()) => {
            println!("[shortcut] {accelerator} registered");
            true
        }
        Err(error) => {
            eprintln!("[shortcut] {accelerator} unavailable: {error}");
            false
        }
    }
}

/// Does a second launch's argv ask to toggle the running instance?
///
/// `--toggle` is the whole contract: anything else (a plain double-click on the
/// launcher, a stray argument) should just surface the window the user already has,
/// not flip it shut. Kept pure so the argv rule is pinned by tests instead of being
/// discovered by a user whose desktop passes an extra argument.
pub fn argv_asks_for_toggle(argv: &[String]) -> bool {
    // Skip argv[0]: the binary's own path may legitimately contain the word.
    argv.iter().skip(1).any(|arg| arg == "--toggle")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Register `kavibay-ext` before plugins/setup/build so webviews can resolve it.
    let builder = runtime_extensions::register_kavibay_ext_protocol(tauri::Builder::default());
    let builder = runtime_extensions::register_kavibay_img_protocol(builder);

    // Must be the first plugin registered (plugin's own requirement). Without it a
    // second `kavibay` launch would start a rival instance instead of reaching the
    // running one — which is what makes `--toggle` possible at all.
    //
    // Skipped when `KAVIBAY_DATA_DIR` is set: that instance owns a different data
    // directory, so it is a separate profile rather than a second copy. Forwarded
    // to the running app it would hand its launch to the instance that owns the
    // *real* data and exit before ever reading its own — which looks exactly like
    // the override being ignored. A dev instance is allowed to sit beside the
    // normal one; it just loses the global shortcut, which the running app holds.
    let builder = if paths::has_data_dir_override() {
        builder
    } else {
        builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if argv_asks_for_toggle(&argv) {
                // Same entry as the double tap, including the Settings "Open on"
                // preference. No key was pressed, so nothing to show in demo mode.
                toggle_cockpit(app, false, CockpitTrigger::App);
                return;
            }
            // A plain second launch means "I want the app" — show it, never hide it.
            if let Some(window) = app.get_webview_window("main") {
                make_interactive(&window);
                if !window.is_visible().unwrap_or(false) {
                    toggle_cockpit(app, false, CockpitTrigger::App);
                } else {
                    let _ = window.set_focus();
                }
            }
        }))
    };

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    // The handler fires for both press AND release. Only hold-to-peek
                    // needs both halves; for everything else, one key press would toggle
                    // the window twice.
                    let pressed = event.state() == ShortcutState::Pressed;

                    // Quick actions never touch the cockpit: they run on text in
                    // someone else's window and answer with their own popup. Checked
                    // first because this one is user-configurable — if somebody binds
                    // it to the peek combination, their setting wins.
                    if let Some(configured) = app.try_state::<quick_action::QuickActionShortcut>() {
                        if configured.matches(shortcut) {
                            if pressed {
                                quick_action::trigger(app);
                            }
                            return;
                        }
                    }

                    // Ctrl+Space shows the widgets only while it is held. Matched
                    // before the release filter below — it is the one shortcut that
                    // wants both halves.
                    if shortcut.matches(Modifiers::CONTROL, Code::Space) {
                        peek_cockpit(app, pressed);
                        return;
                    }

                    if !pressed {
                        return;
                    }

                    // What is left is Shift+Ctrl+Space, which always covers the
                    // pointer display. The Settings “Open on” preference belongs to
                    // the Ctrl double tap instead.
                    toggle_cockpit(app, true, CockpitTrigger::CursorHotkey);
                })
                .build(),
        )
        .setup(|app| {
            app.manage(DemoMode(Mutex::new(false)));
            // Before anything reads settings: folds the legacy single-purpose
            // files into settings.json. A failure here is not fatal — the app
            // starts on the old files and tries again next time, which beats
            // refusing to start over a preference.
            if let Err(error) = settings_store::migrate_legacy_files(app.handle()) {
                eprintln!("[settings] migration failed: {error}; leaving the old files in place");
            }
            app.manage(mcp::presence::McpPresenceState::default());
            let mcp_config = match mcp::settings::load(app.handle()) {
                Ok(config) => config,
                Err(error) => {
                    eprintln!("[mcp] config load failed: {error}; using safe defaults");
                    mcp::settings::McpServerConfig::default()
                }
            };
            #[cfg(not(test))]
            let mcp_state =
                mcp::server::McpServerState::new_with_app(app.handle().clone(), mcp_config);
            #[cfg(test)]
            let mcp_state = mcp::server::McpServerState::new(mcp_config);
            app.manage(mcp_state.clone());
            if mcp_state.config().enabled {
                let state = mcp_state.clone();
                tauri::async_runtime::spawn(async move {
                    let status = state.start().await;
                    if status.state == mcp::server::McpServerLifecycle::Error {
                        eprintln!("[mcp] startup failed: {:?}", status.last_error);
                    }
                });
            }
            // macOS equivalent of `skipTaskbar`, which does not exist there: Accessory
            // is LSUIElement — no Dock icon, no menu bar, not in Cmd+Tab. Exactly what a
            // tray-and-hotkey launcher wants, and the tray icon keeps working.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let window = app
                .get_webview_window("main")
                .expect("main window must exist (defined in tauri.conf.json)");

            // Open-monitor preference (synced from Settings). Default = cursor monitor.
            // Managed before first fit so placement can read it immediately.
            let open_monitor: SharedOpenMonitor = Arc::new(Mutex::new(OpenMonitor::default()));
            app.manage(open_monitor);

            // Deliberately no `fullscreen: true` (see PLAN.md §2): size the window manually
            // to the target monitor (physical pixels for DPI).
            fit_window_to_target_monitor(&window)?;

            // Ctrl+Space (held) = peek at the widgets; Shift+Ctrl+Space = open on
            // the pointer screen. Neither may abort start-up. Another program can
            // already own the combination — Ctrl+Shift+Space in particular is
            // popular with IMEs and launcher tools — and a `?` here turned that
            // into a process that exits with a Rust panic, which a user who
            // installed the NSIS build never sees. The quick-action shortcut below
            // has always been treated this way; these two were the inconsistency.
            register_optional_shortcut(app.handle(), "Ctrl+Space");
            let cursor_toggle = register_optional_shortcut(app.handle(), "Shift+Ctrl+Space");

            // The toggle itself is a double tap on Ctrl, which no global-shortcut
            // API can express: a bare modifier is not a hotkey on any platform, and
            // none of them has a notion of "twice quickly". Only Windows gets it,
            // through a keyboard hook — see `ctrl_double_tap`.
            #[cfg(windows)]
            ctrl_double_tap::spawn(app.handle().clone());
            #[cfg(not(windows))]
            eprintln!(
                "[shortcut] Ctrl double tap is Windows-only - use the tray, Shift+Ctrl+Space or `kavibay --toggle`"
            );
            if !cursor_toggle {
                eprintln!(
                    "[shortcut] Cockpit remains available via Ctrl double tap, the tray icon, or `kavibay --toggle`"
                );
            }
            // Recorded rather than recomputed: whether Shift+Ctrl+Space is ours
            // is only knowable from the registration above, and the tour has to
            // ask the same question later.
            app.manage(RevealGesture(if cfg!(windows) {
                Some(CockpitTrigger::CtrlDoubleTap)
            } else if cursor_toggle {
                Some(CockpitTrigger::CursorHotkey)
            } else {
                None
            }));
            // Quick actions on selected text, anywhere. A failure here must not
            // take the app down with it: another program may already own the
            // combination, and everything else still works without it. Owns its
            // own managed state, because a lost registration is retried in the
            // background and the state has to follow.
            quick_action::register_shortcut(app.handle());
            app.manage(quick_action::QuickActionShortcutCapture::default());

            // Shared click-through state: written by commands and read by the polling thread.
            // `manage` makes it available to commands as managed state.
            let click_through: SharedClickThrough = Arc::new(Mutex::new(ClickThrough::default()));
            app.manage(click_through.clone());
            app.manage(color_picker::ColorPickerSession::default());
            // Managed before the watcher starts writing it and before the first fit.
            let active_window: SharedActiveWindow = Arc::new(Mutex::new(None));
            app.manage(active_window.clone());
            spawn_click_through_watcher(app.handle().clone(), click_through, active_window);

            let clipboard_state = clipboard_widget::ClipboardState::default();
            app.manage(clipboard_state.clone());
            clipboard_widget::spawn_clipboard_watcher(app.handle().clone(), clipboard_state);

            // Quick-action popup: built now, hidden, so the first Ctrl+Shift+Q does
            // not pay for a webview start-up.
            app.manage(quick_action::QuickActionState::new());
            if let Err(error) = quick_action::create_popup_window(app.handle()) {
                eprintln!("[quick_action] popup window unavailable: {error}");
            }

            app.manage(llm::LlmState::new());
            // One OAuth state for every credential that needs a login.
            app.manage(credentials::OAuthState::new());
            // Rate limits, daily budgets and the response cache for declared
            // runtime-package endpoints.
            app.manage(runtime_extensions::http::RuntimeHttpState::new());

            // Focus Tracker: one shared SQLite handle + tracker state for setup/commands/Exit.
            let focus_db = match focus_tracker::FocusDb::open(app.handle()) {
                Ok(db) => db,
                Err(error) => {
                    eprintln!(
                        "[focus_tracker] FocusDb::open failed: {error}; using in-memory fallback"
                    );
                    focus_tracker::FocusDb::open_in_memory()
                        .expect("in-memory focus_tracker db must open")
                }
            };
            let focus_tracker_state = Arc::new(focus_tracker::FocusTrackerState::new());
            app.manage(focus_db.clone());
            app.manage(focus_tracker_state.clone());
            focus_tracker::start_tracker(focus_db, focus_tracker_state);

            // System tray: Open · Version · Settings · Quit (Raycast-style sections).
            // Double-click Open reveals the cockpit.
            if let Err(error) = (|| -> tauri::Result<()> {
                let open_i = MenuItem::with_id(app, "open", "Open", true, None::<&str>)?;
                let sep_top = PredefinedMenuItem::separator(app)?;
                // Disabled label — informational only, mirrors Raycast's version row.
                let version_i = MenuItem::with_id(
                    app,
                    "version",
                    format!("Version: {}", env!("CARGO_PKG_VERSION")),
                    false,
                    None::<&str>,
                )?;
                let settings_i =
                    MenuItem::with_id(app, "settings", "Settings...", true, None::<&str>)?;
                let sep_bottom = PredefinedMenuItem::separator(app)?;
                let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
                let menu = Menu::with_items(
                    app,
                    &[
                        &open_i,
                        &sep_top,
                        &version_i,
                        &settings_i,
                        &sep_bottom,
                        &quit_i,
                    ],
                )?;

                let Some(icon) = app.default_window_icon().cloned() else {
                    eprintln!("[tray] no default window icon; skipping tray");
                    return Ok(());
                };

                TrayIconBuilder::new()
                    .icon(icon)
                    .tooltip("Kavibay")
                    .menu(&menu)
                    .show_menu_on_left_click(true)
                    .on_menu_event(|app, event| match event.id().as_ref() {
                        "open" => reveal_main_window(app),
                        "settings" => reveal_settings(app),
                        "quit" => app.exit(0),
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
                Ok(())
            })() {
                eprintln!("[tray] failed to create tray icon: {error}");
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            demo_mode_enabled,
            enable_demo_mode,
            disable_demo_mode,
            commands::execute_action,
            ai_usage::widget_ai_usage,
            ai_usage::widget_ai_usage_enable_claude,
            notifications::widget_notification_show,
            system_info::widget_system_info,
            commands::set_interactive_rects,
            commands::set_click_through_paused,
            commands::set_outside_click_dismiss,
            commands::needs_dom_gap_catcher,
            commands::set_open_monitor,
            commands::app_exit,
            cockpit_reveal_gesture,
            appearance_prefs::onboarding_preferences_load,
            appearance_prefs::onboarding_preferences_save,
            autostart::autostart_supported,
            autostart::autostart_enabled,
            autostart::autostart_set,
            settings_store::settings_load,
            settings_store::settings_save_sections,
            settings_store::settings_file_path,
            settings_store::settings_file_open,
            web_storage::web_storage_load,
            web_storage::web_storage_save,
            extension_providers::extension_provider_fetch,
            extension_providers::extension_provider_connection,
            extension_providers::extension_open_external,
            extension_providers::extension_provider_is_connected,
            extension_providers::extension_capability_fetch,
            color_picker::color_picker_start,
            color_picker::color_picker_stop,
            app_launcher::extract_app_icon,
            palette_app_icons::get_cached_app_icons,
            app_launcher::load_local_icon,
            app_launcher::fetch_url_icon,
            app_launcher::launch_path,
            app_launcher::open_windows_search,
            app_launcher::send_virtual_key,
            installed_apps::list_installed_apps,
            file_search::list_path_completions,
            file_type_icons::get_file_type_icons,
            file_search::browse_folder,
            file_search::search_folder,
            file_search::open_in_terminal,
            file_search::reveal_in_file_manager,
            image_widget::image_widget_import,
            image_widget::image_widget_clear,
            kill_port::kill_port,
            clipboard_widget::clipboard_list,
            clipboard_widget::clipboard_restore,
            clipboard_widget::clipboard_set_revealed,
            clipboard_widget::clipboard_delete,
            clipboard_widget::clipboard_clear,
            now_playing::widget_now_playing,
            now_playing::now_playing_prev,
            now_playing::now_playing_play_pause,
            now_playing::now_playing_next,
            now_playing::now_playing_open_source,
            llm::llm_models,
            llm::llm_catalog,
            llm::llm_model_set_enabled,
            llm::llm_quick_model,
            llm::llm_quick_model_set,
            llm::llm_chat_stream,
            llm::llm_chat_cancel,
            quick_action::quick_action_ready,
            quick_action::quick_action_apply,
            quick_action::quick_action_open_widget,
            quick_action::quick_action_cancel,
            quick_action::quick_action_shortcut,
            quick_action::quick_action_shortcut_set,
            quick_action::quick_action_shortcut_capture,
            quick_action::quick_action_disabled_templates,
            quick_action::quick_action_disabled_templates_set,
            credentials::credential_types_list,
            credentials::bindings::connections_selection,
            credentials::bindings::connections_select,
            credentials::bindings::connections_copy,
            credentials::bindings::connections_dispose,
            credentials::bindings::connections_prune,
            runtime_extensions::installs::connections_package_types,
            runtime_extensions::installs::connections_grant_package,
            credentials::credentials_list,
            credentials::credentials_status,
            credentials::credentials_save,
            credentials::credentials_delete,
            credentials::credentials_test,
            credentials::credentials_connect,
            credentials::credentials_cancel_connect,
            credentials::credentials_disconnect,
            focus_tracker::focus_tracker_status,
            focus_tracker::focus_tracker_summary,
            focus_tracker::focus_tracker_list_habit_rules,
            focus_tracker::focus_tracker_upsert_habit_rule,
            focus_tracker::focus_tracker_delete_habit_rule,
            focus_tracker::focus_tracker_list_ignore_rules,
            focus_tracker::focus_tracker_upsert_ignore_rule,
            focus_tracker::focus_tracker_delete_ignore_rule,
            focus_tracker::focus_tracker_recent_apps,
            runtime_extensions::runtime_extensions_root,
            runtime_extensions::runtime_extensions_scan,
            runtime_extensions::runtime_extensions_custom_root,
            runtime_extensions::drafts::runtime_extensions_draft_write,
            runtime_extensions::drafts::runtime_extensions_draft_validate,
            runtime_extensions::drafts::runtime_extensions_draft_list,
            runtime_extensions::drafts::runtime_extensions_draft_promote,
            runtime_extensions::drafts::runtime_extensions_draft_discard,
            runtime_extensions::drafts::runtime_extensions_draft_read,
            runtime_extensions::drafts::runtime_extensions_draft_open,
            runtime_extensions::drafts::runtime_extensions_read_package,
            runtime_extensions::drafts::runtime_extensions_delete_package,
            runtime_extensions::export::runtime_extensions_export_package,
            mcp::presence::mcp_draft_presence,
            mcp::server::mcp_server_status,
            mcp::server::mcp_server_set_enabled,
            mcp::server::mcp_server_set_port,
            mcp::server::mcp_server_retry,
            wizard::wizard_models,
            wizard::wizard_complete,
            wizard::store::wizard_conversations_list,
            wizard::store::wizard_conversation_load,
            wizard::store::wizard_conversation_save,
            wizard::store::wizard_conversation_delete,
            runtime_extensions::installs::runtime_extensions_installs_list,
            runtime_extensions::installs::runtime_extensions_installs_set,
            runtime_extensions::installs::runtime_extensions_installs_import,
            runtime_extensions::installs::runtime_extensions_credential_users,
            runtime_extensions::installs::runtime_extensions_revoke_credential,
            runtime_extensions::installs::runtime_extensions_set_daily_budget,
            runtime_extensions::http::runtime_extensions_budget_status,
            runtime_extensions::http::runtime_extensions_http_call,
            runtime_extensions::http::extension_http_call,
        ])
        // build + run so we can join the focus-tracker poll thread on Exit.
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                if let (Some(state), Some(db)) = (
                    app_handle.try_state::<Arc<focus_tracker::FocusTrackerState>>(),
                    app_handle.try_state::<Arc<focus_tracker::FocusDb>>(),
                ) {
                    focus_tracker::shutdown_tracker(db.as_ref(), state.as_ref());
                }
                if let Some(mcp_state) = app_handle.try_state::<mcp::server::McpServerState>() {
                    mcp_state.shutdown_for_exit();
                }
            }
        });
}

/// Show + focus the main window for tray Open (not a cockpit toggle).
fn reveal_main_window(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    make_interactive(&window);
    let target = open_monitor_target(&window);
    let _ = window.show();
    let _ = window.set_focus();
    let _ = fit_window_to_monitor(&window, target);
    let _ = window.emit("palette:show", ());
}

/// Tray Settings: reveal the cockpit, then open the global Settings modal.
fn reveal_settings(app: &tauri::AppHandle) {
    reveal_main_window(app);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("settings:show", ());
    }
}

/// Read the configured open-monitor target (defaults to cursor if unset).
fn open_monitor_target(window: &tauri::WebviewWindow) -> OpenMonitor {
    window
        .app_handle()
        .try_state::<SharedOpenMonitor>()
        .map(|s| *s.lock().unwrap())
        .unwrap_or_default()
}

/// Size and move the window to cover the configured target monitor.
fn fit_window_to_target_monitor(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    fit_window_to_monitor(window, open_monitor_target(window))
}

/// Size and move the window to cover an explicit monitor target.
///
/// On Windows this uses `SetWindowPos` + Win32 monitor APIs so mixed-DPI setups
/// don't end up with a window that's short of the monitor edge (a known Tauri
/// `set_size`/`set_position` pitfall). Other platforms use the Tauri monitor API,
/// positioning first so size is applied in the target DPI context.
fn fit_window_to_monitor(window: &tauri::WebviewWindow, target: OpenMonitor) -> tauri::Result<()> {
    #[cfg(windows)]
    {
        if fit_window_to_monitor_win32(window, target) {
            return Ok(());
        }
    }
    fit_window_to_monitor_tauri(window, target)
}

/// Tauri fallback: move onto the target monitor, then size to its physical bounds.
fn fit_window_to_monitor_tauri(
    window: &tauri::WebviewWindow,
    target: OpenMonitor,
) -> tauri::Result<()> {
    let monitor = match target {
        OpenMonitor::Primary => window.primary_monitor()?.or(window.current_monitor()?),
        // ActiveWindow has no portable "which monitor holds the foreground window"
        // query — the Win32 path above handles it, and everywhere else the pointer
        // is the closest stand-in.
        OpenMonitor::Cursor | OpenMonitor::ActiveWindow => match window.cursor_position() {
            Ok(cursor) => window
                .monitor_from_point(cursor.x, cursor.y)?
                .or(window.current_monitor()?)
                .or(window.primary_monitor()?),
            Err(_) => window.current_monitor()?.or(window.primary_monitor()?),
        },
    };

    if let Some(monitor) = monitor {
        // Position first so the window enters the target DPI context before resize.
        window.set_position(PhysicalPosition::new(
            monitor.position().x,
            monitor.position().y,
        ))?;
        window.set_size(PhysicalSize::new(
            monitor.size().width,
            monitor.size().height,
        ))?;
    }
    Ok(())
}

/// The window the watcher last saw in front, if it is still a live window.
///
/// A remembered handle can outlive its window (app closed while Kavibay was up), and
/// `MonitorFromWindow` would happily hand back the nearest monitor for a dead handle.
#[cfg(windows)]
fn remembered_active_hwnd(
    window: &tauri::WebviewWindow,
) -> Option<windows::Win32::Foundation::HWND> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::IsWindow;

    let raw = {
        let state = window.app_handle().try_state::<SharedActiveWindow>()?;
        let slot = state.lock().ok()?;
        (*slot)?
    };
    let hwnd = HWND(raw as *mut std::ffi::c_void);
    unsafe { IsWindow(Some(hwnd)) }.as_bool().then_some(hwnd)
}

/// Cover the configured monitor via Win32 (avoids mixed-DPI size drift).
///
/// Returns `false` if native calls fail so the caller can use the Tauri fallback.
#[cfg(windows)]
fn fit_window_to_monitor_win32(window: &tauri::WebviewWindow, target: OpenMonitor) -> bool {
    use windows::Win32::Foundation::{HWND, POINT, RECT};
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromPoint, MonitorFromWindow, MONITORINFO,
        MONITOR_DEFAULTTONEAREST, MONITOR_DEFAULTTOPRIMARY,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetCursorPos, GetWindowRect, SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER,
    };

    let Ok(tauri_hwnd) = window.hwnd() else {
        return false;
    };
    // Tauri may link a different `windows` crate version, so go through the raw
    // pointer rather than the typed handle. No cast: the pointer types agree
    // today, and if a version bump changes that the build says so loudly.
    let hwnd = HWND(tauri_hwnd.0);

    unsafe {
        // Primary monitor origin is (0,0) in Windows virtual-screen coords.
        // Do not use MonitorFromWindow + DEFAULTTOPRIMARY: that still returns the
        // monitor intersecting the window when one exists.
        let hmon = match target {
            OpenMonitor::Primary => {
                MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY)
            }
            OpenMonitor::Cursor => {
                let mut cursor = POINT::default();
                if GetCursorPos(&mut cursor).is_err() {
                    return false;
                }
                MonitorFromPoint(
                    POINT {
                        x: cursor.x,
                        y: cursor.y,
                    },
                    MONITOR_DEFAULTTONEAREST,
                )
            }
            OpenMonitor::ActiveWindow => {
                // Deliberately NOT GetForegroundWindow(): the reveal path focuses us
                // before placing, so that call would answer "Kavibay". Use the window
                // the watcher last saw in front instead, and only if it still exists.
                match remembered_active_hwnd(window) {
                    Some(active) => MonitorFromWindow(active, MONITOR_DEFAULTTONEAREST),
                    // Nothing remembered yet (fresh launch) — pointer is the best guess.
                    None => {
                        let mut cursor = POINT::default();
                        if GetCursorPos(&mut cursor).is_err() {
                            return false;
                        }
                        MonitorFromPoint(
                            POINT {
                                x: cursor.x,
                                y: cursor.y,
                            },
                            MONITOR_DEFAULTTONEAREST,
                        )
                    }
                }
            }
        };

        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            rcMonitor: RECT::default(),
            rcWork: RECT::default(),
            dwFlags: 0,
        };
        if !GetMonitorInfoW(hmon, &mut info).as_bool() {
            return false;
        }

        let r = info.rcMonitor;
        let width = r.right - r.left;
        let height = r.bottom - r.top;
        if width <= 0 || height <= 0 {
            return false;
        }

        // Already covering exactly this monitor? Then every SetWindowPos below is
        // pure cost: the window is fullscreen and transparent, so Windows makes
        // WebView2 relayout and recomposite the whole surface even for a move to
        // the coordinates it already has. Reopening on the same monitor is the
        // common case, and it used to pay that twice per open.
        let mut current = RECT::default();
        if GetWindowRect(hwnd, &mut current).is_ok()
            && current.left == r.left
            && current.top == r.top
            && current.right == r.right
            && current.bottom == r.bottom
        {
            return true;
        }

        let flags = SWP_NOZORDER | SWP_NOACTIVATE;
        // First call places the window (may trigger WM_DPICHANGED). Second call
        // re-asserts the full monitor rect after any DPI-driven resize.
        if SetWindowPos(hwnd, None, r.left, r.top, width, height, flags).is_err() {
            return false;
        }
        let _ = SetWindowPos(hwnd, None, r.left, r.top, width, height, flags);
    }
    true
}

/// Background thread that checks the global cursor position and makes the window
/// click-through when the cursor is over no interactive rectangle.
///
/// Why polling instead of DOM events: once the window ignores cursor events, the WebView
/// receives NO mouse movement and cannot tell when the cursor returns to a card. Detection
/// therefore has to run in the backend.
///
/// The cadence is adaptive (see the constants above): 16 ms while in use and 64 ms when
/// the cursor is still. A fixed 16-ms cadence would mean 62.5 timer wakeups/s around the
/// clock — little in CPU percentage, but relevant for battery life because the CPU would
/// never enter deep C-states.
fn spawn_click_through_watcher(
    app: tauri::AppHandle,
    state: SharedClickThrough,
    active_window: SharedActiveWindow,
) {
    std::thread::spawn(move || {
        let mut last_ignore: Option<bool> = None;
        let mut prev_mouse_down = false;
        let mut tick_ms = WATCH_TICK_MS;
        let mut last_cursor: Option<(f64, f64)> = None;
        let mut last_generation = 0u64;

        // Read once: the display backend cannot change under a running process.
        let hit_test_usable = cursor_position_is_reliable(
            std::env::var("GDK_BACKEND").ok().as_deref(),
            std::env::var("WAYLAND_DISPLAY").ok().as_deref(),
        );
        if !hit_test_usable {
            println!(
                "[click-through] disabled — on native Wayland, tao does not provide a \
                 reliable cursor position. Use an Xorg session for click-through gaps."
            );
        }
        // Shares the gate: the pointer read is only trustworthy where the hit test is.
        let buttons = MouseButtons::new(hit_test_usable);

        loop {
            std::thread::sleep(Duration::from_millis(tick_ms));

            // Sample before the visibility gate so a press-and-hold across hide/show
            // cannot come back as a fresh edge.
            let mouse_down = buttons.is_down();
            let pressed = mouse_down && !prev_mouse_down;
            prev_mouse_down = mouse_down;

            let Some(window) = app.get_webview_window("main") else {
                continue;
            };

            // Track which window the user is actually working in. Must happen before
            // the visibility gate: while Kavibay is hidden the foreground window IS
            // the answer we want to remember for the next "Active window" open.
            remember_active_window(&window, &active_window);

            // While hidden, force click-through off. Otherwise the last `ignore=true`
            // sticks across hide/show and the reopened window never receives clicks
            // (the toggle then only flips a ghost overlay).
            if !window.is_visible().unwrap_or(false) {
                // No boundary to maintain while hidden — idle right down.
                tick_ms = WATCH_HIDDEN_TICK_MS;
                last_cursor = None;
                if last_ignore != Some(false) {
                    let _ = window.set_ignore_cursor_events(false);
                    last_ignore = Some(false);
                }
                continue;
            }

            // Sample all window geometry before taking the lock, so the critical
            // section below stays pure arithmetic and never holds the mutex
            // across a Win32 call while the frontend may be writing rects.
            let geometry = match (
                window.cursor_position(),
                window.outer_position(),
                window.scale_factor(),
            ) {
                (Ok(cursor), Ok(origin), Ok(scale)) => Some((cursor, origin, scale)),
                _ => None,
            };

            let cursor_now = geometry.as_ref().map(|(c, _, _)| (c.x, c.y));
            let moved = cursor_now != last_cursor;
            last_cursor = cursor_now;

            let (outside_click_armed, generation, interactive) = {
                let s = state.lock().unwrap();
                // Hit-test inside the lock. Cloning `rects` out just to test it
                // outside meant a heap allocation on every single tick, for data
                // that changes only when the layout does.
                // `hit_test_usable` first: without a real cursor position the test
                // below would answer "not on any widget" every time and hand the
                // entire window to the desktop underneath.
                let interactive = if s.paused || !hit_test_usable {
                    true
                } else {
                    match geometry {
                        Some((cursor, origin, scale)) => {
                            // Convert the cursor from physical screen pixels to window-relative
                            // CSS pixels — the same unit used by the frontend's rectangles.
                            let px = (cursor.x - origin.x as f64) / scale;
                            let py = (cursor.y - origin.y as f64) / scale;
                            s.rects.iter().any(|r| r.contains(px, py))
                        }
                        // On error, stay interactive rather than accidentally making the whole
                        // window click-through.
                        None => true,
                    }
                };
                (s.outside_click_armed, s.generation, interactive)
            };

            // Cadence for the *next* tick — rule and rationale in
            // commands::next_watch_tick_ms.
            let rects_changed = generation != last_generation;
            last_generation = generation;
            tick_ms = next_watch_tick_ms(moved, rects_changed, outside_click_armed);

            let ignore = !interactive;
            if click_through_needs_write(last_ignore, ignore, rects_changed) {
                let _ = window.set_ignore_cursor_events(ignore);
                last_ignore = Some(ignore);
            }

            // Gap click while "Hide on outside click" is armed. The window is already
            // click-through here, so Windows delivers this very click to the app below —
            // we only tell the frontend to close in parallel.
            if pressed && ignore && outside_click_armed {
                let _ = window.emit("cockpit:outside-click", ());
            }
        }
    });
}

/// Note the current foreground window unless it is ours.
///
/// Keeping the previous value when Kavibay is in front is the whole point: the user
/// means "the window I was working in", which is exactly what we were before we
/// stole focus.
#[cfg(windows)]
fn remember_active_window(window: &tauri::WebviewWindow, state: &SharedActiveWindow) {
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

    let foreground = unsafe { GetForegroundWindow() };
    let foreground = (!foreground.is_invalid()).then_some(foreground.0 as isize);
    let ours = window.hwnd().ok().map(|h| h.0 as isize);
    if let Ok(mut slot) = state.lock() {
        *slot = commands::next_active_window(*slot, foreground, ours);
    }
}

#[cfg(not(windows))]
fn remember_active_window(_window: &tauri::WebviewWindow, _state: &SharedActiveWindow) {}

/// Global mouse state — left or right down. Both dismiss, matching the `pointerdown`
/// the frontend catcher used to see.
///
/// A struct rather than a free function because the X11 read needs a connection and
/// the watcher samples this up to 60 times a second: connecting per tick would mean
/// a socket, a handshake and a teardown per sample.
struct MouseButtons {
    #[cfg(target_os = "linux")]
    x11: Option<(
        x11rb::rust_connection::RustConnection,
        x11rb::protocol::xproto::Window,
    )>,
}

#[cfg(windows)]
impl MouseButtons {
    fn new(_x11_usable: bool) -> Self {
        Self {}
    }

    fn is_down(&self) -> bool {
        use windows::Win32::UI::Input::KeyboardAndMouse::{
            GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON,
        };
        let down = |key: i32| unsafe { GetAsyncKeyState(key) as u16 & 0x8000 != 0 };
        down(VK_LBUTTON.0 as i32) || down(VK_RBUTTON.0 as i32)
    }
}

#[cfg(target_os = "linux")]
impl MouseButtons {
    /// `x11_usable` gates the connection deliberately. On native Wayland `DISPLAY`
    /// still points at XWayland and the connect would *succeed* — but that pointer
    /// never sees Wayland-native input, so every reply would be a confident lie.
    /// Same failure shape as tao's fabricated cursor position, one layer down.
    fn new(x11_usable: bool) -> Self {
        Self {
            x11: x11_usable.then(Self::connect).flatten(),
        }
    }

    fn connect() -> Option<(
        x11rb::rust_connection::RustConnection,
        x11rb::protocol::xproto::Window,
    )> {
        // `setup()` comes from the Connection trait, `query_pointer` from the xproto
        // extension trait — both must be in scope at their call site.
        use x11rb::connection::Connection;

        // Our own connection, used only from this thread — that is what makes the
        // read thread-safe without touching GDK from off the main thread.
        let (conn, screen) = x11rb::connect(None).ok()?;
        let root = conn.setup().roots.get(screen)?.root;
        Some((conn, root))
    }

    fn is_down(&self) -> bool {
        use x11rb::protocol::xproto::ConnectionExt;

        let Some((conn, root)) = &self.x11 else {
            return false;
        };
        // Fail closed: a dropped X connection must not read as "button held", which
        // would dismiss the cockpit on its own.
        let Ok(cookie) = conn.query_pointer(*root) else {
            return false;
        };
        let Ok(reply) = cookie.reply() else {
            return false;
        };
        commands::x11_pointer_button_held(reply.mask.into())
    }
}

/// `CGEventSourceButtonState` from Quartz Event Services.
///
/// Deliberately not AppKit's `NSEvent.pressedMouseButtons`, even though objc2 binds
/// it safely: AppKit is main-thread-bound and this is read from the watcher thread.
/// The Quartz event-source queries carry no such restriction. Same reasoning that
/// put a private X11 connection on Linux instead of a GDK call.
///
/// Needs no dependency — CoreGraphics is already linked into every macOS build.
#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventSourceButtonState(state: i32, button: u32) -> bool;
}

#[cfg(target_os = "macos")]
impl MouseButtons {
    fn new(_x11_usable: bool) -> Self {
        Self {}
    }

    fn is_down(&self) -> bool {
        /// Combine hardware and synthesised events, i.e. what the user sees happen.
        const COMBINED_SESSION_STATE: i32 = 0;
        const LEFT: u32 = 0;
        const RIGHT: u32 = 1;
        // Left or right, matching the Windows read — both dismiss.
        unsafe {
            CGEventSourceButtonState(COMBINED_SESSION_STATE, LEFT)
                || CGEventSourceButtonState(COMBINED_SESSION_STATE, RIGHT)
        }
    }
}

#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
impl MouseButtons {
    fn new(_x11_usable: bool) -> Self {
        Self {}
    }

    fn is_down(&self) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::{argv_asks_for_toggle, CockpitTrigger};

    fn argv(args: &[&str]) -> Vec<String> {
        args.iter().map(|s| s.to_string()).collect()
    }

    /// The frontend matches these strings to decide whether the tour's hotkey
    /// step was passed (`core/app/host/cockpitSession.ts`). Nothing in Rust
    /// fails to compile if the spelling changes — the step just becomes
    /// impossible to complete, silently, on the one screen a new user cannot
    /// get past.
    #[test]
    fn a_trigger_keeps_the_spelling_the_frontend_matches() {
        assert_eq!(
            serde_json::to_string(&CockpitTrigger::CtrlDoubleTap).unwrap(),
            "\"ctrlDoubleTap\""
        );
        assert_eq!(
            serde_json::to_string(&CockpitTrigger::CursorHotkey).unwrap(),
            "\"cursorHotkey\""
        );
        assert_eq!(
            serde_json::to_string(&CockpitTrigger::App).unwrap(),
            "\"app\""
        );
    }

    /// Only the two gestures have a keystroke to put on screen.
    #[test]
    fn only_keystrokes_get_a_demo_label() {
        assert_eq!(
            CockpitTrigger::CtrlDoubleTap.demo_label(),
            Some("CTRL+CTRL")
        );
        assert_eq!(
            CockpitTrigger::CursorHotkey.demo_label(),
            Some("CTRL+SHIFT+SPACE")
        );
        assert_eq!(CockpitTrigger::App.demo_label(), None);
    }

    #[test]
    fn the_flag_asks_for_a_toggle() {
        assert!(argv_asks_for_toggle(&argv(
            ["kavibay", "--toggle"].as_ref()
        )));
    }

    #[test]
    fn a_plain_second_launch_does_not_toggle() {
        // Double-clicking the launcher must surface the cockpit, never close it.
        assert!(!argv_asks_for_toggle(&argv(["kavibay"].as_ref())));
    }

    #[test]
    fn an_unrelated_argument_does_not_toggle() {
        // A desktop entry may pass %U or a file path; neither means "toggle".
        assert!(!argv_asks_for_toggle(&argv(
            ["kavibay", "--quiet"].as_ref()
        )));
        assert!(!argv_asks_for_toggle(&argv(["kavibay", "toggle"].as_ref())));
    }

    #[test]
    fn the_binary_path_is_never_read_as_a_flag() {
        // Installing to a directory that happens to contain the flag must not turn
        // every launch into a toggle.
        assert!(!argv_asks_for_toggle(&argv(
            ["/opt/--toggle/kavibay"].as_ref()
        )));
    }

    #[test]
    fn the_flag_is_found_after_other_arguments() {
        assert!(argv_asks_for_toggle(&argv(
            ["kavibay", "--quiet", "--toggle"].as_ref()
        )));
    }
}

/// The ACL as the running app enforces it: `generate_context!` compiles in the
/// capabilities and the permissions `build.rs` generates, so this asks the
/// same authority an `invoke` does.
#[cfg(test)]
mod acl_tests {
    use tauri::ipc::Origin;

    fn registered_commands() -> Vec<&'static str> {
        let source = include_str!("lib.rs");
        let start = source.find("generate_handler![").unwrap() + "generate_handler![".len();
        let end = start + source[start..].find(']').unwrap();
        source[start..end]
            .split(',')
            .map(str::trim)
            .filter(|path| !path.is_empty())
            .map(|path| path.rsplit("::").next().unwrap())
            .collect()
    }

    #[test]
    fn each_window_reaches_exactly_its_commands() {
        let mut context: tauri::Context<tauri::Wry> = tauri::generate_context!();
        let acl = context.runtime_authority_mut();
        let allowed = |window: &str, command: &str| {
            acl.resolve_access(command, window, window, &Origin::Local)
                .is_some()
        };

        let commands = registered_commands();
        assert!(commands.len() > 100, "parsed {} commands", commands.len());
        for command in &commands {
            assert!(
                allowed("main", command),
                "the main window must reach {command}"
            );
        }

        for command in ["quick_action_apply", "llm_chat_stream", "web_storage_load"] {
            assert!(allowed("quickaction", command), "the popup needs {command}");
        }
        for command in [
            "credentials_delete",
            "credentials_save",
            "launch_path",
            "image_widget_clear",
            "runtime_extensions_installs_set",
            "web_storage_save",
        ] {
            assert!(
                !allowed("quickaction", command),
                "the popup must not reach {command}"
            );
        }

        // A package frame is served from its own origin: it reaches nothing,
        // whichever window it sits in.
        let frame = Origin::Remote {
            url: "http://kavibay-ext.localhost/pkg/index.html"
                .parse()
                .unwrap(),
        };
        assert!(acl
            .resolve_access("credentials_list", "main", "main", &frame)
            .is_none());
    }
}
