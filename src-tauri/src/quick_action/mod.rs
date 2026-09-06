//! Selection quick actions — Ctrl+Shift+Q on text selected in any application.
//!
//! The whole feature is one borrowed clipboard round-trip:
//!
//! 1. remember the foreground window and what is on the clipboard,
//! 2. synthesise Ctrl+C and read the selection back,
//! 3. show a small menu at the caret (see `placement`),
//! 4. hand the text to the extension the user picked,
//! 5. write the answer, refocus the remembered window, synthesise Ctrl+V,
//! 6. put the original clipboard back.
//!
//! Steps 1–3 run here, step 4 in the popup webview (`quickaction.html`), steps
//! 5–6 in `quick_action_apply`. The popup is its own window on purpose: the
//! main window is a fullscreen transparent cockpit, and showing it would bring
//! the palette and every pinned widget along with it.
//!
//! Known limitation: only *text* on the clipboard is restored afterwards. An
//! image is lost either way — Ctrl+C in the target app overwrites it before we
//! get a say — so saving one to put back is effort spent on a case we cannot
//! actually rescue.

mod editability;
mod placement;
mod win;

use std::time::{Duration, Instant};
use std::{
    collections::{BTreeSet, HashMap},
    sync::Mutex,
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

use crate::extensions::clipboard_widget::{
    pause_capture, resume_capture, write_text_clipboard, ClipboardState,
};
use editability::decide;
use placement::{place_popup, Anchor, Rect};

/// Window label of the popup; also its entry point (`quickaction.html`).
pub const POPUP_LABEL: &str = "quickaction";
/// Ctrl+Shift, never Ctrl+Alt.
///
/// AltGr on Windows *is* Ctrl+Alt, and `RegisterHotKey` is handed the same
/// modifier mask either way — there is no flag at that level saying the right
/// Alt key was the one pressed. So a global `Ctrl+Alt+<key>` swallows the AltGr
/// character before the keyboard layout ever produces it. The previous default,
/// `Ctrl+Alt+Q`, made `@` untypable in every application on a German layout;
/// `E` would have cost `€`, `7`–`0` the braces and brackets.
pub const DEFAULT_SHORTCUT: &str = "Ctrl+Shift+Q";

/// Treat a manually edited or stale preference as the safe default rather than
/// showing one shortcut in Settings while registering another at startup.
pub fn configured_shortcut(app: &AppHandle) -> String {
    let candidate = crate::llm::quick_shortcut(app).unwrap_or_else(|| DEFAULT_SHORTCUT.to_string());
    match candidate.parse::<Shortcut>() {
        Ok(shortcut) if !shortcut.mods.is_empty() => candidate,
        _ => DEFAULT_SHORTCUT.to_string(),
    }
}

/// How often to re-attempt a lost shortcut registration.
///
/// No attempt limit: a deadline only moves the moment the feature goes quietly
/// dead. The competing program may be a launcher the user closes an hour later,
/// and one `RegisterHotKey` every few seconds costs nothing while we wait.
const REGISTER_RETRY_DELAY: Duration = Duration::from_secs(3);

/// Claim the quick-action shortcut, retrying in the background if it is taken.
///
/// One attempt is not enough, and the usual loser of that race is a restart:
/// the process being replaced still owns the combination for a moment after
/// the new one starts, `RegisterHotKey` fails, and quick actions are then dead
/// for the whole session — silently, because the only trace is a line on
/// stderr while Settings goes on showing the shortcut as if it worked. The
/// handler in `lib.rs` is never reached, so nothing happens in any
/// application, at any time, and only another restart that happens to win the
/// race brings the feature back.
pub fn register_shortcut(app: &AppHandle) {
    let text = configured_shortcut(app);
    let shortcut: Shortcut = text.parse().unwrap_or_else(|_| {
        DEFAULT_SHORTCUT
            .parse()
            .expect("the default shortcut must parse")
    });

    if app.global_shortcut().register(shortcut).is_ok() {
        println!("[shortcut] {text} (quick actions) registered");
        app.manage(QuickActionShortcut::new(Some(shortcut)));
        return;
    }

    // Managed as unregistered right away: the handler must not treat the
    // combination as ours until we actually hold it.
    app.manage(QuickActionShortcut::new(None));
    eprintln!("[shortcut] {text} (quick actions) is taken — retrying in the background");

    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(REGISTER_RETRY_DELAY);
        let Some(state) = app.try_state::<QuickActionShortcut>() else {
            return;
        };
        // Settings registered a replacement while we were waiting. That choice
        // is the user's and outranks this one — claiming the old combination
        // now would silently overwrite it.
        if !state.is_unset() {
            return;
        }
        if app.global_shortcut().register(shortcut).is_err() {
            continue;
        }
        state.replace(shortcut);
        println!("[shortcut] {text} (quick actions) registered on retry");
        return;
    });
}

/// Longest selection we act on. Quick actions rewrite a sentence or a
/// paragraph; a whole document is a job for the widget, where the user can see
/// what is being sent and what came back.
///
/// Refused rather than truncated, and that is the important part: the answer
/// *replaces the selection*, so rewriting the first 8000 characters of a longer
/// one would delete everything after them.
const MAX_SELECTION_CHARS: usize = 8_000;

/// Let the target window settle after the focus switch before typing into it.
const REFOCUS_SETTLE_MS: u64 = 80;

/// Give the target time to actually read the clipboard before we put the old
/// content back. Applications fetch the data when they handle Ctrl+V, not when
/// the key arrives, so restoring immediately pastes the wrong thing.
const PASTE_SETTLE_MS: u64 = 300;

/// How long a quick action may stay pending before a fresh hotkey press is
/// allowed to replace it.
///
/// The popup normally clears the pending itself — apply, open widget, or
/// cancel. This bound covers the one case where it never answers at all: the
/// `quickaction:open` event reached a webview that had not registered its
/// listener yet, which is a real race right after start-up because the popup
/// mounts asynchronously (see `core/app/quickaction/main.ts`). Without it that
/// single press left a pending behind and `is_busy` then swallowed *every*
/// later press silently, for the rest of the process' life.
///
/// Generous on purpose: while the menu is open the pending is legitimate, and
/// a model that streams for a minute must not have its answer stolen by a
/// mis-key.
const PENDING_MAX_AGE: Duration = Duration::from_secs(90);

/// One quick action in flight, from hotkey to paste.
struct Pending {
    /// When the hotkey fired, so an abandoned pending cannot block forever.
    started: Instant,
    /// Captured selection, retained when the user opens the full widget.
    text: String,
    /// The window the selection came from, and the one we paste back into.
    target: isize,
    /// Clipboard text displaced by our Ctrl+C, restored when we are done.
    saved_clipboard: Option<String>,
    anchor: Anchor,
    /// False when the selection came from something we cannot type into — the
    /// answer then stays on the clipboard instead of being pasted.
    can_replace: bool,
}

/// Managed state; `None` means no quick action is running.
#[derive(Default)]
pub struct QuickActionState(Mutex<Option<Pending>>);

/// The registered quick-action shortcut, shared with the global handler.
pub struct QuickActionShortcut(Mutex<Option<Shortcut>>);
/// `None` = idle, `Some(None)` = recording with no prior shortcut, and
/// `Some(Some(..))` = recording while this shortcut is temporarily unregistered.
pub struct QuickActionShortcutCapture(Mutex<Option<Option<Shortcut>>>);

impl QuickActionShortcutCapture {
    fn begin(&self, shortcut: Option<Shortcut>) -> bool {
        let Ok(mut slot) = self.0.lock() else {
            return false;
        };
        if slot.is_some() {
            return false;
        }
        *slot = Some(shortcut);
        true
    }

    fn end(&self) -> Option<Option<Shortcut>> {
        self.0.lock().ok().and_then(|mut slot| slot.take())
    }
}

impl Default for QuickActionShortcutCapture {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

impl QuickActionShortcut {
    pub fn new(shortcut: Option<Shortcut>) -> Self {
        Self(Mutex::new(shortcut))
    }

    pub fn matches(&self, shortcut: &Shortcut) -> bool {
        self.0
            .lock()
            .map(|current| current.as_ref() == Some(shortcut))
            .unwrap_or(false)
    }

    /// True while no combination is registered — the retry loop's cue that it
    /// is still the one responsible for claiming one.
    fn is_unset(&self) -> bool {
        self.0.lock().map(|slot| slot.is_none()).unwrap_or(false)
    }

    fn replace(&self, shortcut: Shortcut) {
        if let Ok(mut current) = self.0.lock() {
            *current = Some(shortcut);
        }
    }
}

#[tauri::command]
pub fn quick_action_shortcut(app: AppHandle) -> Result<String, String> {
    Ok(configured_shortcut(&app))
}

/// Manifest action keys hidden from the quick-action popup only.
#[tauri::command]
pub fn quick_action_disabled_templates(app: AppHandle) -> Vec<String> {
    crate::llm::disabled_quick_actions(&app)
        .into_iter()
        .collect()
}

#[tauri::command]
pub fn quick_action_disabled_templates_set(
    app: AppHandle,
    action_ids: Vec<String>,
) -> Result<(), String> {
    let ids = action_ids
        .into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect::<BTreeSet<_>>();
    crate::llm::set_disabled_quick_actions(&app, ids)
}

/// Prevent the currently registered shortcut from firing while Settings is
/// recording its replacement (especially important when recording itself is
/// Ctrl+Shift+Q).
#[tauri::command]
pub fn quick_action_shortcut_capture(
    app: AppHandle,
    shortcut_state: tauri::State<'_, QuickActionShortcut>,
    capture_state: tauri::State<'_, QuickActionShortcutCapture>,
    active: bool,
) -> Result<(), String> {
    if active {
        let current = shortcut_state
            .0
            .lock()
            .map_err(|_| "shortcut state is unavailable")?
            .take();
        if !capture_state.begin(current) {
            // Recording is already active; leave its temporary state alone.
            if let Ok(mut slot) = shortcut_state.0.lock() {
                *slot = current;
            }
            return Ok(());
        }
        if let Some(shortcut) = current {
            if let Err(error) = app.global_shortcut().unregister(shortcut) {
                shortcut_state.replace(shortcut);
                let _ = capture_state.end();
                return Err(format!("Could not start shortcut recording: {error}"));
            }
        }
        return Ok(());
    }

    let Some(previous) = capture_state.end() else {
        return Ok(());
    };
    // A successful replacement registered itself while recording; never bring
    // the old combination back beside it.
    if shortcut_state
        .0
        .lock()
        .map(|slot| slot.is_some())
        .unwrap_or(false)
    {
        return Ok(());
    }
    if let Some(shortcut) = previous {
        app.global_shortcut()
            .register(shortcut)
            .map_err(|error| format!("Could not restore the previous shortcut: {error}"))?;
        shortcut_state.replace(shortcut);
    }
    Ok(())
}

/// Re-register the shortcut before persisting it, so Settings never claims a
/// combination that Windows has already rejected because another app owns it.
#[tauri::command]
pub fn quick_action_shortcut_set(app: AppHandle, shortcut: String) -> Result<(), String> {
    let next: Shortcut = shortcut
        .trim()
        .parse()
        .map_err(|error| format!("Invalid shortcut: {error}"))?;
    if next.mods.is_empty() {
        return Err("Add Ctrl, Alt, Shift, or Super to the shortcut".into());
    }
    let state = app
        .try_state::<QuickActionShortcut>()
        .ok_or_else(|| "quick actions are not available".to_string())?;
    let current = *state
        .0
        .lock()
        .map_err(|_| "shortcut state is unavailable")?;
    if current.as_ref() == Some(&next) {
        return Ok(());
    }
    app.global_shortcut()
        .register(next)
        .map_err(|error| format!("Shortcut is unavailable: {error}"))?;
    if let Some(current) = current {
        if let Err(error) = app.global_shortcut().unregister(current) {
            let _ = app.global_shortcut().unregister(next);
            return Err(format!("Could not replace the current shortcut: {error}"));
        }
    }
    state.replace(next);
    crate::llm::set_quick_shortcut(&app, shortcut.trim().to_string())
}

impl QuickActionState {
    pub fn new() -> Self {
        Self::default()
    }

    /// True while a quick action the popup can still answer is in flight.
    ///
    /// A pending older than `PENDING_MAX_AGE` is treated as abandoned: the
    /// popup never took it, and refusing new presses on its behalf disables
    /// the feature entirely.
    fn is_busy(&self) -> bool {
        self.0
            .lock()
            .map(|slot| match slot.as_ref() {
                Some(pending) if pending.started.elapsed() < PENDING_MAX_AGE => true,
                Some(_) => {
                    eprintln!(
                        "[quick_action] dropping a pending the popup never answered; \
                         the popup window most likely missed `quickaction:open`"
                    );
                    false
                }
                None => false,
            })
            .unwrap_or(false)
    }

    fn set(&self, pending: Pending) {
        if let Ok(mut slot) = self.0.lock() {
            *slot = Some(pending);
        }
    }

    fn take(&self) -> Option<Pending> {
        self.0.lock().ok().and_then(|mut slot| slot.take())
    }

    fn anchor(&self) -> Option<Anchor> {
        self.0
            .lock()
            .ok()
            .and_then(|slot| slot.as_ref().map(|p| p.anchor))
    }
}

/// Payload for `quickaction:open`. A non-empty `error` means the popup opens
/// to explain itself instead of offering actions.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct QuickActionOpenPayload {
    text: String,
    error: String,
    /// False makes the popup say the result goes to the clipboard. Told up
    /// front rather than confirmed afterwards: a menu that quietly does
    /// something else than the last time is worse than one that says so.
    can_replace: bool,
}

/// A declared widget action requested from the quick-action popup.
///
/// The popup does not load the main host's extensions; it only forwards the
/// manifest-declared hand-off after Rust has safely taken ownership of the
/// borrowed clipboard state.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct QuickActionWidgetPayload {
    extension_id: String,
    action_id: String,
    args: HashMap<String, String>,
    text: String,
}

/// Create the popup window up front, hidden.
///
/// Building a webview costs a few hundred milliseconds — long enough to feel
/// like the hotkey did nothing. Creating it at startup and only moving it
/// afterwards is what makes Ctrl+Shift+Q feel instant.
pub fn create_popup_window(app: &AppHandle) -> tauri::Result<()> {
    tauri::WebviewWindowBuilder::new(
        app,
        POPUP_LABEL,
        tauri::WebviewUrl::App("quickaction.html".into()),
    )
    .title("Kavibay quick action")
    // Roomy on purpose: the menu lays itself out at its natural size inside
    // this canvas, reports it, and only then is the window shrunk and shown.
    .inner_size(420.0, 640.0)
    .visible(false)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .shadow(false)
    .focused(false)
    .build()?;
    Ok(())
}

/// Kavibay's own window handles — never treat one of them as the paste target.
#[cfg(windows)]
fn own_window_handles(app: &AppHandle) -> Vec<isize> {
    app.webview_windows()
        .values()
        .filter_map(|window| window.hwnd().ok().map(|hwnd| hwnd.0 as isize))
        .collect()
}

// Quick actions use Win32 window handles. The non-Windows implementation is a
// deliberate no-op, but keeping this helper available lets the shared trigger
// path compile on every Tauri target.
#[cfg(not(windows))]
fn own_window_handles(_app: &AppHandle) -> Vec<isize> {
    Vec::new()
}

/// Ctrl+Shift+Q handler.
///
/// Returns immediately: the capture below sleeps for up to a second waiting for
/// the modifiers and the clipboard, and the global-shortcut handler is not a
/// thread that may be blocked for that long.
pub fn trigger(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || capture_selection(&app));
}

fn capture_selection(app: &AppHandle) {
    let Some(state) = app.try_state::<QuickActionState>() else {
        return;
    };
    // A second press while the menu is open is a mis-key, not a request to
    // capture the popup's own (empty) selection.
    if state.is_busy() {
        return;
    }

    // Nothing to show the result in means nothing to start: the pending state
    // holds the clipboard watcher paused until a popup answers.
    if app.get_webview_window(POPUP_LABEL).is_none() {
        eprintln!("[quick_action] no popup window; hotkey ignored");
        return;
    }

    let Some(target) = win::foreground_window(&own_window_handles(app)) else {
        return;
    };

    win::wait_for_modifier_release();

    let clipboard = app.try_state::<ClipboardState>();
    if let Some(clipboard) = clipboard.as_ref() {
        pause_capture(clipboard);
    }

    let saved_clipboard = crate::extensions::clipboard_widget::clipboard_text();
    let selection = win::copy_selection();

    let Some(text) = selection.filter(|text| !text.trim().is_empty()) else {
        // Nothing selected, or a non-text selection. Deliberately silent: the
        // user pressed a hotkey over someone else's window, and a toast on top
        // of that window is more intrusive than the miss it reports.
        if let Some(clipboard) = clipboard.as_ref() {
            resume_capture(clipboard, false);
        }
        return;
    };

    // A refused selection still travels to the popup so it can show what it is
    // refusing — but only as much of it as the preview line can hold.
    let (text, error) = if text.chars().count() > MAX_SELECTION_CHARS {
        (
            text.chars().take(200).collect(),
            format!("Selection is too long (over {MAX_SELECTION_CHARS} characters)"),
        )
    } else {
        (text, String::new())
    };

    let anchor = win::caret_anchor(target)
        .or_else(win::cursor_anchor)
        .unwrap_or(Anchor {
            x: 0,
            y: 0,
            height: 0,
        });

    // Probed here, not at paste time: the answer is part of what the popup
    // shows, and by the time the model replies the focus may have moved.
    let window_probe = win::window_probe(target);
    let target_kind = match window_probe {
        // Only pay for UI Automation when the cheap probe has no answer.
        editability::WindowProbe::Unknown => decide(window_probe, win::uia_probe()),
        resolved => decide(resolved, editability::UiaProbe::Unknown),
    };
    let can_replace = target_kind.can_replace();

    state.set(Pending {
        started: Instant::now(),
        text: text.clone(),
        target,
        saved_clipboard,
        anchor,
        can_replace,
    });

    // The popup measures itself and calls `quick_action_ready`, which is what
    // finally positions and shows it — its height depends on how many actions
    // the installed extensions declare, which only the frontend knows.
    let _ = app.emit_to(
        POPUP_LABEL,
        "quickaction:open",
        QuickActionOpenPayload {
            text,
            error,
            can_replace,
        },
    );
}

/// Position and show the popup once it knows how big it is.
///
/// `width` / `height` are CSS pixels; the anchor is physical, so one of the two
/// has to be converted — and the monitor under the anchor is the only correct
/// source for that factor on a mixed-DPI desktop.
#[tauri::command]
pub fn quick_action_ready(
    app: AppHandle,
    state: tauri::State<'_, QuickActionState>,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let Some(anchor) = state.anchor() else {
        return Err("no quick action is pending".into());
    };
    let window = app
        .get_webview_window(POPUP_LABEL)
        .ok_or_else(|| "quick action window is missing".to_string())?;

    let scale = window
        .monitor_from_point(anchor.x as f64, anchor.y as f64)
        .ok()
        .flatten()
        .map(|monitor| monitor.scale_factor())
        .unwrap_or(1.0);

    let size = (
        (width * scale).round() as i32,
        (height * scale).round() as i32,
    );
    let work = win::work_area_at(anchor.x, anchor.y).unwrap_or(Rect {
        x: anchor.x,
        y: anchor.y,
        width: size.0,
        height: size.1,
    });
    let (x, y) = place_popup(anchor, size, work);

    // Position before size, so the resize happens in the target monitor's DPI
    // context (the same ordering the main window's monitor fit relies on).
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|error| error.to_string())?;
    window
        .set_size(PhysicalSize::new(size.0.max(1), size.1.max(1)))
        .map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}

/// Deliver `text`: paste it over the selection, or leave it on the clipboard
/// when the selection came from something we cannot type into.
#[tauri::command]
pub fn quick_action_apply(app: AppHandle, text: String) -> Result<(), String> {
    let state = app
        .try_state::<QuickActionState>()
        .ok_or_else(|| "quick actions are not available".to_string())?;
    let pending = state
        .take()
        .ok_or_else(|| "no quick action is pending".to_string())?;

    if text.trim().is_empty() {
        finish(&app, pending.saved_clipboard, false);
        return Err("nothing to paste".into());
    }

    hide_popup(&app);

    // Read-only source: the result *is* the delivery. Nothing is typed, the
    // borrowed clipboard is not restored — it now holds something the user
    // asked for — and the history watcher keeps it, because a clipboard entry
    // they wanted is exactly what the history is for.
    if !pending.can_replace {
        write_text_clipboard(&text)?;
        win::focus_window(pending.target);
        finish(&app, None, true);
        return Ok(());
    }

    if !win::is_window(pending.target) {
        // The user closed the source window while the model was working.
        finish(&app, pending.saved_clipboard, false);
        return Err("the window the text came from is gone".into());
    }

    // The paste has to happen after the focus switch, and the restore after the
    // paste — all of it on a thread, because a command may not sleep on the
    // caller's IPC thread for half a second.
    let app_for_thread = app.clone();
    std::thread::spawn(move || {
        if let Err(error) = write_text_clipboard(&text) {
            eprintln!("[quick_action] clipboard write failed: {error}");
            finish(&app_for_thread, pending.saved_clipboard, false);
            return;
        }
        win::focus_window(pending.target);
        std::thread::sleep(Duration::from_millis(REFOCUS_SETTLE_MS));
        if let Err(error) = win::paste() {
            eprintln!("[quick_action] paste failed: {error}");
        }
        std::thread::sleep(Duration::from_millis(PASTE_SETTLE_MS));
        finish(&app_for_thread, pending.saved_clipboard, false);
    });
    Ok(())
}

/// Close the popup and forward its selected text to a widget in the main host.
/// Unlike `quick_action_apply`, this deliberately does not refocus or paste
/// into the source application: the user chose to continue editing in Kavibay.
#[tauri::command]
pub fn quick_action_open_widget(
    app: AppHandle,
    state: tauri::State<'_, QuickActionState>,
    extension_id: String,
    action_id: String,
    args: HashMap<String, String>,
) -> Result<(), String> {
    if extension_id.trim().is_empty() || action_id.trim().is_empty() {
        return Err("widget hand-off is missing an extension action".into());
    }
    let pending = state
        .take()
        .ok_or_else(|| "no quick action is pending".to_string())?;
    hide_popup(&app);
    let _ = app.emit_to(
        "main",
        "quickaction:open-widget",
        QuickActionWidgetPayload {
            extension_id,
            action_id,
            args,
            text: pending.text,
        },
    );
    finish(&app, pending.saved_clipboard, false);
    Ok(())
}

/// Dismiss without pasting (Escape, click outside, or a failed run).
#[tauri::command]
pub fn quick_action_cancel(app: AppHandle) -> Result<(), String> {
    hide_popup(&app);
    let Some(state) = app.try_state::<QuickActionState>() else {
        return Ok(());
    };
    if let Some(pending) = state.take() {
        // Focus goes back even on a cancel: the user was typing somewhere, and
        // the popup took that away to show a menu they did not want.
        win::focus_window(pending.target);
        finish(&app, pending.saved_clipboard, false);
    }
    Ok(())
}

/// Put the borrowed clipboard back and let the history watcher run again.
///
/// `keep_current` decides what the watcher does with what is on the clipboard
/// at that moment: normally we put it there ourselves and it must not become a
/// history entry, but a read-only quick action deliberately leaves its answer
/// behind, and that one belongs in the history like any other copy.
fn finish(app: &AppHandle, restore: Option<String>, keep_current: bool) {
    if let Some(text) = restore {
        if let Err(error) = write_text_clipboard(&text) {
            eprintln!("[quick_action] could not restore the clipboard: {error}");
        }
    }
    if let Some(clipboard) = app.try_state::<ClipboardState>() {
        resume_capture(&clipboard, keep_current);
    }
}

fn hide_popup(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(POPUP_LABEL) {
        let _ = window.hide();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pending(started: Instant) -> Pending {
        Pending {
            started,
            text: "hallo".into(),
            target: 1,
            saved_clipboard: None,
            anchor: Anchor {
                x: 0,
                y: 0,
                height: 0,
            },
            can_replace: true,
        }
    }

    /// A second press while the menu is open must still be refused.
    #[test]
    fn a_fresh_pending_blocks_a_second_press() {
        let state = QuickActionState::new();
        state.set(pending(Instant::now()));
        assert!(state.is_busy());
    }

    /// The popup missed `quickaction:open` and will never clear this pending.
    /// Refusing new presses on its behalf disabled the hotkey until restart.
    #[test]
    fn a_pending_the_popup_never_answered_stops_blocking() {
        let state = QuickActionState::new();
        let abandoned = Instant::now()
            .checked_sub(PENDING_MAX_AGE + Duration::from_secs(1))
            .expect("test clock is past the epoch");
        state.set(pending(abandoned));
        assert!(!state.is_busy());
    }
}
