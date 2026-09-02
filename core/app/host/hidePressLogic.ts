/**
 * Chrome × long-press: short release hides; armed release deletes.
 */

/** Hold duration before × morphs to trash. */
export const HIDE_PRESS_ARM_MS = 750;

/**
 * Hold duration before the tip advertises the long press. Deliberately near-instant:
 * the hint should feel like it belongs to pressing down, not like a second thought.
 */
export const HIDE_PRESS_HINT_MS = 20;

/** Press lifecycle for the chrome hide control. */
export type HidePressPhase = "idle" | "pressing" | "armed";

/** What to do when the pointer is released during a hide-button gesture. */
export type HidePressReleaseAction = "hide" | "remove" | "cancel";

/**
 * Resolve pointer-up on the hide control.
 * Armed + on control → delete; pressing + on control → hide; otherwise cancel.
 */
export function resolveHidePressRelease(
  phase: HidePressPhase,
  releasedOnControl: boolean,
): HidePressReleaseAction {
  if (phase === "armed") {
    return releasedOnControl ? "remove" : "cancel";
  }
  if (phase === "pressing" && releasedOnControl) {
    return "hide";
  }
  return "cancel";
}

/**
 * Tip text for the chrome hide control — it tracks what releasing right now would do.
 *
 * `hinting` is presentational only (set once the press outlives HIDE_PRESS_HINT_MS);
 * it never changes the release action, so it stays out of the phase machine. Dragged
 * off the control the tip falls back to "Hide", matching the icon that morphs back.
 */
export function hidePressTipLabel(
  phase: HidePressPhase,
  overControl: boolean,
  hinting: boolean,
): string {
  if (!overControl) return "Hide";
  if (phase === "armed") return "Delete";
  if (phase === "pressing" && hinting) return "Long press to delete";
  return "Hide";
}
