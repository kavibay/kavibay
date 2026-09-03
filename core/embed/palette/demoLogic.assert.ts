/**
 * Rank and keyboard-step for the marketing palette.
 * Run: npx tsx core/embed/palette/demoLogic.assert.ts
 */
import { DEMO_ROWS } from "./demoRows";
import { moveSelection, rankRows } from "./demoLogic";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

/**
 * The app's own rule: `filterPaletteRows` answers an empty query with `[]`,
 * and the panel is not rendered at all until something is typed. The demo used
 * to open with the whole list showing, which reads as a menu rather than a
 * search bar.
 */
assert(rankRows("").length === 0, "an empty query has no results");
assert(rankRows("   ").length === 0, "whitespace is an empty query too");
assert(DEMO_ROWS.length > 0, "there are rows to find once something is typed");

const notes = rankRows("note");
assert(
  notes.some((hit) => hit.row.id === "notes"),
  "note finds the Notes widget",
);
assert(
  notes.every((hit) => hit.row.id !== "chrome"),
  "note does not keep an unrelated app",
);

const wizard = rankRows("wiz");
assert(
  wizard.some((hit) => hit.row.id === "wizard"),
  "wiz finds Widget Wizard the way the app's fuzzy matcher does",
);

assert(moveSelection(0, -1, 4) === 0, "selection does not wrap past the top");
assert(moveSelection(3, 1, 4) === 3, "selection does not wrap past the bottom");
assert(moveSelection(1, 1, 4) === 2, "arrow down steps one row");
assert(moveSelection(0, 0, 0) === 0, "an empty list clamps to 0");

/**
 * The phrases the page-level tour types must find their rows.
 *
 * `fuzzyMatch` scores a query against one string at a time, so a two-word
 * query matches neither a one-word title nor a one-word keyword. The tour
 * typed "water tracker", the palette found nothing, and the last step of the
 * story silently did not happen.
 */
for (const [phrase, rowId] of [
  ["new widget", "new-widget"],
  ["water tracker", "water-tracker"],
  ["inbox", "inbox"],
] as const) {
  const hits = rankRows(phrase);
  assert(
    hits.some((hit) => hit.row.id === rowId),
    `the tour types "${phrase}" and expects the ${rowId} row to be found`,
  );
}

console.log("core/embed/palette/demoLogic.assert.ts: ok");
