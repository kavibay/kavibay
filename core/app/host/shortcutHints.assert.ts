import {
  CTRL_SHORTCUT_HINT_DELAY_MS,
  shortcutModifierLabel,
} from "./shortcutHints";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

assert(CTRL_SHORTCUT_HINT_DELAY_MS === 750, "Ctrl shortcut hints wait 750ms");
assert(shortcutModifierLabel() === "Ctrl", "non-browser shortcut hints use Ctrl");

console.log("shortcutHints.assert.ts: ok");
