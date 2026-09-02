/**
 * How far a dragged card may travel, on one axis.
 *
 * WHY THE FRAME IS NOT ALWAYS THE VIEWPORT:
 *
 * On a desk the viewport *is* the frame — the app fills the screen, and
 * `viewportEdgeMargin` keeps a card from touching the window border. Embedded
 * in a document that assumption breaks: the card is inside a stage a few
 * hundred pixels tall, and clamping it to the viewport let a visitor drag the
 * Widget Wizard clean out of the wallpaper and drop it across the paragraphs
 * two sections up. Nothing was broken; it just stopped being a desktop.
 *
 * So the frame is the box the page positions the card in, and the viewport is
 * only the fallback for a page that positions nothing.
 */
export interface DragAxis {
  /** Frame edge nearer the origin, in viewport coordinates. */
  start: number;
  /** Frame edge further from the origin. */
  end: number;
  /** Clear gap to hold from both edges. */
  margin: number;
  /** Where the page puts the box with no offset applied. */
  base: number;
  /** The box's own length on this axis. */
  size: number;
}

/**
 * The offset to apply, clamped so the box stays in its frame.
 *
 * THE SWAP AT THE END IS THE INTERESTING PART:
 *
 * A box can be bigger than its frame — the Wizard card is 660px tall in a
 * 596px screen, on purpose, so the frame keeps a monitor's proportions. Then
 * "start no earlier than the frame" and "end no later than the frame" cannot
 * both hold, and a plain clamp with `min > max` collapses to a single point:
 * the card would refuse to move at all on that axis.
 *
 * Swapping the two bounds turns that dead point into the range between "flush
 * with the top" and "flush with the bottom" — the box still always covers the
 * frame, and it can be panned to show either end. Which is what dragging an
 * oversized thing should do.
 */
export function clampDragOffset(want: number, axis: DragAxis): number {
  const low = axis.start + axis.margin - axis.base;
  const high = axis.end - axis.margin - axis.size - axis.base;
  return low <= high
    ? Math.min(Math.max(want, low), high)
    : Math.min(Math.max(want, high), low);
}

/**
 * The element a page positions this one in, or null for "use the viewport".
 *
 * `offsetParent` answers exactly the right question — the nearest positioned
 * ancestor — with one exception worth naming: with no positioned ancestor at
 * all it reports `<body>`, and clamping to the body means clamping to the
 * whole document, which is looser than the viewport rule it would replace.
 */
export function dragFrameElement(host: HTMLElement | null): HTMLElement | null {
  const parent = host?.offsetParent;
  if (!(parent instanceof HTMLElement)) return null;
  if (parent === document.body || parent === document.documentElement) return null;
  return parent;
}
