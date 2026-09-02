/**
 * A dragged card stays in its frame — including when it is bigger than one.
 * Run: npx tsx core/embed/widget/dragBounds.assert.ts
 *
 * The arithmetic is four lines and it was wrong in a way nobody would have
 * noticed from reading it: with a box taller than its frame, a plain clamp has
 * `min > max` and collapses to one value, so the Wizard card — 660px in a
 * 596px screen — would have been immovable rather than pannable. That case is
 * the reason this file exists.
 */
import { clampDragOffset, type DragAxis } from "./dragBounds";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

/** A 200px card sitting at 100 inside a frame that runs 0…1000. */
const roomy = (over: Partial<DragAxis> = {}): DragAxis => ({
  start: 0,
  end: 1000,
  margin: 0,
  base: 100,
  size: 200,
  ...over,
});

assert(clampDragOffset(0, roomy()) === 0, "no pull, no move");
assert(clampDragOffset(50, roomy()) === 50, "a pull inside the frame is taken as given");

/**
 * The box may travel until its own edge meets the frame's, and no further —
 * the offset is relative to where the page put it, so the limits are the
 * frame's edges minus that base.
 */
assert(clampDragOffset(-500, roomy()) === -100, "stopped where its start meets the frame's");
assert(clampDragOffset(5000, roomy()) === 700, "stopped where its end meets the frame's");

/** A margin holds the box off both edges by that much. */
assert(clampDragOffset(-500, roomy({ margin: 40 })) === -60, "the margin holds it off the start");
assert(clampDragOffset(5000, roomy({ margin: 40 })) === 660, "and off the end");

/** A frame that does not begin at the origin: every limit shifts with it. */
assert(
  clampDragOffset(-500, roomy({ start: 300, end: 1300 })) === 200,
  "a frame further down the page moves the limits with it",
);

/**
 * The oversized case: a 660px card in a 596px frame, placed so its bottom sits
 * on the frame's bottom edge — which is where the landing page authors it.
 *
 * Both limits still exist, they have simply swapped ends: the card may be
 * pulled down until its top meets the frame's top (+64), and up until its
 * bottom meets the frame's bottom (0). Anywhere in between it still covers the
 * frame completely, which is what "inside" means for something too big to fit.
 */
const oversized: DragAxis = { start: 0, end: 596, margin: 0, base: -64, size: 660 };

assert(clampDragOffset(0, oversized) === 0, "it starts where the page put it");
assert(clampDragOffset(40, oversized) === 40, "and may be pulled down within the overhang");
assert(clampDragOffset(500, oversized) === 64, "down only until its top reaches the frame's");
assert(clampDragOffset(-500, oversized) === 0, "up only until its bottom reaches the frame's");

/**
 * The same card in a frame it fits into comfortably behaves like any other —
 * the swap must not leak into the ordinary case.
 */
const fits: DragAxis = { start: 0, end: 900, margin: 0, base: 0, size: 660 };
assert(clampDragOffset(-500, fits) === 0, "a fitting box still stops at the frame's start");
assert(clampDragOffset(5000, fits) === 240, "and at the frame's end");

console.log("core/embed/widget/dragBounds.assert.ts: ok");
