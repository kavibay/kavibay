import { invoke } from "@tauri-apps/api/core";

/** "pending" from the first open until the hint has been shown once. */
const BACKGROUND_HINT_KEY = "kavibay:background-hint";

/**
 * Tell a new user, once, that Kavibay is running when it starts hidden.
 *
 * The first open shows the window; every start after that — the first one is
 * usually autostart after a reboot — is a tray icon and nothing else, which
 * reads as the app not having started. Armed on the first open so existing
 * installs, whose users already know, never see it. Windows only, like the
 * notification capability it goes through.
 */
export function backgroundHintOnStart(firstOpen: boolean): void {
  try {
    if (firstOpen) {
      localStorage.setItem(BACKGROUND_HINT_KEY, "pending");
      return;
    }
    if (localStorage.getItem(BACKGROUND_HINT_KEY) !== "pending") return;
    localStorage.setItem(BACKGROUND_HINT_KEY, "done");
  } catch {
    return;
  }
  void invoke("widget_notification_show", {
    title: "Kavibay is running",
    body: "Tap Ctrl twice to open it — or double-click the tray icon.",
  }).catch(() => {});
}
