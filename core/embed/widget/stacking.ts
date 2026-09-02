/**
 * One stacking order for every widget on the page.
 *
 * WHY THIS IS A MODULE AND NOT A VARIABLE IN THE COMPONENT:
 *
 * Everything inside `<script setup>` runs per instance — it *is* the setup
 * function. A counter declared there gives every card its own sequence, so
 * three cards touched in turn all ended up at `z-index: 2` and the one touched
 * last was not on top. Sharing the counter is the whole feature, so it lives
 * where sharing is the default.
 *
 * The app orders its widgets by DOM position instead, which a host that owns
 * the instance list can do. Here the page writes the markup and the elements
 * cannot reorder themselves, so the stacking is explicit.
 */
let top = 1;

/** The next z-index. Monotonic: whatever asked last sits above everything. */
export function nextStackOrder(): number {
  top += 1;
  return top;
}

/** Current top of the stack, without claiming it. For assertions. */
export function stackOrderTop(): number {
  return top;
}
