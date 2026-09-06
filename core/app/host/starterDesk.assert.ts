/**
 * Run: npx tsx core/app/host/starterDesk.assert.ts
 */
import {
  starterDeskIds,
  startsGated,
  STARTER_DESK_LIMIT,
  type StarterCandidate,
} from "./starterDesk";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function assertEq(actual: unknown, expected: unknown, msg: string): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected), msg);
}

const widget = (over: Partial<StarterCandidate> & { id: string }): StarterCandidate => ({
  enabled: true,
  isWidget: true,
  ...over,
});

assertEq(starterDeskIds([]), [], "nothing declared, nothing placed");

// Only widgets that asked for it, in the order they asked.
assertEq(
  starterDeskIds([
    widget({ id: "weather", starter: 3 }),
    widget({ id: "clock", starter: 1 }),
    widget({ id: "snake" }),
    widget({ id: "todo", starter: 2 }),
  ]),
  ["clock", "todo", "weather"],
  "starters in declared order, non-starters left out",
);

// A shipped-off extension is off on a fresh profile, which is exactly the
// profile this runs on — placing it would contradict its own manifest.
assertEq(
  starterDeskIds([
    widget({ id: "clock", starter: 1 }),
    widget({ id: "tado", starter: 2, enabled: false }),
  ]),
  ["clock"],
  "a disabled extension is not placed",
);

// Palette-only extensions have no card to place.
assertEq(
  starterDeskIds([widget({ id: "kill-port", starter: 1, isWidget: false })]),
  [],
  "an action-only extension is not placed",
);

// Reproducibility: the same build must greet every machine the same way, so a
// tie cannot fall through to module-resolution order.
assertEq(
  starterDeskIds([
    widget({ id: "zebra", starter: 2 }),
    widget({ id: "alpha", starter: 2 }),
  ]),
  ["alpha", "zebra"],
  "ties break on id, not on input order",
);
assertEq(
  starterDeskIds([
    widget({ id: "alpha", starter: 2 }),
    widget({ id: "zebra", starter: 2 }),
  ]),
  ["alpha", "zebra"],
  "…whichever order they arrived in",
);

// The cap is a blast radius, not a preference: enthusiasm in one manifest must
// not cost the new user a wall of cards.
const many = Array.from({ length: STARTER_DESK_LIMIT + 3 }, (_, i) =>
  widget({ id: `w${i}`, starter: i }),
);
assert(
  starterDeskIds(many).length === STARTER_DESK_LIMIT,
  "the desk is capped",
);
assertEq(starterDeskIds(many)[0], "w0", "the cap keeps the lowest starters");

// Zero and negative are ordinary positions, not "absent".
assertEq(
  starterDeskIds([
    widget({ id: "b", starter: 0 }),
    widget({ id: "a", starter: -1 }),
  ]),
  ["a", "b"],
  "0 and negatives are real positions",
);

// A starter claim only counts if the widget can actually show something. The
// case that made this exist: `weather` has no provider and looked like an ideal
// first card, and opened on a required Location field — a form as the first
// thing a new user ever sees.
assert(startsGated({}) === false, "a plain widget is not gated");
assert(
  startsGated({ configuration: { location: { required: true } } }),
  "a required configuration field is a gate",
);
assert(
  startsGated({ configuration: { units: { required: false }, tz: {} } }) === false,
  "optional fields are not a gate",
);
assert(
  startsGated({ requires: { providers: ["tado"] } }),
  "a provider requirement is a gate",
);
assert(
  startsGated({ requires: { providers: [] } }) === false,
  "an empty provider list is not a gate",
);
// Both at once, which is what a connected-account widget with a room picker is.
assert(
  startsGated({
    requires: { providers: ["tado"] },
    configuration: { zone: { required: true } },
  }),
  "provider plus required field is still a gate",
);

console.log("starterDesk.assert.ts: ok");
