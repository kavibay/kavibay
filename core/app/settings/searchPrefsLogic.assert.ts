import { buildWebSearchUrl, searchActionTitle, type WebSearchActionId } from "../palette/searchActions";
import { fromSections, toSections } from "../system/settingsSections";
import { loadSearchPrefs, moveSearchAction, normalizeSearchPrefs, saveSearchPrefs, SEARCH_PREFS_KEY } from "./searchPrefsLogic";

function equal(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message);
}
const defaults = normalizeSearchPrefs(null);
const defaultIds = ["ai", "google", "duckduckgo", "chatgpt", "claude", "ecosia", "brave", "bing"];
const optional = defaults.slice(3);
equal(defaults.map((row) => row.id), defaultIds, "new profiles offer all actions in order");
equal(defaults.filter((row) => row.enabled).map((row) => row.id), ["ai", "google", "duckduckgo"], "additional providers are opt-in");
equal(normalizeSearchPrefs({}), defaults, "invalid saved shapes fall back to defaults");
equal(normalizeSearchPrefs([
  { id: "duckduckgo", enabled: false },
  { id: "unknown", enabled: true },
  { id: "duckduckgo", enabled: true },
  null,
  { id: "ai", enabled: "false" },
]), [
  { id: "duckduckgo", enabled: false },
  { id: "ai", enabled: true },
  { id: "google", enabled: true },
  ...optional,
], "normalization preserves valid order and false, removes duplicates, and appends missing actions");

const oldSettings = [{ id: "google", enabled: false }, { id: "ai", enabled: false }, { id: "duckduckgo", enabled: false }];
equal(normalizeSearchPrefs(oldSettings).filter((row) => row.enabled), [], "adding providers does not undo an existing all-hidden preference");
equal(normalizeSearchPrefs(oldSettings).slice(0, 3), oldSettings, "upgrading keeps the saved order and visibility");

const moved = moveSearchAction(moveSearchAction(defaults, "duckduckgo", -1), "duckduckgo", -1);
equal(moved.map((row) => row.id), ["duckduckgo", "ai", "google", ...defaultIds.slice(3)], "an engine can move to the leftmost position");
equal(defaults.map((row) => row.id), defaultIds, "moving does not mutate an older snapshot");
equal(moveSearchAction(moved, "duckduckgo", -1), moved, "moving before the first entry does nothing");
equal(moveSearchAction(moved, "bing", 1), moved, "moving past the last entry does nothing");

let stored: string | null = null;
const storage = {
  getItem: (key: string) => { equal(key, SEARCH_PREFS_KEY, "reads its own setting"); return stored; },
  setItem: (key: string, value: string) => { equal(key, SEARCH_PREFS_KEY, "writes its own setting"); stored = value; },
};
equal(loadSearchPrefs(storage), defaults, "missing persisted values use defaults");
const selected = moved.map((row) => ({ ...row, enabled: row.enabled && row.id !== "google" }));
saveSearchPrefs(selected, storage);
equal(loadSearchPrefs(storage), selected, "visibility and order survive save and reload");
equal(loadSearchPrefs(storage).filter((row) => row.enabled).map((row) => row.id), ["duckduckgo", "ai"],
  "hiding an action preserves the order of the visible actions");
const allHidden = selected.map((row) => ({ ...row, enabled: false }));
saveSearchPrefs(allHidden, storage);
equal(loadSearchPrefs(storage), allHidden, "turning every action off remains off after reload");
stored = "malformed{";
equal(loadSearchPrefs(storage), defaults, "invalid JSON does not break palette startup");

const snapshot = { [SEARCH_PREFS_KEY]: JSON.stringify(selected) };
equal(toSections(snapshot), { search: selected }, "preferences belong to the durable settings file");
equal(fromSections(toSections(snapshot)), snapshot, "durable settings hydrate the same visibility and order");

const term = "  Potsdam & Umgebung? #1 / Grüße  ";
equal(buildWebSearchUrl("duckduckgo", term), "https://duckduckgo.com/?q=Potsdam%20%26%20Umgebung%3F%20%231%20%2F%20Gr%C3%BC%C3%9Fe", "DuckDuckGo encodes the entire query");
equal(buildWebSearchUrl("google", term), "https://www.google.com/search?q=Potsdam%20%26%20Umgebung%3F%20%231%20%2F%20Gr%C3%BC%C3%9Fe", "Google keeps the existing query encoding");
equal(buildWebSearchUrl("duckduckgo", "   "), "https://duckduckgo.com/", "an empty query has a valid homepage URL");
const destinations: Array<[WebSearchActionId, string]> = [
  ["chatgpt", "https://chatgpt.com/"],
  ["claude", "https://claude.ai/new"],
  ["ecosia", "https://www.ecosia.org/search"],
  ["brave", "https://search.brave.com/search"],
  ["bing", "https://www.bing.com/search"],
];
for (const [id, page] of destinations) {
  equal(buildWebSearchUrl(id, term), `${page}?q=Potsdam%20%26%20Umgebung%3F%20%231%20%2F%20Gr%C3%BC%C3%9Fe`, `${id} receives the complete encoded search text`);
  equal(buildWebSearchUrl(id, ""), page, `${id} opens without a query too`);
}
equal(searchActionTitle("ai", "GPT test"), "Ask AI in Kavibay (saved API key) · GPT test", "internal AI names its location and credential source");
equal(searchActionTitle("chatgpt"), "Open ChatGPT in browser", "external ChatGPT clearly names its destination");
equal(searchActionTitle("claude"), "Open Claude in browser", "external Claude clearly names its destination");
console.log("searchPrefsLogic.assert: ok");
