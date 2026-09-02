/**
 * Asserts for chrome × long-press resolve.
 * Run: npx tsx core/app/host/hidePressLogic.assert.ts
 */
import {
  HIDE_PRESS_ARM_MS,
  HIDE_PRESS_HINT_MS,
  hidePressTipLabel,
  resolveHidePressRelease,
} from "./hidePressLogic";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(HIDE_PRESS_ARM_MS === 750, "arm delay is 750ms");
assert(HIDE_PRESS_HINT_MS === 20, "hint delay is 20ms");
assert(HIDE_PRESS_HINT_MS < HIDE_PRESS_ARM_MS, "hint must land before arming");

assert(
  resolveHidePressRelease("pressing", true) === "hide",
  "short press on × → hide",
);
assert(
  resolveHidePressRelease("pressing", false) === "cancel",
  "release off × while pressing → cancel",
);
assert(
  resolveHidePressRelease("armed", true) === "remove",
  "armed release on trash → remove",
);
assert(
  resolveHidePressRelease("armed", false) === "cancel",
  "armed release off control → cancel",
);
assert(
  resolveHidePressRelease("idle", true) === "cancel",
  "idle release → cancel",
);

// --- tip text tracks what releasing now would do ---------------------------------
assert(
  hidePressTipLabel("idle", true, false) === "Hide",
  "resting tip is Hide",
);
assert(
  hidePressTipLabel("pressing", true, false) === "Hide",
  "press before the hint delay still reads Hide",
);
assert(
  hidePressTipLabel("pressing", true, true) === "Long press to delete",
  "press past the hint delay advertises the gesture",
);
assert(
  hidePressTipLabel("armed", true, true) === "Delete",
  "armed press promises Delete",
);
assert(
  hidePressTipLabel("armed", false, true) === "Hide",
  "dragged off the control the tip falls back with the icon",
);
assert(
  hidePressTipLabel("pressing", false, true) === "Hide",
  "hint never shows while the pointer sits off the control",
);

console.log("hidePressLogic.assert.ts: ok");
