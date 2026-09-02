/**
 * Palette app launch history — rank frequent apps higher, ignore one-offs.
 *
 * Rules:
 * - Record successful palette launches by app name (stable across .lnk/exe paths)
 * - Count increments at most once per COUNT_GAP_MS (double-tap guard only)
 * - Score boost only when count >= MIN_COUNT_FOR_BOOST (one accidental open = no boost)
 * - Query-specific frecency: prefixes of the search query used at launch time
 */
import { appNameDedupeKey } from "./paletteResults";

export const APP_LAUNCH_HISTORY_KEY = "kavibay:palette-app-launches-v3";
const V2_HISTORY_KEY = "kavibay:palette-app-launches-v2";
const LEGACY_HISTORY_KEY = "kavibay:palette-app-launches-v1";

/** Launches required before any ranking boost. */
export const MIN_COUNT_FOR_BOOST = 2;

/** Min gap between counted launches — short so same-session reuse qualifies. */
export const COUNT_GAP_MS = 45_000;

/**
 * Boost large enough to beat same-letter fuzzy ties (e.g. Spotify over Settings for "s").
 * Pinned is only +5; single-char fuzzy is typically ~15–25.
 */
const USAGE_BASE_BOOST = 40;
const MAX_EXTRA_BOOST = 20;

/** Query frecency base — higher than global usage so query-specific habit wins ties. */
const QUERY_FRECENCY_BASE_BOOST = 50;

export interface AppLaunchEntry {
  /** Counted launches (gap-debounced). */
  count: number;
  /** Last counted launch timestamp (ms). */
  lastAt: number;
}

export type AppLaunchHistory = Record<string, AppLaunchEntry>;

export interface AppLaunchHistoryState {
  apps: AppLaunchHistory;
  queries: Record<string, AppLaunchHistory>;
}

/** OS-agnostic path key: trim, lower case, backslashes → forward slashes. */
export function normalizeLaunchPathKey(path: string): string {
  return path.trim().toLowerCase().replace(/\\/g, "/");
}

/** Trim, lower case, cap at 16 chars — key for query-prefix frecency maps. */
export function normalizeQueryPrefix(query: string): string {
  return query.trim().toLowerCase().slice(0, 16);
}

/** All query prefixes length 1..min(16, normalized length). */
function queryPrefixes(query: string): string[] {
  const q = normalizeQueryPrefix(query);
  if (!q) return [];
  const max = Math.min(16, q.length);
  const out: string[] = [];
  for (let i = 1; i <= max; i++) out.push(q.slice(0, i));
  return out;
}

/** Stable history key: prefer name so .lnk vs exe still share a streak. */
export function appHistoryKey(name: string, path: string): string {
  const n = appNameDedupeKey(name);
  if (n) return `name:${n}`;
  const p = normalizeLaunchPathKey(path);
  return p ? `path:${p}` : "";
}

/** Normalize persisted map; drop invalid entries. */
export function normalizeHistory(raw: unknown): AppLaunchHistory {
  if (!raw || typeof raw !== "object") return {};
  const out: AppLaunchHistory = {};
  for (const [key, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!key || !entry || typeof entry !== "object") continue;
    const count = (entry as { count?: unknown }).count;
    const lastAt = (entry as { lastAt?: unknown }).lastAt;
    if (typeof count !== "number" || !Number.isFinite(count) || count < 1) continue;
    if (typeof lastAt !== "number" || !Number.isFinite(lastAt)) continue;
    out[key] = { count: Math.floor(count), lastAt };
  }
  return out;
}

function emptyState(): AppLaunchHistoryState {
  return { apps: {}, queries: {} };
}

function normalizeState(raw: unknown): AppLaunchHistoryState {
  if (!raw || typeof raw !== "object") return emptyState();
  const obj = raw as Record<string, unknown>;
  if ("apps" in obj || "queries" in obj) {
    return {
      apps: normalizeHistory(obj.apps),
      queries: Object.fromEntries(
        Object.entries(
          obj.queries && typeof obj.queries === "object"
            ? (obj.queries as Record<string, unknown>)
            : {},
        ).map(([prefix, map]) => [prefix, normalizeHistory(map)]),
      ),
    };
  }
  // Bare v2 map stored at v3 key by mistake — treat as apps only.
  return { apps: normalizeHistory(raw), queries: {} };
}

/** Read history from localStorage (v3, else migrate v2/v1 into apps). */
export function loadAppLaunchHistory(): AppLaunchHistoryState {
  try {
    const raw = localStorage.getItem(APP_LAUNCH_HISTORY_KEY);
    if (raw) return normalizeState(JSON.parse(raw));

    const v2 = localStorage.getItem(V2_HISTORY_KEY);
    if (v2) return { apps: normalizeHistory(JSON.parse(v2)), queries: {} };

    const legacy = localStorage.getItem(LEGACY_HISTORY_KEY);
    if (!legacy) return emptyState();
    // v1 keyed plain paths — keep under path: prefix so boosts still apply.
    const old = normalizeHistory(JSON.parse(legacy));
    const migrated: AppLaunchHistory = {};
    for (const [path, entry] of Object.entries(old)) {
      migrated[`path:${normalizeLaunchPathKey(path)}`] = entry;
    }
    return { apps: migrated, queries: {} };
  } catch {
    return emptyState();
  }
}

/** Persist history state. */
export function saveAppLaunchHistory(state: AppLaunchHistoryState): void {
  localStorage.setItem(APP_LAUNCH_HISTORY_KEY, JSON.stringify(state));
}

function isHistoryState(
  history: AppLaunchHistory | AppLaunchHistoryState,
): history is AppLaunchHistoryState {
  return (
    typeof history === "object" &&
    history !== null &&
    "queries" in history &&
    typeof history.queries === "object" &&
    !("count" in history)
  );
}

function appsMap(history: AppLaunchHistory | AppLaunchHistoryState): AppLaunchHistory {
  return isHistoryState(history) ? history.apps : history;
}

/** Gap-debounced increment for one app key inside a history map. */
function bumpEntry(
  map: AppLaunchHistory,
  appKey: string,
  now: number,
): { map: AppLaunchHistory; changed: boolean } {
  const prev = map[appKey];
  if (prev && now - prev.lastAt < COUNT_GAP_MS) {
    return { map, changed: false };
  }
  return {
    map: {
      ...map,
      [appKey]: {
        count: (prev?.count ?? 0) + 1,
        lastAt: now,
      },
    },
    changed: true,
  };
}

/**
 * Record a palette launch. Increments app count and query-prefix counts when gap elapsed.
 * Empty query only bumps the global apps map (same as pre-v3 behavior).
 */
export function recordAppLaunch(
  state: AppLaunchHistoryState,
  name: string,
  path: string,
  query: string,
  now = Date.now(),
): AppLaunchHistoryState {
  const appKey = appHistoryKey(name, path);
  if (!appKey) return state;

  let nextApps = state.apps;
  let changed = false;
  const appBump = bumpEntry(nextApps, appKey, now);
  if (appBump.changed) {
    nextApps = appBump.map;
    changed = true;
  }

  let nextQueries = state.queries;
  for (const prefix of queryPrefixes(query)) {
    const prevMap = nextQueries[prefix] ?? {};
    const bump = bumpEntry(prevMap, appKey, now);
    if (bump.changed) {
      nextQueries = { ...nextQueries, [prefix]: bump.map };
      changed = true;
    }
  }

  if (!changed) return state;
  return { apps: nextApps, queries: nextQueries };
}

function recencyBoost(entry: AppLaunchEntry, now: number): number {
  const ageMs = now - entry.lastAt;
  const day = 24 * 60 * 60 * 1000;
  return ageMs <= 2 * day ? 8 : ageMs <= 14 * day ? 3 : 0;
}

/**
 * Ranking boost for an app. Zero until MIN_COUNT_FOR_BOOST.
 * Accepts full state or apps map only. Looks up name key first, then path.
 */
export function usageBoostForApp(
  history: AppLaunchHistory | AppLaunchHistoryState,
  name: string,
  path: string,
  now = Date.now(),
): number {
  const map = appsMap(history);
  const nameKey = appHistoryKey(name, path);
  const pathKey = `path:${normalizeLaunchPathKey(path)}`;
  const entry = map[nameKey] ?? map[pathKey];
  if (!entry || entry.count < MIN_COUNT_FOR_BOOST) return 0;

  const extra = Math.min(MAX_EXTRA_BOOST, Math.max(0, entry.count - 2) * 5);
  return USAGE_BASE_BOOST + extra + recencyBoost(entry, now);
}

/**
 * Query-specific frecency boost for the current palette query.
 * Zero when the app was not launched twice+ via that query prefix.
 */
export function queryFrecencyBoost(
  state: AppLaunchHistoryState,
  query: string,
  name: string,
  path: string,
  now = Date.now(),
): number {
  const prefix = normalizeQueryPrefix(query);
  if (!prefix) return 0;

  const appKey = appHistoryKey(name, path);
  if (!appKey) return 0;

  const entry = state.queries[prefix]?.[appKey];
  if (!entry || entry.count < MIN_COUNT_FOR_BOOST) return 0;

  return QUERY_FRECENCY_BASE_BOOST + recencyBoost(entry, now);
}
