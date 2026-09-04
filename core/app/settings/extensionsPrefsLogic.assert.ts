/**
 * Asserts for the catalog enable/disable prefs: which extensions a fresh
 * profile starts with, and what a stored record does to that answer.
 * Run: npx tsx core/app/settings/extensionsPrefsLogic.assert.ts
 */
import {
  EXTENSIONS_PREFS_KEY,
  defaultDisabledIds,
  isExtensionIdEnabled,
  loadExtensionsPrefs,
  normalizeExtensionsPrefs,
  saveExtensionsPrefs,
} from "./extensionsPrefsLogic";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/**
 * Enough of the Storage API for these four calls. Node has no localStorage, and
 * the branch worth covering — a stored record beating the defaults — cannot be
 * reached without one.
 */
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
};

const catalog = [
  { id: "clock" },
  { id: "tado", enabledByDefault: false },
  { id: "notes", enabledByDefault: true },
  { id: "kavibay.ai-usage/ai-usage", enabledByDefault: false },
];

// --- what a fresh profile starts from --------------------------------------

assert(
  defaultDisabledIds(catalog).join(",") === "tado,kavibay.ai-usage/ai-usage",
  "only extensions that say so are off out of the box",
);
assert(
  defaultDisabledIds([{ id: "clock" }]).length === 0,
  "an absent flag means on, so most manifests say nothing",
);
assert(defaultDisabledIds([]).length === 0, "an empty catalog disables nothing");
assert(
  defaultDisabledIds([{ id: "x", enabledByDefault: undefined }]).length === 0,
  "undefined is absent, not false",
);

/**
 * The reason this is derived rather than listed. A literal list kept naming
 * `github-actions` after the extension was gone; a list that cannot outlive its
 * subject cannot go stale the same way.
 */
assert(
  !defaultDisabledIds(catalog).includes("github-actions"),
  "an extension that no longer ships cannot linger in the defaults",
);

// --- load: stored record wins ----------------------------------------------

store.clear();
assert(
  loadExtensionsPrefs(["tado"]).disabledIds.join(",") === "tado",
  "no stored record falls back to the catalog defaults",
);

store.set(EXTENSIONS_PREFS_KEY, '{"disabledIds":[]}');
assert(
  loadExtensionsPrefs(["tado"]).disabledIds.length === 0,
  "a record naming no ids means all enabled, not 'unset'",
);

store.set(EXTENSIONS_PREFS_KEY, '{"disabledIds":["clock"]}');
assert(
  loadExtensionsPrefs(["tado"]).disabledIds.join(",") === "clock",
  "a stored record wins over the defaults entirely",
);

store.set(EXTENSIONS_PREFS_KEY, "not json");
assert(
  loadExtensionsPrefs(["tado"]).disabledIds.join(",") === "tado",
  "unreadable storage falls back rather than throwing on the boot path",
);

// --- normalize / round trip -------------------------------------------------

assert(
  normalizeExtensionsPrefs({ disabledIds: ["a", "a", "b"] }).disabledIds.join(",") === "a,b",
  "duplicates collapse while order is kept",
);
assert(
  normalizeExtensionsPrefs({ disabledIds: ["a", "", 7, null] }).disabledIds.join(",") === "a",
  "non-string and empty entries are dropped",
);
assert(normalizeExtensionsPrefs(null).disabledIds.length === 0, "garbage normalizes to empty");

store.clear();
saveExtensionsPrefs({ disabledIds: ["b", "b", "a"] });
assert(
  loadExtensionsPrefs([]).disabledIds.join(",") === "b,a",
  "what is saved is what loads back, normalized once on the way in",
);

// --- the lookup every caller uses ------------------------------------------

assert(isExtensionIdEnabled("clock", ["tado"]), "an id nobody disabled is enabled");
assert(!isExtensionIdEnabled("tado", ["tado"]), "a disabled id is disabled");
assert(isExtensionIdEnabled("tado", []), "an empty disabled list enables everything");

console.log("extensionsPrefsLogic.assert.ts: ok");
