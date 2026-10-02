import { webEmit } from "./ipc";

/**
 * The overlay window, as far as a page can have one.
 *
 * On the desktop Rust shows and hides a transparent full-screen window and
 * turns a double Ctrl tap anywhere into `palette:hotkey`. Here the "window" is
 * the iframe's document: hiding it leaves the landing page's wallpaper, and the
 * same double tap brings it back — inside the iframe, or on the page around it,
 * which forwards it as a `kavibay:hotkey` message.
 *
 * The page is told about every change (`kavibay:window`) so it can show a way
 * back to someone who does not know the shortcut. It can also put the window
 * away (`kavibay:hide`), as clicking another app's window would.
 */

/** Longest gap between the two taps, as on the desktop. */
const DOUBLE_TAP_MS = 400;

let visible = true;

function setVisible(next: boolean): void {
  visible = next;
  document.documentElement.style.visibility = next ? "" : "hidden";
  window.parent.postMessage({ type: "kavibay:window", visible: next }, location.origin);
}

/** What Rust does on the hotkey: show the window if needed, then tell the app. */
function hotkey(): void {
  const revealed = !visible;
  if (revealed) setVisible(true);
  webEmit("palette:hotkey", { revealed, trigger: "ctrlDoubleTap" });
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
  let lastTap = 0;
  let clean = false;
  window.addEventListener("keydown", (event) => {
    clean = event.key === "Control" && !event.repeat;
  });
  window.addEventListener("keyup", (event) => {
    if (event.key !== "Control" || !clean) {
      lastTap = 0;
      return;
    }
    const now = performance.now();
    if (now - lastTap < DOUBLE_TAP_MS) {
      lastTap = 0;
      hotkey();
    } else {
      lastTap = now;
    }
  });
  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin) return;
    const type = (event.data as { type?: string } | null)?.type;
    if (type === "kavibay:hotkey") hotkey();
    if (type === "kavibay:hide" && visible) setVisible(false);
  });
}
