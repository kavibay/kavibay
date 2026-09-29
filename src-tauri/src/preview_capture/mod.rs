//! Main-webview snapshots for sharing a widget, including its sandboxed frame.
//! Only the host calls these commands; they are deliberately absent from both SDK bridges.

mod artifacts;
#[cfg(windows)]
mod cursor_windows;
#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(windows)]
mod media_foundation;
mod recording_commands;
mod recording_session;
#[cfg(windows)]
mod video_windows;
#[cfg(windows)]
mod windows;
pub use recording_commands::*;
#[cfg(target_os = "macos")]
mod cursor_macos;
#[cfg(any(windows, target_os = "macos", test))]
mod recording;
#[cfg(any(windows, target_os = "macos"))]
mod recording_pipeline;
#[cfg(target_os = "macos")]
mod video_macos;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Deserialize;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use tokio::sync::oneshot;

type CaptureReply = Arc<Mutex<Option<oneshot::Sender<Result<Vec<u8>, String>>>>>;
static CAPTURE_PENDING: AtomicBool = AtomicBool::new(false);

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
        CAPTURE_PENDING.store(false, Ordering::Release);
        let _ = sender.send(result);
    }
}

/// Capture once; the host retains this PNG for both Save and Copy.
#[tauri::command]
pub async fn capture_preview_image(
    window: tauri::WebviewWindow,
    region: CaptureRegion,
) -> Result<Response, String> {
    if window.label() != "main" {
        return Err("Preview capture is only available in the main window.".into());
    }
    region.validate()?;
    let png = capture_snapshot(&window, Duration::from_secs(15), None).await?;
    tauri::async_runtime::spawn_blocking(move || {
        let image = crop_image(&png, region)?;
        let mut output = std::io::Cursor::new(Vec::new());
        image
            .write_to(&mut output, image::ImageFormat::Png)
            .map_err(|e| e.to_string())?;
        Ok(Response::new(output.into_inner()))
    })
    .await
    .map_err(|error| format!("Could not capture the preview: {error}"))?
}

fn screenshot_bytes(
    window: &tauri::WebviewWindow,
    request: &Request<'_>,
) -> Result<Vec<u8>, String> {
    if window.label() != "main" {
        return Err("Screenshot sharing is only available in the main window.".into());
    }
    let png = match request.body() {
        InvokeBody::Raw(png) => png.clone(),
        // Once one IPC fetch fails, Tauri sends everything through postMessage
        // until the page reloads, and the ArrayBuffer arrives as a JSON array.
        InvokeBody::Json(json) => Vec::<u8>::deserialize(json)
            .map_err(|_| "A captured PNG screenshot is required.".to_string())?,
    };
    if !png.starts_with(b"\x89PNG\r\n\x1a\n") || png.len() > 64 * 1024 * 1024 {
        return Err("The screenshot is invalid or exceeds 64 MiB.".into());
    }
    Ok(png)
}

#[tauri::command]
pub async fn copy_preview_image(
    window: tauri::WebviewWindow,
    request: Request<'_>,
) -> Result<(), String> {
    let png = screenshot_bytes(&window, &request)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        crate::extensions::clipboard_widget::system::write_png_clipboard(&app, &png)
    })
    .await
    .map_err(|error| format!("Could not copy the screenshot: {error}"))?
}

#[tauri::command]
pub async fn save_preview_image(
    window: tauri::WebviewWindow,
    request: Request<'_>,
) -> Result<bool, String> {
    let png = screenshot_bytes(&window, &request)?;
    let title = request
        .headers()
        .get("kavibay-title")
        .and_then(|value| value.to_str().ok())
        .map(|value| percent_encoding::percent_decode_str(value).decode_utf8_lossy())
        .unwrap_or_default();
    let stem = widget_file_stem(&title).unwrap_or_else(|| "kavibay-screenshot".into());
    tauri::async_runtime::spawn_blocking(move || {
        let (bytes, extension, kind) = saved_file(png)?;
        let target = window
            .dialog()
            .file()
            .set_parent(&window)
            .set_file_name(format!("{stem}.{extension}"))
            .add_filter(kind, &[extension])
            .blocking_save_file();
        let Some(target) = target else {
            return Ok(false);
        };
        let path = target.into_path().map_err(|error| error.to_string())?;
        std::fs::write(path, bytes)
            .map_err(|error| format!("Could not save the screenshot: {error}"))?;
        Ok(true)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// "kavibay-todo-widget" for the widget titled "Todo", the name Save suggests
/// for screenshots and clips. Letters and digits survive, in any script,
/// lowercased; every other run becomes one '-', which also removes whatever a
/// file name cannot hold. `None` when nothing of the title is left.
fn widget_file_stem(title: &str) -> Option<String> {
    let mut slug = String::new();
    for c in title.chars().flat_map(char::to_lowercase) {
        if c.is_alphanumeric() {
            slug.push(c);
        } else if !slug.is_empty() && !slug.ends_with('-') {
            slug.push('-');
        }
    }
    let slug: String = slug.chars().take(60).collect();
    let slug = slug.trim_end_matches('-');
    let slug = slug.strip_suffix("-widget").unwrap_or(slug);
    (!slug.is_empty() && slug != "widget").then(|| format!("kavibay-{slug}-widget"))
}

/// At 92 a widget's text edges match the PNG at 3x zoom, and a screenshot
/// over the nebula background drops from 1.0 MB to 0.2 MB. 85 shows blocks
/// in dark areas. The lossless best, PNG without alpha, only saved 12%.
const SAVED_JPEG_QUALITY: u8 = 92;

/// What Save writes: an opaque screenshot as JPEG, one with transparency as
/// the PNG it already is. Copy keeps the PNG either way.
fn saved_file(png: Vec<u8>) -> Result<(Vec<u8>, &'static str, &'static str), String> {
    let image = image::load_from_memory_with_format(&png, image::ImageFormat::Png)
        .map_err(|error| format!("Could not read the screenshot: {error}"))?;
    let transparent = match &image {
        image::DynamicImage::ImageRgba8(rgba) => rgba.pixels().any(|pixel| pixel[3] < 255),
        other => other.color().has_alpha(),
    };
    if transparent {
        return Ok((png, "png", "PNG image"));
    }
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, SAVED_JPEG_QUALITY)
        .encode_image(&image.to_rgb8())
        .map_err(|error| format!("Could not encode the screenshot: {error}"))?;
    Ok((jpeg, "jpg", "JPEG image"))
}

async fn capture_snapshot(
    window: &tauri::WebviewWindow,
    timeout: Duration,
    macos_region: Option<CaptureRegion>,
) -> Result<Vec<u8>, String> {
    if CAPTURE_PENDING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("Another preview snapshot is still finishing. Please try again.".into());
    }
    let (sender, receiver) = oneshot::channel();
    let reply = Arc::new(Mutex::new(Some(sender)));
    let dispatch_reply = reply.clone();
    if let Err(error) = window.with_webview(move |webview| {
        let reply = dispatch_reply;
        #[cfg(target_os = "macos")]
        macos::capture(webview, reply, macos_region);
        #[cfg(not(target_os = "macos"))]
        let _ = macos_region;
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
    }) {
        finish(
            &reply,
            Err(format!("Could not capture the preview: {error}")),
        );
    }

    // A timed-out native request retains the pending flag until its callback.
    // A retry cannot queue overlapping compositor work behind that request.
    tokio::time::timeout(timeout, receiver)
        .await
        .map_err(|_| "Preview capture timed out. Please try again.".to_string())?
        .map_err(|_| "The preview closed before capture finished.".to_string())?
}

fn crop_image(png: &[u8], region: CaptureRegion) -> Result<image::RgbaImage, String> {
    let image = image::load_from_memory_with_format(png, image::ImageFormat::Png)
        .map_err(|error| format!("Could not read the preview snapshot: {error}"))?;
    let (x, y, width, height) = region.pixels(image.width(), image.height())?;
    Ok(image.crop_imm(x, y, width, height).into_rgba8())
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

    #[test]
    fn names_saved_files_after_the_widget() {
        let stem = |title| widget_file_stem(title);
        assert_eq!(stem("Todo").as_deref(), Some("kavibay-todo-widget"));
        assert_eq!(
            stem("Weather Widget").as_deref(),
            Some("kavibay-weather-widget")
        );
        assert_eq!(
            stem("Übersicht: A/B?").as_deref(),
            Some("kavibay-übersicht-a-b-widget")
        );
        assert_eq!(stem(""), None);
        assert_eq!(stem(" *?* "), None);
        assert_eq!(stem("Widget"), None);
    }

    #[test]
    fn saves_opaque_screenshots_as_jpeg_and_keeps_transparent_ones_png() {
        let png = |image: image::RgbaImage| {
            let mut png = std::io::Cursor::new(Vec::new());
            image.write_to(&mut png, image::ImageFormat::Png).unwrap();
            png.into_inner()
        };
        let mut image = image::RgbaImage::from_pixel(40, 20, image::Rgba([30, 60, 90, 255]));

        let (bytes, extension, _) = saved_file(png(image.clone())).unwrap();
        assert_eq!(extension, "jpg");
        assert!(bytes.starts_with(&[0xff, 0xd8, 0xff]));

        image.put_pixel(39, 19, image::Rgba([30, 60, 90, 0]));
        let transparent = png(image);
        let (bytes, extension, _) = saved_file(transparent.clone()).unwrap();
        assert_eq!(extension, "png");
        assert_eq!(bytes, transparent);
    }
}
