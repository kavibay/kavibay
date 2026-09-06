import { invoke } from "@tauri-apps/api/core";
import { ref, type Ref } from "vue";

/**
 * "Start Kavibay when I log in", shared by the setup card and Settings.
 *
 * The odd one out among the preference composables: every other one keeps its
 * value in localStorage and lets the durable mirror carry it to disk, but this
 * one has no value of its own to keep. The truth is a registry entry on Windows
 * and a `.desktop` file on Linux (see `src-tauri/src/autostart.rs`), both of
 * which the user can remove from outside the app — through Task Manager's
 * Startup tab, GNOME Tweaks, an uninstaller, a reinstall to a different folder.
 * A mirrored copy would go on claiming "on" long after the entry was gone.
 *
 * So the ref is a cache of what the host last reported, refreshed on read and
 * corrected on every write, and the host is asked rather than told.
 */

const hasTauri = () => "__TAURI_INTERNALS__" in window;

/** Last known state of the autostart entry. */
const enabled: Ref<boolean> = ref(false);
/** False on platforms with no mechanism, so the UI can omit the switch. */
const supported: Ref<boolean> = ref(false);
/** Set when the host refused a write, for the caller to show next to the switch. */
const error: Ref<string | null> = ref(null);

let refreshed: Promise<void> | null = null;

/** Ask the host for the current state; the first call is shared by every caller. */
function refresh(): Promise<void> {
  if (!hasTauri()) return Promise.resolve();
  refreshed ??= (async () => {
    try {
      supported.value = await invoke<boolean>("autostart_supported");
      if (supported.value) {
        enabled.value = await invoke<boolean>("autostart_enabled");
      }
    } catch {
      // An unreadable entry is reported as off rather than as a broken switch:
      // switching it on writes the entry either way, which is the repair.
      supported.value = false;
    }
  })();
  return refreshed;
}

export function useAutostart() {
  void refresh();

  /**
   * Create or remove the autostart entry.
   *
   * The ref follows the host, not the click: a refused write leaves the switch
   * where it was and puts the reason in `error`, instead of showing an "on"
   * that no logon will honour.
   */
  async function setEnabled(on: boolean): Promise<void> {
    if (!hasTauri()) return;
    error.value = null;
    try {
      await invoke("autostart_set", { enabled: on });
      enabled.value = on;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
      // Re-read rather than assume the old value: a partial failure (entry
      // written, delete refused) is exactly when a guess would be wrong.
      try {
        enabled.value = await invoke<boolean>("autostart_enabled");
      } catch {
        // Keep the last known value; the switch stays honest about being stale.
      }
    }
  }

  return { enabled, supported, error, setEnabled, refresh };
}
