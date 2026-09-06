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
  isCoreStep,
  isExtraStep,
  ONBOARDING_CORE_DONE_STEP,
  ONBOARDING_CORE_STEPS,
  ONBOARDING_DONE_STEP,
  ONBOARDING_EXTRA_STEPS,
  ONBOARDING_HOTKEY_STEP,
  onboardingProgress,
  onboardingStatusLabel,
  parseOnboardingState,
  replayOnboarding,
  retreatStep,
  serializeOnboardingState,
  shouldAutoStartOnboarding,
  skipTour,
  teachingProgress,
  teachingProgressIndex,
  type OnboardingStep,
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
assert(ONBOARDING_CORE_DONE_STEP === 6, "the core tour ends on step 6");
assert(ONBOARDING_DONE_STEP === 13, "done card is step 13");
assert(ONBOARDING_CORE_STEPS === 4, "four lessons everybody gets");
assert(ONBOARDING_EXTRA_STEPS === 6, "six lessons only on request");
assert(
  ONBOARDING_CORE_STEPS + ONBOARDING_EXTRA_STEPS === ONBOARDING_DONE_STEP - 3,
  "every step that is not one of the three cards is a lesson in one section",
);

// Each step belongs to exactly one of: a card, the core, the extras.
for (let n = 1; n <= ONBOARDING_DONE_STEP; n += 1) {
  const step = n as OnboardingStep;
  const card = step === 1 || step === ONBOARDING_CORE_DONE_STEP || step === ONBOARDING_DONE_STEP;
  assert(
    [card, isCoreStep(step), isExtraStep(step)].filter(Boolean).length === 1 ||
      // The hotkey step is drawn as a card *and* is a core lesson; that overlap
      // is presentation, not membership, so it is the one allowed exception.
      step === ONBOARDING_HOTKEY_STEP,
    `step ${n} belongs to exactly one section`,
  );
}
assert(isCoreStep(ONBOARDING_HOTKEY_STEP), "hotkey is a core lesson");
assert(isCoreStep(5), "add is the last core lesson");
assert(!isCoreStep(ONBOARDING_CORE_DONE_STEP), "the core card is not a lesson");
assert(isExtraStep(7), "move is the first extra");
assert(isExtraStep(12), "delete is the last extra");
assert(!isExtraStep(ONBOARDING_DONE_STEP), "the completion card is not a lesson");

assert(parseOnboardingState(null) === null, "parse null");
assertEq(
  parseOnboardingState(JSON.stringify({ status: "active", step: 13 })),
  { status: "active", step: 13 },
  "parse step 13",
);
assert(
  parseOnboardingState(JSON.stringify({ status: "active", step: 99 })) === null,
  "parse invalid step",
);

assertEq(advanceStep({ status: "active", step: 1 }), { status: "active", step: 2 }, "intro→hotkey");
assertEq(advanceStep({ status: "active", step: 2 }), { status: "active", step: 3 }, "hotkey→search");
// The branch is in the card's buttons, not the state machine: advancing off the
// core card is the user asking for the extras.
assertEq(
  advanceStep({ status: "active", step: ONBOARDING_CORE_DONE_STEP }),
  { status: "active", step: 7 },
  "core card→first extra",
);
assertEq(advanceStep({ status: "active", step: 12 }), { status: "active", step: 13 }, "12→done");
assertEq(
  advanceStep({ status: "active", step: 13 }),
  { status: "completed", step: 13 },
  "done→completed",
);

// …and the other way off the card is finishing, which is skipTour by another
// name. The stored step is what tells the two endings apart afterwards.
assertEq(
  skipTour({ status: "active", step: ONBOARDING_CORE_DONE_STEP }),
  { status: "completed", step: ONBOARDING_CORE_DONE_STEP },
  "finishing at the core card",
);

assertEq(
  retreatStep({ status: "active", step: 2 }),
  { status: "active", step: 1 },
  "retreat hotkey→intro",
);
// Stepping back out of the extras lands on the offer, not past it.
assertEq(
  retreatStep({ status: "active", step: 7 }),
  { status: "active", step: ONBOARDING_CORE_DONE_STEP },
  "retreat first extra→core card",
);

// Progress is counted per section: "Tour 4/4" is a finished promise, and the
// extras start their own short count rather than continuing to 10.
assertEq(onboardingStatusLabel({ status: "active", step: 1 }), "Tour", "status intro");
assertEq(onboardingStatusLabel({ status: "active", step: 2 }), "Tour 1/4", "status hotkey");
assertEq(onboardingStatusLabel({ status: "active", step: 5 }), "Tour 4/4", "status last core");
assertEq(
  onboardingStatusLabel({ status: "active", step: ONBOARDING_CORE_DONE_STEP }),
  "Tour done",
  "status core card",
);
assertEq(onboardingStatusLabel({ status: "active", step: 7 }), "More 1/6", "status first extra");
assertEq(onboardingStatusLabel({ status: "active", step: 12 }), "More 6/6", "status last extra");
assertEq(
  onboardingStatusLabel({ status: "active", step: 13 }),
  "Tour complete",
  "status done",
);

assertEq(
  teachingProgress(2),
  { index: 1, total: 4, section: "core" },
  "hotkey is core 1/4",
);
assertEq(
  teachingProgress(7),
  { index: 1, total: 6, section: "extra" },
  "move is extra 1/6",
);
assert(teachingProgress(1) === null, "intro is in no section");
assert(teachingProgress(ONBOARDING_CORE_DONE_STEP) === null, "core card is in no section");
assert(teachingProgress(ONBOARDING_DONE_STEP) === null, "done card is in no section");

assert(isCardStep(1) === true, "intro is card");
// The hotkey step has no on-screen target, so it is drawn centered like the
// three punctuation cards — but it is still a lesson, and still counts.
assert(isCardStep(ONBOARDING_HOTKEY_STEP) === true, "hotkey is drawn as a card");
assert(teachingProgressIndex(ONBOARDING_HOTKEY_STEP) === 1, "hotkey still has a progress index");
assert(isCardStep(ONBOARDING_CORE_DONE_STEP) === true, "core card is a card");
assert(isCardStep(3) === false, "search is not card");
assert(teachingProgressIndex(1) === null, "intro has no progress index");
assert(teachingProgressIndex(ONBOARDING_DONE_STEP) === null, "done card has no progress index");

assert(isCoachVisible({ status: "active", step: 1 }) === true, "coach on intro");
assert(isCoachVisible({ status: "completed", step: 8 }) === false, "coach off when done");

assertEq(
  onboardingProgress({ status: "active", step: 1 }),
  { current: 0, total: 4, ratio: 0, label: "Tour" },
  "progress intro is an empty core",
);
assertEq(
  onboardingProgress({ status: "active", step: 4 }),
  { current: 3, total: 4, ratio: 3 / 4, label: "Tour 3/4" },
  "progress gallery = core 3",
);
assertEq(
  onboardingProgress({ status: "active", step: ONBOARDING_CORE_DONE_STEP }),
  { current: 4, total: 4, ratio: 1, label: "Tour done" },
  "progress core card is a full core",
);
assertEq(
  onboardingProgress({ status: "active", step: 7 }),
  { current: 1, total: 6, ratio: 1 / 6, label: "More 1/6" },
  "the arc restarts for the extras",
);
assertEq(
  onboardingProgress({ status: "active", step: 13 }),
  { current: 6, total: 6, ratio: 1, label: "Tour complete" },
  "progress done card is a full set of extras",
);
assert(
  onboardingProgress({ status: "completed", step: 13 }) === null,
  "progress null when completed",
);
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
    storedRaw: serializeOnboardingState({ status: "completed", step: 10 }),
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
