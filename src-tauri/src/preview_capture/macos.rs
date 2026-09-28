use block2::RcBlock;
use objc2::{AnyThread, MainThreadOnly};
use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
use objc2_core_foundation::{CGPoint, CGRect, CGSize};
use objc2_foundation::{NSDictionary, NSError};
use objc2_web_kit::{WKSnapshotConfiguration, WKWebView};

use super::{finish, CaptureRegion, CaptureReply};

pub(super) fn image_png(image: &NSImage) -> Result<Vec<u8>, String> {
    image
        .TIFFRepresentation()
        .and_then(|data| NSBitmapImageRep::initWithData(NSBitmapImageRep::alloc(), &data))
        .and_then(|bitmap| unsafe {
            bitmap.representationUsingType_properties(
                NSBitmapImageFileType::PNG,
                &NSDictionary::new(),
            )
        })
        .map(|data| data.to_vec())
        .ok_or_else(|| "Could not encode the preview snapshot.".to_string())
}

pub(super) fn capture(
    webview: tauri::webview::PlatformWebview,
    reply: CaptureReply,
    region: Option<CaptureRegion>,
) {
    // Tauri runs with_webview on the main thread; the completion block owns its reply.
    unsafe {
        let view: &WKWebView = &*webview.inner().cast();
        // Recording avoids encoding/decoding the whole desktop on every frame.
        // CSS coordinates can differ from AppKit points when the host is zoomed.
        let configuration = region.map(|region| {
            let bounds = view.bounds();
            let sx = bounds.size.width / region.viewport_width;
            let sy = bounds.size.height / region.viewport_height;
            let configuration = WKSnapshotConfiguration::new(view.mtm());
            configuration.setRect(CGRect::new(
                CGPoint::new(
                    bounds.origin.x + region.x * sx,
                    bounds.origin.y + region.y * sy,
                ),
                CGSize::new(region.width * sx, region.height * sy),
            ));
            configuration
        });
        let callback = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
            let result = if let Some(error) = error.as_ref() {
                Err(format!(
                    "Could not capture the preview: {}",
                    error.localizedDescription()
                ))
            } else if let Some(image) = image.as_ref() {
                image_png(image)
            } else {
                Err("The preview snapshot is empty.".into())
            };
            finish(&reply, result);
        });
        view.takeSnapshotWithConfiguration_completionHandler(configuration.as_deref(), &callback);
    }
}
