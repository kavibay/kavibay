//! Windows recording frames: the preview's rectangle copied from the screen,
//! the pointer drawn in. Chromium's capture of a whole 4K window took about
//! 200 ms a frame, plus decoding a 4K image; this copy takes about 17 ms.
//! Whatever covers the preview on screen, a notification say, is recorded too.
use std::mem::size_of;
use windows::Win32::{Graphics::Gdi::*, UI::WindowsAndMessaging::*};

/// The screen rectangle at `(x, y)`, in physical pixels.
pub(super) fn grab(x: i32, y: i32, width: u32, height: u32) -> Result<image::RgbaImage, String> {
    unsafe { copy(x, y, width, height) }.map_err(|e| format!("Could not capture the preview: {e}"))
}

struct ScreenDc(HDC);
impl Drop for ScreenDc {
    fn drop(&mut self) {
        unsafe {
            ReleaseDC(None, self.0);
        }
    }
}
struct IconInfo(ICONINFO);
impl Drop for IconInfo {
    fn drop(&mut self) {
        unsafe {
            if !self.0.hbmColor.is_invalid() {
                let _ = DeleteObject(self.0.hbmColor.into());
            }
            if !self.0.hbmMask.is_invalid() {
                let _ = DeleteObject(self.0.hbmMask.into());
            }
        }
    }
}
struct Surface {
    dc: HDC,
    bitmap: HBITMAP,
    previous: HGDIOBJ,
}
impl Drop for Surface {
    fn drop(&mut self) {
        unsafe {
            if !self.previous.is_invalid() {
                SelectObject(self.dc, self.previous);
            }
            if !self.bitmap.is_invalid() {
                let _ = DeleteObject(self.bitmap.into());
            }
            let _ = DeleteDC(self.dc);
        }
    }
}

unsafe fn copy(x: i32, y: i32, width: u32, height: u32) -> windows::core::Result<image::RgbaImage> {
    let screen = ScreenDc(GetDC(None));
    if screen.0.is_invalid() {
        return Err(windows::core::Error::from_thread());
    }
    let dc = CreateCompatibleDC(Some(screen.0));
    if dc.is_invalid() {
        return Err(windows::core::Error::from_thread());
    }
    let mut surface = Surface {
        dc,
        bitmap: HBITMAP::default(),
        previous: HGDIOBJ::default(),
    };
    let header = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width as i32,
            biHeight: -(height as i32),
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut data = std::ptr::null_mut();
    surface.bitmap = CreateDIBSection(Some(dc), &header, DIB_RGB_COLORS, &mut data, None, 0)?;
    surface.previous = SelectObject(dc, surface.bitmap.into());
    // No CAPTUREBLT: Kavibay's window is composited, not layered, and the
    // flag makes the pointer flicker while it copies.
    BitBlt(
        dc,
        0,
        0,
        width as i32,
        height as i32,
        Some(screen.0),
        x,
        y,
        SRCCOPY,
    )?;
    draw_pointer(dc, (x, y))?;
    GdiFlush().ok()?;
    let pixels = std::slice::from_raw_parts(data.cast::<u8>(), (width * height * 4) as usize);
    let mut image = image::RgbaImage::new(width, height);
    for (target, source) in image.pixels_mut().zip(pixels.as_chunks::<4>().0) {
        target.0 = [source[2], source[1], source[0], 255];
    }
    Ok(image)
}

/// The pointer at the size the screen shows it; `origin` is the copied
/// rectangle's top-left on screen.
unsafe fn draw_pointer(dc: HDC, origin: (i32, i32)) -> windows::core::Result<()> {
    let mut cursor = CURSORINFO {
        cbSize: size_of::<CURSORINFO>() as u32,
        ..Default::default()
    };
    GetCursorInfo(&mut cursor)?;
    if cursor.flags != CURSOR_SHOWING {
        return Ok(());
    }
    let icon = HICON(cursor.hCursor.0);
    let mut info = IconInfo(ICONINFO::default());
    GetIconInfo(icon, &mut info.0)?;
    DrawIconEx(
        dc,
        cursor.ptScreenPos.x - origin.0 - info.0.xHotspot as i32,
        cursor.ptScreenPos.y - origin.1 - info.0.yHotspot as i32,
        icon,
        0,
        0,
        0,
        None,
        DI_NORMAL,
    )
}
