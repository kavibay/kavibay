//! Main-webview snapshots for sharing a widget, including its sandboxed frame.
//! Only the host calls this command; it is deliberately absent from both SDK bridges.

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(windows)]
mod windows;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Deserialize;
use tokio::sync::oneshot;

type CaptureReply = Arc<Mutex<Option<oneshot::Sender<Result<Vec<u8>, String>>>>>;

/// DOM bounds are CSS pixels; the snapshot supplies its own physical scale.
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureRegion {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    viewport_width: f64,
    viewport_height: f64,
}

impl CaptureRegion {
    fn validate(&self) -> Result<(), String> {
        if ![
            self.x,
            self.y,
            self.width,
            self.height,
            self.viewport_width,
            self.viewport_height,
        ]
        .iter()
        .all(|value| value.is_finite())
            || self.x < 0.0
            || self.y < 0.0
            || self.width <= 0.0
            || self.height <= 0.0
            || self.viewport_width <= 0.0
            || self.viewport_height <= 0.0
            || self.x + self.width > self.viewport_width
            || self.y + self.height > self.viewport_height
        {
            return Err("The preview must be fully visible before copying.".into());
        }
        Ok(())
    }

    fn pixels(&self, width: u32, height: u32) -> Result<(u32, u32, u32, u32), String> {
        self.validate()?;
        if width == 0 || height == 0 {
            return Err("The preview snapshot is empty.".into());
        }
        let sx = f64::from(width) / self.viewport_width;
        let sy = f64::from(height) / self.viewport_height;
        let left = (self.x * sx).floor() as u32;
        let top = (self.y * sy).floor() as u32;
        let right = ((self.x + self.width) * sx).ceil().min(f64::from(width)) as u32;
        let bottom = ((self.y + self.height) * sy).ceil().min(f64::from(height)) as u32;
        Ok((left, top, right - left, bottom - top))
    }
}

/// Complete once, whether the native API fails immediately or calls back later.
fn finish(reply: &CaptureReply, result: Result<Vec<u8>, String>) {
    if let Some(sender) = reply
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .take()
    {
        let _ = sender.send(result);
    }
}

/// Capture only Kavibay's webview, crop the card and put its pixels on the clipboard.
#[tauri::command]
pub async fn copy_preview_image(
    window: tauri::WebviewWindow,
    region: CaptureRegion,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Preview capture is only available in the main window.".into());
    }
    region.validate()?;
    let (sender, receiver) = oneshot::channel();
    let reply = Arc::new(Mutex::new(Some(sender)));
    window
        .with_webview(move |webview| {
            #[cfg(target_os = "macos")]
            macos::capture(webview, reply);
            #[cfg(windows)]
            windows::capture(webview, reply);
            #[cfg(target_os = "linux")]
            linux::capture(webview, reply);
            #[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
            {
                let _ = webview;
                finish(
                    &reply,
                    Err("Preview capture is not available on this platform.".into()),
                );
            }
        })
        .map_err(|error| format!("Could not capture the preview: {error}"))?;

    let png = tokio::time::timeout(Duration::from_secs(15), receiver)
        .await
        .map_err(|_| "Preview capture timed out. Please try again.".to_string())?
        .map_err(|_| "The preview closed before capture finished.".to_string())??;
    tauri::async_runtime::spawn_blocking(move || copy_cropped_image(&png, region))
        .await
        .map_err(|error| format!("Could not copy the preview: {error}"))?
}

fn crop_image(png: &[u8], region: CaptureRegion) -> Result<image::RgbaImage, String> {
    let image = image::load_from_memory_with_format(png, image::ImageFormat::Png)
        .map_err(|error| format!("Could not read the preview snapshot: {error}"))?;
    let (x, y, width, height) = region.pixels(image.width(), image.height())?;
    Ok(image.crop_imm(x, y, width, height).into_rgba8())
}

fn copy_cropped_image(png: &[u8], region: CaptureRegion) -> Result<(), String> {
    let image = crop_image(png, region)?;
    let mut clipboard = arboard::Clipboard::new()
        .map_err(|error| format!("Could not open the clipboard: {error}"))?;
    // Clipboard managers can briefly own the Windows clipboard while reading it.
    for attempt in 0..3 {
        let result = clipboard.set_image(arboard::ImageData {
            width: image.width() as usize,
            height: image.height() as usize,
            bytes: std::borrow::Cow::Borrowed(image.as_raw()),
        });
        match result {
            Ok(()) => return Ok(()),
            Err(error) if attempt == 2 => {
                return Err(format!("Could not copy the preview image: {error}"))
            }
            Err(_) => std::thread::sleep(Duration::from_millis(50)),
        }
    }
    unreachable!()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn region() -> CaptureRegion {
        CaptureRegion {
            x: 10.0,
            y: 20.0,
            width: 30.0,
            height: 40.0,
            viewport_width: 100.0,
            viewport_height: 100.0,
        }
    }

    #[test]
    fn maps_css_bounds_to_snapshot_pixels() {
        assert_eq!(region().pixels(200, 200).unwrap(), (20, 40, 60, 80));
        assert_eq!(region().pixels(150, 150).unwrap(), (15, 30, 45, 60));
    }

    #[test]
    fn includes_partial_edge_pixels() {
        let region = CaptureRegion {
            x: 10.25,
            width: 30.5,
            ..region()
        };
        assert_eq!(region.pixels(150, 150).unwrap(), (15, 30, 47, 60));
    }

    #[test]
    fn rejects_invalid_or_clipped_regions() {
        for invalid in [
            CaptureRegion {
                x: -1.0,
                ..region()
            },
            CaptureRegion {
                y: f64::NAN,
                ..region()
            },
            CaptureRegion {
                width: f64::INFINITY,
                ..region()
            },
            CaptureRegion {
                height: 0.0,
                ..region()
            },
            CaptureRegion {
                viewport_width: 0.0,
                ..region()
            },
            CaptureRegion {
                x: 90.0,
                ..region()
            },
            CaptureRegion {
                y: 90.0,
                ..region()
            },
        ] {
            assert!(invalid.validate().is_err(), "{invalid:?}");
        }
        assert!(region().pixels(0, 100).is_err());
    }

    #[test]
    fn crops_actual_pixels_without_surrounding_ui() {
        let mut source = image::RgbaImage::from_pixel(200, 200, image::Rgba([255, 0, 0, 255]));
        for y in 40..120 {
            for x in 20..80 {
                source.put_pixel(x, y, image::Rgba([0, 200, 0, 255]));
            }
        }
        let mut png = std::io::Cursor::new(Vec::new());
        source.write_to(&mut png, image::ImageFormat::Png).unwrap();
        let cropped = crop_image(png.get_ref(), region()).unwrap();
        assert_eq!(cropped.dimensions(), (60, 80));
        assert!(cropped.pixels().all(|pixel| pixel.0 == [0, 200, 0, 255]));
    }
}
