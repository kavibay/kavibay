/** Invisible layout grid gap in CSS pixels (Behavior → Snap to grid). */
export const GRID_GAP = 15;

export interface SnapBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Snap a scalar to the nearest multiple of `gap` (default `GRID_GAP`). */
export function snapValue(n: number, gap: number = GRID_GAP): number {
  if (!(gap > 0) || !Number.isFinite(n)) return n;
  return Math.round(n / gap) * gap;
}

/** Snap top-left + size to the grid. */
export function snapBox(box: SnapBox, gap: number = GRID_GAP): SnapBox {
  return {
    x: snapValue(box.x, gap),
    y: snapValue(box.y, gap),
    width: snapValue(box.width, gap),
    height: snapValue(box.height, gap),
  };
}

/**
 * Snap a center-anchored resize onto the grid while keeping unmoved edges fixed.
 * Snapping all four edges (snapBox) during resize fights the anchored edge and
 * can block shrinking near the min size (e.g. stuck around 150px on a 15px grid).
 */
export function snapResizeGeometry(
  edge: string,
  center: { x: number; y: number },
  size: { width: number; height: number },
  mins: { minWidth: number; minHeight: number } = { minWidth: 0, minHeight: 0 },
  gap: number = GRID_GAP,
): { center: { x: number; y: number }; width: number; height: number } {
  let left = center.x - size.width / 2;
  let right = center.x + size.width / 2;
  let top = center.y - size.height / 2;
  let bottom = center.y + size.height / 2;

  const moveE = edge.includes("e");
  const moveW = edge.includes("w");
  const moveS = edge.includes("s");
  const moveN = edge.includes("n");

  if (moveE) right = snapValue(right, gap);
  if (moveW) left = snapValue(left, gap);
  if (moveS) bottom = snapValue(bottom, gap);
  if (moveN) top = snapValue(top, gap);

  let width = right - left;
  let height = bottom - top;

  if (width < mins.minWidth) {
    if (moveW && !moveE) left = right - mins.minWidth;
    else right = left + mins.minWidth;
    width = mins.minWidth;
  }
  if (height < mins.minHeight) {
    if (moveN && !moveS) top = bottom - mins.minHeight;
    else bottom = top + mins.minHeight;
    height = mins.minHeight;
  }

  return {
    center: { x: left + width / 2, y: top + height / 2 },
    width,
    height,
  };
}

/**
 * Snap a center-anchored box's top-left to the grid without changing size.
 * Used for palette move (size stays free). Widget move snaps full box instead.
 */
export function snapPosition(
  center: { x: number; y: number },
  size: { width: number; height: number },
  gap: number = GRID_GAP,
): { x: number; y: number } {
  const left = snapValue(center.x - size.width / 2, gap);
  const top = snapValue(center.y - size.height / 2, gap);
  return {
    x: left + size.width / 2,
    y: top + size.height / 2,
  };
}

/**
 * Like snapPosition, but the grid origin is the inset content box so the
 * minimum left/right (and top/bottom) gaps stay equal at the extremes.
 * Snapping to the raw window origin (0,0) makes the right/bottom margins
 * look different whenever the viewport size is not a multiple of `gap`.
 */
export function snapPositionInInset(
  center: { x: number; y: number },
  size: { width: number; height: number },
  inset: { left: number; top: number; right: number; bottom: number },
  gap: number = GRID_GAP,
): { x: number; y: number } {
  const minLeft = inset.left;
  const maxLeft = inset.right - size.width;
  const minTop = inset.top;
  const maxTop = inset.bottom - size.height;

  let left = center.x - size.width / 2;
  let top = center.y - size.height / 2;

  // Snap relative to the inset origin (not the window origin).
  left = minLeft + snapValue(left - minLeft, gap);
  top = minTop + snapValue(top - minTop, gap);

  if (Number.isFinite(maxLeft) && maxLeft >= minLeft) {
    left = Math.min(maxLeft, Math.max(minLeft, left));
  }
  if (Number.isFinite(maxTop) && maxTop >= minTop) {
    top = Math.min(maxTop, Math.max(minTop, top));
  }

  return {
    x: left + size.width / 2,
    y: top + size.height / 2,
  };
}
