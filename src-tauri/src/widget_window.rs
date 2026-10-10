//! Windows for widgets that do not live on the desk (`ui.ownWindow`).
//!
//! The overlay is one always-on-top window outside the taskbar, which is right
//! for glanceable cards and wrong for the Widget Wizard: people work in it next
//! to a browser and switch with Alt+Tab. Such a widget gets an ordinary window
//! instead — in the taskbar, not on top — which the Ctrl double tap leaves alone
//! because that toggle only ever addresses `main`. It draws its own title row,
//! the card's, so it looks like the widget it was on the desk.
//!
//! The window loads the same app with `?widgetWindow=<type>`, which mounts that
//! one widget (`core/app/host/WidgetWindow.vue`). It runs first-party code only,
//! like `main`, and shares its capability (`capabilities/default.json`).

use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

const LABEL_PREFIX: &str = "widget-window-";

/// Lets the frontend tell the desktop app from the landing's web build, which
/// answers `false` and keeps such widgets on its desk.
#[tauri::command]
pub fn widget_window_supported() -> bool {
    true
}

/// Open a widget's window, or bring it forward, and hand it `request`.
///
/// A new window reads the request from its URL, because it is not listening
/// yet; an open one gets it as `widget-window:request`.
///
/// Async on purpose: a sync command runs on the main thread, and building a
/// webview there on Windows deadlocks — the window frame appears, its page
/// never loads.
#[tauri::command]
pub async fn widget_window_open(
    app: AppHandle,
    type_id: String,
    title: String,
    width: f64,
    height: f64,
    request: serde_json::Value,
) -> Result<(), String> {
    // The id ends up in a window label and a URL: catalog ids only.
    let valid = !type_id.is_empty()
        && type_id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if !valid {
        return Err(format!("not a widget type id: {type_id:?}"));
    }
    let label = format!("{LABEL_PREFIX}{type_id}");
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return app
            .emit_to(&label, "widget-window:request", request)
            .map_err(|error| error.to_string());
    }
    let url = format!(
        "index.html?widgetWindow={type_id}&request={}",
        utf8_percent_encode(&request.to_string(), NON_ALPHANUMERIC)
    );
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
        .title(format!("{title} – Kavibay"))
        .inner_size(width, height)
        .min_inner_size(640.0, 420.0)
        .decorations(false)
        .center()
        .build()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

/// A widget window asks the desk to open a widget (the Wizard's "Add to desk").
#[tauri::command]
pub fn widget_window_run(app: AppHandle, detail: serde_json::Value) -> Result<(), String> {
    crate::reveal_main_window(&app);
    app.emit_to("main", "widget-window:run", detail)
        .map_err(|error| error.to_string())
}

/// A widget window asks for Settings, which only the overlay has.
#[tauri::command]
pub fn widget_window_show_settings(app: AppHandle, section: String, focus: Option<String>) {
    crate::reveal_settings(&app, Some(&section), focus.as_deref());
}
