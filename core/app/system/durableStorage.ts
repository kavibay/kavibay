/**
 * Makes the frontend's `kavibay:` localStorage keyspace survive a restart.
 *
 * WebView2 does not reliably commit localStorage to disk: writes can sit in the
 * browser process's memory and die with it, and the profile can be recreated
 * independently of the app data directory. Measured on this machine, `setItem`
 * succeeded and `getItem` returned the value while the profile's leveldb was not
 * touched for days — every note, alarm and timer was lost on the next start,
 * while Settings survived because `useAppearance` already mirrors itself into
 * AppData (see the comment there, which describes the same failure).
 *
 * Rather than rewrite 130+ synchronous call sites onto an async store, this
 * keeps localStorage as the fast cache and makes AppData the durable copy:
 *
 *   boot   → hydrate localStorage from `web-storage.json`
 *   write  → mark dirty, snapshot the keyspace back, debounced
 *   hide   → flush immediately (the window hides far more often than it exits)
 *
 * The worst case is losing the last {@link SAVE_DEBOUNCE_MS} of typing if the
 * process is killed mid-debounce, instead of losing everything.
 *
 * This side speaks plain JSON both ways; encryption at rest is the Rust side's
 * job (`web_storage.rs` wraps the payload with the OS secret store). Note that
 * localStorage itself stays unencrypted — see SECURITY.md, "Data at rest".
 */
import { invoke } from "@tauri-apps/api/core";

/** Every key the app owns starts with this; nothing else is mirrored. */
const DURABLE_PREFIX = "kavibay:";

/** Long enough to batch a burst of typing, short enough to lose little. */
const SAVE_DEBOUNCE_MS = 400;

const hasTauri = () => "__TAURI_INTERNALS__" in window;

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let hooked = false;

/** Current value of every mirrored key. */
function snapshot(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(DURABLE_PREFIX)) continue;
    const value = localStorage.getItem(key);
    if (value !== null) out[key] = value;
  }
  return out;
}

/** Write the snapshot to AppData now. */
async function save(): Promise<void> {
  if (saveTimer !== undefined) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }
  if (!hasTauri()) return;
  try {
    await invoke("web_storage_save", { value: JSON.stringify(snapshot()) });
  } catch (error) {
    // Nothing useful to do here — localStorage still holds the value, and the
    // next write retries the whole snapshot anyway. Log so a broken durable
    // store shows up in the console instead of only at the next restart.
    console.error("[kavibay] durable storage save failed:", error);
  }
}

/** Flush pending changes without waiting for the debounce. */
export function flushDurableStorage(): void {
  if (saveTimer === undefined) return;
  void save();
}

function scheduleSave(): void {
  if (saveTimer !== undefined) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void save(), SAVE_DEBOUNCE_MS);
}

/**
 * Notice every write to localStorage, wherever it comes from.
 *
 * Patched on `Storage.prototype` rather than the `localStorage` instance:
 * `Storage` is a legacy platform object whose named-property setter makes
 * assigning to the instance ambiguous. The guard on `this` keeps sessionStorage
 * — same prototype, not mirrored — out of it.
 */
function hookWrites(): void {
  if (hooked) return;
  hooked = true;

  const proto = Storage.prototype;
  const nativeSetItem = proto.setItem;
  const nativeRemoveItem = proto.removeItem;
  const nativeClear = proto.clear;

  proto.setItem = function setItem(key: string, value: string) {
    nativeSetItem.call(this, key, value);
    if (this === localStorage && key.startsWith(DURABLE_PREFIX)) scheduleSave();
  };
  proto.removeItem = function removeItem(key: string) {
    nativeRemoveItem.call(this, key);
    if (this === localStorage && key.startsWith(DURABLE_PREFIX)) scheduleSave();
  };
  proto.clear = function clear() {
    nativeClear.call(this);
    if (this === localStorage) scheduleSave();
  };

  // Writes from the other window of this origin — the quick-action popup runs
  // text actions that store widget content — never reach the patch above,
  // because it only sees this document. `storage` fires for exactly those.
  window.addEventListener("storage", (event) => {
    if (event.storageArea !== localStorage) return;
    if (event.key !== null && !event.key.startsWith(DURABLE_PREFIX)) return;
    scheduleSave();
  });

  // The window hides on Esc and on the close half of the toggle, far more often
  // than the app exits — the most reliable moment to get a snapshot out.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushDurableStorage();
  });
  window.addEventListener("pagehide", flushDurableStorage);
}

/**
 * Fill localStorage from the durable copy, then keep the two in sync.
 *
 * Must run before anything reads localStorage — several composables read at
 * import time, so the app's module graph has to be imported after this resolves
 * (see core/app/main.ts).
 *
 * AppData wins over what the WebView happens to still hold, for the same reason
 * `useAppearance` prefers its AppData copy: the profile is the unreliable side.
 * Keys the snapshot does not know stay untouched and join it on the next save,
 * which is what migrates an existing profile on first run.
 */
export async function hydrateDurableStorage(
  options: { mirror?: boolean } = {},
): Promise<void> {
  if (!hasTauri()) return;

  let raw: string | null;
  try {
    raw = await invoke<string | null>("web_storage_load");
  } catch (error) {
    // Could not read the durable copy — and therefore must not write it. The
    // snapshot below would replace a file full of notes with whatever this
    // empty session happens to hold, turning a failed read into real data loss.
    // A stale file the user can still recover from beats a confidently wrong one.
    console.error("[kavibay] durable storage unreadable, mirroring disabled:", error);
    return;
  }

  // `null` is not a failure: first run, nothing saved yet. Everything else gets
  // parsed leniently — a corrupt file is unusable either way, so mirroring
  // carries on and replaces it with something valid.
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (!key.startsWith(DURABLE_PREFIX) || typeof value !== "string") continue;
          localStorage.setItem(key, value);
        }
      } else {
        console.error("[kavibay] durable storage is not an object — ignoring it");
      }
    } catch (error) {
      console.error("[kavibay] durable storage could not be parsed:", error);
    }
  }

  // Only one window may own the mirror. The quick-action popup hydrates
  // read-only (`mirror: false`) so it renders with the real appearance and
  // widget state; the cockpit picks its writes up through the `storage` event.
  // Two writers would race over the same file for nothing.
  if (options.mirror === false) return;

  hookWrites();
  // First run (or a profile that carries keys the snapshot lacks): persist what
  // is there now, so the very first restart already has something to restore.
  scheduleSave();
}
