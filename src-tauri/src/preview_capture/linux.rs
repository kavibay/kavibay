use webkit2gtk::{gio, SnapshotOptions, SnapshotRegion, WebViewExt};

use super::{finish, CaptureReply};

pub(super) fn capture(webview: tauri::webview::PlatformWebview, reply: CaptureReply) {
    webview.inner().snapshot(
        SnapshotRegion::Visible,
        SnapshotOptions::TRANSPARENT_BACKGROUND,
        None::<&gio::Cancellable>,
        move |result| {
            let png = result
                .map_err(|error| format!("Could not capture the preview: {error}"))
                .and_then(|surface| {
                    let mut bytes = Vec::new();
                    surface.write_to_png(&mut bytes).map_err(|error| {
                        format!("Could not encode the preview snapshot: {error}")
                    })?;
                    Ok(bytes)
                });
            finish(&reply, png);
        },
    );
}
