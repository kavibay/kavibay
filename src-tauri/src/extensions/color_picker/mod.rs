//! Screen color pick session: poll cursor pixels and emit samples or outcomes.

use super::ExtensionRust;

/// The uniform entry point: which root folder this belongs to, and what the
/// host declares on its behalf. Empty lists are the statement, not an
/// omission — this extension reaches no network host through the host layer.
pub const EXTENSION: ExtensionRust = ExtensionRust {
    folder: "color-picker",
    capabilities: &[],
};

#[cfg(windows)]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(windows)]
use std::sync::{Arc, Mutex};
#[cfg(windows)]
use std::thread::JoinHandle;
#[cfg(windows)]
use std::time::Duration;

use serde::Serialize;
#[cfg(windows)]
use tauri::Manager;
use tauri::{AppHandle, Emitter, State};

use crate::commands::SharedClickThrough;

/// RGB value sampled from the pixel beneath the global cursor.
///
/// Only the native sampler builds these, and that is Windows-only so far.
#[cfg(windows)]
#[derive(Clone, Serialize)]
pub struct ColorSample {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

/// Coordinates the single active native color-picking worker.
///
/// Every field belongs to that worker, so off Windows this is an empty marker the
/// commands can still be handed — they answer "unsupported" without touching it.
pub struct ColorPickerSession {
    #[cfg(windows)]
    pub stop: Arc<AtomicBool>,
    #[cfg(windows)]
    worker: Mutex<Option<JoinHandle<()>>>,
    #[cfg(windows)]
    lifecycle: Mutex<()>,
}

impl Default for ColorPickerSession {
    /// Creates an idle picker session with no active worker.
    fn default() -> Self {
        Self {
            #[cfg(windows)]
            stop: Arc::new(AtomicBool::new(false)),
            #[cfg(windows)]
            worker: Mutex::new(None),
            #[cfg(windows)]
            lifecycle: Mutex::new(()),
        }
    }
}

#[cfg(windows)]
impl ColorPickerSession {
    /// Signals and waits for the active worker to exit without emitting an event.
    fn stop_worker(&self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(worker) = self.worker.lock().unwrap().take() {
            let _ = worker.join();
        }
    }
}

/// Stops picking and reports a user-initiated cancellation to the frontend.
#[tauri::command]
pub fn color_picker_stop(
    app: AppHandle,
    session: State<'_, ColorPickerSession>,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        let _lifecycle = session.lifecycle.lock().unwrap();
        session.stop_worker();
    }

    #[cfg(not(windows))]
    {
        let _ = &session;
    }

    let _ = app.emit("color-picker:cancelled", ());
    Ok(())
}

/// Starts a fresh Windows picker worker after fully stopping any previous session.
#[tauri::command]
pub fn color_picker_start(
    app: AppHandle,
    session: State<'_, ColorPickerSession>,
    click_through: State<'_, SharedClickThrough>,
) -> Result<(), String> {
    #[cfg(not(windows))]
    {
        let _ = (&app, &session, &click_through);
        return Err("Color picker is only supported on Windows".into());
    }

    #[cfg(windows)]
    {
        let _lifecycle = session.lifecycle.lock().unwrap();
        session.stop_worker();
        session.stop.store(false, Ordering::SeqCst);

        let stop = session.stop.clone();
        let handle = app.clone();
        let click_through = click_through.inner().clone();
        let worker = std::thread::spawn(move || pick_loop(handle, stop, click_through));
        *session.worker.lock().unwrap() = Some(worker);
        Ok(())
    }
}

#[cfg(windows)]
/// Unpack a Win32 `COLORREF` into an RGB sample.
fn color_sample_from_ref(color: windows::Win32::Foundation::COLORREF) -> Option<ColorSample> {
    use windows::Win32::Foundation::COLORREF;
    use windows::Win32::Graphics::Gdi::CLR_INVALID;

    if color == COLORREF(CLR_INVALID) {
        return None;
    }
    Some(ColorSample {
        r: (color.0 & 0xFF) as u8,
        g: ((color.0 >> 8) & 0xFF) as u8,
        b: ((color.0 >> 16) & 0xFF) as u8,
    })
}

#[cfg(windows)]
/// Read one pixel from an HWND client DC (cursor in screen coords).
unsafe fn sample_hwnd_pixel(
    hwnd: windows::Win32::Foundation::HWND,
    screen_pt: windows::Win32::Foundation::POINT,
) -> Option<ColorSample> {
    use windows::Win32::Graphics::Gdi::{GetDC, GetPixel, ReleaseDC, ScreenToClient};

    if hwnd.is_invalid() {
        return None;
    }
    let mut client = screen_pt;
    if !ScreenToClient(hwnd, &mut client).as_bool() {
        return None;
    }
    let hdc = GetDC(Some(hwnd));
    if hdc.is_invalid() {
        return None;
    }
    let color = GetPixel(hdc, client.x, client.y);
    let _ = ReleaseDC(Some(hwnd), hdc);
    color_sample_from_ref(color)
}

#[cfg(windows)]
/// BitBlt 1×1 without CAPTUREBLT — usually skips layered overlay windows.
unsafe fn sample_bitblt_pixel(screen_pt: windows::Win32::Foundation::POINT) -> Option<ColorSample> {
    use windows::Win32::Foundation::COLORREF;
    use windows::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
        GetPixel, ReleaseDC, SelectObject, CLR_INVALID, SRCCOPY,
    };

    let screen = GetDC(None);
    if screen.is_invalid() {
        return None;
    }
    let mem = CreateCompatibleDC(Some(screen));
    if mem.is_invalid() {
        let _ = ReleaseDC(None, screen);
        return None;
    }
    let bmp = CreateCompatibleBitmap(screen, 1, 1);
    if bmp.is_invalid() {
        let _ = DeleteDC(mem);
        let _ = ReleaseDC(None, screen);
        return None;
    }

    let bmp_obj = bmp.into();
    let old = SelectObject(mem, bmp_obj);
    let blit_ok = BitBlt(
        mem,
        0,
        0,
        1,
        1,
        Some(screen),
        screen_pt.x,
        screen_pt.y,
        SRCCOPY,
    )
    .is_ok();
    let color = if blit_ok {
        GetPixel(mem, 0, 0)
    } else {
        COLORREF(CLR_INVALID)
    };
    let _ = SelectObject(mem, old);
    let _ = DeleteObject(bmp_obj);
    let _ = DeleteDC(mem);
    let _ = ReleaseDC(None, screen);
    color_sample_from_ref(color)
}

#[cfg(windows)]
/// Sample under the cursor without hiding Kavibay (no flicker).
///
/// Prefer the top HWND under the cursor (click-through skips our WS_EX_TRANSPARENT
/// window). Fall back to BitBlt without CAPTUREBLT.
fn sample_pixel_at_cursor(our_hwnd: windows::Win32::Foundation::HWND) -> Option<ColorSample> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::{GetCursorPos, WindowFromPoint};

    unsafe {
        let mut cursor = POINT::default();
        if GetCursorPos(&mut cursor).is_err() {
            return None;
        }

        let hwnd = WindowFromPoint(cursor);
        if !hwnd.is_invalid() && hwnd != our_hwnd {
            if let Some(sample) = sample_hwnd_pixel(hwnd, cursor) {
                return Some(sample);
            }
        }

        sample_bitblt_pixel(cursor)
    }
}

#[cfg(windows)]
/// True when the cursor is over a real widget/palette rect (not a fullscreen catcher).
fn cursor_over_widget_ui(
    window: &tauri::WebviewWindow,
    click_through: &SharedClickThrough,
) -> bool {
    match (
        window.cursor_position(),
        window.outer_position(),
        window.outer_size(),
        window.scale_factor(),
    ) {
        (Ok(cursor), Ok(origin), Ok(size), Ok(scale)) => {
            let px = (cursor.x - origin.x as f64) / scale;
            let py = (cursor.y - origin.y as f64) / scale;
            let win_area = (size.width as f64 / scale) * (size.height as f64 / scale);
            let rects = click_through.lock().unwrap().rects.clone();
            rects.iter().any(|rect| {
                let area = rect.w * rect.h;
                area < win_area * 0.5 && rect.contains(px, py)
            })
        }
        // Don't block live samples; just refuse confirm this tick.
        _ => true,
    }
}

#[cfg(windows)]
/// Polls global input and desktop pixels until it is stopped or picks/cancels.
fn pick_loop(app: AppHandle, stop: Arc<AtomicBool>, click_through: SharedClickThrough) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_ESCAPE, VK_LBUTTON};

    let mut prev_lmb = false;
    let mut prev_esc = unsafe { GetAsyncKeyState(VK_ESCAPE.0 as i32) as u16 & 0x8000 != 0 };
    let mut last_good: Option<ColorSample> = None;

    // Wait for the Pick button's mouse press to end before accepting a new click.
    while unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) as u16 & 0x8000 != 0 } {
        if stop.load(Ordering::SeqCst) {
            return;
        }
        std::thread::sleep(Duration::from_millis(16));
    }

    while !stop.load(Ordering::SeqCst) {
        std::thread::sleep(Duration::from_millis(33));
        if stop.load(Ordering::SeqCst) {
            break;
        }

        let Some(window) = app.get_webview_window("main") else {
            continue;
        };

        let our_hwnd = match window.hwnd() {
            Ok(h) => HWND(h.0),
            Err(_) => continue,
        };

        let over_ui = cursor_over_widget_ui(&window, &click_through);
        let sample = sample_pixel_at_cursor(our_hwnd);
        if let Some(s) = sample.clone() {
            last_good = Some(s.clone());
            // Always push live previews — over_ui only gates confirm.
            let _ = window.emit("color-picker:sample", &s);
        }

        let lmb = unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) as u16 & 0x8000 != 0 };
        let esc = unsafe { GetAsyncKeyState(VK_ESCAPE.0 as i32) as u16 & 0x8000 != 0 };

        if esc && !prev_esc {
            stop.store(true, Ordering::SeqCst);
            let _ = window.emit("color-picker:cancelled", ());
            break;
        }
        if lmb && !prev_lmb && !over_ui {
            stop.store(true, Ordering::SeqCst);
            if let Some(s) = sample.or(last_good) {
                let _ = window.emit("color-picker:picked", &s);
            } else {
                let _ = window.emit("color-picker:cancelled", ());
            }
            break;
        }

        prev_lmb = lmb;
        prev_esc = esc;
    }
}
