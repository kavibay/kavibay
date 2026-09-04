/**
 * The bulk-add offer: what makes a widget eligible, and what stops a second
 * press from duplicating everything.
 * Run: npx tsx core/app/settings/extensionDetailLogic.assert.ts
 */
import type { ConfigField } from "@sdk/contract/sdk";
import {
  bulkAddField,
  bulkAddLabel,
  bulkAddSummary,
  pendingOptions,
  providerStatusLine,
} from "./extensionDetailLogic";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const zone: ConfigField = {
  type: "select",
  label: "Room",
  required: true,
  source: { provider: "kavibay.tado/tado", query: "zones" },
};

// --- eligibility -----------------------------------------------------------

assert(bulkAddField({ zone })?.key === "zone", "a required source-backed select is eligible");
assert(bulkAddField(undefined) === null, "a widget with no configuration is not eligible");
assert(bulkAddField({}) === null, "an empty schema is not eligible");

assert(
  bulkAddField({ zone: { ...zone, source: undefined } }) === null,
  "a select with static options has no list to expand",
);
assert(
  bulkAddField({ zone: { ...zone, required: false } }) === null,
  "an optional field means an unconfigured instance is already useful",
);
assert(
  bulkAddField({ zone: { ...zone, multiple: true } }) === null,
  "a multi-select instance already holds several options",
);
assert(
  bulkAddField({ zone: { ...zone, type: "string" } }) === null,
  "a free-text field has no option list",
);
assert(
  bulkAddField({ zone, board: { ...zone, label: "Board" } }) === null,
  "two source-backed selects make 'one per option' ambiguous, so nothing is offered",
);
assert(
  bulkAddField({ zone, label: { type: "string", label: "Title" } })?.key === "zone",
  "an unrelated field alongside it does not disqualify the widget",
);

// --- what is still missing -------------------------------------------------

const options = [
  { value: 1, label: "Living room" },
  { value: 2, label: "Kitchen" },
  { value: 3, label: "Study" },
];

assert(pendingOptions(options, []).length === 3, "nothing placed yet means every option is pending");
assert(
  pendingOptions(options, [1, 2, 3]).length === 0,
  "every option bound means the second press adds nothing",
);
assert(
  pendingOptions(options, ["1", "3"]).map((o) => o.value).join(",") === "2",
  "a numeric option matches the string its config round-tripped as",
);
assert(
  pendingOptions(options, [null, undefined]).length === 3,
  "an instance that never got a value does not claim an option",
);
assert(
  pendingOptions(options, [9]).length === 3,
  "a value the provider no longer returns blocks nothing",
);

// --- copy ------------------------------------------------------------------

assert(bulkAddLabel(zone) === "Add one widget per room", "the button borrows the field's own noun");
assert(
  bulkAddLabel({ ...zone, label: "  " }) === "Add one widget per option",
  "a blank label still reads as a sentence",
);
assert(bulkAddSummary(0, zone) === "Every room already has a widget.", "nothing added says so");
assert(bulkAddSummary(1, zone) === "Added 1 widget.", "one is singular");
assert(bulkAddSummary(4, zone) === "Added 4 widgets.", "several are plural");

// --- account line ----------------------------------------------------------

assert(providerStatusLine({ state: "connected" }).tone === "ok", "connected reads as settled");
assert(
  providerStatusLine({ state: "auth-expired" }).label === "Sign-in expired",
  "an expired sign-in is not the same message as never connected",
);
assert(
  providerStatusLine({ state: "auth-expired" }).tone === "warn",
  "an expired sign-in asks for action",
);
assert(
  providerStatusLine({ state: "disconnected" }).tone === "idle",
  "never connected is not a warning",
);
assert(
  providerStatusLine({ state: "error", message: "broker refused host" }).label ===
    "broker refused host",
  "an error shows what the host said, not a generic line",
);

console.log("extensionDetailLogic.assert.ts: ok");
