import { webEmit, webEmitWhenHeard } from "./ipc";

/**
 * The overlay window, as far as a page can have one.
 *
 * On the desktop Rust shows and hides a transparent full-screen window and
 * turns a double Ctrl tap anywhere into `palette:hotkey`. Here the "window" is
 * the iframe's document: hiding it leaves the landing page's wallpaper. The
 * page around it plays Rust's part: a double tap there arrives as a
 * `kavibay:hotkey` message. A double tap inside the iframe is the app's own
 * (WidgetHost `onCtrlTapKey`), as it is on the desktop when the webview has
 * focus and Rust's hook sees nothing. Answering it here as well toggled twice:
 * the window opened and closed again in the same tap.
 *
 * The page is told about every change (`kavibay:window`) so it can show a way
 * back to someone who does not know the shortcut. It can also put the window
 * away (`kavibay:hide`), as clicking another app's window would, and forward
 * the hold-to-peek keys when focus is on the page (`kavibay:peek`).
 */

let visible = true;

function setVisible(next: boolean): void {
  visible = next;
  document.documentElement.style.visibility = next ? "" : "hidden";
  // A hidden window has no focus on the desktop; the next keys go to whatever
  // is behind it, and Rust's hook sees them. Here that is the page around us.
  if (!next && window.parent !== window) {
    (document.activeElement as HTMLElement | null)?.blur();
    window.parent.focus();
  }
  window.parent.postMessage({ type: "kavibay:window", visible: next }, location.origin);
}

/** What Rust does on the hotkey: show the window if needed, then tell the app. */
function hotkey(): void {
  const revealed = !visible;
  if (revealed) setVisible(true);
  // Rust focuses the window it shows. Here the keys were the page's, so the
  // frame takes the focus, or the palette's search field would not get any typing.
  window.focus();
  webEmit("palette:hotkey", { revealed, trigger: "ctrlDoubleTap" });
  // The palette asks for focus before it is on screen again, and a hidden
  // input cannot take it. Once it has painted, ask again; opening is idempotent.
  if (revealed) requestAnimationFrame(() => setTimeout(() => webEmit("palette:show"), 0));
}

/**
 * Hold Ctrl+Space: the widgets while the keys are down (Rust's `peek_cockpit`).
 * Like Rust this only ever shows; whether letting go hides the window again is
 * the host's call (`closeCockpit`), which knows about pinned cards.
 */
let peeking = false;
function peek(active: boolean): void {
  if (active === peeking) return;
  peeking = active;
  const revealed = active && !visible;
  if (revealed) setVisible(true);
  webEmit("cockpit:peek", { active, revealed });
}

export const WINDOW_ANSWERS: Record<string, () => unknown> = {
  "plugin:window|hide": () => setVisible(false),
  "plugin:window|show": () => setVisible(true),
  "plugin:window|set_focus": () => null,
  "plugin:window|is_visible": () => visible,
  "plugin:window|available_monitors": () => [],
};

/** Two Ctrl taps with nothing in between, like the desktop gesture. */
export function installWebHotkey(): void {
  window.addEventListener("keydown", (event) => {
    if (event.code === "Space" && event.ctrlKey) {
      event.preventDefault();
      peek(true);
    }
  });
  window.addEventListener("keyup", (event) => {
    if (peeking && (event.code === "Space" || event.key === "Control")) peek(false);
  });
  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin) return;
    const type = (event.data as { type?: string } | null)?.type;
    if (type === "kavibay:hotkey") hotkey();
    // What Rust reports when a click lands outside the cards: the host ends
    // its session and hides the window itself (closeCockpit), so a later
    // hotkey or peek starts from a closed cockpit, not a stale one.
    // During boot the host is not listening yet: it gets the click once it
    // is, and the window is put away directly in the meantime.
    if (type === "kavibay:hide" && visible) {
      webEmitWhenHeard("cockpit:outside-click", null);
      setTimeout(() => visible && setVisible(false), 50);
    }
    if (type === "kavibay:peek") peek((event.data as { active?: unknown }).active === true);
  });
}
