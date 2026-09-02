/**
 * Quick checks for appearance color-mode helpers
 * (run: npx tsx src/settings/appearanceLogic.assert.ts).
 */
import {
  DEFAULT_APPEARANCE,
  normalizeAppearance,
  normalizeColorMode,
  normalizeOpenMonitor,
  normalizeWidgetLayoutMode,
  OPEN_MONITOR_OPTIONS,
  toggleColorModeValue,
} from "./appearanceLogic";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(normalizeColorMode("system") === "system", "accept system");
assert(normalizeColorMode("light") === "light", "accept light");
assert(normalizeColorMode("dark") === "dark", "accept dark");
assert(normalizeColorMode("nope") === "dark", "unknown → dark");
assert(normalizeColorMode(undefined) === "dark", "missing → dark");

assert(toggleColorModeValue("dark") === "light", "toggle dark→light");
assert(toggleColorModeValue("light") === "dark", "toggle light→dark");

assert(DEFAULT_APPEARANCE.colorMode === "dark", "default dark");
assert(normalizeAppearance({}).colorMode === "dark", "empty object → dark");
assert(normalizeAppearance({ colorMode: "system" }).colorMode === "system", "preserve system");
assert(normalizeAppearance({ colorMode: "light" }).colorMode === "light", "preserve light");
assert(normalizeAppearance({ colorMode: "weird" }).colorMode === "dark", "bad colorMode → dark");

assert(
  normalizeAppearance({}).surfaceShadowStyle === "default",
  "missing shadow style → default",
);
assert(
  normalizeAppearance({ surfaceShadowStyle: "s15" }).surfaceShadowStyle === "s15",
  "preserve stripe shadow",
);
assert(
  normalizeAppearance({ surfaceShadowStyle: "nope" }).surfaceShadowStyle === "default",
  "bad shadow style → default",
);

assert(normalizeWidgetLayoutMode("freehand") === "freehand", "accept freehand");
assert(normalizeWidgetLayoutMode("grid") === "grid", "accept grid");
assert(normalizeWidgetLayoutMode("nope") === "freehand", "unknown → freehand");
assert(normalizeWidgetLayoutMode(undefined) === "freehand", "missing → freehand");
assert(DEFAULT_APPEARANCE.widgetLayoutMode === "freehand", "default freehand");
assert(
  normalizeAppearance({}).widgetLayoutMode === "freehand",
  "empty object → freehand",
);
assert(
  normalizeAppearance({ widgetLayoutMode: "grid" }).widgetLayoutMode === "grid",
  "preserve grid",
);

// --- open monitor -----------------------------------------------------------------
assert(normalizeOpenMonitor("cursor") === "cursor", "accept cursor");
assert(normalizeOpenMonitor("primary") === "primary", "accept primary");
assert(
  normalizeOpenMonitor("activeWindow") === "activeWindow",
  "accept activeWindow",
);
assert(normalizeOpenMonitor("nope") === "cursor", "unknown → cursor");
assert(normalizeOpenMonitor(undefined) === "cursor", "missing → cursor");
// Legacy stores hold lowercase ids; a casing slip must not silently pick a screen.
assert(
  normalizeOpenMonitor("activewindow") === "cursor",
  "wrong casing is not an activeWindow alias",
);
assert(
  OPEN_MONITOR_OPTIONS.every((opt) => normalizeOpenMonitor(opt.id) === opt.id),
  "every offered option survives a normalize round-trip",
);
assert(
  normalizeAppearance({ openMonitor: "activeWindow" }).openMonitor === "activeWindow",
  "preserve activeWindow through normalizeAppearance",
);

console.log("appearanceLogic.assert.ts: all passed");
