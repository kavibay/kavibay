use base64::Engine;
use webview2_com::{CallDevToolsProtocolMethodCompletedHandler, CoTaskMemPWSTR};

use super::{finish, CaptureReply};

pub(super) fn capture(webview: tauri::webview::PlatformWebview, reply: CaptureReply) {
    // WebView2's compositor captures sandboxed frames as rendered, without DOM access.
    unsafe {
        let result = webview.controller().CoreWebView2().and_then(|view| {
            let method = CoTaskMemPWSTR::from("Page.captureScreenshot");
            let parameters =
                CoTaskMemPWSTR::from(r#"{"format":"png","captureBeyondViewport":false}"#);
            let completed = reply.clone();
            let callback = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                move |status, response| {
                    let result = status
                        .map_err(|error| format!("Could not capture the preview: {error}"))
                        .and_then(|()| {
                            let response: serde_json::Value = serde_json::from_str(&response)
                                .map_err(|error| {
                                    format!("Could not read the preview snapshot: {error}")
                                })?;
                            let data = response
                                .get("data")
                                .and_then(|value| value.as_str())
                                .ok_or("The preview snapshot is empty.")?;
                            base64::engine::general_purpose::STANDARD
                                .decode(data)
                                .map_err(|error| {
                                    format!("Could not decode the preview snapshot: {error}")
                                })
                        });
                    finish(&completed, result);
                    Ok(())
                },
            ));
            view.CallDevToolsProtocolMethod(
                *method.as_ref().as_pcwstr(),
                *parameters.as_ref().as_pcwstr(),
                &callback,
            )
        });
        if let Err(error) = result {
            finish(
                &reply,
                Err(format!("Could not capture the preview: {error}")),
            );
        }
    }
}
