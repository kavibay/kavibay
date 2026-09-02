import { nextWidgetFocusId } from "./widgetFocusCycle";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const ids = ["alarm", "timer", "notes"];

assert(nextWidgetFocusId([], null) === null, "empty list has no focus target");
assert(nextWidgetFocusId(ids, null) === "alarm", "first Ctrl+Tab selects first widget");
assert(nextWidgetFocusId(ids, "alarm") === "timer", "cycles forward");
assert(nextWidgetFocusId(ids, "notes") === null, "last widget returns to the palette");
assert(nextWidgetFocusId(ids, "alarm", true) === null, "first widget returns to the palette backward");
assert(nextWidgetFocusId(ids, null, true) === "notes", "Ctrl+Shift+Tab from palette selects last widget");
assert(nextWidgetFocusId(ids, "missing", true) === "notes", "unknown focus starts at the end backward");

console.log("widgetFocusCycle.assert.ts: ok");
