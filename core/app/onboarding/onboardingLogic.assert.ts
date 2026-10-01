/**
 * Run: npx tsx core/app/onboarding/onboardingLogic.assert.ts
 */
import {
  advanceStep,
  declinedState,
  defaultActiveState,
  stateAfterSetup,
  isCardStep,
  isCoachVisible,
  isLessonStep,
  ONBOARDING_DONE_STEP,
  ONBOARDING_HOTKEY_STEP,
  ONBOARDING_LESSONS,
  onboardingProgress,
  onboardingStatusLabel,
  parseOnboardingState,
  replayOnboarding,
  retreatStep,
  serializeOnboardingState,
  shouldAutoStartOnboarding,
  skipTour,
  teachingProgressIndex,
} from "./onboardingLogic";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function assertEq(actual: unknown, expected: unknown, msg: string): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected), msg);
}

assertEq(defaultActiveState(), { status: "active", step: 1 }, "defaultActiveState");

// The shape of the sequence, so a renumbering has to update this file too.
assert(ONBOARDING_HOTKEY_STEP === 2, "hotkey is the first thing taught");
assert(ONBOARDING_DONE_STEP === 6, "the tour ends on step 6");
assert(ONBOARDING_LESSONS === 4, "four lessons between the two cards");
assert(isLessonStep(ONBOARDING_HOTKEY_STEP) && isLessonStep(5), "hotkey through add are lessons");
assert(!isLessonStep(1) && !isLessonStep(ONBOARDING_DONE_STEP), "the two cards are not lessons");

assert(parseOnboardingState(null) === null, "parse null");
assertEq(
  parseOnboardingState(JSON.stringify({ status: "active", step: 6 })),
  { status: "active", step: 6 },
  "parse the ending",
);
// Steps 7–13 were the chrome lessons, now tips. A record from back then is
// unreadable rather than resumed on whatever step now carries that number.
assert(
  parseOnboardingState(JSON.stringify({ status: "active", step: 9 })) === null,
  "a retired step is not resumed",
);
// …and still counts as "toured", so nobody is sent through the tour again.
assert(
  shouldAutoStartOnboarding({
    firstOpenConsumed: true,
    storedRaw: JSON.stringify({ status: "completed", step: 13 }),
  }) === false,
  "a retired record still keeps the tour from auto-starting",
);

assertEq(advanceStep({ status: "active", step: 1 }), { status: "active", step: 2 }, "intro→hotkey");
assertEq(advanceStep({ status: "active", step: 2 }), { status: "active", step: 3 }, "hotkey→search");
assertEq(advanceStep({ status: "active", step: 5 }), { status: "active", step: 6 }, "add→ending");
assertEq(
  advanceStep({ status: "active", step: 6 }),
  { status: "completed", step: 6 },
  "ending→completed",
);
assertEq(
  retreatStep({ status: "active", step: 2 }),
  { status: "active", step: 1 },
  "retreat hotkey→intro",
);

assertEq(onboardingStatusLabel({ status: "active", step: 1 }), "Tour", "status intro");
assertEq(onboardingStatusLabel({ status: "active", step: 2 }), "Tour 1/4", "status hotkey");
assertEq(onboardingStatusLabel({ status: "active", step: 5 }), "Tour 4/4", "status last lesson");
assertEq(onboardingStatusLabel({ status: "active", step: 6 }), "Tour done", "status ending");
assert(onboardingStatusLabel({ status: "completed", step: 6 }) === null, "no label when done");

assert(isCardStep(1), "intro is card");
// The hotkey step has no on-screen target, so it is drawn centered like the
// two cards — but it is still a lesson, and still counts.
assert(isCardStep(ONBOARDING_HOTKEY_STEP), "hotkey is drawn as a card");
assert(teachingProgressIndex(ONBOARDING_HOTKEY_STEP) === 1, "hotkey still has a progress index");
assert(isCardStep(ONBOARDING_DONE_STEP), "the ending is a card");
assert(!isCardStep(3), "search is not card");
assert(teachingProgressIndex(1) === null, "intro has no progress index");
assert(teachingProgressIndex(ONBOARDING_DONE_STEP) === null, "ending has no progress index");

assert(isCoachVisible({ status: "active", step: 1 }), "coach on intro");
assert(!isCoachVisible({ status: "completed", step: 6 }), "coach off when done");

assertEq(
  onboardingProgress({ status: "active", step: 1 }),
  { current: 0, total: 4, ratio: 0, label: "Tour" },
  "progress intro is empty",
);
assertEq(
  onboardingProgress({ status: "active", step: 4 }),
  { current: 3, total: 4, ratio: 3 / 4, label: "Tour 3/4" },
  "progress gallery = 3",
);
assertEq(
  onboardingProgress({ status: "active", step: 6 }),
  { current: 4, total: 4, ratio: 1, label: "Tour done" },
  "progress ending is full",
);
assert(onboardingProgress({ status: "completed", step: 6 }) === null, "progress null when completed");
assertEq(replayOnboarding(), { status: "active", step: 1 }, "replay");
assertEq(skipTour({ status: "active", step: 4 }), { status: "completed", step: 4 }, "skipTour");

// Serialize/parse round-trip: what is written must come back unchanged.
assertEq(
  parseOnboardingState(serializeOnboardingState({ status: "active", step: 4 })),
  { status: "active", step: 4 },
  "serialize round-trip",
);

// Auto-start only on a true first open with nothing stored yet — a veteran
// whose first-open was already consumed is never pushed into the tour. This is
// also what keeps the move to a v3 key from replaying the tour for them: their
// v3 value is missing, and only `firstOpenConsumed` decides.
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
    storedRaw: serializeOnboardingState({ status: "completed", step: 5 }),
  }) === false,
  "no auto-start once state exists",
);

// The setup card carries the welcome, so the tour it starts skips that step —
// while Replay Tour, which has no card in front of it, still opens on it.
assertEq(
  stateAfterSetup(),
  { status: "active", step: ONBOARDING_HOTKEY_STEP },
  "after setup the tour opens on the hotkey lesson",
);
assertEq(replayOnboarding(), { status: "active", step: 1 }, "replay still opens on the welcome");
assert(
  JSON.stringify(stateAfterSetup()) !== JSON.stringify(defaultActiveState()),
  "the two entry points are genuinely different",
);

// Declining the tour from the card has to be *written*: an absent record is
// what makes the tour start by itself, so leaving it blank asks again tomorrow.
assertEq(declinedState(), { status: "completed", step: 1 }, "declined is a completed record");
assert(
  shouldAutoStartOnboarding({
    firstOpenConsumed: true,
    storedRaw: serializeOnboardingState(declinedState()),
  }) === false,
  "a declined tour does not come back on the next start",
);
assert(isCoachVisible(declinedState()) === false, "a declined tour paints nothing");

console.log("onboardingLogic.assert.ts: ok");
