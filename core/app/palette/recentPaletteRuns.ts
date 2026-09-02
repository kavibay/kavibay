/**
 * MRU list of palette runs — ArrowDown on empty search shows the last N.
 * Dedupes by kind+key and moves the reused entry to the front.
 */
import {
  appHistoryKey,
  normalizeLaunchPathKey,
  type AppLaunchHistory,
} from "./appLaunchHistory";

export const RECENT_PALETTE_RUNS_KEY = "kavibay:palette-recent-runs-v1";
export const RECENT_PALETTE_RUNS_LIMIT = 12;

/** One successfully run palette action (command, app, or widget type). */
export type RecentPaletteRun =
  | { kind: "command"; commandId: string; title: string }
  | { kind: "app"; path: string; title: string }
  | { kind: "type"; typeId: string; title: string };

/** Stable identity for dedupe (command id, launch path, or type id). */
export function recentRunKey(run: RecentPaletteRun): string {
  if (run.kind === "command") return `command:${run.commandId}`;
  if (run.kind === "app") return `app:${run.path.trim().toLowerCase()}`;
  return `type:${run.typeId}`;
}

/** Drop invalid entries; keep at most `limit` in order. */
export function normalizeRecentRuns(
  raw: unknown,
  limit = RECENT_PALETTE_RUNS_LIMIT,
): RecentPaletteRun[] {
  if (!Array.isArray(raw)) return [];
  const out: RecentPaletteRun[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const kind = (item as { kind?: unknown }).kind;
    const title = String((item as { title?: unknown }).title ?? "").trim();
    if (!title) continue;

    let run: RecentPaletteRun | null = null;
    if (kind === "command") {
      const commandId = String((item as { commandId?: unknown }).commandId ?? "").trim();
      if (commandId) run = { kind: "command", commandId, title };
    } else if (kind === "app") {
      const path = String((item as { path?: unknown }).path ?? "").trim();
      if (path) run = { kind: "app", path, title };
    } else if (kind === "type") {
      const typeId = String((item as { typeId?: unknown }).typeId ?? "").trim();
      if (typeId) run = { kind: "type", typeId, title };
    }
    if (!run) continue;
    const key = recentRunKey(run);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(run);
    if (out.length >= limit) break;
  }
  return out;
}

/** Read MRU list from localStorage. */
export function loadRecentPaletteRuns(): RecentPaletteRun[] {
  try {
    const raw = localStorage.getItem(RECENT_PALETTE_RUNS_KEY);
    if (!raw) return [];
    return normalizeRecentRuns(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** Persist MRU list. */
export function saveRecentPaletteRuns(runs: RecentPaletteRun[]): void {
  localStorage.setItem(
    RECENT_PALETTE_RUNS_KEY,
    JSON.stringify(normalizeRecentRuns(runs)),
  );
}

/**
 * Bootstrap MRU from app-launch frecency when the dedicated recent list is empty.
 * Newest `lastAt` first; only apps still present in the installed index.
 */
export function recentAppsFromLaunchHistory(
  history: AppLaunchHistory,
  installed: { name: string; path: string }[],
  limit = RECENT_PALETTE_RUNS_LIMIT,
): RecentPaletteRun[] {
  const scored: { lastAt: number; run: RecentPaletteRun }[] = [];
  for (const app of installed) {
    const name = app.name?.trim();
    const path = app.path?.trim();
    if (!name || !path) continue;
    const key = appHistoryKey(name, path);
    const pathKey = `path:${normalizeLaunchPathKey(path)}`;
    const entry = history[key] ?? history[pathKey];
    if (!entry) continue;
    scored.push({
      lastAt: entry.lastAt,
      run: { kind: "app", path, title: name },
    });
  }
  scored.sort((a, b) => b.lastAt - a.lastAt);
  return scored.slice(0, limit).map((item) => item.run);
}

/**
 * Prepend a run (deduped). Newest first. Caps at `limit`.
 */
export function recordRecentPaletteRun(
  runs: RecentPaletteRun[],
  entry: RecentPaletteRun,
  limit = RECENT_PALETTE_RUNS_LIMIT,
): RecentPaletteRun[] {
  const title = entry.title.trim();
  if (!title) return runs;
  const nextEntry: RecentPaletteRun =
    entry.kind === "command"
      ? { kind: "command", commandId: entry.commandId.trim(), title }
      : entry.kind === "app"
        ? { kind: "app", path: entry.path.trim(), title }
        : { kind: "type", typeId: entry.typeId.trim(), title };
  if (nextEntry.kind === "command" && !nextEntry.commandId) return runs;
  if (nextEntry.kind === "app" && !nextEntry.path) return runs;
  if (nextEntry.kind === "type" && !nextEntry.typeId) return runs;

  const key = recentRunKey(nextEntry);
  const rest = runs.filter((r) => recentRunKey(r) !== key);
  return normalizeRecentRuns([nextEntry, ...rest], limit);
}
