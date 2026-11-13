/**
 * Run: npx tsx core/app/onboarding/setupLogic.assert.ts
 */
import {
  completedSetupState,
  isSetupVisible,
  nextSetupPage,
  SETUP_PAGES,
  parseSetupState,
  setupQuestionCount,
  pendingSetupState,
  serializeSetupState,
  shouldOfferDisplayChoice,
  shouldShowSetup,
} from "./setupLogic";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function assertEq(actual: unknown, expected: unknown, msg: string): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected), msg);
}

assertEq(pendingSetupState(), { status: "pending" }, "pendingSetupState");

// The double tap is the card's way forward on every page, but it only starts
// the tour from the last one: earlier it would skip the questions unseen.
assert(nextSetupPage("machine") === "ai", "gesture on page 1 goes to page 2");
assert(nextSetupPage("ai") === "start", "gesture on page 2 goes to the last page");
assert(nextSetupPage("start") === "finish", "gesture on the last page starts the tour");
assertEq(SETUP_PAGES, ["machine", "ai", "start"], "three pages in this order");

// The AI question is always asked, so the lead never says "no questions".
assert(setupQuestionCount({ autostart: false, displayChoice: false }) === 1, "AI question always counts");
assert(setupQuestionCount({ autostart: true, displayChoice: false }) === 2, "autostart and AI");
assert(setupQuestionCount({ autostart: true, displayChoice: true }) === 3, "all three");
assertEq(completedSetupState(), { status: "done" }, "completedSetupState");

assert(parseSetupState(null) === null, "parse null");
assert(parseSetupState("") === null, "parse empty");
assert(parseSetupState("{") === null, "parse malformed json");
assert(parseSetupState('{"status":"whatever"}') === null, "parse unknown status");
assertEq(
  parseSetupState('{"status":"pending"}'),
  { status: "pending" },
  "parse pending",
);
assertEq(
  parseSetupState(serializeSetupState(completedSetupState())),
  { status: "done" },
  "serialize round trip",
);

assert(isSetupVisible(null) === false, "no state paints nothing");
assert(isSetupVisible(pendingSetupState()), "pending paints");
assert(isSetupVisible(completedSetupState()) === false, "done does not paint");

// The card is for a genuinely new install and nothing else.
assert(
  shouldShowSetup({ firstOpenConsumed: true, storedRaw: null, tourStoredRaw: null }),
  "fresh install shows the card",
);
assert(
  shouldShowSetup({ firstOpenConsumed: false, storedRaw: null, tourStoredRaw: null }) === false,
  "a later launch does not",
);
assert(
  shouldShowSetup({
    firstOpenConsumed: true,
    storedRaw: '{"status":"done"}',
    tourStoredRaw: null,
  }) === false,
  "an answered card does not come back",
);
// The regression that matters: an existing user whose WebView cache was
// recreated must not be asked to configure startup all over again.
assert(
  shouldShowSetup({
    firstOpenConsumed: true,
    storedRaw: null,
    tourStoredRaw: '{"status":"completed","step":11}',
  }) === false,
  "a user who already ran the tour is left alone",
);

assert(shouldOfferDisplayChoice(1) === false, "one monitor asks nothing");
assert(shouldOfferDisplayChoice(0) === false, "no monitor reported asks nothing");
assert(shouldOfferDisplayChoice(2), "two monitors ask");

console.log("setupLogic.assert.ts: ok");
