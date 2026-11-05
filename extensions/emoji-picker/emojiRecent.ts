// SPDX-License-Identifier: MIT
/**
 * The persisted "recent" list, kept free of `emojiData.ts`: the widget
 * definition imports this at start-up, the 250 KB catalog loads with the view.
 */

export const MAX_RECENT = 24;

/** Normalize a recent list: strings only, newest-first, capped. */
export function normalizeRecent(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || !item.trim()) continue;
    const g = item.trim();
    if (seen.has(g)) continue;
    seen.add(g);
    out.push(g);
    if (out.length >= MAX_RECENT) break;
  }
  return out;
}

export interface EmojiPickerStoredState {
  recent: string[];
}

export function normalizeEmojiPickerState(raw: unknown): EmojiPickerStoredState {
  if (Array.isArray(raw)) return { recent: normalizeRecent(raw) };
  const value = raw && typeof raw === "object" ? (raw as { recent?: unknown }) : {};
  return { recent: normalizeRecent(value.recent) };
}

/** Prepend a glyph to recent (dedupe, cap). */
export function pushRecent(recent: string[], glyph: string): string[] {
  const g = glyph.trim();
  if (!g) return normalizeRecent(recent);
  return normalizeRecent([g, ...recent.filter((x) => x !== g)]);
}
