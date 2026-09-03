//! Double tap on Ctrl — the cockpit toggle.
//!
//! No global-shortcut API can express this. `RegisterHotKey` and its macOS/X11
//! equivalents all want modifiers *plus* a key, so a bare Ctrl is not a hotkey
//! anywhere, and "twice quickly" is not a concept they have at all. The only way
//! to see it is to watch the keyboard directly, which on Windows means a
//! `WH_KEYBOARD_LL` hook.
//!
//! That hook sees every keystroke on the machine, so it is worth being precise
//! about what this one does with them: it asks each event two questions — "is
//! this Ctrl?" and "is it a press?" — and keeps nothing but two timestamps. No
//! key identity is stored, logged, emitted or sent anywhere, and the hook always
//! passes the event on (`CallNextHookEx`), so it can never swallow a keystroke
//! from the app the user is actually typing in.
//!
//! The hook has one blind spot, and it decides the shape of the whole feature:
//! **Windows stops calling it while Kavibay's own webview holds the keyboard
//! focus.** Measured, not assumed — with the cockpit open the hook thread keeps
//! servicing its message queue on schedule while no key event arrives at all, and
//! events resume the instant the window hides. Those keystrokes go to the webview
//! instead, which is why the closing half of the toggle lives in
//! `core/app/host/ctrlDoubleTap.ts`. The two halves never overlap: this one only
//! ever sees the keys that open the cockpit, that one only the keys that close
//! it, and both end in `toggle_cockpit` so there is still exactly one toggle.
//!
//! The rule itself is [`CtrlTapDetector`], plain Rust with no OS in it: the
//! interesting part is *which* sequences count, and that deserves tests rather
//! than a machine to tap on. `ctrlDoubleTap.ts` repeats it case for case — a
//! deliberate copy, since nothing can be shared across the language boundary, and
//! each side is pinned by its own tests so they cannot drift apart.

use std::time::{Duration, Instant};

/// A tap is a quick press. Holding Ctrl longer is somebody reaching for a chord
/// that never came — not half of a double tap.
const MAX_TAP: Duration = Duration::from_millis(300);
/// Allowed gap between the two presses. Windows' own double-click default is
/// 500ms; two deliberate taps land well inside this.
const MAX_GAP: Duration = Duration::from_millis(400);

/// The keyboard events the rule depends on — all a hook has to report.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyEvent {
    CtrlDown,
    CtrlUp,
    /// Any other key going down, whichever it was.
    OtherDown,
}

/// Whether the sequence just completed a double tap.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tap {
    None,
    Double,
}

/// Two clean Ctrl taps in a row, with nothing typed in between.
#[derive(Default)]
pub struct CtrlTapDetector {
    /// When the current Ctrl press began, while it can still become a tap.
    pressed_at: Option<Instant>,
    /// When the previous clean tap began.
    first_tap_at: Option<Instant>,
}

impl CtrlTapDetector {
    /// Feed one keyboard event; the caller acts on [`Tap::Double`].
    ///
    /// `now` is a parameter rather than read in here, so the rule can be tested
    /// at speeds no human types at.
    pub fn observe(&mut self, event: KeyEvent, now: Instant) -> Tap {
        match event {
            // Another key turns the held Ctrl into a modifier, and ends the
            // chain outright: Ctrl+C twice in a row is copying, and "Ctrl, a,
            // Ctrl" is typing. Getting this wrong is what makes naive
            // double-modifier detectors fire while people work.
            KeyEvent::OtherDown => {
                self.pressed_at = None;
                self.first_tap_at = None;
            }
            // Held keys repeat their down event; the first one is the press.
            KeyEvent::CtrlDown => {
                if self.pressed_at.is_none() {
                    self.pressed_at = Some(now);
                }
            }
            KeyEvent::CtrlUp => {
                // No press on record: it was cancelled by another key, or this
                // is the second Ctrl of a two-Ctrl grip coming back up.
                let Some(pressed_at) = self.pressed_at.take() else {
                    return Tap::None;
                };
                if now.duration_since(pressed_at) > MAX_TAP {
                    // A hold, so not a tap — and it separates whatever came
                    // before it from whatever comes next.
                    self.first_tap_at = None;
                    return Tap::None;
                }
                match self.first_tap_at.take() {
                    Some(first) if pressed_at.duration_since(first) <= MAX_GAP => {
                        return Tap::Double
                    }
                    // Too slow to be the partner of the last tap, but a fine
                    // first half for the next one.
                    _ => self.first_tap_at = Some(pressed_at),
                }
            }
        }
        Tap::None
    }
}

#[cfg(windows)]
pub use win::spawn;

#[cfg(windows)]
mod win {
    use super::{CtrlTapDetector, KeyEvent, Tap};
    use std::cell::RefCell;
    use std::sync::OnceLock;
    use std::time::Instant;
    use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::Input::KeyboardAndMouse::{VK_CONTROL, VK_LCONTROL, VK_RCONTROL};
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GetMessageW, SetWindowsHookExW, TranslateMessage,
        UnhookWindowsHookEx, KBDLLHOOKSTRUCT, MSG, WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP,
        WM_SYSKEYDOWN, WM_SYSKEYUP,
    };

    /// Set once at start-up; the hook callback has no other way to reach the app.
    static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

    // The callback only ever runs on the thread that installed the hook, so the
    // detector can be thread-local and never takes a lock on the key path.
    thread_local! {
        static DETECTOR: RefCell<CtrlTapDetector> = RefCell::new(CtrlTapDetector::default());
    }

    /// Install the hook on a thread of its own and keep it alive.
    ///
    /// A low-level keyboard hook is only served on a thread that pumps messages,
    /// and Tauri's main loop is not ours to borrow — so the hook gets a thread
    /// that does nothing else. Failure is reported, never propagated: the tray,
    /// `kavibay --toggle` and Shift+Ctrl+Space all still open the cockpit.
    pub fn spawn(app: tauri::AppHandle) {
        if APP.set(app).is_err() {
            return; // already running
        }
        std::thread::spawn(|| {
            // SAFETY: `keyboard_proc` is a valid HOOKPROC that lives for the
            // program's lifetime. hMod is ignored for an in-process
            // WH_KEYBOARD_LL hook.
            let hook =
                match unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), None, 0) } {
                    Ok(hook) => hook,
                    Err(error) => {
                        eprintln!("[shortcut] Ctrl double tap unavailable: {error}");
                        return;
                    }
                };
            println!("[shortcut] Ctrl double tap (cockpit) registered");

            let mut message = MSG::default();
            // Blocks; the hook is called from inside here. `.0 > 0` rather than
            // `as_bool()` — GetMessageW answers -1 on error, which would
            // otherwise spin this thread forever.
            while unsafe { GetMessageW(&mut message, None, 0, 0) }.0 > 0 {
                unsafe {
                    let _ = TranslateMessage(&message);
                    DispatchMessageW(&message);
                }
            }
            let _ = unsafe { UnhookWindowsHookEx(hook) };
        });
    }

    /// Classify one event, hand it to the detector, pass it on untouched.
    unsafe extern "system" fn keyboard_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        // HC_ACTION (0) is the only code that carries an event; anything else
        // must be forwarded without being looked at.
        if code == 0 {
            // SAFETY: for HC_ACTION the OS guarantees lparam is a KBDLLHOOKSTRUCT.
            let event = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
            let key = event.vkCode as u16;
            let is_ctrl = key == VK_CONTROL.0 || key == VK_LCONTROL.0 || key == VK_RCONTROL.0;
            let message = wparam.0 as u32;
            let down = message == WM_KEYDOWN || message == WM_SYSKEYDOWN;
            let up = message == WM_KEYUP || message == WM_SYSKEYUP;

            let observed = match (is_ctrl, down, up) {
                (true, true, _) => Some(KeyEvent::CtrlDown),
                (true, _, true) => Some(KeyEvent::CtrlUp),
                // Only the fact that *something else* went down matters — which
                // key it was is never recorded.
                (false, true, _) => Some(KeyEvent::OtherDown),
                _ => None,
            };
            if let Some(observed) = observed {
                let tap = DETECTOR
                    .with(|detector| detector.borrow_mut().observe(observed, Instant::now()));
                if tap == Tap::Double {
                    toggle_cockpit_soon();
                }
            }
        }

        // SAFETY: forwarding is required of every hook; None lets the OS find
        // the next hook in the chain itself.
        unsafe { CallNextHookEx(None, code, wparam, lparam) }
    }

    /// Hand the toggle to the main thread and return immediately.
    ///
    /// Windows drops a low-level hook that misses its deadline
    /// (`LowLevelHooksTimeout`, 300ms by default) and does not say so — the keys
    /// simply stop arriving. Showing a fullscreen window from inside the
    /// callback would flirt with that budget for no reason.
    fn toggle_cockpit_soon() {
        let Some(app) = APP.get() else {
            return;
        };
        let app = app.clone();
        let _ = app
            .clone()
            .run_on_main_thread(move || crate::toggle_cockpit(&app, false, Some("CTRL+CTRL")));
    }
}

#[cfg(test)]
mod tests {
    use super::{CtrlTapDetector, KeyEvent, Tap};
    use std::time::{Duration, Instant};

    const DOWN: KeyEvent = KeyEvent::CtrlDown;
    const UP: KeyEvent = KeyEvent::CtrlUp;
    const OTHER: KeyEvent = KeyEvent::OtherDown;

    /// Replays `(event, milliseconds since the start)` pairs and reports the
    /// verdict on the last one.
    fn replay(events: &[(KeyEvent, u64)]) -> Tap {
        let start = Instant::now();
        let mut detector = CtrlTapDetector::default();
        let mut last = Tap::None;
        for (event, at) in events {
            last = detector.observe(*event, start + Duration::from_millis(*at));
        }
        last
    }

    #[test]
    fn two_quick_taps_are_the_toggle() {
        assert_eq!(
            replay(&[(DOWN, 0), (UP, 60), (DOWN, 180), (UP, 240)]),
            Tap::Double
        );
    }

    #[test]
    fn one_tap_does_nothing() {
        assert_eq!(replay(&[(DOWN, 0), (UP, 60)]), Tap::None);
    }

    #[test]
    fn a_slow_second_tap_starts_over_instead_of_firing() {
        assert_eq!(
            replay(&[(DOWN, 0), (UP, 60), (DOWN, 900), (UP, 960)]),
            Tap::None
        );
        // ...and that late tap is a valid first half for the next pair.
        assert_eq!(
            replay(&[
                (DOWN, 0),
                (UP, 60),
                (DOWN, 900),
                (UP, 960),
                (DOWN, 1100),
                (UP, 1160),
            ]),
            Tap::Double
        );
    }

    #[test]
    fn holding_ctrl_is_not_a_tap() {
        assert_eq!(
            replay(&[(DOWN, 0), (UP, 500), (DOWN, 600), (UP, 660)]),
            Tap::None
        );
    }

    #[test]
    fn a_chord_is_never_half_a_double_tap() {
        // Ctrl+C twice in a row is copying, not a request for the cockpit.
        assert_eq!(
            replay(&[
                (DOWN, 0),
                (OTHER, 20),
                (UP, 60),
                (DOWN, 180),
                (OTHER, 200),
                (UP, 240),
            ]),
            Tap::None
        );
    }

    #[test]
    fn typing_between_two_taps_breaks_the_chain() {
        assert_eq!(
            replay(&[(DOWN, 0), (UP, 60), (OTHER, 100), (DOWN, 180), (UP, 240)]),
            Tap::None
        );
    }

    #[test]
    fn holding_ctrl_space_to_peek_never_toggles() {
        // The peek hotkey is Ctrl+Space held down: Space cancels the tap, so
        // letting go of Ctrl afterwards must not count as half a double tap —
        // twice in a row least of all.
        assert_eq!(
            replay(&[
                (DOWN, 0),
                (OTHER, 40),
                (UP, 300),
                (DOWN, 400),
                (OTHER, 440),
                (UP, 700),
            ]),
            Tap::None
        );
    }

    #[test]
    fn auto_repeat_does_not_restart_the_press() {
        // A repeating down must not reset the clock, or a long hold would end
        // up looking like a tap.
        assert_eq!(
            replay(&[
                (DOWN, 0),
                (DOWN, 200),
                (DOWN, 400),
                (UP, 500),
                (DOWN, 600),
                (UP, 660),
            ]),
            Tap::None
        );
    }

    #[test]
    fn a_stray_release_is_ignored() {
        assert_eq!(replay(&[(UP, 0)]), Tap::None);
    }
}
