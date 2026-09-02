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
 *   boot   → hydrate localStorage from the durable files
 *   write  → mark dirty, snapshot the keyspace back, debounced
 *   hide   → flush immediately (the window hides far more often than it exits)
 *
 * The worst case is losing the last {@link SAVE_DEBOUNCE_MS} of typing if the
 * process is killed mid-debounce, instead of losing everything.
 *
 * # Two files, not one
 *
 * The keyspace is split by {@link isSettingsKey}:
 *
 *   settings → `settings.json`, plain and pretty-printed, so the user can read
 *              and edit it like any other config file
 *   the rest → `web-storage.json`, wrapped by the OS secret store, because it
 *              holds what the user typed — notes, todos, alarms, timers
 *
 * Splitting rather than unifying is the whole point: making one file editable
 * would mean publishing widget content in the clear. Which key goes where is
 * decided in `settingsSections.ts`, and settings additionally change shape on
 * the way out — localStorage holds JSON-encoded strings, `settings.json` holds
 * the objects themselves, or nobody could hand-edit it.
 *
 * This side speaks plain JSON both ways; encryption at rest is the Rust side's
 * job (`web_storage.rs` wraps the payload with the OS secret store). Note that
 * localStorage itself stays unencrypted — see SECURITY.md, "Data at rest".
 */
import { invoke } from "@tauri-apps/api/core";

import { fromSections, isSettingsKey, toSections } from "./settingsSections";

/** Every key the app owns starts with this; nothing else is mirrored. */
const DURABLE_PREFIX = "kavibay:";

/** Long enough to batch a burst of typing, short enough to lose little. */
const SAVE_DEBOUNCE_MS = 400;

const hasTauri = () => "__TAURI_INTERNALS__" in window;

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let hooked = false;

/**
 * Which durable files this window may write.
 *
 * Per file, and both off until hydration proves the file readable: a file we
 * could not read is a file we must not overwrite, or a failed read turns into
 * real data loss. One unreadable file no longer silences the other, which is
 * what a single flag used to do.
 */
const mirroring = { settings: false, state: false };

/** Current value of every mirrored key, split by which file owns it. */
function snapshot(): { settings: Record<string, string>; state: Record<string, string> } {
  const settings: Record<string, string> = {};
  const state: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(DURABLE_PREFIX)) continue;
    const value = localStorage.getItem(key);
    if (value === null) continue;
    if (isSettingsKey(key)) settings[key] = value;
    else state[key] = value;
  }
  return { settings, state };
}

/**
 * Write the snapshot to AppData now.
 *
 * Both files are attempted even when one fails: they hold different things, and
 * a settings write that cannot land is no reason to drop the user's notes.
 */
async function save(): Promise<void> {
  if (saveTimer !== undefined) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }
  if (!hasTauri()) return;

  const current = snapshot();
  const writes: Promise<unknown>[] = [];

  if (mirroring.state) {
    writes.push(
      // Nothing useful to do on failure — localStorage still holds the value,
      // and the next write retries the whole snapshot anyway. Log so a broken
      // durable store shows up in the console instead of only at the next
      // restart.
      invoke("web_storage_save", { value: JSON.stringify(current.state) }).catch(
        (error: unknown) => console.error("[kavibay] durable storage save failed:", error),
      ),
    );
  }
  if (mirroring.settings) {
    writes.push(
      // Sections only: the host merges them, so sections this build does not
      // know — a newer version's, or the file's own `version` — stay put.
      invoke("settings_save_sections", { sections: toSections(current.settings) }).catch(
        (error: unknown) => console.error("[kavibay] settings save failed:", error),
      ),
    );
  }

  await Promise.all(writes);
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
 * Read one durable file, or report that it could not be read.
 *
 * `null` is not a failure: first run, nothing saved yet. A thrown error is, and
 * the caller must then leave that file alone for the rest of the session —
 * overwriting a file we could not read would replace real content with whatever
 * this empty session happens to hold. A stale file the user can still recover
 * from beats a confidently wrong one.
 */
async function loadDurableFile(
  command: string,
  label: string,
): Promise<{ ok: boolean; raw: string | null }> {
  try {
    return { ok: true, raw: await invoke<string | null>(command) };
  } catch (error) {
    console.error(`[kavibay] ${label} unreadable, mirroring disabled:`, error);
    return { ok: false, raw: null };
  }
}

/** Parse a durable payload into an object, or nothing if it is unusable. */
function parseDocument(raw: string | null, label: string): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    console.error(`[kavibay] ${label} is not an object — ignoring it`);
  } catch (error) {
    console.error(`[kavibay] ${label} could not be parsed:`, error);
  }
  return undefined;
}

/** Copy string entries under the durable prefix into localStorage. */
function restore(values: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(values)) {
    if (!key.startsWith(DURABLE_PREFIX) || typeof value !== "string") continue;
    localStorage.setItem(key, value);
  }
}

/**
 * Fill localStorage from the durable copies, then keep the three in sync.
 *
 * Must run before anything reads localStorage — several composables read at
 * import time, so the app's module graph has to be imported after this resolves
 * (see core/app/main.ts).
 *
 * AppData wins over what the WebView happens to still hold, for the same reason
 * it always did: the profile is the unreliable side. Keys the snapshot does not
 * know stay untouched and join it on the next save, which is what migrates an
 * existing profile on first run.
 *
 * Settings are applied *after* state on purpose. An install that predates the
 * split still has the four settings keys inside `web-storage.json`; applying
 * `settings.json` last makes the new home win wherever it has a value, and
 * leaves the old copies in place until the first save moves them across. That
 * first save is the whole migration — no separate step, and it runs itself.
 */
export async function hydrateDurableStorage(
  options: { mirror?: boolean } = {},
): Promise<void> {
  if (!hasTauri()) return;

  const state = await loadDurableFile("web_storage_load", "durable storage");
  const settings = await loadDurableFile("settings_load", "settings");

  const stateValues = parseDocument(state.raw, "durable storage");
  if (stateValues) restore(stateValues);

  const document = parseDocument(settings.raw, "settings");
  if (document) restore(fromSections(document));

  // Only one window may own the mirror. The quick-action popup hydrates
  // read-only (`mirror: false`) so it renders with the real appearance and
  // widget state; the cockpit picks its writes up through the `storage` event.
  // Two writers would race over the same files for nothing.
  if (options.mirror === false) return;

  mirroring.state = state.ok;
  mirroring.settings = settings.ok;
  if (!mirroring.state && !mirroring.settings) return;

  hookWrites();
  // First run (or a profile that carries keys the snapshot lacks): persist what
  // is there now, so the very first restart already has something to restore.
  scheduleSave();
}
