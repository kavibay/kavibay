/**
 * Run: npx tsx core/app/host/widgetAppearance.assert.ts
 */
import { normalizeCatalogEntry } from "./deskLogic";
import { duplicateInstance, normalizeInstance } from "./layoutLogic";
import {
  effectiveWidgetAppearance,
  normalizeWidgetAppearance,
  radiusStyle,
  surfaceStyle,
} from "./widgetAppearance";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

assert(normalizeWidgetAppearance(undefined) === undefined, "no appearance stores nothing");
assert(normalizeWidgetAppearance({ blur: "x", background: "red" }) === undefined, "only invalid fields store nothing");

const clampedLook = normalizeWidgetAppearance({ background: "#ABC", opacity: 3, blur: 99, radius: -5 });
assert(clampedLook?.background === "#aabbcc", "short hex expands and lowercases");
assert(clampedLook?.opacity === 1, "opacity clamps to 1");
assert(clampedLook?.blur === 24, "blur clamps to the shared maximum");
assert(clampedLook?.radius === 0, "radius clamps to 0");

const manifest = { background: "#000000", opacity: 1, blur: 0, radius: 16 };
const mine = effectiveWidgetAppearance(manifest, { opacity: 0.4, blur: 12 });
assert(mine.background === "#000000" && mine.radius === 16, "the manifest fills what the instance leaves out");
assert(mine.opacity === 0.4 && mine.blur === 12, "the instance wins where it sets a value");

const glass = surfaceStyle({ background: "#102030", opacity: 0.4, blur: 12 });
assert(glass["--surface-bg-rgb"] === "16, 32, 48", "background becomes the rgb channels");
assert(glass["--surface-alpha"] === "0.4", "opacity becomes the surface alpha");
assert(
  glass["--surface-backdrop-filter"] === "blur(12px) saturate(var(--surface-saturate, 1))",
  "blur keeps the shared saturation lift",
);
assert(surfaceStyle({ blur: 0 })["--surface-backdrop-filter"] === "none", "blur 0 turns the filter off");
assert(surfaceStyle({ shadow: false })["--surface-box-shadow"] === "0 0 transparent", "shadow off drops the drop shadow");
assert(!("--surface-box-shadow" in surfaceStyle({ shadow: true })), "shadow on keeps the shared one");
assert(normalizeWidgetAppearance({ shadow: false })?.shadow === false, "shadow off is stored");
assert(normalizeWidgetAppearance({ shadow: "no" }) === undefined, "a non-boolean shadow is not stored");
assert(Object.keys(surfaceStyle({})).length === 0, "no fields leave the shared look alone");

assert(radiusStyle({ radius: 16 }, "round", false)["--surface-radius"] === "16px", "round corners keep the radius");
assert(
  radiusStyle({ radius: 32 }, "squircle", false)["--surface-radius"] === "17px",
  "a squircle without engine support gets the shallower round arc",
);
assert(Object.keys(radiusStyle({}, "round", true)).length === 0, "no radius keeps the shared one");

const cover = {
  instanceId: "a",
  typeId: "redacted",
  offset: { x: 0, y: 0 },
  appearance: { background: "#224466", opacity: 0.4 },
};
assert(duplicateInstance(cover).appearance?.background === "#224466", "a duplicate keeps its source's look");
assert(duplicateInstance(cover).appearance !== cover.appearance, "a duplicate gets its own copy to change");
assert(normalizeInstance(cover).appearance?.opacity === 0.4, "a saved instance keeps its look");
assert(
  normalizeCatalogEntry({ instanceId: "a", typeId: "redacted", appearance: { blur: -3 } }).appearance?.blur === 0,
  "the catalog stores the look clamped",
);
assert(
  !("appearance" in normalizeCatalogEntry({ instanceId: "a", typeId: "redacted", appearance: {} })),
  "an empty look is not stored",
);

console.log("widgetAppearance.assert.ts: ok");
