//! All Tauri commands called by the frontend through `invoke()`.
//!
//! Important for the widget contract (see PLAN.md §3): this is the ONLY place where
//! "real" data (system data and later external APIs) is acquired. The frontend
//! (widgets) does not know how that data is produced; it only receives JSON.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

// --- Click-through-State --------------------------------------------------------------
//
// The frontend reports the rectangles of all interactive elements (widget cards + palette)
// in CSS pixels. The polling thread in lib.rs compares them with the cursor position and
// makes the window click-through outside them. `paused` keeps the window interactive during
// a drag.

#[derive(Deserialize, Clone, Copy)]
pub struct RectPx {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl RectPx {
    pub fn contains(&self, px: f64, py: f64) -> bool {
        px >= self.x && px <= self.x + self.w && py >= self.y && py <= self.y + self.h
    }
}

#[derive(Default)]
pub struct ClickThrough {
    pub rects: Vec<RectPx>,
    pub paused: bool,
    /// Frontend wants a `cockpit:outside-click` event when a click lands in a gap.
    /// Off by default so desktop clicks under a pinned-only window emit nothing.
    pub outside_click_armed: bool,
    /// Bumped on every rect update so the click-through watcher can tell the
    /// boundary moved even though the cursor did not, and tick fast again.
    /// Also bumped when Rust makes the window interactive itself, so the watcher
    /// rewrites its answer instead of trusting the one it wrote last.
    pub generation: u64,
    /// OS file drags that have entered the window, counted by its `DragDrop`
    /// handler. A press in a gap followed by one of these is somebody dragging a
    /// file onto Kavibay, not clicking past it.
    pub drags_entered: u64,
}

pub type SharedClickThrough = Arc<Mutex<ClickThrough>>;

/// Which display the overlay should cover when opened (multi-monitor).
// camelCase, not lowercase: single-word variants serialize identically either way,
// so this stays compatible with persisted "cursor" / "primary" while giving
// ActiveWindow a readable "activeWindow" instead of "activewindow".
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum OpenMonitor {
    /// Cover the monitor under the mouse pointer (historic default).
    #[default]
    Cursor,
    /// Cover the system primary/main display.
    Primary,
    /// Cover the monitor holding the foreground window.
    ActiveWindow,
}

pub type SharedOpenMonitor = Arc<Mutex<OpenMonitor>>;

/// Last foreground window that was not our overlay, as a raw HWND.
///
/// Sampled continuously by the click-through watcher rather than read on demand:
/// the reveal path calls `show()` + `set_focus()` before it places the window, so
/// asking for the foreground window at placement time always answers "Kavibay".
pub type SharedActiveWindow = Arc<Mutex<Option<isize>>>;

/// Decide what `SharedActiveWindow` should hold after observing the foreground.
///
/// Split out from the Win32 call so the rule that actually matters is testable:
/// our own window must never overwrite the memory. It briefly *is* the foreground
/// on every reveal, and letting that land would make "Active window" collapse into
/// "wherever Kavibay already was" — in practice, the pointer's screen.
#[cfg(any(windows, test))]
pub fn next_active_window(
    current: Option<isize>,
    foreground: Option<isize>,
    ours: Option<isize>,
) -> Option<isize> {
    match foreground {
        Some(fg) if Some(fg) != ours => Some(fg),
        _ => current,
    }
}

/// Base cadence for the click-through watcher — fast enough that crossing a card
/// edge feels instant.
pub const WATCH_TICK_MS: u64 = 16;
/// Cadence while the cursor sits still. Motion drops straight back to
/// `WATCH_TICK_MS`, so this only ever delays *noticing* that motion resumed — a
/// stationary cursor cannot cross a boundary on its own.
pub const WATCH_IDLE_TICK_MS: u64 = 64;
/// While the window is hidden there is no boundary to maintain at all.
pub const WATCH_HIDDEN_TICK_MS: u64 = 250;

/// Decide the click-through watcher's next poll interval.
///
/// Split out from the loop for the same reason as `next_active_window`: the rule
/// is small, easy to get subtly wrong, and worth pinning down in tests. A fixed
/// 16ms tick meant 62.5 timer wakeups per second around the clock — little in
/// CPU percent, but enough to keep the CPU package out of deep C-states.
pub fn next_watch_tick_ms(moved: bool, rects_changed: bool, outside_click_armed: bool) -> u64 {
    // Cursor motion and layout changes are the only two things that can move the
    // boundary. `outside_click_armed` is the non-obvious third: that path reads
    // mouse button *edges*, so a click shorter than the idle interval would fall
    // between two samples and be lost entirely.
    if moved || rects_changed || outside_click_armed {
        WATCH_TICK_MS
    } else {
        WATCH_IDLE_TICK_MS
    }
}

/// Must the watcher write `ignore` to the window on this tick?
///
/// Writing only when the answer changes is what keeps the watcher cheap, but it
/// makes the last write a belief about the window, not a reading of it. The
/// reveal paths make the window interactive themselves; with nothing on screen
/// to hover, the answer never changed again, so a frontend that did not respond
/// left a fullscreen window that swallowed every click. A new generation says
/// the belief may be stale.
pub fn click_through_needs_write(
    last_written: Option<bool>,
    ignore: bool,
    generation_changed: bool,
) -> bool {
    generation_changed || last_written != Some(ignore)
}

/// A press in a gap, waiting for its release to say whether it was a click.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PendingOutsideClick {
    drags_at_press: u64,
}

/// Advance the outside-click answer by one watcher tick.
///
/// Returns the press still waiting, and whether to dismiss now. A gap press
/// used to dismiss at once, which closed the palette the moment somebody
/// pressed on a file in Finder to drag it over. Now the release decides: a
/// press that ends without a file drag having reached the window was a click,
/// and one that brought a drag in was not.
///
/// The release is read from the button state rather than from a release event,
/// because a drag session swallows the release it ends with. A press the
/// watcher never saw (a screenshot tool's selection) starts nothing, so its
/// release dismisses nothing.
pub fn outside_click_step(
    pending: Option<PendingOutsideClick>,
    pressed_in_gap: bool,
    armed: bool,
    button_down: bool,
    drags_entered: u64,
) -> (Option<PendingOutsideClick>, bool) {
    if !armed {
        return (None, false);
    }
    let pending = if pressed_in_gap {
        Some(PendingOutsideClick {
            drags_at_press: drags_entered,
        })
    } else {
        pending
    };
    match pending {
        Some(press) if press.drags_at_press != drags_entered => (None, false),
        Some(press) if button_down => (Some(press), false),
        Some(_) => (None, true),
        None => (None, false),
    }
}

/// Can the click-through hit test trust `window.cursor_position()`?
///
/// Wayland does not let a client query the global pointer position, and tao does
/// not report that as an error — it returns a fabricated `Ok((0, 0))`
/// (`tao/src/platform_impl/linux/util.rs`). The watcher would then hit-test the
/// screen corner forever, conclude the cursor is on no widget at all, and make the
/// whole window click-through. The `None => true` fail-open in the watcher cannot
/// catch it, because nothing ever fails.
///
/// Under XWayland the X11 path runs and the query is genuine, so this asks which
/// GDK backend GTK actually picked, not what the session advertises: an explicit
/// `GDK_BACKEND` wins, otherwise GTK prefers Wayland whenever `WAYLAND_DISPLAY` is set.
///
/// Takes the values as arguments rather than reading the environment so it stays a
/// pure function — env vars are process-global and make tests order-dependent.
pub fn cursor_position_is_reliable(
    gdk_backend: Option<&str>,
    wayland_display: Option<&str>,
) -> bool {
    // GDK_BACKEND may list fallbacks ("wayland,x11"); the first entry wins.
    if let Some(first) = gdk_backend
        .map(str::trim)
        .filter(|b| !b.is_empty())
        .and_then(|b| b.split(',').next())
    {
        return !first.eq_ignore_ascii_case("wayland");
    }
    wayland_display.filter(|d| !d.is_empty()).is_none()
}

/// Left or right mouse button held, decoded from an X11 `QueryPointer` mask.
///
/// Mirrors the Windows read (`VK_LBUTTON || VK_RBUTTON`) — both dismiss. Two traps
/// the mask hides:
///
/// - X11 numbers the middle button 2, so *right* is `BUTTON3`. Reading `BUTTON2` as
///   right would dismiss on middle-click and ignore the actual right-click.
/// - The same mask carries the modifier keys. A plain `mask != 0` would report a
///   pressed button every time the user merely holds Shift or Ctrl.
#[cfg(any(target_os = "linux", test))]
pub fn x11_pointer_button_held(mask: u16) -> bool {
    const BUTTON1: u16 = 1 << 8; // left
    const BUTTON3: u16 = 1 << 10; // right
    mask & (BUTTON1 | BUTTON3) != 0
}

/// Must the frontend catch gap clicks in the DOM instead of Rust reporting them?
///
/// Native reporting needs two things at once, and the answer differs per platform:
///
/// | Platform        | global button read      | hit test | gap clicks come from |
/// |-----------------|-------------------------|----------|----------------------|
/// | Windows         | `GetAsyncKeyState`      | yes      | Rust (`cockpit:outside-click`) |
/// | macOS           | `NSEvent` global monitor | yes     | Rust (`cockpit:outside-click`) |
/// | Linux + X11     | `QueryPointer`          | yes      | Rust (`cockpit:outside-click`) |
/// | Linux + Wayland | none                    | no       | the DOM catcher |
///
/// A DOM catcher is only *safe* while click-through is off. With click-through on
/// (Windows, X11) a fullscreen catcher would have to report itself as interactive,
/// the window would turn opaque to the OS, and the gap click would no longer reach
/// the app underneath — the regression `clickThrough.ts` documents at length.
///
/// The two columns collapse into one question on Linux: both the pointer query and
/// the hit test need a live X11 connection, so neither can work where the other
/// does not.
pub fn dom_gap_catcher_needed(native_button_read: bool, hit_test_usable: bool) -> bool {
    !native_button_read && !hit_test_usable
}

/// Asked once at startup by `clickThrough.ts`. Reads the same two facts the watcher
/// does, so the frontend cannot drift from Rust's own decision.
#[tauri::command]
pub fn needs_dom_gap_catcher() -> bool {
    let hit_test_usable = cursor_position_is_reliable(
        std::env::var("GDK_BACKEND").ok().as_deref(),
        std::env::var("WAYLAND_DISPLAY").ok().as_deref(),
    );
    // On Linux the button read rides the same X11 connection as the hit test, so it
    // is available exactly where the hit test is. Windows and macOS always have both.
    let native_button_read = cfg!(windows)
        || cfg!(target_os = "macos")
        || (cfg!(target_os = "linux") && hit_test_usable);
    dom_gap_catcher_needed(native_button_read, hit_test_usable)
}

#[tauri::command]
pub fn set_interactive_rects(rects: Vec<RectPx>, state: State<'_, SharedClickThrough>) {
    let mut s = state.lock().unwrap();
    s.rects = rects;
    s.generation = s.generation.wrapping_add(1);
}

#[tauri::command]
pub fn set_click_through_paused(paused: bool, state: State<'_, SharedClickThrough>) {
    state.lock().unwrap().paused = paused;
}

/// Arm/disarm native outside-click detection ("Hide on outside click").
///
/// Armed, the poll thread reports gap clicks instead of the frontend catching them
/// with a fullscreen div — that div would make the window opaque to the cursor and
/// swallow the click, so the user had to click twice to hit anything underneath.
#[tauri::command]
pub fn set_outside_click_dismiss(armed: bool, state: State<'_, SharedClickThrough>) {
    state.lock().unwrap().outside_click_armed = armed;
}

/// Sync the open-monitor preference from Settings (localStorage) into Rust.
/// Needed because the hotkey places the window before the frontend runs.
#[tauri::command]
pub fn set_open_monitor(target: OpenMonitor, state: State<'_, SharedOpenMonitor>) {
    *state.lock().unwrap() = target;
}

/// Fully quit the app (gear menu / shared exit path).
#[tauri::command]
pub fn app_exit(app: AppHandle) {
    app.exit(0);
}

/// Parse and range-check the `level` argument of `set-volume`.
/// Split out from the COM call so it is testable on every platform.
fn parse_volume_level(args: &HashMap<String, String>) -> Result<f32, String> {
    let raw = args
        .get("level")
        .ok_or_else(|| "set-volume requires a level".to_string())?;
    let value: f32 = raw
        .trim()
        .parse()
        .map_err(|_| format!("not a number: {raw}"))?;
    if !value.is_finite() || !(0.0..=100.0).contains(&value) {
        return Err(format!("level must be between 0 and 100, got {raw}"));
    }
    Ok(value)
}

/// Called by the command palette on `Enter`. Commands with parameters receive them as a
/// validated string map; Rust still validates them again because the frontend must not be
/// the only line of defense.
#[tauri::command]
pub fn execute_action(action_id: String, args: HashMap<String, String>) -> Result<(), String> {
    match action_id.as_str() {
        "set-volume" => {
            let level = parse_volume_level(&args)?;
            set_master_volume(level / 100.0)
        }
        "toggle-mute" => toggle_master_mute(),
        "lock-screen" => lock_workstation(),
        // Unimplemented palette stubs remain harmless but visible.
        "open-browser" | "sleep" | "empty-clipboard" => {
            println!("[action] {action_id} (not implemented)");
            Ok(())
        }
        // A typo in a command row must not silently succeed.
        other => Err(format!("unknown action: {other}")),
    }
}

/// Set the default render endpoint volume (0.0–1.0).
#[cfg(windows)]
fn set_master_volume(scalar: f32) -> Result<(), String> {
    with_endpoint_volume(|volume| unsafe {
        volume
            .SetMasterVolumeLevelScalar(scalar, std::ptr::null())
            .map_err(|e| e.to_string())
    })
}

#[cfg(not(windows))]
fn set_master_volume(_scalar: f32) -> Result<(), String> {
    Err("set-volume is only implemented on Windows".into())
}

/// Flip mute on the default render endpoint.
#[cfg(windows)]
fn toggle_master_mute() -> Result<(), String> {
    with_endpoint_volume(|volume| unsafe {
        let muted = volume.GetMute().map_err(|e| e.to_string())?;
        volume
            .SetMute(!muted.as_bool(), std::ptr::null())
            .map_err(|e| e.to_string())
    })
}

#[cfg(not(windows))]
fn toggle_master_mute() -> Result<(), String> {
    Err("toggle-mute is only implemented on Windows".into())
}

/// Resolve the default audio render endpoint and hand its volume interface to `f`.
/// COM is initialized per call on this thread, mirroring `now_playing`/`installed_apps`.
#[cfg(windows)]
fn with_endpoint_volume<F>(f: F) -> Result<(), String>
where
    F: FnOnce(&windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume) -> Result<(), String>,
{
    use windows::Win32::Media::Audio::{
        eMultimedia, eRender, Endpoints::IAudioEndpointVolume, IMMDeviceEnumerator,
        MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
    };

    unsafe {
        // S_FALSE means "already initialized on this thread" — not an error.
        let init = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let result = (|| {
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                    .map_err(|e| e.to_string())?;
            let device = enumerator
                .GetDefaultAudioEndpoint(eRender, eMultimedia)
                .map_err(|e| e.to_string())?;
            let volume: IAudioEndpointVolume = device
                .Activate(CLSCTX_ALL, None)
                .map_err(|e| e.to_string())?;
            f(&volume)
        })();
        if init.is_ok() {
            CoUninitialize();
        }
        result
    }
}

#[cfg(windows)]
fn lock_workstation() -> Result<(), String> {
    unsafe { windows::Win32::System::Shutdown::LockWorkStation().map_err(|e| e.to_string()) }
}

#[cfg(not(windows))]
fn lock_workstation() -> Result<(), String> {
    Err("lock-screen is only implemented on Windows".into())
}

#[cfg(test)]
mod action_tests {
    use super::*;

    fn args(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
            .collect()
    }

    #[test]
    fn volume_level_accepts_the_full_range() {
        assert_eq!(parse_volume_level(&args(&[("level", "0")])), Ok(0.0));
        assert_eq!(parse_volume_level(&args(&[("level", "100")])), Ok(100.0));
        assert_eq!(parse_volume_level(&args(&[("level", " 42 ")])), Ok(42.0));
    }

    #[test]
    fn volume_level_rejects_junk_and_out_of_range() {
        assert!(parse_volume_level(&args(&[("level", "abc")])).is_err());
        assert!(parse_volume_level(&args(&[("level", "101")])).is_err());
        assert!(parse_volume_level(&args(&[("level", "-1")])).is_err());
        assert!(parse_volume_level(&args(&[("level", "NaN")])).is_err());
        assert!(parse_volume_level(&args(&[])).is_err(), "missing level");
    }

    #[test]
    fn unknown_action_errors_instead_of_succeeding_silently() {
        let err = execute_action("nope".into(), HashMap::new()).unwrap_err();
        assert!(err.contains("unknown action"), "got: {err}");
    }

    #[test]
    fn unimplemented_stubs_stay_harmless() {
        assert!(execute_action("sleep".into(), HashMap::new()).is_ok());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Run a sequence of ticks, each `(pressed_in_gap, button_down, drags_entered)`,
    /// and return the tick indexes that dismissed.
    fn dismissals(ticks: &[(bool, bool, u64)]) -> Vec<usize> {
        let mut pending = None;
        let mut out = Vec::new();
        for (index, &(pressed, down, drags)) in ticks.iter().enumerate() {
            let (next, dismiss) = outside_click_step(pending, pressed, true, down, drags);
            pending = next;
            if dismiss {
                out.push(index);
            }
        }
        out
    }

    #[test]
    fn a_gap_click_dismisses_on_release() {
        assert_eq!(
            dismissals(&[(true, true, 0), (false, true, 0), (false, false, 0)]),
            vec![2]
        );
    }

    #[test]
    fn a_click_shorter_than_a_tick_dismisses_at_once() {
        assert_eq!(dismissals(&[(true, false, 0)]), vec![0]);
    }

    #[test]
    fn a_press_that_drags_a_file_in_never_dismisses() {
        assert_eq!(
            dismissals(&[
                (true, true, 3),
                (false, true, 4),
                (false, false, 4),
                (false, false, 4)
            ]),
            Vec::<usize>::new()
        );
    }

    #[test]
    fn a_later_click_after_a_file_drag_still_dismisses() {
        assert_eq!(
            dismissals(&[
                (true, true, 0),
                (false, true, 1),
                (false, false, 1),
                (true, false, 1)
            ]),
            vec![3]
        );
    }

    #[test]
    fn a_release_without_a_seen_press_dismisses_nothing() {
        assert_eq!(
            dismissals(&[(false, true, 0), (false, false, 0)]),
            Vec::<usize>::new()
        );
    }

    #[test]
    fn disarming_forgets_the_press() {
        let (pending, dismiss) = outside_click_step(None, true, true, true, 0);
        assert!(pending.is_some() && !dismiss);
        assert_eq!(
            outside_click_step(pending, false, false, false, 0),
            (None, false)
        );
    }

    #[test]
    fn foreground_window_is_remembered() {
        assert_eq!(next_active_window(None, Some(10), Some(99)), Some(10));
        assert_eq!(next_active_window(Some(10), Some(20), Some(99)), Some(20));
    }

    #[test]
    fn our_own_window_never_overwrites_the_memory() {
        // The reveal path focuses Kavibay before it places the window, so this is
        // the state the watcher sees on every single open.
        assert_eq!(next_active_window(Some(10), Some(99), Some(99)), Some(10));
    }

    #[test]
    fn a_missing_foreground_keeps_what_we_had() {
        assert_eq!(next_active_window(Some(10), None, Some(99)), Some(10));
        assert_eq!(next_active_window(None, None, Some(99)), None);
    }

    #[test]
    fn an_unknown_own_handle_still_records_the_foreground() {
        // window.hwnd() can fail; losing the target beats freezing the memory.
        assert_eq!(next_active_window(Some(10), Some(20), None), Some(20));
    }

    #[test]
    fn a_still_cursor_over_a_still_layout_idles_down() {
        assert_eq!(next_watch_tick_ms(false, false, false), WATCH_IDLE_TICK_MS);
    }

    #[test]
    fn cursor_motion_restores_the_fast_tick() {
        assert_eq!(next_watch_tick_ms(true, false, false), WATCH_TICK_MS);
    }

    #[test]
    fn a_layout_change_restores_the_fast_tick_without_any_motion() {
        // The palette opening under a stationary cursor moves the boundary, not
        // the cursor. Idling through that would leave the window click-through
        // over a card that is now sitting under the pointer.
        assert_eq!(next_watch_tick_ms(false, true, false), WATCH_TICK_MS);
    }

    #[test]
    fn armed_outside_click_never_idles_down() {
        // That path reads mouse button edges, so a click shorter than the idle
        // interval would land entirely between two ticks and be dropped.
        assert_eq!(next_watch_tick_ms(false, false, true), WATCH_TICK_MS);
    }

    #[test]
    fn an_unchanged_answer_is_not_written_again() {
        assert!(!click_through_needs_write(Some(true), true, false));
        assert!(click_through_needs_write(Some(true), false, false));
        assert!(click_through_needs_write(None, true, false));
    }

    #[test]
    fn a_new_generation_rewrites_even_the_same_answer() {
        // Rust revealed the window and made it interactive behind the watcher's
        // back. The cursor is still in a gap, so the answer is still "ignore" —
        // and it has to be written again, or the window keeps every click.
        assert!(click_through_needs_write(Some(true), true, true));
    }

    #[test]
    fn a_plain_x11_session_can_be_hit_tested() {
        assert!(cursor_position_is_reliable(None, None));
        assert!(cursor_position_is_reliable(Some("x11"), None));
    }

    #[test]
    fn a_native_wayland_session_cannot_be_hit_tested() {
        // tao answers Ok((0,0)) here — a fake success the watcher must not trust.
        assert!(!cursor_position_is_reliable(None, Some("wayland-0")));
        assert!(!cursor_position_is_reliable(
            Some("wayland"),
            Some("wayland-0")
        ));
    }

    #[test]
    fn xwayland_is_trusted_even_inside_a_wayland_session() {
        // WAYLAND_DISPLAY stays set under XWayland, but GTK is on X11 and the
        // pointer query is genuine. Reading the session type alone would give up
        // click-through for no reason.
        assert!(cursor_position_is_reliable(Some("x11"), Some("wayland-0")));
    }

    #[test]
    fn only_the_first_gdk_backend_entry_decides() {
        // GDK_BACKEND takes a fallback list; GTK uses the first one that works.
        assert!(!cursor_position_is_reliable(
            Some("wayland,x11"),
            Some("wayland-0")
        ));
        assert!(cursor_position_is_reliable(
            Some("x11,wayland"),
            Some("wayland-0")
        ));
    }

    #[test]
    fn an_empty_backend_or_display_is_treated_as_unset() {
        // Shells export empty strings easily; an empty GDK_BACKEND must not be
        // read as a backend name, and an empty WAYLAND_DISPLAY is not a session.
        assert!(cursor_position_is_reliable(Some(""), None));
        assert!(cursor_position_is_reliable(None, Some("")));
        assert!(!cursor_position_is_reliable(Some(""), Some("wayland-0")));
    }

    #[test]
    fn windows_keeps_reporting_gap_clicks_natively() {
        assert!(!dom_gap_catcher_needed(true, true));
    }

    #[test]
    fn native_wayland_hands_gap_clicks_to_the_dom() {
        // Nothing to lose: click-through is already off there, so the window
        // swallows gap clicks whether or not a catcher exists.
        assert!(dom_gap_catcher_needed(false, false));
    }

    #[test]
    fn x11_keeps_its_click_through_instead_of_a_catcher() {
        // The hit test works here, so the gaps really are click-through. A catcher
        // would have to make the window opaque and would eat the click meant for
        // the app underneath — worse than the missing dismiss.
        assert!(!dom_gap_catcher_needed(true, true));
        assert!(!dom_gap_catcher_needed(false, true));
    }

    #[test]
    fn a_bare_pointer_mask_is_not_a_click() {
        assert!(!x11_pointer_button_held(0));
    }

    #[test]
    fn left_and_right_both_count_as_a_dismiss() {
        assert!(x11_pointer_button_held(1 << 8)); // BUTTON1, left
        assert!(x11_pointer_button_held(1 << 10)); // BUTTON3, right
    }

    #[test]
    fn the_middle_button_is_not_the_right_button() {
        // X11 numbers the middle button 2. Mistaking BUTTON2 for "right" would
        // dismiss on a middle-click paste and ignore the real right-click.
        assert!(!x11_pointer_button_held(1 << 9));
    }

    #[test]
    fn held_modifiers_alone_are_not_a_click() {
        // The pointer mask carries Shift/Ctrl/Alt in its low bits, so `mask != 0`
        // would fire the dismiss on every modifier the user happens to hold.
        assert!(!x11_pointer_button_held(0b1111_1111));
        // …but a modifier held *with* a button still counts.
        assert!(x11_pointer_button_held((1 << 8) | 0b100));
    }

    #[test]
    fn the_idle_tick_stays_under_human_point_and_click() {
        // The one way the backoff can bite: cursor sits still, then moves onto a
        // card *and* clicks inside a single tick. Pointing at a target takes well
        // over 100ms, so keep the ceiling below that — raising this constant
        // without re-checking that reasoning would start swallowing clicks.
        // `const` blocks: these compare constants, so the build fails on a bad
        // edit rather than the test suite catching it afterwards.
        const { assert!(WATCH_TICK_MS < WATCH_IDLE_TICK_MS) };
        const { assert!(WATCH_IDLE_TICK_MS <= 100) };
        const { assert!(WATCH_HIDDEN_TICK_MS > WATCH_IDLE_TICK_MS) };
    }

    #[test]
    fn open_monitor_keeps_its_persisted_spelling() {
        // camelCase must not have renamed the two ids already on disk.
        assert_eq!(
            serde_json::to_string(&OpenMonitor::Cursor).unwrap(),
            "\"cursor\""
        );
        assert_eq!(
            serde_json::to_string(&OpenMonitor::Primary).unwrap(),
            "\"primary\""
        );
        assert_eq!(
            serde_json::to_string(&OpenMonitor::ActiveWindow).unwrap(),
            "\"activeWindow\""
        );
        assert_eq!(
            serde_json::from_str::<OpenMonitor>("\"activeWindow\"").unwrap(),
            OpenMonitor::ActiveWindow
        );
    }
}
