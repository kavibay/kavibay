/**
 * Ctrl/Cmd+W or Ctrl/Cmd+H hides the widget the user is working in, while
 * Ctrl/Cmd+R removes it — the same actions the palette offers on a row, now
 * reachable without going back to the palette first.
 *
 * Both halves are kept pure so the interesting part (which card a keystroke
 * means) is testable without a DOM: the host only supplies what it already
 * tracks.
 */

/** What a matched close chord asks the host to do. */
export type WidgetCloseKeyAction = "hide" | "remove";

/** The keyboard-event fields the match depends on. */
export interface WidgetCloseKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * Ctrl/Cmd+W / H → hide, Ctrl/Cmd+R → remove; anything else → null.
 *
 * Shift is excluded so Ctrl+Shift+… chords (desk switch, nudge) keep their
 * meaning, and Alt so nothing collides with a window-manager binding.
 */
export function matchWidgetCloseKey(
  event: WidgetCloseKeyEvent,
): WidgetCloseKeyAction | null {
  if (!(event.ctrlKey || event.metaKey)) return null;
  if (event.altKey || event.shiftKey) return null;

  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (key === "w" || key === "h") return "hide";
  if (key === "r") return "remove";
  return null;
}

/** What the host knows about where the user currently is. */
export interface WidgetCloseTargetInput {
  /** True while `document.activeElement` sits inside the palette. */
  paletteHasFocus: boolean;
  /** Card containing `document.activeElement`, if any. */
  domInstanceId: string | null;
  /** Card that took keyboard focus from the palette (Tab / Enter). */
  focusedInstanceId: string | null;
  /** Topmost card — the last one clicked. */
  frontInstanceId: string | null;
  /** True while the palette is the active surface. */
  paletteFront: boolean;
}

/**
 * Which widget a close chord applies to, most explicit signal first.
 *
 * Typing in the palette always wins: its rows carry the same two chords, and
 * clicking into the search field does not clear the host's keyboard-focus
 * state — without this first check, Ctrl+H there would close the card you
 * tabbed through five keystrokes ago.
 *
 * After that the real DOM focus wins, then the host's keyboard-focus state
 * (set by Tab out of the palette, cleared by Shift+Tab back into it), then the
 * card the user last clicked — the last step only while the palette is not the
 * active surface, so an unfocused palette row still keeps its chord.
 */
export function resolveWidgetCloseTarget(
  input: WidgetCloseTargetInput,
): string | null {
  if (input.paletteHasFocus) return null;
  if (input.domInstanceId) return input.domInstanceId;
  if (input.focusedInstanceId) return input.focusedInstanceId;
  if (input.paletteFront) return null;
  return input.frontInstanceId;
}
