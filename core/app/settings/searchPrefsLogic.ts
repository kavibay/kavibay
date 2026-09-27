import { isSearchActionId, SEARCH_ACTIONS, type SearchActionId } from "../palette/searchActions";

export interface SearchActionPreference {
  id: SearchActionId;
  enabled: boolean;
}

export const SEARCH_PREFS_KEY = "kavibay:palette-search-v1";

/** Keep the saved order, drop unknown/duplicate ids, and append newly available actions. */
export function normalizeSearchPrefs(raw: unknown): SearchActionPreference[] {
  const rows: SearchActionPreference[] = [];
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue;
      const { id, enabled } = entry as Record<string, unknown>;
      if (!isSearchActionId(id) || rows.some((row) => row.id === id)) continue;
      const defaults = SEARCH_ACTIONS.find((action) => action.id === id)!;
      rows.push({ id, enabled: typeof enabled === "boolean" ? enabled : defaults.defaultEnabled });
    }
  }
  for (const { id, defaultEnabled } of SEARCH_ACTIONS) {
    if (!rows.some((row) => row.id === id)) rows.push({ id, enabled: defaultEnabled });
  }
  return rows;
}

export function moveSearchAction(rows: SearchActionPreference[], id: SearchActionId, direction: -1 | 1): SearchActionPreference[] {
  const index = rows.findIndex((row) => row.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= rows.length) return rows;
  const next = [...rows];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function loadSearchPrefs(storage?: Pick<Storage, "getItem">): SearchActionPreference[] {
  try {
    const raw = (storage ?? localStorage).getItem(SEARCH_PREFS_KEY);
    return normalizeSearchPrefs(raw ? JSON.parse(raw) as unknown : null);
  } catch {
    return normalizeSearchPrefs(null);
  }
}

export function saveSearchPrefs(rows: SearchActionPreference[], storage?: Pick<Storage, "setItem">) {
  (storage ?? localStorage).setItem(SEARCH_PREFS_KEY, JSON.stringify(normalizeSearchPrefs(rows)));
}
