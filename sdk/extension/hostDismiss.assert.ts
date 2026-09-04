// SPDX-License-Identifier: MIT
/**
 * Asserts for the host dismiss hold — in particular that two holders do not
 * speak for each other, which is the bug a shared boolean had.
 * Run: npx tsx sdk/extension/hostDismiss.assert.ts
 */
import { holdHostDismiss, hostDismissHeld, hostDismissHolders } from "./hostDismiss";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(!hostDismissHeld.value, "nothing holds the gestures at rest");
assert(hostDismissHolders.value.length === 0, "and nobody is listed");

// --- one holder ------------------------------------------------------------

const releaseFirst = holdHostDismiss("color-picker");
assert(hostDismissHeld.value, "a claim suspends the host's dismiss gestures");
assert(hostDismissHolders.value.join(",") === "color-picker", "the reason is carried");

// --- two holders, released out of order ------------------------------------

const releaseSecond = holdHostDismiss("color-picker");
assert(
  hostDismissHolders.value.join(",") === "color-picker,color-picker",
  "two instances of one widget are two claims, not one",
);

releaseFirst();
assert(
  hostDismissHeld.value,
  "the first instance finishing does not re-arm Escape under the second — the whole reason this is a list",
);
assert(hostDismissHolders.value.length === 1, "and exactly one claim survives");

releaseSecond();
assert(!hostDismissHeld.value, "the last release ends the hold");

// --- releasing twice -------------------------------------------------------

const releaseOnce = holdHostDismiss("a");
const releaseOther = holdHostDismiss("b");
releaseOnce();
releaseOnce();
assert(
  hostDismissHolders.value.join(",") === "b",
  "a double release drops its own claim only — a widget torn down mid-gesture releases from both its transition and its scope dispose",
);
releaseOther();
assert(!hostDismissHeld.value, "back to rest");

// --- ordering --------------------------------------------------------------

const releaseX = holdHostDismiss("x");
const releaseY = holdHostDismiss("y");
assert(hostDismissHolders.value.join(",") === "x,y", "holders are listed oldest first");
releaseX();
releaseY();
assert(!hostDismissHeld.value, "no claim outlives its release");

console.log("hostDismiss.assert.ts: ok");
