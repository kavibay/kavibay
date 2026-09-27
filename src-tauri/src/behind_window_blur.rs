//! Lets CSS `backdrop-filter` blur what is behind Kavibay's windows on macOS.
//!
//! WebKit draws a backdrop filter with a `CABackdropLayer` and creates it with
//! `windowServerAware` off, so the layer samples only the window's own content.
//! Kavibay's windows are transparent overlays whose glass is meant to blur the
//! desktop and the apps behind them. With the flag off, the blur showed only
//! while a card was being redrawn (its header fading in) and was gone a second
//! or two later. Measured: the layers stay alive, enabled and filtered the whole
//! time, and once the flag is set WebKit never clears it, so the blur stays.
//!
//! Each new glass surface brings a new layer, so the visible windows are walked
//! twice a second. A layer is written once. A surface that just appeared is
//! still being drawn and shows its blur until the next walk anyway.
//!
//! `windowServerAware` is private Core Animation API, like the transparent
//! window it depends on (`macOSPrivateApi`). On a system without the property
//! nothing is written, and the blur stays limited to the window's own content.

use std::time::Duration;

use objc2::runtime::{AnyClass, AnyObject};
use objc2::{msg_send, sel};
use tauri::{AppHandle, Manager, WebviewWindow};

const INTERVAL: Duration = Duration::from_millis(500);

pub fn spawn(app: AppHandle) {
    let Some(backdrop) = AnyClass::get(c"CABackdropLayer") else {
        return;
    };
    if !backdrop.responds_to(sel!(setWindowServerAware:)) {
        return;
    }
    std::thread::spawn(move || loop {
        std::thread::sleep(INTERVAL);
        let windows = app.clone();
        let _ = app.run_on_main_thread(move || {
            for window in windows.webview_windows().values() {
                mark_window(window, backdrop);
            }
        });
    });
}

/// Runs on the main thread, which owns AppKit and the layer tree.
fn mark_window(window: &WebviewWindow, backdrop: &AnyClass) {
    let Ok(ns_window) = window.ns_window() else {
        return;
    };
    // SAFETY: Tauri hands out its live NSWindow, and this runs on the main thread.
    let ns_window = unsafe { &*ns_window.cast::<AnyObject>() };
    let visible: bool = unsafe { msg_send![ns_window, isVisible] };
    if !visible {
        return;
    }
    let view: *mut AnyObject = unsafe { msg_send![ns_window, contentView] };
    if view.is_null() {
        return;
    }
    // SAFETY: a non-null content view of a live window.
    let layer: *mut AnyObject = unsafe { msg_send![&*view, layer] };
    if !layer.is_null() {
        // SAFETY: a non-null layer of that view.
        mark_layer(unsafe { &*layer }, backdrop);
    }
}

fn mark_layer(layer: &AnyObject, backdrop: &AnyClass) {
    // SAFETY: plain CALayer and NSArray messages; `windowServerAware` exists on
    // every CABackdropLayer, which `spawn` checked on the class.
    unsafe {
        let is_backdrop: bool = msg_send![layer, isKindOfClass: backdrop];
        if is_backdrop {
            let aware: bool = msg_send![layer, windowServerAware];
            if !aware {
                let () = msg_send![layer, setWindowServerAware: true];
            }
        }
        let sublayers: *mut AnyObject = msg_send![layer, sublayers];
        if sublayers.is_null() {
            return;
        }
        let count: usize = msg_send![&*sublayers, count];
        for index in 0..count {
            let child: *mut AnyObject = msg_send![&*sublayers, objectAtIndex: index];
            if !child.is_null() {
                mark_layer(&*child, backdrop);
            }
        }
    }
}
