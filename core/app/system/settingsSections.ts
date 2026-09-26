/**
 * Which `kavibay:` localStorage keys are *settings*, and what they are called in
 * `settings.json`.
 *
 * The durable mirror writes two files (see `durableStorage.ts`). Settings go to
 * a plain, hand-editable `settings.json`; everything else — notes, timers, desk
 * layout, palette history — goes to the encrypted `web-storage.json`,
 * because that file is the only copy of the user's content and must not become
 * something a text editor opens. This module is the line between the two.
 *
 * localStorage values are JSON-encoded *strings*. Writing them into
 * `settings.json` as-is would produce JSON inside JSON — technically valid,
 * unreadable in an editor, and impossible to hand-edit without escaping. So the
 * mirror decodes on the way out and re-encodes on the way back in, and that
 * translation is all this module does.
 *
 * Pure on purpose: no localStorage, no Tauri, no imports. It runs before the app
 * module graph is loaded (see `core/app/main.ts`), where anything that reads
 * localStorage at import time would read an empty cache.
 */

/**
 * localStorage key → top-level section name in `settings.json`.
 *
 * Deliberately a literal map rather than imports of the four owning modules:
 * this runs in the pre-hydration path, and importing settings modules there is
 * exactly the boot-order trap `main.ts` warns about. `settingsSections.assert.ts`
 * checks these strings against the real constants, so drift fails CI instead of
 * silently dropping a section.
 *
 * Adding a key here moves it from the encrypted file to a readable one. That is
 * a disclosure decision, not a formatting one — only add keys holding settings
 * the user typed into the Settings UI, never widget content.
 */
export const SETTINGS_SECTIONS: Readonly<Record<string, string>> = {
  "kavibay:appearance-v1": "appearance",
  "kavibay:developer-v1": "developer",
  "kavibay:extensions-v1": "extensions",
  "kavibay:palette-folders-v1": "folders",
};

/** Membership test without touching prototype keys (`toString`, `__proto__`). */
const SETTINGS_KEYS: ReadonlySet<string> = new Set(Object.keys(SETTINGS_SECTIONS));

/**
 * Section → key. A `Map` rather than an object because the sections come from a
 * file the user may edit by hand: a section literally named `__proto__` is then
 * an ordinary lookup miss instead of a surprise.
 */
const KEY_BY_SECTION: ReadonlyMap<string, string> = new Map(
  Object.entries(SETTINGS_SECTIONS).map(([key, section]) => [section, key]),
);

/** True when this key belongs in `settings.json` rather than `web-storage.json`. */
export function isSettingsKey(key: string): boolean {
  return SETTINGS_KEYS.has(key);
}

/**
 * Decode a localStorage snapshot into the sections of `settings.json`.
 *
 * A key whose value is not valid JSON is skipped rather than passed through as
 * a string. The host merges what it gets, so skipping leaves the last good
 * value in the file — better than replacing settings the user can read with a
 * quoted fragment they cannot.
 *
 * Only ever emits section names from {@link SETTINGS_SECTIONS}, which is what
 * lets the host merge instead of replace: sections written by a newer build, and
 * the file's own `version` field, are never named here and so survive untouched.
 */
export function toSections(snapshot: Record<string, string>): Record<string, unknown> {
  const sections: Record<string, unknown> = {};
  for (const [key, section] of Object.entries(SETTINGS_SECTIONS)) {
    const raw = snapshot[key];
    if (raw === undefined) continue;
    try {
      sections[section] = JSON.parse(raw) as unknown;
    } catch {
      // Unreadable cache value: leave the section out, keep the file's copy.
    }
  }
  return sections;
}

/**
 * Encode `settings.json` back into localStorage values.
 *
 * Anything the map does not know is ignored: the `version` field, and sections a
 * newer build wrote that this one has no key for. Ignoring them is the whole
 * forward-compatibility story on this side — not losing them is the host's,
 * which merges sections rather than replacing the document.
 */
export function fromSections(doc: Record<string, unknown>): Record<string, string> {
  const snapshot: Record<string, string> = {};
  for (const [section, value] of Object.entries(doc)) {
    const key = KEY_BY_SECTION.get(section);
    if (key === undefined || value === undefined) continue;
    snapshot[key] = JSON.stringify(value);
  }
  return snapshot;
}
