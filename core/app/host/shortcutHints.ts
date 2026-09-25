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

/** Platform modifier used in the visible chord label. */
export function shortcutModifierLabel(): "Ctrl" | "⌘" {
  if (typeof navigator === "undefined") return "Ctrl";
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
    ? "⌘"
    : "Ctrl";
}
