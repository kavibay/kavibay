/**
 * Keeps WebView2's own zoom out of the way.
 *
 * `zoomHotkeysEnabled` in tauri.conf.json is one switch for two things in wry:
 * it enables the browser's Ctrl+wheel / Ctrl+`+-0` zoom *and* the trackpad
 * pinch gesture (`SetIsZoomControlEnabled` / `SetIsPinchZoomEnabled` are both
 * bound to it). We need the pinch, but a browser zoom would scale the whole
 * overlay — chrome, gaps and all — instead of one widget's content.
 *
 * So the switch stays on and the default is cancelled here. The events still
 * propagate, so WidgetCard's own zoom handler runs as before.
 */

/** Ctrl/Meta + these keys are the browser's zoom hotkeys. */
const ZOOM_KEYS = new Set(["+", "-", "=", "_", "0"]);

export function startBrowserZoomGuard(): void {
  window.addEventListener(
    "wheel",
    (event) => {
      if (event.ctrlKey || event.metaKey) event.preventDefault();
    },
    { capture: true, passive: false },
  );

  window.addEventListener(
    "keydown",
    (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      // Numpad +/-/0 report as Add/Subtract/Numpad0 in `code`, not in `key`.
      const numpad =
        event.code === "NumpadAdd" ||
        event.code === "NumpadSubtract" ||
        event.code === "Numpad0";
      if (ZOOM_KEYS.has(event.key) || numpad) event.preventDefault();
    },
    { capture: true },
  );
}
