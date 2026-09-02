/**
 * In-memory index of installed Windows apps for fast palette search.
 * Backed by Rust `list_installed_apps` (also cached ~60s server-side).
 */
import { invoke } from "@tauri-apps/api/core";
import { shallowRef, type ShallowRef } from "vue";
import {
  appHistoryKey,
  normalizeLaunchPathKey,
  type AppLaunchHistoryState,
} from "./appLaunchHistory";
import { iconKeysToEvict } from "./iconCacheLru";

/** One launchable app from `list_installed_apps`. */
export interface InstalledAppEntry {
  name: string;
  path: string;
  pinned?: boolean;
  /** Precomputed at index load — cheap reject in buildAppRows. */
  nameLower?: string;
}

/** Reactive snapshot so palette results recompute when the index loads. */
export const installedAppsIndex: ShallowRef<InstalledAppEntry[]> = shallowRef([]);

/**
 * path → extracted shell icon data URL.
 * Missing key = not loaded yet or failed (UI reserves empty icon slot either way).
 */
export const installedAppIcons: ShallowRef<Record<string, string>> = shallowRef(
  {},
);

let loadedAt = 0;
let inflight: Promise<InstalledAppEntry[]> | null = null;

/** Paths that failed extraction — skip retries for this session. */
const iconFailed = new Set<string>();
/**
 * Icon request order, oldest first (a Set preserves insertion order, and
 * re-inserting after delete moves an entry to the end). Drives LRU eviction so
 * the base64 icon cache cannot grow for the whole session.
 */
const iconRecency = new Set<string>();
/** Paths currently queued or extracting. */
const iconPending = new Set<string>();
const ICON_WORKERS = 2;

/** Client refresh interval — longer than before so opening stays snappy. */
const CLIENT_TTL_MS = 4 * 60_000;

/** Snapshot of the last successful load (may be empty before first fetch). */
export function getInstalledAppsCached(): InstalledAppEntry[] {
  return installedAppsIndex.value;
}

/**
 * Ensure the index is warm. Reuses an in-flight fetch; refreshes after TTL.
 * Safe to call often (palette open, mount) — never blocks the caller.
 */
export async function ensureInstalledAppsIndex(
  force = false,
): Promise<InstalledAppEntry[]> {
  const cache = installedAppsIndex.value;
  const fresh = cache.length > 0 && Date.now() - loadedAt < CLIENT_TTL_MS;
  if (!force && fresh) return cache;
  // Soft refresh: keep serving stale cache while a background fetch runs.
  if (!force && cache.length > 0 && inflight) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const apps = await invoke<InstalledAppEntry[]>("list_installed_apps");
      installedAppsIndex.value = (Array.isArray(apps) ? apps : []).map((a) => ({
        ...a,
        nameLower: a.name.trim().toLowerCase(),
      }));
      loadedAt = Date.now();
    } catch {
      // Keep stale cache on failure so typing still works.
    } finally {
      inflight = null;
    }
    return installedAppsIndex.value;
  })();

  // First load must await; later refreshes can run in the background.
  if (cache.length === 0) return inflight;
  return cache;
}

/** Pending icon writes flushed once per animation frame (avoids per-icon re-renders). */
let iconFlushRaf = 0;
const iconBatch: Record<string, string> = {};

/** Mark paths as most recently requested (hits included, not just misses). */
function touchIcons(paths: string[]): void {
  for (const path of paths) {
    if (!path) continue;
    iconRecency.delete(path);
    iconRecency.add(path);
  }
}

/** Drop the coldest entries once the cache exceeds its cap. */
function evictColdIcons(icons: Record<string, string>): Record<string, string> {
  const drop = iconKeysToEvict(Object.keys(icons), [...iconRecency]);
  if (drop.length === 0) return icons;
  for (const key of drop) {
    delete icons[key];
    iconRecency.delete(key);
  }
  return icons;
}

function flushIconBatch() {
  iconFlushRaf = 0;
  const keys = Object.keys(iconBatch);
  if (keys.length === 0) return;
  const next = { ...installedAppIcons.value };
  for (const key of keys) {
    next[key] = iconBatch[key]!;
    delete iconBatch[key];
  }
  installedAppIcons.value = evictColdIcons(next);
}

/**
 * Lazily extract shell icons for the given launch paths (palette result rows).
 * Concurrent workers; batched UI updates so typing stays responsive.
 */
export function ensureAppIcons(paths: string[]): void {
  // Touch before filtering: a cache *hit* is still a use, and eviction order
  // must reflect that or visible rows could be evicted out from under the UI.
  touchIcons(paths);
  const queue = paths.filter((path) => {
    if (!path) return false;
    if (installedAppIcons.value[path] || iconBatch[path]) return false;
    if (iconFailed.has(path) || iconPending.has(path)) return false;
    iconPending.add(path);
    return true;
  });
  if (queue.length === 0) return;

  async function worker() {
    while (queue.length > 0) {
      const path = queue.shift();
      if (!path) continue;
      try {
        const iconDataUrl = await invoke<string>("extract_app_icon", { path });
        if (iconDataUrl) {
          iconBatch[path] = iconDataUrl;
          if (!iconFlushRaf) {
            iconFlushRaf = requestAnimationFrame(flushIconBatch);
          }
        } else {
          iconFailed.add(path);
        }
      } catch {
        iconFailed.add(path);
      } finally {
        iconPending.delete(path);
      }
    }
  }

  void Promise.all(
    Array.from({ length: Math.min(ICON_WORKERS, queue.length) }, () =>
      worker(),
    ),
  );
}

/**
 * Merge disk-cached palette icons (Rust `get_cached_app_icons`) into memory.
 * No extraction — misses are left for `ensureAppIcons` / `prewarmAppIcons`.
 */
export async function hydrateAppIconsFromCache(paths: string[]): Promise<void> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return;
  touchIcons(unique);
  try {
    const hit = await invoke<Record<string, string>>("get_cached_app_icons", {
      paths: unique,
    });
    if (!hit || typeof hit !== "object") return;
    const next = { ...installedAppIcons.value };
    let changed = false;
    for (const [path, url] of Object.entries(hit)) {
      if (url && !next[path]) {
        next[path] = url;
        changed = true;
      }
    }
    if (changed) installedAppIcons.value = evictColdIcons(next);
  } catch {
    // Cache optional — extract path still works.
  }
}

/**
 * Prewarm habitual palette icons: pinned, then top-used / recent from launch history.
 * Hydrates disk cache first, then extracts remaining misses (which also populate cache).
 */
export function prewarmAppIcons(
  apps: InstalledAppEntry[],
  history: AppLaunchHistoryState,
  limit = 24,
): void {
  const paths: string[] = [];
  const seen = new Set<string>();

  function add(path: string) {
    if (!path || seen.has(path) || paths.length >= limit) return;
    seen.add(path);
    paths.push(path);
  }

  for (const app of apps) {
    if (app.pinned) add(app.path);
  }

  const ranked = apps
    .map((app) => {
      const nameKey = appHistoryKey(app.name, app.path);
      const pathKey = `path:${normalizeLaunchPathKey(app.path)}`;
      const entry =
        (nameKey ? history.apps[nameKey] : undefined) ??
        history.apps[pathKey];
      return {
        app,
        count: entry?.count ?? 0,
        lastAt: entry?.lastAt ?? 0,
      };
    })
    .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);

  for (const { app } of ranked) {
    add(app.path);
  }

  void (async () => {
    await hydrateAppIconsFromCache(paths);
    const missing = paths.filter(
      (path) =>
        !installedAppIcons.value[path] &&
        !iconBatch[path] &&
        !iconFailed.has(path) &&
        !iconPending.has(path),
    );
    if (missing.length > 0) ensureAppIcons(missing);
  })();
}
