/** Persistence for which first-party extensions are enabled in the catalog. */

export interface ExtensionsPrefs {
  /** Extension ids that are disabled (absent = enabled). */
  disabledIds: string[];
}

export const EXTENSIONS_PREFS_KEY = "kavibay:extensions-v1";

/**
 * What a profile with no stored record starts from.
 *
 * The list is not "extensions we are unsure about" — everything here works. They
 * are off out of the box because each one is either tied to an account the user
 * has not connected yet or narrow enough that it belongs in the catalog rather
 * than on a fresh desk. A record that exists but names no ids still means "all
 * enabled": only the absence of a record lands here.
 */
export const DEFAULT_EXTENSIONS_PREFS: ExtensionsPrefs = {
  disabledIds: [
    "calendar",
    "color-picker",
    "focus-tracker",
    "github-actions",
    "kavibay.ai-usage/ai-usage",
    "tado",
  ],
};

/** Normalize persisted prefs; unknown shape → defaults. */
export function normalizeExtensionsPrefs(raw: unknown): ExtensionsPrefs {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const ids = Array.isArray(o.disabledIds)
    ? o.disabledIds.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  // Dedupe while preserving order.
  return { disabledIds: [...new Set(ids)] };
}

/** Load extension prefs from localStorage. */
export function loadExtensionsPrefs(): ExtensionsPrefs {
  try {
    const raw = localStorage.getItem(EXTENSIONS_PREFS_KEY);
    if (!raw) return { disabledIds: [...DEFAULT_EXTENSIONS_PREFS.disabledIds] };
    return normalizeExtensionsPrefs(JSON.parse(raw) as unknown);
  } catch {
    return { disabledIds: [...DEFAULT_EXTENSIONS_PREFS.disabledIds] };
  }
}

/** Persist normalized extension prefs. */
export function saveExtensionsPrefs(state: ExtensionsPrefs): void {
  localStorage.setItem(
    EXTENSIONS_PREFS_KEY,
    JSON.stringify(normalizeExtensionsPrefs(state)),
  );
}

/** Whether an extension id is enabled given a disabled-id list. */
export function isExtensionIdEnabled(
  typeId: string,
  disabledIds: readonly string[],
): boolean {
  return !disabledIds.includes(typeId);
}
