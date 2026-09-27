import { clampContentScale, contentScaleFromWheel } from "./resizeLogic";

const ZOOM_EVENT = "kavibay:content-zoom";
const ZOOM_SURFACE = "data-widget-zoom-surface";
type ZoomChange =
  | { kind: "wheel"; deltaY: number; deltaMode: number }
  | { kind: "pinch"; factor: number };

function readZoomChange(value: unknown): ZoomChange | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (data.kind === "wheel" && typeof data.deltaY === "number" && Number.isFinite(data.deltaY)
      && (data.deltaMode === 0 || data.deltaMode === 1 || data.deltaMode === 2)) {
    return { kind: "wheel", deltaY: data.deltaY, deltaMode: data.deltaMode };
  }
  if (data.kind === "pinch" && typeof data.factor === "number"
      && Number.isFinite(data.factor) && data.factor > 0) {
    return { kind: "pinch", factor: data.factor };
  }
  return null;
}

/** Identity comes from the frame, never from ids supplied by its document. */
export function forwardFrameZoom(frame: HTMLIFrameElement | null, event: MessageEvent): boolean {
  if (!frame?.contentWindow || event.source !== frame.contentWindow) return false;
  if (event.data?.type !== "kavibay.ext.zoom") return false;
  const change = readZoomChange(event.data);
  if (change) frame.dispatchEvent(new CustomEvent(ZOOM_EVENT, { detail: change, bubbles: true }));
  return true;
}

/** Same scale and persistence callback for native content, iframe content and resizing. */
export function installContentZoom(
  root: HTMLElement,
  getScale: () => number,
  update: (scale: number) => void,
): () => void {
  let gestureScale: number | null = null;
  root.setAttribute(ZOOM_SURFACE, "");
  // A Wizard card contains a preview card. Capture must leave the inner card's
  // gestures alone instead of zooming the entire Wizard first.
  const owns = (event: Event) =>
    event.target instanceof Element && event.target.closest(`[${ZOOM_SURFACE}]`) === root;
  function apply(change: ZoomChange) {
    const scale = getScale();
    const next = change.kind === "wheel"
      ? contentScaleFromWheel(scale, change.deltaY, change.deltaMode)
      : clampContentScale(scale * change.factor);
    if (next !== scale) update(next);
  }
  function wheel(event: WheelEvent) {
    if (!owns(event) || !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    event.stopPropagation();
    if (gestureScale === null) apply({ kind: "wheel", deltaY: event.deltaY, deltaMode: event.deltaMode });
  }
  function forwarded(event: Event) {
    if (!owns(event)) return;
    const change = readZoomChange((event as CustomEvent<unknown>).detail);
    if (!change) return;
    event.stopPropagation();
    apply(change);
  }
  function gesture(event: Event) {
    if (!owns(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.type === "gesturestart") gestureScale = 1;
    else if (event.type === "gestureend") gestureScale = null;
    else {
      const scale = (event as Event & { scale?: number }).scale;
      if (gestureScale === null || typeof scale !== "number" || !Number.isFinite(scale) || scale <= 0) return;
      apply({ kind: "pinch", factor: scale / gestureScale });
      gestureScale = scale;
    }
  }
  const options = { capture: true, passive: false };
  root.addEventListener("wheel", wheel, options);
  root.addEventListener(ZOOM_EVENT, forwarded);
  for (const type of ["gesturestart", "gesturechange", "gestureend"]) root.addEventListener(type, gesture, options);
  return () => {
    root.removeAttribute(ZOOM_SURFACE);
    root.removeEventListener("wheel", wheel, options);
    root.removeEventListener(ZOOM_EVENT, forwarded);
    for (const type of ["gesturestart", "gesturechange", "gestureend"]) root.removeEventListener(type, gesture, options);
  };
}
