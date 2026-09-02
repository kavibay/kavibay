/**
 * Quick checks for the inline-widget zoom store.
 * Run: npx tsx core/app/palette/inlineWidgetZoom.assert.ts
 */
import { parseInlineZoom, withInlineZoom } from "./inlineWidgetZoom";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

// --- parsing -----------------------------------------------------------------
{
  assert(Object.keys(parseInlineZoom(null)).length === 0, "no stored value → empty map");
  assert(Object.keys(parseInlineZoom("not json")).length === 0, "garbage → empty map");
  assert(Object.keys(parseInlineZoom("[1,2]")).length === 0, "an array is not a map");

  const parsed = parseInlineZoom('{"a":1.5,"b":"nope","c":null,"d":2}');
  assert(parsed.a === 1.5 && parsed.d === 2, "usable scales survive");
  assert(!("b" in parsed) && !("c" in parsed), "non-numbers are dropped");
}

// Out-of-range values are clamped rather than discarded — a layout written by a
// future build with wider bounds should still open at the nearest usable zoom.
{
  const parsed = parseInlineZoom('{"tiny":0.1,"huge":99}');
  assert(parsed.tiny === 0.5, "below the floor clamps to it");
  assert(parsed.huge === 3, "above the ceiling clamps to it");
}

// The default zoom is the absence of an entry, on the way in as well as out.
assert(!("a" in parseInlineZoom('{"a":1}')), "a stored 1 is not kept");

// --- updating ----------------------------------------------------------------
{
  const first = withInlineZoom({}, "a", 1.5);
  assert(first.a === 1.5, "a zoom is remembered for that widget");

  const second = withInlineZoom(first, "b", 2);
  assert(second.a === 1.5 && second.b === 2, "widgets are remembered independently");
  assert(!("b" in first), "the input map is not mutated");

  const cleared = withInlineZoom(second, "a", 1);
  assert(!("a" in cleared), "zooming back to 1 forgets the entry instead of storing it");
  assert(cleared.b === 2, "and leaves the others alone");

  assert(withInlineZoom({}, "a", 99).a === 3, "an out-of-range gesture is clamped");
}

console.log("inlineWidgetZoom.assert.ts: ok");
