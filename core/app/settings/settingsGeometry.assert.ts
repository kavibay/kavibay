/**
 * Settings modal geometry helpers.
 * Run: npx tsx core/app/settings/settingsGeometry.assert.ts
 */
import {
  clampSettingsGeometry,
  defaultSettingsGeometry,
  normalizeSettingsGeometry,
  SETTINGS_MARGIN,
} from "./settingsGeometry";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const d = defaultSettingsGeometry(1000, 800);
assert(d.cx === 500 && d.cy === 400, "default center");
assert(d.width === 720 && d.height === 480, "default size");

assert(normalizeSettingsGeometry(null) === null, "null");
assert(normalizeSettingsGeometry({ cx: 1, cy: 2, width: 3 }) === null, "incomplete");

const clamped = clampSettingsGeometry(
  { cx: -100, cy: 9000, width: 2000, height: 2000 },
  1000,
  800,
);
assert(clamped.width <= 1000 - SETTINGS_MARGIN * 2, "width fits viewport");
assert(clamped.height <= 800 - SETTINGS_MARGIN * 2, "height fits viewport");
assert(clamped.cx >= SETTINGS_MARGIN + clamped.width / 2, "cx min");
assert(clamped.cy <= 800 - SETTINGS_MARGIN - clamped.height / 2, "cy max");

console.log("settingsGeometry.assert.ts: ok");
