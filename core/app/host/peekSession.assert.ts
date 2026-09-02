/**
 * Asserts for the hold-to-peek hotkey's press/release rule.
 * Run: npx tsx core/app/host/peekSession.assert.ts
 */
import { resolvePeek, type PeekInput } from "./peekSession";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function input(over: Partial<PeekInput>): PeekInput {
  return { pressed: true, cockpitOpen: false, peeking: false, ...over };
}

// --- the plain hold --------------------------------------------------------------
assert(resolvePeek(input({})) === "open", "pressing on a closed cockpit peeks");
assert(
  resolvePeek(input({ pressed: false, peeking: true })) === "close",
  "releasing ends the peek it started",
);

// --- an open cockpit is never touched --------------------------------------------
assert(
  resolvePeek(input({ cockpitOpen: true })) === "ignore",
  "peeking at what is already on screen does nothing",
);
assert(
  resolvePeek(input({ pressed: false, cockpitOpen: true })) === "ignore",
  "and its release must not close a toggled-open session",
);

// --- events that arrive out of order ---------------------------------------------
assert(
  resolvePeek(input({ peeking: true, cockpitOpen: true })) === "ignore",
  "a repeated press never restarts a running peek",
);
assert(
  resolvePeek(input({ pressed: false })) === "ignore",
  "a release with no peek behind it is a no-op, not a close",
);

console.log("peekSession.assert.ts: all assertions passed");
