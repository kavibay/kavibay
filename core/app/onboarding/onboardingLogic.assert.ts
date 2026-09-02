/**
 * Run: npx tsx core/app/onboarding/onboardingLogic.assert.ts
 */
import {
  advanceStep,
  defaultActiveState,
  isCardStep,
  isCoachVisible,
  onboardingProgress,
  onboardingStatusLabel,
  parseOnboardingState,
  replayOnboarding,
  retreatStep,
  serializeOnboardingState,
  shouldAutoStartOnboarding,
  skipTour,
} from "./onboardingLogic";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function assertEq(actual: unknown, expected: unknown, msg: string): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected), msg);
}

assertEq(defaultActiveState(), { status: "active", step: 1 }, "defaultActiveState");

assert(parseOnboardingState(null) === null, "parse null");
assertEq(
  parseOnboardingState(JSON.stringify({ status: "active", step: 11 })),
  { status: "active", step: 11 },
  "parse step 11",
);
assert(
  parseOnboardingState(JSON.stringify({ status: "active", step: 99 })) === null,
  "parse invalid step",
);

assertEq(advanceStep({ status: "active", step: 1 }), { status: "active", step: 2 }, "intro→search");
assertEq(advanceStep({ status: "active", step: 8 }), { status: "active", step: 9 }, "8→9 restore");
assertEq(advanceStep({ status: "active", step: 9 }), { status: "active", step: 10 }, "9→10 remove");
assertEq(advanceStep({ status: "active", step: 10 }), { status: "active", step: 11 }, "10→done");
assertEq(
  advanceStep({ status: "active", step: 11 }),
  { status: "completed", step: 11 },
  "done→completed",
);

assertEq(
  retreatStep({ status: "active", step: 2 }),
  { status: "active", step: 1 },
  "retreat search→intro",
);
assertEq(
  retreatStep({ status: "active", step: 11 }),
  { status: "active", step: 10 },
  "retreat done→remove",
);

assertEq(onboardingStatusLabel({ status: "active", step: 1 }), "Tour", "status intro");
assertEq(
  onboardingStatusLabel({ status: "active", step: 9 }),
  "Tour 8/9",
  "status restore",
);
assertEq(
  onboardingStatusLabel({ status: "active", step: 11 }),
  "Tour complete",
  "status done",
);

assert(isCardStep(1) === true, "intro is card");
assert(isCardStep(2) === false, "search is not card");
assert(isCoachVisible({ status: "active", step: 1 }) === true, "coach on intro");
assert(isCoachVisible({ status: "completed", step: 8 }) === false, "coach off when done");
assertEq(
  onboardingProgress({ status: "active", step: 1 }),
  { current: 0, total: 9, ratio: 0, label: "Tour" },
  "progress intro",
);
assertEq(
  onboardingProgress({ status: "active", step: 3 }),
  {
    current: 2,
    total: 9,
    ratio: 2 / 9,
    label: "Tour 2/9",
  },
  "progress gallery = teaching 2",
);
assertEq(
  onboardingProgress({ status: "active", step: 11 }),
  { current: 9, total: 9, ratio: 1, label: "Tour complete" },
  "progress done card",
);
assert(onboardingProgress({ status: "completed", step: 11 }) === null, "progress null when completed");
assertEq(replayOnboarding(), { status: "active", step: 1 }, "replay");
assertEq(
  skipTour({ status: "active", step: 8 }),
  { status: "completed", step: 8 },
  "skipTour",
);

// Serialize/parse round-trip: what is written must come back unchanged.
assertEq(
  parseOnboardingState(serializeOnboardingState({ status: "active", step: 4 })),
  { status: "active", step: 4 },
  "serialize round-trip",
);

// Auto-start only on a true first open with nothing stored yet — a veteran
// whose first-open was already consumed is never pushed into the tour.
assert(
  shouldAutoStartOnboarding({ firstOpenConsumed: true, storedRaw: null }) === true,
  "auto-start on first open",
);
assert(
  shouldAutoStartOnboarding({ firstOpenConsumed: false, storedRaw: null }) === false,
  "no auto-start before first open",
);
assert(
  shouldAutoStartOnboarding({
    firstOpenConsumed: true,
    storedRaw: serializeOnboardingState({ status: "completed", step: 10 }),
  }) === false,
  "no auto-start once state exists",
);

console.log("onboardingLogic.assert.ts: ok");
