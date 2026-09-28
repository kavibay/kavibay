use block2::RcBlock;
use objc2::AnyThread;
use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
use objc2_foundation::{NSDictionary, NSError};
use objc2_web_kit::WKWebView;

use super::{finish, CaptureReply};

pub(super) fn capture(webview: tauri::webview::PlatformWebview, reply: CaptureReply) {
    // Tauri runs with_webview on the main thread; the completion block owns its reply.
    unsafe {
        let view: &WKWebView = &*webview.inner().cast();
        let callback = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
            let result = if let Some(error) = error.as_ref() {
                Err(format!(
                    "Could not capture the preview: {}",
                    error.localizedDescription()
                ))
            } else if let Some(image) = image.as_ref() {
                image
                    .TIFFRepresentation()
                    .and_then(|data| {
                        NSBitmapImageRep::initWithData(NSBitmapImageRep::alloc(), &data)
                    })
                    .and_then(|bitmap| {
                        bitmap.representationUsingType_properties(
                            NSBitmapImageFileType::PNG,
                            &NSDictionary::new(),
                        )
                    })
                    .map(|data| data.to_vec())
                    .ok_or_else(|| "Could not encode the preview snapshot.".to_string())
            } else {
                Err("The preview snapshot is empty.".into())
            };
            finish(&reply, result);
        });
        view.takeSnapshotWithConfiguration_completionHandler(None, &callback);
    }
}
