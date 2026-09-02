/**
 * Apps the user has hidden from palette search.
 * They still match queries but stay behind a "Show more" expand.
 */
import { appHistoryKey } from "./appLaunchHistory";

export const HIDDEN_APPS_KEY = "kavibay:palette-hidden-apps-v1";

/** Stable hide key — name-based so .lnk/exe variants share one hide. */
export function hiddenAppKey(name: string, path: string): string {
  return appHistoryKey(name, path);
}

/** True when this app is in the hidden-from-search set. */
export function isAppHidden(
  hidden: ReadonlySet<string>,
  name: string,
  path: string,
): boolean {
  const key = hiddenAppKey(name, path);
  return Boolean(key) && hidden.has(key);
}

/** Add an app to the hidden set (immutable). */
export function hideApp(
  hidden: ReadonlySet<string>,
  name: string,
  path: string,
): Set<string> {
  const key = hiddenAppKey(name, path);
  if (!key || hidden.has(key)) return new Set(hidden);
  const next = new Set(hidden);
  next.add(key);
  return next;
}

/** Remove an app from the hidden set (immutable). */
export function unhideApp(
  hidden: ReadonlySet<string>,
  name: string,
  path: string,
): Set<string> {
  const key = hiddenAppKey(name, path);
  if (!key || !hidden.has(key)) return new Set(hidden);
  const next = new Set(hidden);
  next.delete(key);
  return next;
}

/** Normalize persisted JSON into a key set. */
export function normalizeHiddenApps(raw: unknown): Set<string> {
  if (!Array.isArray(raw)) return new Set();
  const out = new Set<string>();
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) out.add(item.trim());
  }
  return out;
}

/** Load hidden app keys from localStorage. */
export function loadHiddenApps(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(HIDDEN_APPS_KEY) ?? "null");
    return normalizeHiddenApps(raw);
  } catch {
    return new Set();
  }
}

/** Persist hidden app keys. */
export function saveHiddenApps(hidden: ReadonlySet<string>): void {
  try {
    localStorage.setItem(HIDDEN_APPS_KEY, JSON.stringify([...hidden]));
  } catch {
    // Best-effort.
  }
}
