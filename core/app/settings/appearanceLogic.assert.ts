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
  normalizeAppearance({}).surfaceShadowStyle === "s2",
  "missing shadow style → s2",
);
assert(
  normalizeAppearance({ surfaceShadowStyle: "s15" }).surfaceShadowStyle === "s15",
  "preserve stripe shadow",
);
assert(
  normalizeAppearance({ surfaceShadowStyle: "nope" }).surfaceShadowStyle === "s2",
  "bad shadow style → s2",
);

assert(normalizeWidgetLayoutMode("freehand") === "freehand", "accept freehand");
assert(normalizeWidgetLayoutMode("grid") === "grid", "accept grid");
assert(normalizeWidgetLayoutMode("nope") === "grid", "unknown → grid");
assert(normalizeWidgetLayoutMode(undefined) === "grid", "missing → grid");
assert(DEFAULT_APPEARANCE.widgetLayoutMode === "grid", "default grid");
assert(normalizeAppearance({}).widgetLayoutMode === "grid", "empty object → grid");
// The non-default value is the one worth pinning: it has to survive a load.
assert(
  normalizeAppearance({ widgetLayoutMode: "freehand" }).widgetLayoutMode === "freehand",
  "preserve freehand",
);
assert(
  normalizeAppearance({ widgetLayoutMode: "grid" }).widgetLayoutMode === "grid",
  "preserve grid",
);

// --- hide on outside click -------------------------------------------------
assert(DEFAULT_APPEARANCE.hideOnOutsideClick === true, "default hides on outside click");
assert(normalizeAppearance({}).hideOnOutsideClick === true, "empty object → hide");
// Switching it off is a decision, so a stored `false` outranks the default.
assert(
  normalizeAppearance({ hideOnOutsideClick: false }).hideOnOutsideClick === false,
  "an explicit off survives a load",
);
assert(
  normalizeAppearance({ hideOnOutsideClick: "yes" }).hideOnOutsideClick === false,
  "a non-boolean is not a yes",
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
