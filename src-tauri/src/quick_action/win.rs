//! The platform half of quick actions: read the selection out of a foreign
//! window, find out where it is on screen, and put an answer back.
//!
//! Windows has no "give me the selected text of the focused control" call that
//! works everywhere, so this does what every text expander does: remember the
//! foreground window, synthesise Ctrl+C, and read the clipboard. Everything
//! non-Windows is stubbed out — the macOS port needs a different mechanism
//! (Accessibility API), not a different shape of this file.

use super::editability::{UiaProbe, WindowProbe};
use super::placement::{Anchor, Rect};

// Timings for the synthesised Ctrl+C / Ctrl+V dance below — the `imp` module that
// performs it is Windows-only, so these travel with it.

/// How long we wait for the target application to answer our Ctrl+C.
#[cfg(windows)]
const COPY_TIMEOUT_MS: u64 = 500;
#[cfg(windows)]
const COPY_POLL_MS: u64 = 20;

/// How long we wait for the user to let go of Ctrl+Shift+Q before typing.
#[cfg(windows)]
const MODIFIER_TIMEOUT_MS: u64 = 800;
#[cfg(windows)]
const MODIFIER_POLL_MS: u64 = 10;

#[cfg(windows)]
mod imp {
    use super::*;
    use std::ffi::c_void;
    use std::time::{Duration, Instant};
    use windows::Win32::Foundation::{HWND, POINT, RECT};
    use windows::Win32::Graphics::Gdi::{
        ClientToScreen, GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS,
        KEYEVENTF_KEYUP, VIRTUAL_KEY,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetCursorPos, GetForegroundWindow, GetGUIThreadInfo, GetWindowThreadProcessId, IsWindow,
        SetForegroundWindow, GUITHREADINFO,
    };

    const VK_SHIFT: u16 = 0x10;
    const VK_CONTROL: u16 = 0x11;
    const VK_MENU: u16 = 0x12; // Alt
    const VK_LWIN: u16 = 0x5B;
    const VK_RWIN: u16 = 0x5C;
    const VK_C: u16 = 0x43;
    const VK_V: u16 = 0x56;

    fn hwnd_from(raw: isize) -> HWND {
        HWND(raw as *mut c_void)
    }

    /// The window in front right now, unless it is one of ours.
    ///
    /// `own_hwnds` are Kavibay's own windows: pressing the hotkey while the
    /// cockpit has focus must not make Kavibay paste into itself.
    pub fn foreground_window(own_hwnds: &[isize]) -> Option<isize> {
        let hwnd = unsafe { GetForegroundWindow() };
        if hwnd.0.is_null() {
            return None;
        }
        let raw = hwnd.0 as isize;
        (!own_hwnds.contains(&raw)).then_some(raw)
    }

    pub fn is_window(raw: isize) -> bool {
        unsafe { IsWindow(Some(hwnd_from(raw))) }.as_bool()
    }

    /// Bring the remembered window back to the front before pasting.
    ///
    /// Windows only grants this to the process that currently owns the
    /// foreground — which is us, because the popup the user just clicked has
    /// focus. Calling it from a background state would silently flash the
    /// taskbar button instead of switching.
    pub fn focus_window(raw: isize) {
        let _ = unsafe { SetForegroundWindow(hwnd_from(raw)) };
    }

    fn key_event(vk: u16, up: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(vk),
                    wScan: 0,
                    dwFlags: if up {
                        KEYEVENTF_KEYUP
                    } else {
                        KEYBD_EVENT_FLAGS(0)
                    },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    /// Send Ctrl + `vk` as one atomic four-event batch.
    fn send_ctrl_combo(vk: u16) -> Result<(), String> {
        let inputs = [
            key_event(VK_CONTROL, false),
            key_event(vk, false),
            key_event(vk, true),
            key_event(VK_CONTROL, true),
        ];
        // SAFETY: `inputs` is a live slice of well-formed keyboard INPUTs.
        let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
        if sent as usize != inputs.len() {
            return Err("could not synthesise a keystroke".into());
        }
        Ok(())
    }

    fn key_is_down(vk: u16) -> bool {
        (unsafe { GetAsyncKeyState(vk as i32) } as u16 & 0x8000) != 0
    }

    /// Wait until the hotkey's own modifiers are physically up.
    ///
    /// Without this the Ctrl+C we send lands while Alt is still held down and
    /// the target application sees Ctrl+Alt+C — which is a different shortcut
    /// almost everywhere, and nothing at all in most editors. Injecting a fake
    /// Alt key-up instead would be faster but leaves the target thinking Alt
    /// was tapped, which opens the menu bar in classic Win32 apps.
    pub fn wait_for_modifier_release() {
        let deadline = Instant::now() + Duration::from_millis(MODIFIER_TIMEOUT_MS);
        while Instant::now() < deadline {
            let held = [VK_CONTROL, VK_MENU, VK_SHIFT, VK_LWIN, VK_RWIN]
                .iter()
                .any(|vk| key_is_down(*vk));
            if !held {
                return;
            }
            std::thread::sleep(Duration::from_millis(MODIFIER_POLL_MS));
        }
    }

    /// Ctrl+C into the foreground window, then wait for the clipboard to move.
    ///
    /// The sequence number is the signal, not the content: it also bumps when
    /// the copied text happens to equal what was already there, and it stays
    /// put when nothing was selected — which is exactly how "no selection"
    /// is detected. `None` means the copy produced nothing.
    pub fn copy_selection() -> Option<String> {
        let before = crate::extensions::clipboard_widget::clipboard_sequence();
        if send_ctrl_combo(VK_C).is_err() {
            return None;
        }

        let deadline = Instant::now() + Duration::from_millis(COPY_TIMEOUT_MS);
        while Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(COPY_POLL_MS));
            match (
                before,
                crate::extensions::clipboard_widget::clipboard_sequence(),
            ) {
                // Sequence numbers unavailable: fall back to "read once, late".
                (None, None) => continue,
                (a, b) if a == b => continue,
                _ => return crate::extensions::clipboard_widget::clipboard_text(),
            }
        }
        // No bump at all — either nothing was selected, or the app copied
        // something that is not text (files in Explorer).
        None
    }

    pub fn paste() -> Result<(), String> {
        send_ctrl_combo(VK_V)
    }

    /// The text caret of `raw`'s thread, in screen pixels.
    ///
    /// Only apps that keep a real system caret report one: Notepad, Win32 edit
    /// controls, Office. Chromium, Electron and most UWP apps draw their own
    /// and return an empty rect here — `Anchor::at_cursor` is what those get.
    pub fn caret_anchor(raw: isize) -> Option<Anchor> {
        let thread = unsafe { GetWindowThreadProcessId(hwnd_from(raw), None) };
        if thread == 0 {
            return None;
        }

        let mut info = GUITHREADINFO {
            cbSize: std::mem::size_of::<GUITHREADINFO>() as u32,
            ..Default::default()
        };
        unsafe { GetGUIThreadInfo(thread, &mut info) }.ok()?;

        let caret: RECT = info.rcCaret;
        if info.hwndCaret.0.is_null() || (caret.right - caret.left) < 0 {
            return None;
        }
        let height = caret.bottom - caret.top;
        // A zero-height caret rect is the documented "no caret" answer, and a
        // (0,0) origin usually means the same thing reported sloppily.
        if height <= 0 || (caret.left == 0 && caret.top == 0) {
            return None;
        }

        let mut point = POINT {
            x: caret.left,
            y: caret.top,
        };
        // rcCaret is in client coordinates of hwndCaret, not of the window we
        // were handed — those differ for anything with a toolbar.
        if !unsafe { ClientToScreen(info.hwndCaret, &mut point) }.as_bool() {
            return None;
        }
        Some(Anchor {
            x: point.x,
            y: point.y,
            height,
        })
    }

    pub fn cursor_anchor() -> Option<Anchor> {
        let mut point = POINT::default();
        unsafe { GetCursorPos(&mut point) }.ok()?;
        Some(Anchor {
            x: point.x,
            y: point.y,
            height: 0,
        })
    }

    /// Stage 1 of the editable check — see `editability`.
    ///
    /// Reads the same `GUITHREADINFO` the caret anchor uses, so the extra cost
    /// over what already runs is one class name and one style read.
    pub fn window_probe(raw: isize) -> WindowProbe {
        use windows::Win32::UI::WindowsAndMessaging::{
            GetWindowLongPtrW, GWL_STYLE, WINDOW_LONG_PTR_INDEX,
        };

        const ES_READONLY: isize = 0x0800;

        let thread = unsafe { GetWindowThreadProcessId(hwnd_from(raw), None) };
        if thread == 0 {
            return WindowProbe::Unknown;
        }
        let mut info = GUITHREADINFO {
            cbSize: std::mem::size_of::<GUITHREADINFO>() as u32,
            ..Default::default()
        };
        if unsafe { GetGUIThreadInfo(thread, &mut info) }.is_err() {
            return WindowProbe::Unknown;
        }

        if !info.hwndCaret.0.is_null() {
            return WindowProbe::HasCaret;
        }
        if info.hwndFocus.0.is_null() {
            return WindowProbe::Unknown;
        }

        // Only classic edit controls carry ES_READONLY; on anything else that
        // bit means something different, so the class name has to gate it.
        let class = window_class(info.hwndFocus);
        let is_edit = class.eq_ignore_ascii_case("Edit")
            || class.to_ascii_uppercase().starts_with("RICHEDIT");
        if !is_edit {
            return WindowProbe::Unknown;
        }

        let style =
            unsafe { GetWindowLongPtrW(info.hwndFocus, WINDOW_LONG_PTR_INDEX(GWL_STYLE.0)) };
        if style & ES_READONLY != 0 {
            WindowProbe::ReadOnlyEdit
        } else {
            WindowProbe::Unknown
        }
    }

    fn window_class(hwnd: HWND) -> String {
        use windows::Win32::UI::WindowsAndMessaging::GetClassNameW;

        let mut buffer = [0u16; 128];
        let len = unsafe { GetClassNameW(hwnd, &mut buffer) };
        if len <= 0 {
            return String::new();
        }
        String::from_utf16_lossy(&buffer[..len as usize])
    }

    /// Stage 2 — ask UI Automation about the focused element.
    ///
    /// Three ways to earn a `Writable`, because no single one covers the web:
    /// a value pattern that accepts writes (`<input>`, `<textarea>`, most
    /// native controls), a text-edit pattern (what a `contenteditable` in
    /// Chromium or Electron exposes), or an `Edit` control type (what those
    /// same composers report when they expose neither). A value pattern that
    /// refuses writes, or a bare `Document`, is the rendered-page case.
    ///
    /// Everything else answers `Unknown`, and the caller then keeps the answer
    /// on the clipboard rather than typing on a guess.
    ///
    /// Chromium only builds its accessibility tree once something asks for it,
    /// so the very first call in a browser can be slower and answer `Unknown`.
    pub fn uia_probe() -> UiaProbe {
        use windows::Win32::System::Com::{
            CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
            COINIT_MULTITHREADED,
        };
        use windows::Win32::UI::Accessibility::{
            CUIAutomation, IUIAutomation, IUIAutomationTextEditPattern, IUIAutomationValuePattern,
            UIA_DocumentControlTypeId, UIA_EditControlTypeId, UIA_TextEditPatternId,
            UIA_ValuePatternId,
        };

        // Multithreaded apartment: this runs on a worker thread with no message
        // pump, which an STA client would need for its callbacks.
        let init = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        let result = (|| -> UiaProbe {
            let automation: IUIAutomation =
                match unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) } {
                    Ok(automation) => automation,
                    Err(_) => return UiaProbe::Unknown,
                };
            let Ok(element) = (unsafe { automation.GetFocusedElement() }) else {
                return UiaProbe::Unknown;
            };

            if let Ok(value) = unsafe {
                element.GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
            } {
                if let Ok(read_only) = unsafe { value.CurrentIsReadOnly() } {
                    return if read_only.as_bool() {
                        UiaProbe::ReadOnly
                    } else {
                        UiaProbe::Writable
                    };
                }
            }

            // Only controls that actually edit text raise this pattern, so its
            // mere presence is the answer. This is the `contenteditable` case:
            // the Slack / Discord / Notion composers expose no value pattern.
            if unsafe {
                element.GetCurrentPatternAs::<IUIAutomationTextEditPattern>(UIA_TextEditPatternId)
            }
            .is_ok()
            {
                return UiaProbe::Writable;
            }

            match unsafe { element.CurrentControlType() } {
                // An edit control that reached this far exposed no pattern at
                // all, but its whole control type says what it is for.
                Ok(control_type) if control_type == UIA_EditControlTypeId => UiaProbe::Writable,
                // A document with nothing writable on it — a rendered page, a
                // PDF view, a chat transcript.
                Ok(control_type) if control_type == UIA_DocumentControlTypeId => UiaProbe::ReadOnly,
                _ => UiaProbe::Unknown,
            }
        })();
        if init.is_ok() {
            unsafe { CoUninitialize() };
        }
        result
    }

    /// Work area (screen minus taskbar) of the monitor holding `x, y`.
    pub fn work_area_at(x: i32, y: i32) -> Option<Rect> {
        let monitor = unsafe { MonitorFromPoint(POINT { x, y }, MONITOR_DEFAULTTONEAREST) };
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !unsafe { GetMonitorInfoW(monitor, &mut info) }.as_bool() {
            return None;
        }
        let work = info.rcWork;
        Some(Rect {
            x: work.left,
            y: work.top,
            width: work.right - work.left,
            height: work.bottom - work.top,
        })
    }
}

#[cfg(not(windows))]
mod imp {
    use super::*;

    pub fn foreground_window(_own_hwnds: &[isize]) -> Option<isize> {
        None
    }
    pub fn is_window(_raw: isize) -> bool {
        false
    }
    pub fn focus_window(_raw: isize) {}
    pub fn wait_for_modifier_release() {}
    pub fn copy_selection() -> Option<String> {
        None
    }
    pub fn paste() -> Result<(), String> {
        Err("Quick actions are only supported on Windows".into())
    }
    pub fn caret_anchor(_raw: isize) -> Option<Anchor> {
        None
    }
    pub fn cursor_anchor() -> Option<Anchor> {
        None
    }
    pub fn work_area_at(_x: i32, _y: i32) -> Option<Rect> {
        None
    }
    pub fn window_probe(_raw: isize) -> WindowProbe {
        WindowProbe::Unknown
    }
    pub fn uia_probe() -> UiaProbe {
        UiaProbe::Unknown
    }
}

pub use imp::*;
