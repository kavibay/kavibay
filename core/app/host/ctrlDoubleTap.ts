/**
 * Double tap on Ctrl — the half of the toggle that Rust cannot see.
 *
 * The rule itself lives in `src-tauri/src/ctrl_double_tap.rs`, fed by a
 * `WH_KEYBOARD_LL` hook on Windows and an `NSEvent` global monitor on macOS.
 * Neither sees the keys that go to Kavibay itself. The hook goes silent the
 * moment Kavibay's own webview holds the keyboard focus: the keys are delivered
 * to the webview and the hook is not called for them at all. Measured, not
 * assumed — with the cockpit open, the hook thread keeps servicing its message
 * queue on schedule while no key event ever reaches it, and events resume the
 * instant the window hides again. Apple documents the same for a global monitor,
 * which never receives events sent to its own app.
 *
 * So the toggle needs both halves, and they never overlap:
 *
 * - cockpit hidden → the keys go to some other application, Rust sees them, and
 *   opens the cockpit.
 * - cockpit open and focused → the keys go here, and this module closes it.
 *
 * The rule is deliberately a copy rather than a shared abstraction — the two
 * sides cannot share code across the language boundary, and the alternative
 * (letting the frontend own the whole thing) would lose the open path, which
 * only exists because Rust can watch the keyboard while another app has focus.
 * The constants and the wording below are kept identical to the Rust module on
 * purpose; both are pinned by their own tests.
 */

/** A tap is a quick press — holding Ctrl is reaching for a chord, not tapping. */
const MAX_TAP_MS = 300;
/** Allowed gap between the two presses. */
const MAX_GAP_MS = 400;

/** The keyboard events the rule depends on. */
export type CtrlKeyEvent = "ctrl-down" | "ctrl-up" | "other-down";

/** Two clean Ctrl taps in a row, with nothing typed in between. */
export interface CtrlTapState {
  /** When the current Ctrl press began, while it can still become a tap. */
  pressedAt: number | null;
  /** When the previous clean tap began. */
  firstTapAt: number | null;
}

/** A detector that has seen nothing yet. */
export function emptyCtrlTapState(): CtrlTapState {
  return { pressedAt: null, firstTapAt: null };
}

/** The verdict on one event, plus the state to carry into the next one. */
export interface CtrlTapResult {
  state: CtrlTapState;
  /** True exactly on the second clean tap of a pair. */
  doubleTap: boolean;
}

/**
 * Feed one keyboard event; the caller acts on `doubleTap`.
 *
 * `now` is a parameter rather than read in here so the rule can be tested at
 * speeds no human types at.
 */
export function observeCtrlTap(
  state: CtrlTapState,
  event: CtrlKeyEvent,
  now: number,
): CtrlTapResult {
  // Another key turns the held Ctrl into a modifier, and ends the chain
  // outright: Ctrl+C twice in a row is copying, and "Ctrl, a, Ctrl" is typing.
  if (event === "other-down") {
    return { state: emptyCtrlTapState(), doubleTap: false };
  }

  // Held keys repeat their down event; the first one is the press.
  if (event === "ctrl-down") {
    if (state.pressedAt !== null) return { state, doubleTap: false };
    return { state: { ...state, pressedAt: now }, doubleTap: false };
  }

  // No press on record: it was cancelled by another key, or this is the second
  // Ctrl of a two-Ctrl grip coming back up.
  const pressedAt = state.pressedAt;
  if (pressedAt === null) return { state, doubleTap: false };

  if (now - pressedAt > MAX_TAP_MS) {
    // A hold, so not a tap — and it separates whatever came before it from
    // whatever comes next.
    return { state: emptyCtrlTapState(), doubleTap: false };
  }

  if (state.firstTapAt !== null && pressedAt - state.firstTapAt <= MAX_GAP_MS) {
    return { state: emptyCtrlTapState(), doubleTap: true };
  }

  // Too slow to be the partner of the last tap, but a fine first half for the
  // next one.
  return { state: { pressedAt: null, firstTapAt: pressedAt }, doubleTap: false };
}

/** Classify a DOM keyboard event, or `null` for events the rule ignores. */
export function classifyCtrlKey(
  type: "keydown" | "keyup",
  key: string,
): CtrlKeyEvent | null {
  if (key === "Control") return type === "keydown" ? "ctrl-down" : "ctrl-up";
  // Only the fact that *something else* went down matters — never which key.
  return type === "keydown" ? "other-down" : null;
}
