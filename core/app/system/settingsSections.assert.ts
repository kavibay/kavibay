/**
 * Run: npx tsx core/app/system/settingsSections.assert.ts
 */
import { APPEARANCE_STORAGE_KEY } from "../settings/appearanceLogic";
import { DEVELOPER_PREFS_KEY } from "../settings/developerPrefsLogic";
import { EXTENSIONS_PREFS_KEY } from "../settings/extensionsPrefsLogic";
import { FOLDER_PREFS_KEY } from "../settings/folderPrefsLogic";
import { SEARCH_PREFS_KEY } from "../settings/searchPrefsLogic";
import { PALETTE_WIDGET_PREFS_KEY } from "../settings/paletteWidgetPrefsLogic";
import { SETTINGS_SECTIONS, fromSections, isSettingsKey, toSections } from "./settingsSections";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function equal(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg}\n  expected: ${b}\n  actual:   ${a}`);
}

// --- the map matches the keys the settings modules actually use --------------
//
// The map is written as literals so the pre-hydration path stays import-free
// (see the module comment). That trade only holds if drift is caught here:
// renaming a key without renaming it in the map would silently move that
// setting back into the encrypted file, where nobody can edit it and nothing
// reports a problem.

for (const key of [
  APPEARANCE_STORAGE_KEY,
  DEVELOPER_PREFS_KEY,
  EXTENSIONS_PREFS_KEY,
  FOLDER_PREFS_KEY,
  SEARCH_PREFS_KEY,
  PALETTE_WIDGET_PREFS_KEY,
]) {
  assert(isSettingsKey(key), `${key} is owned by a settings module but not mapped`);
}

equal(
  Object.keys(SETTINGS_SECTIONS).sort(),
  [APPEARANCE_STORAGE_KEY, DEVELOPER_PREFS_KEY, EXTENSIONS_PREFS_KEY, FOLDER_PREFS_KEY, SEARCH_PREFS_KEY, PALETTE_WIDGET_PREFS_KEY].sort(),
  "the map holds exactly the settings keys — no more, no fewer",
);

// Section names reach a JSON document that also carries its own fields; a
// section called `version` would fight the host's format marker.
assert(
  !Object.values(SETTINGS_SECTIONS).includes("version"),
  "no section may be called `version` — the host owns that field",
);

// --- state keys stay out of the readable file --------------------------------
//
// These carry user content or churn every few seconds. Each one that leaks into
// settings.json is a disclosure (it is written in the clear) and a write storm.

for (const key of [
  "kavibay:layout-v4",
  "kavibay:widget-data:notes-1",
  "kavibay:extension-data:kavibay.todo",
  "kavibay:widget-config:clock-1",
  "kavibay:palette-recent-runs-v1",
  "kavibay:palette-app-launches-v3",
  "kavibay:onboarding-v2",
  "kavibay:settings-geometry-v1",
]) {
  assert(!isSettingsKey(key), `${key} is app state and must not become a settings section`);
}

assert(!isSettingsKey("kavibay:appearance-v2"), "an unknown version of a known key is not mapped");
assert(!isSettingsKey("toString"), "prototype keys are not settings keys");
assert(!isSettingsKey("__proto__"), "prototype keys are not settings keys");

// --- decode ------------------------------------------------------------------

const snapshot: Record<string, string> = {
  [APPEARANCE_STORAGE_KEY]: '{"fontId":"jakarta","surfaceBlur":18}',
  [DEVELOPER_PREFS_KEY]: '{"developerExtensionsEnabled":false,"wizardAutoEnable":false}',
  [EXTENSIONS_PREFS_KEY]: '{"disabledIds":["example.extension"]}',
  [FOLDER_PREFS_KEY]: '{"custom":[],"disabledBuiltins":["downloads"]}',
  "kavibay:layout-v4": '{"widgets":[]}',
};

equal(
  toSections(snapshot),
  {
    appearance: { fontId: "jakarta", surfaceBlur: 18 },
    developer: { developerExtensionsEnabled: false, wizardAutoEnable: false },
    extensions: { disabledIds: ["example.extension"] },
    folders: { custom: [], disabledBuiltins: ["downloads"] },
  },
  "settings decode into nested objects; state keys are not carried along",
);

equal(toSections({}), {}, "an empty snapshot produces no sections");

// A key that is absent differs from one holding garbage, and both differ from
// one holding `null` — only the garbage case may be dropped.
equal(
  toSections({ [APPEARANCE_STORAGE_KEY]: "not json{" }),
  {},
  "an unparsable value is skipped so the host keeps the file's last good copy",
);
equal(
  toSections({ [APPEARANCE_STORAGE_KEY]: "null" }),
  { appearance: null },
  "an explicit null is a value, not a parse failure",
);

// --- encode ------------------------------------------------------------------

equal(
  fromSections({
    appearance: { fontId: "manrope" },
    developer: { developerExtensionsEnabled: true },
  }),
  {
    [APPEARANCE_STORAGE_KEY]: '{"fontId":"manrope"}',
    [DEVELOPER_PREFS_KEY]: '{"developerExtensionsEnabled":true}',
  },
  "sections encode back to the JSON strings localStorage holds",
);

// Forward compatibility, this side of it: an older build must not choke on a
// file a newer build wrote, and must not invent localStorage keys for sections
// it does not know. Keeping those sections in the file is the host's job.
//
// Parsed, not written as a literal: `__proto__` in an object literal sets the
// prototype and never becomes an own property, so a literal would pass this
// test without `fromSections` doing anything. `JSON.parse` is how the document
// actually arrives, and it *does* produce an own property with that name.
const fromNewerBuild = JSON.parse(
  '{"version":1,"appearance":{"fontId":"jetbrains"},"telemetry":{"enabled":true},' +
    '"__proto__":{"polluted":true}}',
) as Record<string, unknown>;

assert(
  Object.keys(fromNewerBuild).includes("__proto__"),
  "precondition: the parsed document really carries an own `__proto__` key",
);

equal(
  fromSections(fromNewerBuild),
  { [APPEARANCE_STORAGE_KEY]: '{"fontId":"jetbrains"}' },
  "version, unknown sections and prototype names are ignored on the way in",
);

equal(
  ({} as Record<string, unknown>).polluted,
  undefined,
  "a `__proto__` section does not pollute Object.prototype",
);

equal(fromSections({}), {}, "an empty document produces no localStorage writes");

// --- round trip --------------------------------------------------------------
//
// Holds because every value in the snapshot was produced by `JSON.stringify` in
// the first place: the app is the only writer, so the encoding is canonical and
// re-encoding reproduces it byte for byte.

const settingsOnly: Record<string, string> = { ...snapshot };
delete settingsOnly["kavibay:layout-v4"];

equal(
  fromSections(toSections(settingsOnly)),
  settingsOnly,
  "decode then encode returns the original snapshot unchanged",
);

equal(
  toSections(fromSections(toSections(settingsOnly))),
  toSections(settingsOnly),
  "encode then decode returns the original sections unchanged",
);

console.log("settingsSections.assert.ts OK");
