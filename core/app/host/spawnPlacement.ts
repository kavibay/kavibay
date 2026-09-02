/**
 * Place new widgets near a preferred offset without overlapping the palette
 * or existing cards (center-based coordinates).
 *
 * Clearance and search step match `GRID_GAP` so spawns sit on the same
 * invisible 15px rhythm as snap-to-grid moves.
 */
import { GRID_GAP } from "./gridSnap";
import type { WidgetPosition } from "./types";

/** Axis-aligned box in center-based coordinates. */
export interface SpawnRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Edge gap between cards / palette — same as the layout grid. */
export const SPAWN_GAP = GRID_GAP;
/** Spiral / ray step — one grid cell. */
export const SPAWN_STEP = GRID_GAP;
const SPAWN_MAX_RADIUS = 720;
const SPAWN_ANGLES = 12;

/** True when two center-rects overlap with at least `gap` between edges. */
export function spawnRectsOverlap(
  a: SpawnRect,
  b: SpawnRect,
  gap: number = SPAWN_GAP,
): boolean {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  const minDx = a.w / 2 + b.w / 2 + gap;
  const minDy = a.h / 2 + b.h / 2 + gap;
  return dx < minDx && dy < minDy;
}

/** True when `candidate` (center + size) hits any obstacle. */
export function spawnOffsetBlocked(
  center: WidgetPosition,
  size: { w: number; h: number },
  obstacles: SpawnRect[],
  gap: number = SPAWN_GAP,
): boolean {
  const self: SpawnRect = { x: center.x, y: center.y, w: size.w, h: size.h };
  return obstacles.some((obs) => spawnRectsOverlap(self, obs, gap));
}

function roundPos(pos: WidgetPosition): WidgetPosition {
  return { x: Math.round(pos.x), y: Math.round(pos.y) };
}

/**
 * Pick a free center near `preferred`.
 * Tries preferred → ray along preferred direction → spiral around preferred / origin.
 * Optional `quantize` snaps each candidate (e.g. onto the 15px grid) before testing.
 */
export function findClearSpawnOffset(opts: {
  preferred: WidgetPosition;
  size: { w: number; h: number };
  obstacles: SpawnRect[];
  gap?: number;
  step?: number;
  maxRadius?: number;
  /** Snap / clamp a candidate center before collision tests. */
  quantize?: (center: WidgetPosition, size: { w: number; h: number }) => WidgetPosition;
}): WidgetPosition {
  const {
    preferred,
    size,
    obstacles,
    gap = SPAWN_GAP,
    step = SPAWN_STEP,
    maxRadius = SPAWN_MAX_RADIUS,
    quantize,
  } = opts;

  const place = (raw: WidgetPosition): WidgetPosition | null => {
    const center = quantize ? quantize(raw, size) : roundPos(raw);
    if (spawnOffsetBlocked(center, size, obstacles, gap)) return null;
    return center;
  };

  const hitPreferred = place(preferred);
  if (hitPreferred) return hitPreferred;

  const len = Math.hypot(preferred.x, preferred.y);
  const baseAngle =
    len > 1e-6 ? Math.atan2(preferred.y, preferred.x) : 0;

  // Spiral near preferred first so we keep the ~1-grid-gap packing instead of
  // leaping along a long ray past the wide palette.
  for (let r = step; r <= maxRadius; r += step) {
    for (let i = 0; i < SPAWN_ANGLES; i++) {
      const a = baseAngle + (i / SPAWN_ANGLES) * Math.PI * 2;
      const aroundPreferred = place({
        x: preferred.x + Math.cos(a) * r,
        y: preferred.y + Math.sin(a) * r,
      });
      if (aroundPreferred) return aroundPreferred;
    }
  }

  for (let r = step; r <= maxRadius; r += step) {
    for (let i = 0; i < SPAWN_ANGLES; i++) {
      const a = baseAngle + (i / SPAWN_ANGLES) * Math.PI * 2;
      const aroundOrigin = place({
        x: Math.cos(a) * r,
        y: Math.sin(a) * r,
      });
      if (aroundOrigin) return aroundOrigin;
    }
  }

  return quantize ? quantize(preferred, size) : roundPos(preferred);
}
