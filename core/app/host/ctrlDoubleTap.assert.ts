/**
 * Asserts for the frontend half of the Ctrl double tap.
 * Run: npx tsx core/app/host/ctrlDoubleTap.assert.ts
 *
 * These mirror the Rust tests in `src-tauri/src/ctrl_double_tap.rs` case for
 * case. The two halves of the toggle must agree on what counts as a double tap,
 * or the same fingers would open reliably and close only sometimes.
 */
import {
  classifyCtrlKey,
  emptyCtrlTapState,
  observeCtrlTap,
  type CtrlKeyEvent,
} from "./ctrlDoubleTap";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const DOWN: CtrlKeyEvent = "ctrl-down";
const UP: CtrlKeyEvent = "ctrl-up";
const OTHER: CtrlKeyEvent = "other-down";

/** Replays `[event, milliseconds]` pairs; returns the times the toggle fired. */
function fires(events: [CtrlKeyEvent, number][]): number[] {
  let state = emptyCtrlTapState();
  const out: number[] = [];
  for (const [event, at] of events) {
    const result = observeCtrlTap(state, event, at);
    state = result.state;
    if (result.doubleTap) out.push(at);
  }
  return out;
}

function same(actual: number[], expected: number[], msg: string) {
  assert(
    actual.length === expected.length && actual.every((at, i) => at === expected[i]),
    `${msg} (fired at [${actual.join(", ")}], expected [${expected.join(", ")}])`,
  );
}

// --- the plain double tap ---------------------------------------------------------
same(fires([[DOWN, 0], [UP, 60], [DOWN, 180], [UP, 240]]), [180], "two quick taps toggle on the second press");
same(fires([[DOWN, 0], [UP, 60]]), [], "one tap does nothing");
same(fires([[DOWN, 0], [UP, 60], [DOWN, 400]]), [400], "the gap is measured press to press");
same(fires([[DOWN, 0], [UP, 60], [DOWN, 401]]), [], "...and ends at 400ms");

// --- taps that are too slow -------------------------------------------------------
same(fires([[DOWN, 0], [UP, 60], [DOWN, 900], [UP, 960]]), [], "a slow second tap does not fire");
same(
  fires([[DOWN, 0], [UP, 60], [DOWN, 900], [UP, 960], [DOWN, 1100], [UP, 1160]]),
  [1100],
  "...but it is a valid first half for the next pair",
);
same(fires([[DOWN, 0], [UP, 500], [DOWN, 600], [UP, 660]]), [], "holding Ctrl is not a tap");

// --- after the toggle ---------------------------------------------------------------
same(
  fires([[DOWN, 0], [UP, 60], [DOWN, 180], [UP, 240], [DOWN, 300], [UP, 360]]),
  [180],
  "the press that fired is not half of the next pair",
);
same(
  fires([[DOWN, 0], [UP, 60], [DOWN, 180], [UP, 240], [DOWN, 300], [UP, 360], [DOWN, 420]]),
  [180, 420],
  "two fresh taps after it are a new pair",
);
same(
  fires([[DOWN, 0], [UP, 60], [DOWN, 180], [DOWN, 700], [DOWN, 730], [UP, 900]]),
  [180],
  "holding the second press fires once",
);
same(
  fires([[DOWN, 0], [UP, 60], [DOWN, 180], [OTHER, 200], [UP, 240]]),
  [180],
  "a tap then a chord toggles by design",
);

// --- chords are not taps ----------------------------------------------------------
same(
  fires([[DOWN, 0], [OTHER, 20], [UP, 60], [DOWN, 180], [OTHER, 200], [UP, 240]]),
  [],
  "Ctrl+C twice in a row is copying, not the cockpit",
);
same(
  fires([[DOWN, 0], [UP, 60], [OTHER, 100], [DOWN, 180], [UP, 240]]),
  [],
  "typing between two taps breaks the chain",
);
same(
  fires([[DOWN, 0], [OTHER, 40], [UP, 300], [DOWN, 400], [OTHER, 440], [UP, 700]]),
  [],
  "holding Ctrl+Space to peek never toggles",
);

// --- events out of order ----------------------------------------------------------
same(
  fires([[DOWN, 0], [DOWN, 200], [DOWN, 400], [UP, 500], [DOWN, 600], [UP, 660]]),
  [],
  "auto-repeat does not restart the press",
);
same(fires([[UP, 0]]), [], "a stray release is a no-op");

// --- DOM event classification -----------------------------------------------------
assert(classifyCtrlKey("keydown", "Control") === "ctrl-down", "Control down");
assert(classifyCtrlKey("keyup", "Control") === "ctrl-up", "Control up");
assert(classifyCtrlKey("keydown", "Control", true) === null, "a repeated Control down is not a press");
assert(classifyCtrlKey("keydown", "a") === "other-down", "any other key cancels");
assert(classifyCtrlKey("keydown", "a", true) === "other-down", "a repeating other key still cancels");
assert(
  classifyCtrlKey("keyup", "a") === null,
  "releasing another key says nothing — only presses cancel",
);

console.log("ctrlDoubleTap.assert.ts: all assertions passed");
