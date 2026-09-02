/**
 * Asserts for the focused-widget hide/remove chords.
 * Run: npx tsx core/app/host/widgetCloseKeys.assert.ts
 */
import {
  matchWidgetCloseKey,
  resolveWidgetCloseTarget,
  type WidgetCloseKeyEvent,
  type WidgetCloseTargetInput,
} from "./widgetCloseKeys";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function keyEvent(over: Partial<WidgetCloseKeyEvent>): WidgetCloseKeyEvent {
  return {
    key: "h",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...over,
  };
}

// --- which chords count ----------------------------------------------------------
assert(matchWidgetCloseKey(keyEvent({ ctrlKey: true })) === "hide", "Ctrl+H hides");
assert(
  matchWidgetCloseKey(keyEvent({ key: "r", ctrlKey: true })) === "remove",
  "Ctrl+R removes",
);
assert(
  matchWidgetCloseKey(keyEvent({ key: "H", metaKey: true })) === "hide",
  "Cmd+Shift-less capital H still hides (caps lock)",
);
assert(matchWidgetCloseKey(keyEvent({})) === null, "bare letters never fire");
assert(
  matchWidgetCloseKey(keyEvent({ key: "n", ctrlKey: true })) === null,
  "other letters are not ours",
);

// Shift and Alt stay free: Ctrl+Shift+… is desk switch / nudge territory.
assert(
  matchWidgetCloseKey(keyEvent({ ctrlKey: true, shiftKey: true })) === null,
  "Ctrl+Shift+H is not a close chord",
);
assert(
  matchWidgetCloseKey(keyEvent({ ctrlKey: true, altKey: true })) === null,
  "Ctrl+Alt+H is not a close chord",
);

// --- which widget it means -------------------------------------------------------
function target(over: Partial<WidgetCloseTargetInput>): string | null {
  return resolveWidgetCloseTarget({
    paletteHasFocus: false,
    domInstanceId: null,
    focusedInstanceId: null,
    frontInstanceId: null,
    paletteFront: false,
    ...over,
  });
}

assert(
  target({ domInstanceId: "a", focusedInstanceId: "b", frontInstanceId: "c" }) === "a",
  "real DOM focus wins",
);
assert(
  target({ focusedInstanceId: "b", frontInstanceId: "c" }) === "b",
  "keyboard focus beats the front card",
);
assert(target({ frontInstanceId: "c" }) === "c", "otherwise the last clicked card");

// With the palette active its own Ctrl+H / Ctrl+R own the chord.
assert(
  target({ frontInstanceId: "c", paletteFront: true }) === null,
  "palette in front yields no widget target",
);
assert(
  target({ domInstanceId: "a", paletteFront: true }) === "a",
  "focus inside a card outranks the palette flag",
);
assert(
  target({ focusedInstanceId: "b", paletteFront: true }) === "b",
  "so does keyboard focus the host handed to a card",
);
assert(target({}) === null, "nothing focused, nothing to close");

// Clicking into the search field leaves focusedInstanceId behind; typing there
// must not close the card that state still points at.
assert(
  target({ paletteHasFocus: true, focusedInstanceId: "b", frontInstanceId: "c" }) === null,
  "focus in the palette yields the chord to its row",
);
assert(
  target({ paletteHasFocus: true, domInstanceId: "a" }) === null,
  "palette focus outranks even a stale card lookup",
);

console.log("widgetCloseKeys.assert.ts: ok");
