/** Persistence for which first-party extensions are enabled in the catalog. */

export interface ExtensionsPrefs {
  /** Extension ids that are disabled (absent = enabled). */
  disabledIds: string[];
}

export const EXTENSIONS_PREFS_KEY = "kavibay:extensions-v1";

/**
 * What a profile with no stored record starts from, read off the catalog.
 *
 * This was a literal list of six ids in this file, and the argument for it was
 * that it is only six. What that cost: `github-actions` sat in it naming an
 * extension that no longer exists, and nothing in the app could have told
 * anyone — a disabled-id that matches nothing is indistinguishable from one
 * that matches something the user turned off. Deriving it means an extension
 * that is deleted, renamed, or newly shipped default-off is right by
 * construction, and core stops holding a roster of what happens to be bundled.
 *
 * The list is not "extensions we are unsure about" — everything shipped works.
 * They are off out of the box because each is either tied to an account nobody
 * has connected yet or narrow enough to belong in the catalog rather than on a
 * fresh desk. That reason is a fact about the extension, so it is stated in the
 * extension's manifest.
 *
 * A record that exists but names no ids still means "all enabled": only the
 * absence of a record consults this.
 */
export function defaultDisabledIds(
  extensions: readonly { id: string; enabledByDefault?: boolean }[],
): string[] {
  return extensions.filter((ext) => ext.enabledByDefault === false).map((ext) => ext.id);
}

/** Normalize persisted prefs; unknown shape → defaults. */
export function normalizeExtensionsPrefs(raw: unknown): ExtensionsPrefs {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const ids = Array.isArray(o.disabledIds)
    ? o.disabledIds.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  // Dedupe while preserving order.
  return { disabledIds: [...new Set(ids)] };
}

/**
 * Load extension prefs from localStorage, falling back to `defaults`.
 *
 * The defaults are passed in rather than imported so this file stays free of
 * the catalog: it runs under `tsx`, where `import.meta.glob` does not exist.
 */
export function loadExtensionsPrefs(defaults: readonly string[]): ExtensionsPrefs {
  try {
    const raw = localStorage.getItem(EXTENSIONS_PREFS_KEY);
    if (!raw) return { disabledIds: [...defaults] };
    return normalizeExtensionsPrefs(JSON.parse(raw) as unknown);
  } catch {
    return { disabledIds: [...defaults] };
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
