/**
 * Scale desk geometry between viewport sizes (multi-monitor / resolution).
 * Positions and sizes are CSS pixels relative to the Kavibay window.
 */
import type { Desk, DeskPlacement, WidgetPosition } from "./types";

/** Reference window size when a desk layout was last saved/adapted. */
export interface ViewportSize {
  width: number;
  height: number;
}

const MIN_VIEWPORT = 1;
/** Ignore sub-pixel / DPI jitter so we don't thrash-scale. */
const SIZE_EPS = 2;

/** Floor / ceiling for screen-edge inset (CSS px). */
const EDGE_MARGIN_MIN = 16;
const EDGE_MARGIN_MAX = 56;
/** Fraction of the shorter viewport side used as the edge inset. */
const EDGE_MARGIN_RATIO = 0.018;

/** True when two viewports are effectively the same size. */
export function viewportsEqual(a: ViewportSize, b: ViewportSize): boolean {
  return (
    Math.abs(a.width - b.width) < SIZE_EPS &&
    Math.abs(a.height - b.height) < SIZE_EPS
  );
}

/**
 * Min clear gap from widget/palette edges to the window border.
 * Scales with the shorter viewport side so left/right insets stay even
 * and look similar on 1080p vs ultrawide / 4K.
 */
export function viewportEdgeMargin(viewport: ViewportSize): number {
  const short = Math.min(viewport.width, viewport.height);
  if (!(short > 0) || !Number.isFinite(short)) return EDGE_MARGIN_MIN;
  const raw = short * EDGE_MARGIN_RATIO;
  return Math.round(
    Math.min(EDGE_MARGIN_MAX, Math.max(EDGE_MARGIN_MIN, raw)),
  );
}

/** Normalize a raw viewport; invalid → null. */
export function normalizeViewport(raw: unknown): ViewportSize | null {
  if (!raw || typeof raw !== "object") return null;
  const width = (raw as { width?: unknown }).width;
  const height = (raw as { height?: unknown }).height;
  if (typeof width !== "number" || typeof height !== "number") return null;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width < MIN_VIEWPORT || height < MIN_VIEWPORT) return null;
  return { width: Math.round(width), height: Math.round(height) };
}

/** Scale a center point from one viewport into another. */
export function scalePosition(
  pos: WidgetPosition,
  from: ViewportSize,
  to: ViewportSize,
): WidgetPosition {
  return {
    x: pos.x * (to.width / from.width),
    y: pos.y * (to.height / from.height),
  };
}

/** Scale a length along one axis. */
export function scaleLength(value: number, from: number, to: number): number {
  return value * (to / from);
}

/**
 * Return a desk with palette/placements scaled into `to`.
 * Sets `viewport` to `to`. No-op when sizes match or `from` is invalid.
 */
export function scaleDeskToViewport(
  desk: Desk,
  from: ViewportSize,
  to: ViewportSize,
): Desk {
  if (from.width < MIN_VIEWPORT || from.height < MIN_VIEWPORT) {
    return { ...desk, viewport: { ...to } };
  }
  if (viewportsEqual(from, to)) {
    return { ...desk, viewport: { ...to } };
  }

  const sx = to.width / from.width;
  const sy = to.height / from.height;

  const placements: DeskPlacement[] = desk.placements.map((p) => {
    const next: DeskPlacement = {
      instanceId: p.instanceId,
      offset: { x: p.offset.x * sx, y: p.offset.y * sy },
    };
    if (typeof p.width === "number") next.width = p.width * sx;
    if (typeof p.height === "number") next.height = p.height * sy;
    if (typeof p.contentScale === "number") next.contentScale = p.contentScale;
    if (p.hidden === true) next.hidden = true;
    if (p.pinned === true) next.pinned = true;
    return next;
  });

  return {
    ...desk,
    palette: { x: desk.palette.x * sx, y: desk.palette.y * sy },
    ...(typeof desk.paletteWidth === "number"
      ? { paletteWidth: desk.paletteWidth * sx }
      : {}),
    ...(typeof desk.paletteListHeight === "number"
      ? { paletteListHeight: desk.paletteListHeight * sy }
      : {}),
    placements,
    viewport: { width: to.width, height: to.height },
  };
}

/** Current browser/webview viewport (Kavibay window CSS size). */
export function currentViewportSize(): ViewportSize {
  return {
    width: typeof window !== "undefined" ? window.innerWidth : 1920,
    height: typeof window !== "undefined" ? window.innerHeight : 1080,
  };
}

/**
 * Resolve the viewport a desk was authored for.
 * Prefer the saved field; otherwise infer from palette center when the layout
 * clearly does not fit the current window (legacy layouts without viewport).
 */
export function resolveDeskViewport(
  desk: Desk,
  current: ViewportSize,
): ViewportSize {
  const saved = normalizeViewport(desk.viewport);
  if (saved) return saved;

  const cx = desk.palette.x;
  const cy = desk.palette.y;
  let extentX = cx;
  let extentY = cy;
  for (const p of desk.placements) {
    const halfW = (p.width ?? 0) / 2;
    const halfH = (p.height ?? 0) / 2;
    extentX = Math.max(extentX, cx + Math.abs(p.offset.x) + halfW);
    extentY = Math.max(extentY, cy + Math.abs(p.offset.y) + halfH);
  }

  // Centered-on-4K → palette ≈ (1920,1080); treat 2× center as the design size.
  const inferred: ViewportSize = {
    width: Math.max(current.width, Math.round(cx * 2), Math.round(extentX + 48)),
    height: Math.max(
      current.height,
      Math.round(cy * 2),
      Math.round(extentY + 48),
    ),
  };

  if (
    inferred.width > current.width + SIZE_EPS ||
    inferred.height > current.height + SIZE_EPS
  ) {
    return inferred;
  }
  return current;
}
