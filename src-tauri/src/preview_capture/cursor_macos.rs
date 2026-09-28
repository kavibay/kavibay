//! Read AppKit state on the main thread and send only pixels/coordinates to the worker.
use objc2_app_kit::{NSCursor, NSEvent};
use objc2_web_kit::WKWebView;

use super::{macos::image_png, CaptureRegion};

pub(super) struct CursorSnapshot {
    png: Vec<u8>,
    position: (f64, f64),
    hotspot: (f64, f64),
    size: (f64, f64),
    viewport: (f64, f64),
}

pub(super) async fn capture(
    window: &tauri::WebviewWindow,
) -> Result<Option<CursorSnapshot>, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    window
        .with_webview(move |webview| {
            let read = || unsafe {
                let view: &WKWebView = &*webview.inner().cast();
                let window = view.window().ok_or("The preview window closed.")?;
                let point = view.convertPoint_fromView(
                    window.convertPointFromScreen(NSEvent::mouseLocation()),
                    None,
                );
                let bounds = view.bounds();
                let position = (
                    point.x - bounds.origin.x,
                    if view.isFlipped() {
                        point.y - bounds.origin.y
                    } else {
                        bounds.size.height - (point.y - bounds.origin.y)
                    },
                );
                if position.0 < 0.0
                    || position.1 < 0.0
                    || position.0 >= bounds.size.width
                    || position.1 >= bounds.size.height
                {
                    return Ok(None);
                }
                let cursor = NSCursor::currentCursor();
                let image = cursor.image();
                let size = image.size();
                let hotspot = cursor.hotSpot();
                Ok(Some(CursorSnapshot {
                    png: image_png(&image)?,
                    position,
                    hotspot: (hotspot.x, hotspot.y),
                    size: (size.width, size.height),
                    viewport: (bounds.size.width, bounds.size.height),
                }))
            };
            let _ = sender.send(read());
        })
        .map_err(|e| e.to_string())?;
    tokio::time::timeout(std::time::Duration::from_millis(500), receiver)
        .await
        .map_err(|_| "Pointer capture timed out.".to_string())?
        .map_err(|_| "The preview window closed.".to_string())?
}

pub(super) fn composite(
    cursor: Option<&CursorSnapshot>,
    image: &mut image::RgbaImage,
    region: CaptureRegion,
) -> Result<(), String> {
    let Some(cursor) = cursor else {
        return Ok(());
    };
    let (width, height) = image.dimensions();
    let sx = f64::from(width) / (region.width * cursor.viewport.0 / region.viewport_width);
    let sy = f64::from(height) / (region.height * cursor.viewport.1 / region.viewport_height);
    let x = (cursor.position.0 - region.x * cursor.viewport.0 / region.viewport_width) * sx;
    let y = (cursor.position.1 - region.y * cursor.viewport.1 / region.viewport_height) * sy;
    if x < 0.0 || y < 0.0 || x >= f64::from(width) || y >= f64::from(height) {
        return Ok(());
    }
    let pixels = image::load_from_memory_with_format(&cursor.png, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?
        .into_rgba8();
    let pixels = image::imageops::resize(
        &pixels,
        (cursor.size.0 * sx).round().max(1.0) as u32,
        (cursor.size.1 * sy).round().max(1.0) as u32,
        image::imageops::FilterType::Triangle,
    );
    image::imageops::overlay(
        image,
        &pixels,
        (x - cursor.hotspot.0 * sx).round() as i64,
        (y - cursor.hotspot.1 * sy).round() as i64,
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retina_pointer_is_cropped_scaled_and_hidden_outside_preview() {
        let mut png = std::io::Cursor::new(Vec::new());
        image::RgbaImage::from_pixel(2, 2, image::Rgba([255, 0, 0, 255]))
            .write_to(&mut png, image::ImageFormat::Png)
            .unwrap();
        let mut cursor = CursorSnapshot {
            png: png.into_inner(),
            position: (25.0, 30.0),
            hotspot: (1.0, 1.0),
            size: (2.0, 2.0),
            viewport: (100.0, 100.0),
        };
        let region = CaptureRegion {
            x: 10.0,
            y: 20.0,
            width: 30.0,
            height: 40.0,
            viewport_width: 100.0,
            viewport_height: 100.0,
        };
        let mut target = image::RgbaImage::new(60, 80);
        composite(Some(&cursor), &mut target, region).unwrap();
        assert_eq!(target.get_pixel(28, 18).0, [255, 0, 0, 255]);
        assert_eq!(target.get_pixel(31, 21).0, [255, 0, 0, 255]);
        assert_eq!(target.get_pixel(27, 18).0, [0, 0, 0, 0]);
        let mut zoomed = image::RgbaImage::new(60, 80);
        let zoomed_region = CaptureRegion {
            x: 15.0,
            y: 30.0,
            width: 45.0,
            height: 60.0,
            viewport_width: 150.0,
            viewport_height: 150.0,
        };
        composite(Some(&cursor), &mut zoomed, zoomed_region).unwrap();
        assert_eq!(zoomed, target);
        cursor.position = (9.0, 30.0);
        let mut empty = image::RgbaImage::new(60, 80);
        composite(Some(&cursor), &mut empty, region).unwrap();
        assert!(empty.as_raw().iter().all(|v| *v == 0));
    }
}
