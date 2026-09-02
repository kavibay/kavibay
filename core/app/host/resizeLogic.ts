/** Shared edge/corner resize math for center-anchored Kavibay cards. */

/** Which edge or corner is being dragged. */
export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export const RESIZE_EDGES: ResizeEdge[] = [
  "n",
  "s",
  "e",
  "w",
  "ne",
  "nw",
  "se",
  "sw",
];

/**
 * Widget cards + command palette: keep the top edge free for moving, but let
 * the two top corners resize. The corner hit targets sit above the move grip.
 */
export const RESIZE_EDGES_NO_TOP: ResizeEdge[] = ["s", "e", "w", "ne", "nw", "se", "sw"];

/** Dock / hug-height widgets: horizontal resize only. */
export const RESIZE_EDGES_HORIZONTAL: ResizeEdge[] = ["e", "w"];

/** CSS cursor for each resize handle. */
export const RESIZE_CURSOR: Record<ResizeEdge, string> = {
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  ne: "nesw-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
  sw: "nesw-resize",
};

export const DEFAULT_WIDGET_MIN_WIDTH = 80;
export const DEFAULT_WIDGET_MIN_HEIGHT = 80;
/** Effectively unbounded — privacy covers / large media need full-monitor size. */
export const DEFAULT_WIDGET_MAX_WIDTH = 16384;
export const DEFAULT_WIDGET_MAX_HEIGHT = 16384;

/**
 * How tall a generated widget's card may grow to fit its own content.
 *
 * A ceiling and not just a floor, because the request was two things: stop
 * making me scroll a widget that would fit, and keep the scrollbar for one that
 * genuinely will not. Past this the card stops growing and the content scrolls,
 * which is the correct answer for a list that has no natural end.
 */
export const PREVIEW_FIT_MAX_HEIGHT = 560;

/**
 * The card height that would remove a widget's own scrollbar.
 *
 * Expressed as *overflow* rather than as a target height on purpose: the caller
 * knows how tall the card is and how tall the frame inside it is, and the gap
 * between them is card padding, a title bar and a border. Growing by the
 * overflow needs none of that modelled, and it converges — once the content
 * fits, the overflow is zero and nothing moves again.
 *
 * `null` when there is nothing worth doing: no overflow, already at the
 * ceiling, or a change too small to be worth a resize. The last one matters —
 * a widget that animates reports a size on every frame, and a card that
 * followed every one of them by a pixel would never sit still.
 */
export function fitToContent(
  cardHeight: number,
  overflow: number,
  max = PREVIEW_FIT_MAX_HEIGHT,
): number | null {
  if (!Number.isFinite(cardHeight) || !Number.isFinite(overflow)) return null;
  if (overflow < 4) return null;
  if (cardHeight >= max) return null;
  const next = Math.min(max, Math.round(cardHeight + overflow));
  return next > cardHeight ? next : null;
}

export const DEFAULT_PALETTE_WIDTH = 640;
/** Seven standard two-line result rows plus the list's vertical padding. */
export const DEFAULT_PALETTE_LIST_HEIGHT = 400;
export const PALETTE_MIN_WIDTH = 320;
export const PALETTE_MIN_LIST_HEIGHT = 160;
export const PALETTE_MAX_WIDTH = 960;
export const PALETTE_MAX_LIST_HEIGHT = 720;

export interface SizeBox {
  width: number;
  height: number;
}

export interface ResizeClamps {
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
}

export const DEFAULT_WIDGET_CLAMPS: ResizeClamps = {
  minWidth: DEFAULT_WIDGET_MIN_WIDTH,
  minHeight: DEFAULT_WIDGET_MIN_HEIGHT,
  maxWidth: DEFAULT_WIDGET_MAX_WIDTH,
  maxHeight: DEFAULT_WIDGET_MAX_HEIGHT,
};

export const DEFAULT_PALETTE_CLAMPS: ResizeClamps = {
  minWidth: PALETTE_MIN_WIDTH,
  minHeight: PALETTE_MIN_LIST_HEIGHT,
  maxWidth: PALETTE_MAX_WIDTH,
  maxHeight: PALETTE_MAX_LIST_HEIGHT,
};

/** Default body zoom when an instance has never been Ctrl+resized. */
export const DEFAULT_CONTENT_SCALE = 1;
export const MIN_CONTENT_SCALE = 0.5;
export const MAX_CONTENT_SCALE = 3;

/** Clamp a content zoom factor into allowed bounds. */
export function clampContentScale(scale: number): number {
  const raw = Number.isFinite(scale) ? scale : DEFAULT_CONTENT_SCALE;
  return Math.min(MAX_CONTENT_SCALE, Math.max(MIN_CONTENT_SCALE, raw));
}

/** ~10% zoom step per wheel notch (deltaY &lt; 0 → zoom in). */
export const CONTENT_SCALE_WHEEL_FACTOR = 1.1;

/** One mouse notch in Chromium: 100px of deltaY at deltaMode 0. */
export const WHEEL_NOTCH_DELTA = 100;
/** Line/page deltaModes in px, so every device shares one zoom curve. */
const WHEEL_LINE_PX = 40;
const WHEEL_PAGE_PX = 400;
/** Ceiling per event — one chunky delta must not jump to a clamp. */
const WHEEL_DELTA_LIMIT = 2 * WHEEL_NOTCH_DELTA;

/**
 * Below this the event came from a trackpad: a mouse notch is a quantized 100,
 * a pinch is a stream of small fractional deltas.
 */
export const PINCH_DELTA_THRESHOLD = 50;
/**
 * Pinch deltas are so small that the raw curve barely moves the zoom across a
 * whole gesture. Raise this to make pinching more sensitive — the mouse wheel
 * is unaffected, its deltas never fall below the threshold.
 */
export const PINCH_DELTA_GAIN = 4;

/**
 * Wheel delta as px, whatever `deltaMode` the device reports — trackpad deltas
 * amplified so one pinch gesture covers a useful part of the zoom range.
 */
export function normalizeWheelDelta(deltaY: number, deltaMode = 0): number {
  if (!Number.isFinite(deltaY)) return 0;
  const px =
    deltaMode === 1 ? deltaY * WHEEL_LINE_PX : deltaMode === 2 ? deltaY * WHEEL_PAGE_PX : deltaY;
  const gained = Math.abs(px) < PINCH_DELTA_THRESHOLD ? px * PINCH_DELTA_GAIN : px;
  return Math.min(WHEEL_DELTA_LIMIT, Math.max(-WHEEL_DELTA_LIMIT, gained));
}

/**
 * Next content zoom for Ctrl/Meta + wheel — the same event a trackpad pinch
 * produces (Chromium reports pinch as a wheel with ctrlKey set). The step is
 * proportional to the delta, so one mouse notch stays ~10% while a pinch's
 * stream of small fractional deltas accumulates smoothly instead of slamming
 * into a clamp after a few events.
 */
export function contentScaleFromWheel(
  scale: number,
  deltaY: number,
  deltaMode = 0,
): number {
  const delta = normalizeWheelDelta(deltaY, deltaMode);
  if (delta === 0) return clampContentScale(scale);
  const factor = CONTENT_SCALE_WHEEL_FACTOR ** (-delta / WHEEL_NOTCH_DELTA);
  return clampContentScale(clampContentScale(scale) * factor);
}

/**
 * Next content zoom for a Ctrl+resize gesture: scale tracks the shorter side.
 * `startScale` is the zoom at pointer-down; sizes are CSS px.
 */
export function contentScaleForResize(
  startScale: number,
  startSize: SizeBox,
  nextSize: SizeBox,
): number {
  const startSide = Math.min(startSize.width, startSize.height);
  const nextSide = Math.min(nextSize.width, nextSize.height);
  if (startSide < 1) return clampContentScale(startScale);
  return clampContentScale(startScale * (nextSide / startSide));
}

/** Clamp a size into allowed bounds. */
export function clampSize(
  width: number,
  height: number,
  clamps: ResizeClamps = DEFAULT_WIDGET_CLAMPS,
): SizeBox {
  const w = Number.isFinite(width) ? width : clamps.minWidth;
  const h = Number.isFinite(height) ? height : clamps.minHeight;
  return {
    width: Math.min(clamps.maxWidth, Math.max(clamps.minWidth, Math.round(w))),
    height: Math.min(clamps.maxHeight, Math.max(clamps.minHeight, Math.round(h))),
  };
}

export interface ResizeApplyResult {
  width: number;
  height: number;
  /** Add to the center-based offset so the opposite edge stays fixed. */
  deltaOffset: { x: number; y: number };
}

/**
 * Apply a pointer delta to a center-anchored box for the given edge/corner.
 * Left/top growth moves the center so the opposite edge stays put.
 */
export function applyResizeDelta(
  edge: ResizeEdge,
  start: SizeBox,
  pointerDx: number,
  pointerDy: number,
  clamps: ResizeClamps = DEFAULT_WIDGET_CLAMPS,
): ResizeApplyResult {
  let dW = 0;
  let dH = 0;
  if (edge.includes("e")) dW += pointerDx;
  if (edge.includes("w")) dW -= pointerDx;
  if (edge.includes("s")) dH += pointerDy;
  if (edge.includes("n")) dH -= pointerDy;

  const next = clampSize(start.width + dW, start.height + dH, clamps);
  const appliedDw = next.width - start.width;
  const appliedDh = next.height - start.height;

  let dx = 0;
  let dy = 0;
  if (edge.includes("e")) dx += appliedDw / 2;
  if (edge.includes("w")) dx -= appliedDw / 2;
  if (edge.includes("s")) dy += appliedDh / 2;
  if (edge.includes("n")) dy -= appliedDh / 2;

  return {
    width: next.width,
    height: next.height,
    deltaOffset: { x: dx, y: dy },
  };
}
