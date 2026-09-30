//! macOS half of quick actions, the `imp` that `platform.rs` picks.
//!
//! The Accessibility API answers most of what Windows needs a clipboard
//! round-trip and UI Automation for: the focused element's `AXSelectedText` is
//! the selection, `AXBoundsForRange` is where it sits, and its role says
//! whether a paste can land there. An app that exposes no selected text falls
//! back to a synthesised Cmd+C, the Windows way. The answer goes back with a
//! synthesised Cmd+V.
//!
//! Reading another app's UI and posting keystrokes both need the Accessibility
//! permission. `access` asks for it the first time the shortcut is pressed
//! without it, through the system's own dialog, which also lists Kavibay in
//! System Settings so the user only has to switch it on.
//!
//! The "window" handed around is the process id of the frontmost app: macOS
//! activates apps, and the app brings its own key window back with it.
//!
//! macOS reports points from the top-left of the main display, while Tauri
//! places windows in physical pixels, so each point is scaled by the display it
//! lies on.

use std::ffi::c_void;
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use core_foundation::base::{CFType, CFTypeRef, TCFType};
use core_foundation::boolean::CFBoolean;
use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
use core_foundation::string::{CFString, CFStringRef};
use objc2::rc::Retained;
use objc2::MainThreadMarker;
use objc2_app_kit::{
    NSApplicationActivationOptions, NSPasteboard, NSRunningApplication, NSScreen, NSWorkspace,
};
use objc2_core_foundation::{CGPoint, CGRect};
use objc2_core_graphics::{
    CGDirectDisplayID, CGDisplayCopyDisplayMode, CGDisplayMode, CGEvent, CGEventFlags,
    CGEventSource, CGEventSourceStateID, CGEventTapLocation, CGGetDisplaysWithPoint,
    CGPreflightPostEventAccess, CGRequestPostEventAccess,
};

use super::{Access, Anchor, Rect, UiaProbe, WindowProbe};

/// How long we wait for the target application to answer our Cmd+C.
const COPY_TIMEOUT: Duration = Duration::from_millis(500);
const COPY_POLL: Duration = Duration::from_millis(20);
/// How long we wait for the user to let go of the shortcut before typing.
const MODIFIER_TIMEOUT: Duration = Duration::from_millis(800);
const MODIFIER_POLL: Duration = Duration::from_millis(10);
/// Activating an app is asynchronous; the paste waits for it up to this long.
const ACTIVATE_TIMEOUT: Duration = Duration::from_millis(500);
const ACTIVATE_POLL: Duration = Duration::from_millis(10);
/// Longest one Accessibility query may block on an app that does not answer.
/// The default is six seconds, which the popup would spend invisible.
const AX_TIMEOUT_SECONDS: f32 = 0.5;

// Carbon virtual key codes `kVK_ANSI_C` and `kVK_ANSI_V`.
const KEY_C: u16 = 0x08;
const KEY_V: u16 = 0x09;

const ACCESSIBILITY_SETTINGS: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";

/// Set once the system dialog has been shown; later presses explain in the popup.
static ASKED: AtomicBool = AtomicBool::new(false);

pub fn access() -> Access {
    // SAFETY: argument-free queries of this process's own permission.
    let reads = unsafe { ffi::AXIsProcessTrusted() } != 0;
    let types = CGPreflightPostEventAccess();
    if reads && types {
        return Access::Granted;
    }
    if ASKED.swap(true, Ordering::Relaxed) {
        return Access::Missing;
    }
    if reads {
        CGRequestPostEventAccess();
    } else {
        // SAFETY: an immutable framework constant.
        let prompt = unsafe { CFString::wrap_under_get_rule(ffi::kAXTrustedCheckOptionPrompt) };
        let options = CFDictionary::from_CFType_pairs(&[(prompt, CFBoolean::true_value())]);
        // SAFETY: a valid dictionary that outlives the call.
        unsafe { ffi::AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef()) };
    }
    Access::Requested
}

pub fn open_access_settings() {
    if let Err(error) = std::process::Command::new("/usr/bin/open")
        .arg(ACCESSIBILITY_SETTINGS)
        .spawn()
    {
        eprintln!("[quick_action] could not open Accessibility settings: {error}");
    }
}

/// The app with keyboard focus, unless it is Kavibay itself.
pub fn foreground_window(_own_windows: &[isize]) -> Option<isize> {
    let pid = frontmost_pid()?;
    (pid != std::process::id() as i32).then_some(pid as isize)
}

pub fn is_window(raw: isize) -> bool {
    running_app(raw).is_some_and(|app| !app.isTerminated())
}

/// Bring the app back and wait until it is actually in front, so the paste
/// that follows does not land in Kavibay.
pub fn focus_window(raw: isize) {
    let Some(app) = running_app(raw) else {
        return;
    };
    app.activateWithOptions(NSApplicationActivationOptions::empty());
    let deadline = Instant::now() + ACTIVATE_TIMEOUT;
    while Instant::now() < deadline && frontmost_pid() != Some(raw as i32) {
        std::thread::sleep(ACTIVATE_POLL);
    }
}

/// Wait until Control, Shift, Option and Command are up. A Cmd+C sent while
/// the shortcut is still held reaches the app as Ctrl+Shift+Cmd+C.
pub fn wait_for_modifier_release() {
    let held = CGEventFlags::MaskControl
        | CGEventFlags::MaskShift
        | CGEventFlags::MaskAlternate
        | CGEventFlags::MaskCommand;
    let deadline = Instant::now() + MODIFIER_TIMEOUT;
    while Instant::now() < deadline {
        if !CGEventSource::flags_state(CGEventSourceStateID::CombinedSessionState).intersects(held)
        {
            return;
        }
        std::thread::sleep(MODIFIER_POLL);
    }
}

/// The focused element's selected text, or what a Cmd+C puts on the pasteboard.
///
/// The change count is the signal for the fallback, as the sequence number is
/// on Windows: it stays put when nothing was selected.
pub fn copy_selection() -> Option<String> {
    let exposed = focused_element()
        .and_then(|element| string_attribute(&element, "AXSelectedText"))
        .filter(|text| !text.is_empty());
    if exposed.is_some() {
        return exposed;
    }

    let pasteboard = NSPasteboard::generalPasteboard();
    let before = pasteboard.changeCount();
    send_command_key(KEY_C).ok()?;
    let deadline = Instant::now() + COPY_TIMEOUT;
    while Instant::now() < deadline {
        std::thread::sleep(COPY_POLL);
        if pasteboard.changeCount() != before {
            return crate::extensions::clipboard_widget::system::clipboard_text();
        }
    }
    None
}

pub fn paste() -> Result<(), String> {
    send_command_key(KEY_V)
}

/// The selection's rectangle, where the app reports one.
pub fn caret_anchor(_raw: isize) -> Option<Anchor> {
    let element = focused_element()?;
    let range = attribute(&element, "AXSelectedTextRange")?;
    let bounds = parameterized_attribute(&element, "AXBoundsForRange", &range)?;
    let mut rect = CGRect::default();
    // SAFETY: `rect` is the CGRect the value type promises to fill.
    let filled = unsafe {
        ffi::AXValueGetValue(
            bounds.as_CFTypeRef(),
            ffi::AX_VALUE_CG_RECT,
            (&mut rect as *mut CGRect).cast::<c_void>(),
        )
    } != 0;
    // (0, 0) with no height is how many apps say "I do not know".
    if !filled || rect.size.height <= 0.0 || (rect.origin.x == 0.0 && rect.origin.y == 0.0) {
        return None;
    }
    Some(anchor_at(rect.origin, rect.size.height))
}

pub fn cursor_anchor() -> Option<Anchor> {
    let event = CGEvent::new(None)?;
    Some(anchor_at(CGEvent::location(Some(&event)), 0.0))
}

/// The visible frame (screen minus menu bar and Dock) of the display holding
/// `x, y`.
pub fn work_area_at(x: i32, y: i32) -> Option<Rect> {
    screen_at(x, y).map(|(_, work)| work)
}

/// The backing scale of the display holding `x, y`.
pub fn scale_at(x: i32, y: i32) -> Option<f64> {
    screen_at(x, y).map(|(scale, _)| scale)
}

/// Scale and visible frame of the display holding physical `x, y`. `NSScreen`
/// is main-thread only; `quick_action_ready` runs there (measured).
fn screen_at(x: i32, y: i32) -> Option<(f64, Rect)> {
    let mtm = MainThreadMarker::new()?;
    let screens = NSScreen::screens(mtm);
    // The first screen holds the menu bar and the origin of both systems.
    let main_height = screens.firstObject()?.frame().size.height;
    screens.iter().find_map(|screen| {
        let scale = screen.backingScaleFactor();
        let physical = |frame: CGRect| Rect {
            x: (frame.origin.x * scale).round() as i32,
            y: ((main_height - frame.origin.y - frame.size.height) * scale).round() as i32,
            width: (frame.size.width * scale).round() as i32,
            height: (frame.size.height * scale).round() as i32,
        };
        let full = physical(screen.frame());
        let inside = x >= full.x && x < full.right() && y >= full.y && y < full.bottom();
        inside.then(|| (scale, physical(screen.visibleFrame())))
    })
}

/// Stage 1 of the editable check, see `editability`: a text role, or a
/// selection the app lets us write, means the paste lands in a text field.
pub fn window_probe(_raw: isize) -> WindowProbe {
    let Some(element) = focused_element() else {
        return WindowProbe::Unknown;
    };
    let text_role = matches!(
        string_attribute(&element, "AXRole").as_deref(),
        Some("AXTextField" | "AXTextArea" | "AXComboBox")
    );
    if text_role || is_settable(&element, "AXSelectedText") {
        WindowProbe::HasCaret
    } else {
        WindowProbe::Unknown
    }
}

/// UI Automation is Windows only; stage 1 above already asked everything.
pub fn uia_probe() -> UiaProbe {
    UiaProbe::Unknown
}

fn frontmost_pid() -> Option<i32> {
    let focused_app = attribute(&system_wide(), "AXFocusedApplication").and_then(|app| {
        let mut pid = 0;
        // SAFETY: `app` is a live AXUIElement and `pid` a valid out-parameter.
        let error = unsafe { ffi::AXUIElementGetPid(app.as_CFTypeRef(), &mut pid) };
        (error == ffi::AX_SUCCESS).then_some(pid)
    });
    // Without the permission the Accessibility API answers nothing. Workspace
    // still knows the frontmost app, which is all the popup needs to hand focus back.
    focused_app.or_else(|| {
        NSWorkspace::sharedWorkspace()
            .frontmostApplication()
            .map(|app| app.processIdentifier())
    })
}

fn running_app(raw: isize) -> Option<Retained<NSRunningApplication>> {
    NSRunningApplication::runningApplicationWithProcessIdentifier(i32::try_from(raw).ok()?)
}

fn send_command_key(key: u16) -> Result<(), String> {
    let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState);
    for down in [true, false] {
        let event = CGEvent::new_keyboard_event(source.as_deref(), key, down)
            .ok_or_else(|| "could not synthesise a keystroke".to_string())?;
        CGEvent::set_flags(Some(&event), CGEventFlags::MaskCommand);
        CGEvent::post(CGEventTapLocation::HIDEventTap, Some(&event));
    }
    Ok(())
}

/// Points to physical pixels, by the scale of the display the point lies on.
fn anchor_at(point: CGPoint, height: f64) -> Anchor {
    let scale = display_scale(point);
    Anchor {
        x: (point.x * scale).round() as i32,
        y: (point.y * scale).round() as i32,
        height: (height * scale).round() as i32,
    }
}

/// Backing scale of the display holding `point`, from CoreGraphics because
/// `NSScreen` may not be touched off the main thread.
fn display_scale(point: CGPoint) -> f64 {
    let mut display: CGDirectDisplayID = 0;
    let mut count = 0;
    // SAFETY: room for exactly the one display asked for.
    unsafe { CGGetDisplaysWithPoint(point, 1, &mut display, &mut count) };
    if count == 0 {
        return 1.0;
    }
    let Some(mode) = CGDisplayCopyDisplayMode(display) else {
        return 1.0;
    };
    let points = CGDisplayMode::width(Some(&mode));
    let pixels = CGDisplayMode::pixel_width(Some(&mode));
    if points == 0 {
        1.0
    } else {
        pixels as f64 / points as f64
    }
}

fn system_wide() -> CFType {
    // SAFETY: returns a +1 reference, which `wrap_under_create_rule` takes over.
    // Setting the timeout on the system-wide element sets it for every element.
    unsafe {
        let element = ffi::AXUIElementCreateSystemWide();
        ffi::AXUIElementSetMessagingTimeout(element, AX_TIMEOUT_SECONDS);
        CFType::wrap_under_create_rule(element)
    }
}

fn focused_element() -> Option<CFType> {
    attribute(&system_wide(), "AXFocusedUIElement")
}

fn attribute(element: &CFType, name: &str) -> Option<CFType> {
    let name = CFString::new(name);
    let mut value: CFTypeRef = ptr::null();
    // SAFETY: a live element, a valid attribute name and out-parameter.
    let error = unsafe {
        ffi::AXUIElementCopyAttributeValue(
            element.as_CFTypeRef(),
            name.as_concrete_TypeRef(),
            &mut value,
        )
    };
    // SAFETY: on success the value is a +1 reference we now own.
    (error == ffi::AX_SUCCESS && !value.is_null())
        .then(|| unsafe { CFType::wrap_under_create_rule(value) })
}

fn parameterized_attribute(element: &CFType, name: &str, parameter: &CFType) -> Option<CFType> {
    let name = CFString::new(name);
    let mut value: CFTypeRef = ptr::null();
    // SAFETY: as in `attribute`, with a live parameter value.
    let error = unsafe {
        ffi::AXUIElementCopyParameterizedAttributeValue(
            element.as_CFTypeRef(),
            name.as_concrete_TypeRef(),
            parameter.as_CFTypeRef(),
            &mut value,
        )
    };
    // SAFETY: on success the value is a +1 reference we now own.
    (error == ffi::AX_SUCCESS && !value.is_null())
        .then(|| unsafe { CFType::wrap_under_create_rule(value) })
}

fn string_attribute(element: &CFType, name: &str) -> Option<String> {
    attribute(element, name)?
        .downcast::<CFString>()
        .map(|value| value.to_string())
}

fn is_settable(element: &CFType, name: &str) -> bool {
    let name = CFString::new(name);
    let mut settable = 0;
    // SAFETY: a live element, a valid attribute name and out-parameter.
    let error = unsafe {
        ffi::AXUIElementIsAttributeSettable(
            element.as_CFTypeRef(),
            name.as_concrete_TypeRef(),
            &mut settable,
        )
    };
    error == ffi::AX_SUCCESS && settable != 0
}

/// The few ApplicationServices calls this needs, declared by hand: no crate in
/// the tree binds the Accessibility API.
mod ffi {
    use super::{c_void, CFDictionaryRef, CFStringRef, CFTypeRef};

    pub const AX_SUCCESS: i32 = 0;
    /// `kAXValueTypeCGRect`.
    pub const AX_VALUE_CG_RECT: u32 = 3;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        pub static kAXTrustedCheckOptionPrompt: CFStringRef;
        pub fn AXIsProcessTrusted() -> u8;
        pub fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> u8;
        pub fn AXUIElementCreateSystemWide() -> CFTypeRef;
        pub fn AXUIElementSetMessagingTimeout(element: CFTypeRef, seconds: f32) -> i32;
        pub fn AXUIElementCopyAttributeValue(
            element: CFTypeRef,
            attribute: CFStringRef,
            value: *mut CFTypeRef,
        ) -> i32;
        pub fn AXUIElementCopyParameterizedAttributeValue(
            element: CFTypeRef,
            attribute: CFStringRef,
            parameter: CFTypeRef,
            value: *mut CFTypeRef,
        ) -> i32;
        pub fn AXUIElementIsAttributeSettable(
            element: CFTypeRef,
            attribute: CFStringRef,
            settable: *mut u8,
        ) -> i32;
        pub fn AXUIElementGetPid(element: CFTypeRef, pid: *mut i32) -> i32;
        pub fn AXValueGetValue(value: CFTypeRef, value_type: u32, value_ptr: *mut c_void) -> u8;
    }
}
