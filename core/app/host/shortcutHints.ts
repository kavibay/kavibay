import type { InjectionKey, Ref } from "vue";

/** Hold duration before the keyboard hints become visible. */
export const CTRL_SHORTCUT_HINT_DELAY_MS = 750;

/** Surface whose pin/hide controls should advertise their keyboard chords. */
export type ShortcutHintTarget =
  | { kind: "palette" }
  | { kind: "widget"; instanceId: string };

/** Shared, read-only target state provided by WidgetHost. */
export const SHORTCUT_HINT_TARGET_KEY: InjectionKey<
  Readonly<Ref<ShortcutHintTarget | null>>
> = Symbol("kavibayShortcutHintTarget");

/** Which keyboard the copy names keys for: a Mac's ⌘ and ⌃, or a PC's Ctrl. */
export type KeyPlatform = "mac" | "pc";

/** The keyboard behind this webview, read from its platform string. */
export function keyPlatform(
  platform = typeof navigator === "undefined"
    ? ""
    : navigator.platform || navigator.userAgent,
): KeyPlatform {
  return /Mac|iPhone|iPad/.test(platform) ? "mac" : "pc";
}

/** Platform modifier used in the visible chord label. */
export function shortcutModifierLabel(platform?: string): "Ctrl" | "⌘" {
  return keyPlatform(platform) === "mac" ? "⌘" : "Ctrl";
}

/**
 * The key the double tap listens for, as its keycap reads.
 *
 * On a Mac that is Control, not the ⌘ every other chord maps to. A Mac user
 * told "Ctrl" reaches for ⌘ first, so the label names the key in full.
 */
export function doubleTapKeyLabel(platform: KeyPlatform): "⌃ Control" | "Ctrl" {
  return platform === "mac" ? "⌃ Control" : "Ctrl";
}
