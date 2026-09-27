export const PALETTE_WIDGET_PREFS_KEY = "kavibay:palette-widgets-v1";

/** Missing settings start with Clipboard; an explicit empty list stays empty. */
export function normalizePaletteWidgets(raw: unknown): string[] {
  if (!Array.isArray(raw)) return ["clipboard"];
  // Keep unavailable ids so disabling an extension does not erase its position.
  return [...new Set(raw.filter((id): id is string => typeof id === "string" && id.trim().length > 0))];
}

export function movePaletteWidget(ids: readonly string[], id: string, direction: -1 | 1): string[] {
  const next = [...ids];
  const index = next.indexOf(id);
  const target = index + direction;
  if (index >= 0 && target >= 0 && target < next.length) {
    [next[index], next[target]] = [next[target], next[index]];
  }
  return next;
}

export function loadPaletteWidgets(storage?: Pick<Storage, "getItem">): string[] {
  try {
    const raw = (storage ?? localStorage).getItem(PALETTE_WIDGET_PREFS_KEY);
    return normalizePaletteWidgets(raw ? JSON.parse(raw) as unknown : null);
  } catch {
    return normalizePaletteWidgets(null);
  }
}

export function savePaletteWidgets(ids: readonly string[], storage?: Pick<Storage, "setItem">) {
  (storage ?? localStorage).setItem(PALETTE_WIDGET_PREFS_KEY, JSON.stringify(normalizePaletteWidgets(ids)));
}
