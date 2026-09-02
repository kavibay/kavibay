/**
 * Asserts for the confetti intensity scale.
 * Run: npx tsx extensions/confetti/confettiLogic.assert.ts
 *
 * No `node:assert`: `extensions/**` is typechecked against the browser tsconfig,
 * which has no node types, so importing it fails `vue-tsc` (same reason as
 * `snakeLogic.assert.ts`).
 */
import { confettiBurstForIntensity } from "./confettiLogic";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function assertEq(actual: unknown, expected: unknown, msg: string): void {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${msg}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`,
  );
}

// The whole point of the default: level 3 must still be the burst this
// extension fired before the intensity parameter existed.
assertEq(
  confettiBurstForIntensity(undefined),
  { count: 100, size: 1, velocity: 200, fade: false },
  "no intensity reproduces the original burst",
);
assertEq(
  confettiBurstForIntensity("3"),
  confettiBurstForIntensity(undefined),
  "an explicit 3 is the default",
);

// --- velocity ---
assertEq(confettiBurstForIntensity("1").velocity, 120, "level 1 is the slow one");
assertEq(confettiBurstForIntensity("5").velocity, 280, "level 5 is the fast one");

// --- count ---
assertEq(confettiBurstForIntensity("1").count, 50, "level 1 halves the default");
assertEq(confettiBurstForIntensity("5").count, 200, "level 5 doubles it");
assert(
  confettiBurstForIntensity("2").count > confettiBurstForIntensity("1").count &&
    confettiBurstForIntensity("4").count < confettiBurstForIntensity("5").count,
  "the scale rises across every step, not just at the ends",
);

// --- input the palette can actually deliver ---
// The field is free text, so anything can arrive; nothing may produce a burst
// of NaN particles, which the library renders as no confetti at all.
assertEq(confettiBurstForIntensity("99").velocity, 280, "above the range clamps to 5");
assertEq(confettiBurstForIntensity("0").velocity, 120, "below the range clamps to 1");
assertEq(confettiBurstForIntensity("-4").count, 50, "a negative clamps to 1");
assertEq(confettiBurstForIntensity("invalid").velocity, 200, "unparseable falls back to 3");
assertEq(confettiBurstForIntensity("").velocity, 200, "an empty string is not zero");
for (const raw of [undefined, "", "invalid", "0", "-4", "99", "2.5"]) {
  const burst = confettiBurstForIntensity(raw);
  assert(
    Number.isInteger(burst.count) && burst.count > 0,
    `"${String(raw)}" must still yield a whole, positive count (got ${burst.count})`,
  );
}

console.log("confettiLogic.assert.ts: ok");
