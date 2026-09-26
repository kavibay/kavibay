import {
  CTRL_SHORTCUT_HINT_DELAY_MS,
  doubleTapKeyLabel,
  keyPlatform,
  shortcutModifierLabel,
} from "./shortcutHints";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

assert(CTRL_SHORTCUT_HINT_DELAY_MS === 750, "Ctrl shortcut hints wait 750ms");
assert(shortcutModifierLabel("MacIntel") === "⌘", "macOS shortcut hints use ⌘");
assert(shortcutModifierLabel("iPad") === "⌘", "iPadOS shortcut hints use ⌘");
assert(shortcutModifierLabel("Win32") === "Ctrl", "Windows shortcut hints use Ctrl");
assert(shortcutModifierLabel("Linux x86_64") === "Ctrl", "Linux shortcut hints use Ctrl");
assert(shortcutModifierLabel("") === "Ctrl", "an unknown platform falls back to Ctrl");

assert(keyPlatform("MacIntel") === "mac", "MacIntel is a Mac keyboard");
assert(keyPlatform("Win32") === "pc", "Win32 is a PC keyboard");
assert(doubleTapKeyLabel("mac") === "⌃ Control", "a Mac's double tap is on Control, not ⌘");
assert(doubleTapKeyLabel("pc") === "Ctrl", "a PC's double tap is on Ctrl");

console.log("shortcutHints.assert.ts: ok");
