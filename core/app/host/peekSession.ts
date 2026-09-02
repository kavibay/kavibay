/**
 * Hold-to-peek: a hotkey that shows the desk's widgets only while it is held,
 * and takes them away again the moment it is released.
 *
 * The global shortcut is the one in the app that reports its release as well as
 * its press (see `peek_cockpit` in `src-tauri/src/lib.rs`), so the host sees two
 * events per hold and has to decide what each of them means. That decision is
 * the whole of this module: it depends only on what the host already tracks, so
 * it is a pure function instead of three booleans read out of a Vue component.
 *
 * The interesting rule is that a press lands on an already-open cockpit. Peeking
 * then does nothing at all — the widgets are on screen, and hiding them when the
 * key comes back up would close a session the user opened deliberately with the
 * Ctrl double tap.
 */

/** What the host should do with one half of a peek hotkey. */
export type PeekAction = "ignore" | "open" | "close";

/** The host state a peek event is judged against. */
export interface PeekInput {
  /** The press half (`true`) or the release half (`false`) of the hotkey. */
  pressed: boolean;
  /** Cockpit session currently open — by the toggle, the tray, or a peek. */
  cockpitOpen: boolean;
  /** A peek session from an earlier press is still running. */
  peeking: boolean;
}

/**
 * Press → open unless something is already showing; release → close only what
 * this peek opened.
 *
 * A release with `peeking: false` is normal, not an error: it follows every
 * ignored press, and it also follows a peek that the toggle promoted into a
 * real cockpit session mid-hold.
 */
export function resolvePeek(input: PeekInput): PeekAction {
  if (input.pressed) {
    // Auto-repeat is filtered natively (MOD_NOREPEAT), but a second press can
    // still arrive if the release was lost — never restart a running peek.
    if (input.peeking) return "ignore";
    return input.cockpitOpen ? "ignore" : "open";
  }
  return input.peeking ? "close" : "ignore";
}
