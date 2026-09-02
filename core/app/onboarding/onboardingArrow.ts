/** Horizontal offset for above-left bubble anchor (left of target edge). */
const BUBBLE_ABOVE_LEFT_OFFSET_X = -8;
/** Vertical offset for above-left bubble anchor (above target top). */
const BUBBLE_ABOVE_LEFT_OFFSET_Y = -72;
/** Horizontal gap between left-of bubble and target edge. */
const BUBBLE_LEFT_OF_GAP = 56;
/** Gap below the target for below-left bubble placement. */
const BUBBLE_BELOW_GAP = 28;
/** Perpendicular offset for cubic control points (slight wobble). */
const ARROW_WOBBLE = 12;
/** Half-angle of the open chevron at the arrow tip (radians). */
const TIP_HALF_ANGLE = Math.PI / 6;
/** Length of each chevron arm from the tip point. */
const TIP_ARM_LENGTH = 8;

export type Point = { x: number; y: number };
export type Rect = { left: number; top: number; width: number; height: number };

export type BubblePlacement = "above-left" | "left-of" | "below-left";

/**
 * Anchor point for positioning the coach bubble relative to a highlighted target.
 * For "above-left", the caller aligns the bubble's bottom-right / tip region near this point.
 * For "below-left", the caller aligns the bubble's top-right near this point (outside the card).
 */
export function bubbleAnchorForTarget(
  target: Rect,
  preferred: BubblePlacement,
): Point {
  if (preferred === "above-left") {
    return {
      x: target.left + BUBBLE_ABOVE_LEFT_OFFSET_X,
      y: target.top + BUBBLE_ABOVE_LEFT_OFFSET_Y,
    };
  }
  if (preferred === "below-left") {
    return {
      x: target.left - BUBBLE_LEFT_OF_GAP,
      y: target.top + target.height + BUBBLE_BELOW_GAP,
    };
  }
  return {
    x: target.left - BUBBLE_LEFT_OF_GAP,
    y: target.top + target.height / 2,
  };
}

/** Format a coordinate for SVG path data. */
function fmt(n: number): string {
  return n.toFixed(2);
}

/**
 * Dashed arrow from `from` to `to`: cubic-bezier shaft with slight wobble plus an open chevron at the tip.
 */
export function arrowPath(from: Point, to: Point): { d: string; tip: string } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;

  const c1 = {
    x: from.x + dx * 0.33 + nx * ARROW_WOBBLE,
    y: from.y + dy * 0.33 + ny * ARROW_WOBBLE,
  };
  const c2 = {
    x: from.x + dx * 0.66 - nx * ARROW_WOBBLE,
    y: from.y + dy * 0.66 - ny * ARROW_WOBBLE,
  };

  const d = `M ${fmt(from.x)} ${fmt(from.y)} C ${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(to.x)} ${fmt(to.y)}`;

  const angle = Math.atan2(dy, dx);
  const arm1 = {
    x: to.x - TIP_ARM_LENGTH * Math.cos(angle - TIP_HALF_ANGLE),
    y: to.y - TIP_ARM_LENGTH * Math.sin(angle - TIP_HALF_ANGLE),
  };
  const arm2 = {
    x: to.x - TIP_ARM_LENGTH * Math.cos(angle + TIP_HALF_ANGLE),
    y: to.y - TIP_ARM_LENGTH * Math.sin(angle + TIP_HALF_ANGLE),
  };

  const tip = `M ${fmt(arm1.x)} ${fmt(arm1.y)} L ${fmt(to.x)} ${fmt(to.y)} M ${fmt(to.x)} ${fmt(to.y)} L ${fmt(arm2.x)} ${fmt(arm2.y)}`;

  return { d, tip };
}
