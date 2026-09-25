import { invoke } from "@tauri-apps/api/core";
import { nextTick, onMounted, onUnmounted } from "vue";

// Is this running in the real Tauri window rather than a bare localhost browser tab?
// Only the Tauri window has the IPC bridge to the Rust backend.
const hasTauri = () => "__TAURI_INTERNALS__" in window;

/** Mirrors Rust `paused`: while true, rects are unused (window stays interactive). */
let clickThroughPaused = false;

/**
 * Last payload sent to Rust — skip IPC when nothing moved/resized. Starts unset
 * rather than "" so the first sync is always sent: Rust keeps the previous
 * page's rects across a reload, and an empty desk would otherwise never clear them.
 */
let lastRectsKey: string | undefined;

/**
 * Reports the rectangles of all interactive UI elements to the backend. Rust uses them
 * to poll the cursor position and make the window click-through outside those rectangles
 * (see src-tauri/src/lib.rs). Interactive elements opt in with `data-interactive`.
 *
 * No-op while click-through is paused — Rust ignores rects until unpause, so a full DOM
 * scan + IPC on every drag/resize frame only burns main-thread time.
 */
export function syncInteractiveRegions() {
  if (!hasTauri() || clickThroughPaused) return;

  const rects = [...document.querySelectorAll<HTMLElement>("[data-interactive]")].map(
    (el) => {
      const r = el.getBoundingClientRect();
      // CSS pixels relative to the top-left of the window. Rust applies the DPI and
      // window-offset conversion using scale_factor + outer_position.
      // Round so sub-pixel jitter does not force redundant IPC.
      return {
        x: Math.round(r.left),
        y: Math.round(r.top),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    },
  );

  const key = rects.map((r) => `${r.x},${r.y},${r.w},${r.h}`).join("|");
  if (key === lastRectsKey) return;
  lastRectsKey = key;

  void invoke("set_interactive_rects", { rects });
}

/**
 * Pauses click-through detection. Needed during drags: the cursor can briefly leave the
 * card rectangle, which would make the window transparent to clicks and interrupt the drag.
 */
export function setClickThroughPaused(paused: boolean) {
  clickThroughPaused = paused;
  if (!hasTauri()) return;
  void invoke("set_click_through_paused", { paused });
}

/** Last armed state sent to Rust — the watcher only needs the edges. */
let lastOutsideClickArmed: boolean | undefined;

/**
 * Arms native outside-click detection. Rust then emits `cockpit:outside-click` when a gap
 * is clicked.
 *
 * Why not catch this in the DOM: a full-screen catcher would have to report itself as an
 * interactive rectangle to see the click, making the window opaque to the OS and preventing
 * the click from reaching the app underneath. The first click would be lost. Native
 * detection keeps the gap click-through, so Windows delivers the click normally.
 *
 * This assumes that the gap is actually click-through. Where click-through is unavailable
 * (native Wayland), there is nothing to preserve, so the DOM catcher takes over; see
 * {@link needsDomGapCatcher}.
 */
export function setOutsideClickDismiss(armed: boolean) {
  if (!hasTauri() || armed === lastOutsideClickArmed) return;
  lastOutsideClickArmed = armed;
  void invoke("set_outside_click_dismiss", { armed });
}

/**
 * Must the DOM catch outside clicks because Rust cannot report them on this platform? The
 * platform matrix and rationale live next to `dom_gap_catcher_needed` in `commands.rs`, so
 * there is one source of truth.
 *
 * In a browser (without Tauri), there is neither click-through nor a gap to catch: `false`.
 */
export async function needsDomGapCatcher(): Promise<boolean> {
  if (!hasTauri()) return false;
  return await invoke<boolean>("needs_dom_gap_catcher");
}

// Coalesce high-frequency callers (hover chrome, drag end, resize) into one frame, so
// pointerdown and text selection do not wait behind a synchronous DOM scan.
let frame = 0;
export function scheduleRegionSync() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(syncInteractiveRegions);
}

/**
 * Call once from the root component. Keeps reported rectangles current when the window or
 * interactive element sizes change, for example when System Info loads data or the palette
 * result list grows.
 */
export function useRegionSync() {
  // Rust's pause outlives the page. A reload mid-pause (a menu open, a drag, the
  // frame between pause and unpause in openCockpit) left it on, and a paused
  // window takes every click across the whole screen. Runs in the root's setup,
  // before any child can pause for itself.
  setClickThroughPaused(false);

  let observer: ResizeObserver | undefined;
  const onResize = () => scheduleRegionSync();

  onMounted(async () => {
    await nextTick();
    syncInteractiveRegions();
    window.addEventListener("resize", onResize);
    observer = new ResizeObserver(() => scheduleRegionSync());
    document
      .querySelectorAll("[data-interactive]")
      .forEach((el) => observer!.observe(el));
  });

  onUnmounted(() => {
    window.removeEventListener("resize", onResize);
    observer?.disconnect();
  });
}
