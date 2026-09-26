import { invoke } from "@tauri-apps/api/core";
import { ref, type Ref } from "vue";
import type { CockpitTrigger } from "./cockpitSession";

/**
 * Which keystroke can bring a hidden cockpit back on this machine.
 *
 * Asked of the host rather than derived from the user agent, because two of the
 * facts behind it are only known at start-up. The Ctrl double tap needs a way to
 * watch the keyboard, which Kavibay has on Windows and macOS and not on Linux.
 * The fallback, Shift+Ctrl+Space, is an ordinary accelerator that another
 * program may already own. `RevealGesture` in `src-tauri/src/lib.rs` records the
 * answer while it registers them.
 *
 * `null` means no keystroke reveals the window here and the tray icon is the
 * only way in. The guided tour is the caller that cares: teaching a key the
 * machine cannot deliver is worse than teaching none, because the user hides
 * Kavibay on the first instruction and then cannot get it back.
 */
export type RevealGesture = Extract<CockpitTrigger, "ctrlDoubleTap" | "cursorHotkey">;

const hasTauri = () => "__TAURI_INTERNALS__" in window;

/** Null until the host answers, and after it answers "none". */
export const revealGesture: Ref<RevealGesture | null> = ref(null);

/** True once the host has answered, so a caller can tell "none" from "not yet". */
export const revealGestureKnown = ref(false);

/**
 * Ask the host once. Shared across callers; safe to call from several.
 *
 * A failure is reported as "no keystroke", which sends the tour down the path
 * that names the tray icon — the one route that does not depend on anything
 * this call could have got wrong.
 */
export const revealGestureReady: Promise<void> = hasTauri()
  ? invoke<RevealGesture | null>("cockpit_reveal_gesture")
      .then((gesture) => {
        revealGesture.value = gesture ?? null;
      })
      .catch(() => {
        revealGesture.value = null;
      })
      .finally(() => {
        revealGestureKnown.value = true;
      })
  : Promise.resolve();
