//! Draw the native cursor onto the captured pixels, never onto the widget DOM.
use std::mem::size_of;
use windows::Win32::{Graphics::Gdi::*, UI::WindowsAndMessaging::*};

use super::{recording::cursor_position, CaptureRegion};

pub(super) struct CursorSnapshot {
    icon: Icon,
    position: (i32, i32),
}

pub(super) fn capture() -> Result<Option<CursorSnapshot>, String> {
    let capture = || unsafe {
        let mut cursor = CURSORINFO {
            cbSize: size_of::<CURSORINFO>() as u32,
            ..Default::default()
        };
        GetCursorInfo(&mut cursor)?;
        if cursor.flags != CURSOR_SHOWING {
            return Ok(None);
        }
        Ok(Some(CursorSnapshot {
            icon: Icon(CopyIcon(HICON(cursor.hCursor.0))?),
            position: (cursor.ptScreenPos.x, cursor.ptScreenPos.y),
        }))
    };
    capture().map_err(|e: windows::core::Error| format!("Could not capture the pointer: {e}"))
}

pub(super) fn composite(
    cursor: Option<&CursorSnapshot>,
    image: &mut image::RgbaImage,
    snapshot: (u32, u32),
    origin: (i32, i32),
    window_size: (u32, u32),
    region: CaptureRegion,
) -> Result<(), String> {
    let Some(cursor) = cursor else {
        return Ok(());
    };
    unsafe { draw(cursor, image, snapshot, origin, window_size, region) }
        .map_err(|e| format!("Could not capture the pointer: {e}"))
}

struct Icon(HICON);
// CopyIcon gives this frame sole ownership. The handle is transferred to one
// worker and never used concurrently; Windows icons have no thread affinity.
unsafe impl Send for Icon {}
impl Drop for Icon {
    fn drop(&mut self) {
        unsafe {
            let _ = DestroyIcon(self.0);
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

unsafe fn draw(
    cursor: &CursorSnapshot,
    image: &mut image::RgbaImage,
    snapshot: (u32, u32),
    origin: (i32, i32),
    window_size: (u32, u32),
    region: CaptureRegion,
) -> windows::core::Result<()> {
    let Some((x, y)) = cursor_position(cursor.position, origin, window_size, snapshot, region)
    else {
        return Ok(());
    };
    let sx = f64::from(snapshot.0) / f64::from(window_size.0);
    let sy = f64::from(snapshot.1) / f64::from(window_size.1);
    let icon = &cursor.icon;
    let mut info = IconInfo(ICONINFO::default());
    GetIconInfo(icon.0, &mut info.0)?;
    let mut bitmap = BITMAP::default();
    let colored = !info.0.hbmColor.is_invalid();
    let handle = if colored {
        info.0.hbmColor
    } else {
        info.0.hbmMask
    };
    if GetObjectW(
        handle.into(),
        size_of::<BITMAP>() as i32,
        Some((&mut bitmap as *mut BITMAP).cast()),
    ) == 0
    {
        return Err(windows::core::Error::from_thread());
    }
    let dc = CreateCompatibleDC(None);
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
            biWidth: image.width() as i32,
            biHeight: -(image.height() as i32),
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
    let pixels = std::slice::from_raw_parts_mut(data.cast::<u8>(), image.as_raw().len());
    for (target, source) in pixels.as_chunks_mut::<4>().0.iter_mut().zip(image.pixels()) {
        target.copy_from_slice(&[source[2], source[1], source[0], 255]);
    }
    DrawIconEx(
        dc,
        (x - f64::from(info.0.xHotspot) * sx).round() as i32,
        (y - f64::from(info.0.yHotspot) * sy).round() as i32,
        icon.0,
        (f64::from(bitmap.bmWidth) * sx).round() as i32,
        (f64::from(if colored {
            bitmap.bmHeight
        } else {
            bitmap.bmHeight / 2
        }) * sy)
            .round() as i32,
        0,
        None,
        DI_NORMAL,
    )?;
    GdiFlush().ok()?;
    for (target, source) in image.pixels_mut().zip(pixels.as_chunks::<4>().0.iter()) {
        target.0 = [source[2], source[1], source[0], 255];
    }
    Ok(())
}
