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

/** Replays `[event, milliseconds]` pairs; reports the verdict on the last one. */
function replay(events: [CtrlKeyEvent, number][]): boolean {
  let state = emptyCtrlTapState();
  let last = false;
  for (const [event, at] of events) {
    const result = observeCtrlTap(state, event, at);
    state = result.state;
    last = result.doubleTap;
  }
  return last;
}

// --- the plain double tap ---------------------------------------------------------
assert(
  replay([
    [DOWN, 0],
    [UP, 60],
    [DOWN, 180],
    [UP, 240],
  ]),
  "two quick taps are the toggle",
);
assert(!replay([[DOWN, 0], [UP, 60]]), "one tap does nothing");

// --- taps that are too slow -------------------------------------------------------
assert(
  !replay([
    [DOWN, 0],
    [UP, 60],
    [DOWN, 900],
    [UP, 960],
  ]),
  "a slow second tap does not fire",
);
assert(
  replay([
    [DOWN, 0],
    [UP, 60],
    [DOWN, 900],
    [UP, 960],
    [DOWN, 1100],
    [UP, 1160],
  ]),
  "...but it is a valid first half for the next pair",
);
assert(
  !replay([
    [DOWN, 0],
    [UP, 500],
    [DOWN, 600],
    [UP, 660],
  ]),
  "holding Ctrl is not a tap",
);

// --- chords are not taps ----------------------------------------------------------
assert(
  !replay([
    [DOWN, 0],
    [OTHER, 20],
    [UP, 60],
    [DOWN, 180],
    [OTHER, 200],
    [UP, 240],
  ]),
  "Ctrl+C twice in a row is copying, not the cockpit",
);
assert(
  !replay([
    [DOWN, 0],
    [UP, 60],
    [OTHER, 100],
    [DOWN, 180],
    [UP, 240],
  ]),
  "typing between two taps breaks the chain",
);
assert(
  !replay([
    [DOWN, 0],
    [OTHER, 40],
    [UP, 300],
    [DOWN, 400],
    [OTHER, 440],
    [UP, 700],
  ]),
  "holding Ctrl+Space to peek never toggles",
);

// --- events out of order ----------------------------------------------------------
assert(
  !replay([
    [DOWN, 0],
    [DOWN, 200],
    [DOWN, 400],
    [UP, 500],
    [DOWN, 600],
    [UP, 660],
  ]),
  "auto-repeat does not restart the press",
);
assert(!replay([[UP, 0]]), "a stray release is a no-op");

// --- DOM event classification -----------------------------------------------------
assert(classifyCtrlKey("keydown", "Control") === "ctrl-down", "Control down");
assert(classifyCtrlKey("keyup", "Control") === "ctrl-up", "Control up");
assert(classifyCtrlKey("keydown", "a") === "other-down", "any other key cancels");
assert(
  classifyCtrlKey("keyup", "a") === null,
  "releasing another key says nothing — only presses cancel",
);

console.log("ctrlDoubleTap.assert.ts: all assertions passed");
