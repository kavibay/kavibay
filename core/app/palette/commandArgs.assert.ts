/**
 * Checks for action argument validation / chip navigation.
 * Run: npx tsx core/app/palette/commandArgs.assert.ts
 */
import type { ActionParam } from "@sdk/types";
import {
  alignArgValues,
  firstInvalidIndex,
  nextParamIndex,
  paramPlaceholder,
  previousParamIndex,
  validateActionArgs,
} from "./commandArgs";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function same(actual: unknown, expected: unknown, msg: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg}\n  expected: ${b}\n  actual:   ${a}`);
}

const text = (name: string, required = true): ActionParam => ({ name, type: "text", required });
const num = (name: string, required = true): ActionParam => ({ name, type: "number", required });
const en = (name: string, options: string[]): ActionParam => ({
  name,
  type: "enum",
  required: true,
  options,
});

// required + empty → invalid at that index
same(validateActionArgs([text("item")], [""]), { ok: false, invalidIndex: 0 }, "empty required");
same(validateActionArgs([text("item")], ["   "]), { ok: false, invalidIndex: 0 }, "blank required");
same(validateActionArgs([text("item")], []), { ok: false, invalidIndex: 0 }, "missing value");

// trimming, and inner spaces kept
same(
  validateActionArgs([text("item")], ["  milk  "]),
  { ok: true, args: { item: "milk" } },
  "values are trimmed",
);
same(
  validateActionArgs([text("item")], ["buy milk and eggs"]),
  { ok: true, args: { item: "buy milk and eggs" } },
  "free text keeps inner spaces",
);

// optional empty → key omitted, not ""
same(
  validateActionArgs([text("item"), text("list", false)], ["milk", ""]),
  { ok: true, args: { item: "milk" } },
  "empty optional param is dropped from args",
);

// number
same(validateActionArgs([num("level")], ["0"]), { ok: true, args: { level: "0" } }, "0 is valid");
same(
  validateActionArgs([num("level")], ["100"]),
  { ok: true, args: { level: "100" } },
  "100 is valid",
);
same(validateActionArgs([num("level")], ["abc"]), { ok: false, invalidIndex: 0 }, "abc is not a number");
same(
  validateActionArgs([num("level")], ["Infinity"]),
  { ok: false, invalidIndex: 0 },
  "Infinity is not a usable number",
);
same(
  validateActionArgs([num("minutes", false)], [""]),
  { ok: true, args: {} },
  "optional number may stay empty",
);

// enum: case-insensitive, canonical value emitted
const mode = en("mode", ["start", "stop", "restart"]);
same(validateActionArgs([mode], ["Start"]), { ok: true, args: { mode: "start" } }, "enum ignores case");
same(
  validateActionArgs([mode], ["  RESTART "]),
  { ok: true, args: { mode: "restart" } },
  "enum trims and canonicalizes",
);
same(validateActionArgs([mode], ["paused"]), { ok: false, invalidIndex: 0 }, "unknown enum value");
same(
  validateActionArgs([{ name: "mode", type: "enum", required: true }], ["whatever"]),
  { ok: true, args: { mode: "whatever" } },
  "enum without options degrades to free text",
);

// reports the FIRST offender
same(
  validateActionArgs([text("a"), num("b")], ["", "x"]),
  { ok: false, invalidIndex: 0 },
  "first offender wins",
);
assert(firstInvalidIndex([text("a"), num("b")], ["ok", "x"]) === 1, "second param invalid");
assert(firstInvalidIndex([text("a")], ["ok"]) === -1, "-1 when all valid");

// multi-param happy path
same(
  validateActionArgs([mode, num("minutes", false)], ["start", "45"]),
  { ok: true, args: { mode: "start", minutes: "45" } },
  "enum + optional number",
);

// no params → always valid
same(validateActionArgs([], []), { ok: true, args: {} }, "no params, no args");

// placeholders
assert(paramPlaceholder(text("item")) === "item", "falls back to the name");
assert(
  paramPlaceholder({ ...num("level"), placeholder: "Volume (0-100)" }) === "Volume (0-100)",
  "explicit placeholder wins",
);
// An enum names the choice rather than listing it: four options with real
// labels ("Correct grammar", "Write an answer") do not fit in a chip.
assert(paramPlaceholder(mode) === "Select mode", "enum asks for a choice by name");
assert(
  paramPlaceholder({ ...mode, placeholder: "Which mode?" }) === "Which mode?",
  "an explicit placeholder still wins over the enum default",
);

// chip navigation
assert(nextParamIndex(0, 2) === 1, "Tab advances");
assert(nextParamIndex(1, 2) === 0, "Tab cycles back to the first chip");
assert(nextParamIndex(0, 1) === 0, "single chip stays put");
assert(nextParamIndex(0, 0) === 0, "no chips, no crash");
assert(previousParamIndex(1) === 0, "Shift+Tab goes back");
assert(previousParamIndex(0) === -1, "-1 = leave argument mode");

// Growing/shrinking chips keep values by param name, not by index.
{
  const template = text("template");
  const name = text("name");
  const mood = text("mood");
  same(
    alignArgValues([template, name], [template], ["hallo {name}"]),
    ["hallo {name}", ""],
    "new placeholder chips start empty",
  );
  same(
    alignArgValues([template, mood], [template, name, mood], ["hi {mood}", "Alex", "gut"]),
    ["hi {mood}", "gut"],
    "removed placeholders drop; survivors keep their value",
  );
  same(
    alignArgValues([template], [], []),
    [""],
    "missing previous values seed empty strings",
  );
}

console.log("commandArgs.assert.ts: ok");
