/**
 * Run: npx tsx core/app/onboarding/setupLogic.assert.ts
 */
import {
  completedSetupState,
  isSetupVisible,
  clampCardOffset,
  nextSetupPage,
  previousSetupPage,
  SETUP_PAGES,
  parseSetupState,
  pendingSetupState,
  serializeSetupState,
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
assert(previousSetupPage("machine") === null, "nothing before the first page");
assert(previousSetupPage("ai") === "machine", "back from the AI page");
assert(previousSetupPage("start") === "ai", "back from the last page");

// The card can be dragged out of the way (a browser sign-in opens behind it),
// but never off screen: a card nobody can reach is a setup nobody can finish.
{
  const card = { left: 400, top: 200, width: 440, height: 560 };
  const screen = { width: 1240, height: 960 };
  assertEq(clampCardOffset({ x: 100, y: -50 }, card, screen), { x: 100, y: -50 }, "inside stays put");
  assertEq(clampCardOffset({ x: -1000, y: 0 }, card, screen), { x: -392, y: 0 }, "stops 8px from the left edge");
  assertEq(clampCardOffset({ x: 1000, y: 0 }, card, screen), { x: 392, y: 0 }, "stops 8px from the right edge");
  assertEq(clampCardOffset({ x: 0, y: -1000 }, card, screen), { x: 0, y: -192 }, "stops 8px from the top");
  assertEq(clampCardOffset({ x: 0, y: 1000 }, card, screen), { x: 0, y: 192 }, "stops 8px from the bottom");
}

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


console.log("setupLogic.assert.ts: ok");
