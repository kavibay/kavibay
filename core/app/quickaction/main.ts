/**
 * Entry point of the selection quick-action window (`quickaction.html`).
 *
 * A second, minimal Vue app rather than a mode of the cockpit: the main window
 * is a fullscreen transparent overlay, and showing it would bring the search
 * palette and every pinned widget along with a menu that is meant to appear
 * next to someone else's text cursor. Keeping the two apart also keeps widget
 * module state single — one webview owns the widgets, this one owns nothing.
 */
import { createApp } from "vue";
import { hydrateDurableStorage } from "../system/durableStorage";
import { vTip } from "../system/floatingTip";
import "../styles.css";
import "./quickaction.css";

// This window is built at startup, possibly before the cockpit has restored the
// durable copy of localStorage — so it hydrates too, read-only. Without that it
// could read an empty cache and render on default appearance. `mirror: false`
// leaves the cockpit as the single writer; text actions run here still reach the
// snapshot, via the `storage` event the cockpit listens to.
void hydrateDurableStorage({ mirror: false }).then(async () => {
  const { default: QuickActionMenu } = await import("./QuickActionMenu.vue");
  const {
    applyColorModeToDocument,
    applyCornerShapeToDocument,
    applyFontToDocument,
    applySurfaceBlurToDocument,
    applySurfaceOpacityToDocument,
    applySurfaceRadiusToDocument,
    loadAppearance,
  } = await import("../settings/appearanceLogic");

  // Read the same appearance the cockpit uses (same origin, same localStorage),
  // but only the tokens this window can show. Importing `useAppearance` instead
  // would drag its boot-time side effects — pushing the open-monitor preference
  // back to Rust — into a window that has no opinion on any of that.
  const appearance = loadAppearance();
  applyColorModeToDocument(appearance.colorMode);
  applyFontToDocument(appearance.fontId);
  applySurfaceOpacityToDocument(appearance.surfaceOpacity);
  applySurfaceBlurToDocument(appearance.surfaceBlur);
  applySurfaceRadiusToDocument(appearance.surfaceRadius);
  applyCornerShapeToDocument(appearance.cornerShape);

  createApp(QuickActionMenu).directive("tip", vTip).mount("#app");
});
