/**
 * Which demo rows reveal a card tagged with `opens-on`.
 * Run: npx tsx core/embed/palette/paletteOpen.assert.ts
 */
import { DEMO_ROWS } from "./demoRows";
import { opensWidget, paletteOpenDetail } from "./paletteOpen";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const clock = DEMO_ROWS.find((row) => row.id === "clock");
assert(clock, "the hand-written list includes Clock");
assert(opensWidget(paletteOpenDetail(clock!), "clock"), "Clock's row opens the Clock card");

const notes = DEMO_ROWS.find((row) => row.id === "notes");
assert(notes, "Notes is in the list");
assert(!opensWidget(paletteOpenDetail(notes!), "clock"), "Notes does not open the Clock card");

const chrome = DEMO_ROWS.find((row) => row.id === "chrome");
assert(chrome, "Chrome is in the list");
assert(
  !opensWidget(paletteOpenDetail(chrome!), "chrome"),
  "an app row does not open a widget card that shares its id",
);

console.log("core/embed/palette/paletteOpen.assert.ts: ok");
