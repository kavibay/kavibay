import {
  EMOJI_CATEGORIES,
  EMOJI_DATA,
  type EmojiCategoryId,
  type EmojiEntry,
} from "./emojiData";

export const MAX_RECENT = 24;
/** Cap rendered search hits so short queries stay snappy. */
export const MAX_SEARCH_RESULTS = 96;

/** Fitzpatrick skin-tone modifiers (empty = default / yellow). */
export const SKIN_TONES: { id: string; modifier: string; swatch: string }[] = [
  { id: "default", modifier: "", swatch: "👋" },
  { id: "1f3fb", modifier: "\u{1F3FB}", swatch: "👋🏻" },
  { id: "1f3fc", modifier: "\u{1F3FC}", swatch: "👋🏼" },
  { id: "1f3fd", modifier: "\u{1F3FD}", swatch: "👋🏽" },
  { id: "1f3fe", modifier: "\u{1F3FE}", swatch: "👋🏾" },
  { id: "1f3ff", modifier: "\u{1F3FF}", swatch: "👋🏿" },
];

export type CategoryFilter = EmojiCategoryId | "recent";

/** Category chip icons for the picker UI. */
export const CATEGORY_ICONS: Record<CategoryFilter, string> = {
  recent: "🕒",
  smileys: "😀",
  people: "👋",
  animals: "🐱",
  food: "🍔",
  travel: "✈️",
  activities: "⚽",
  objects: "💡",
  symbols: "❤️",
  flags: "🚩",
};

export { EMOJI_CATEGORIES, EMOJI_DATA, type EmojiCategoryId, type EmojiEntry };

/** Entry plus a pre-lowercased haystack for fast substring search. */
interface IndexedEmoji extends EmojiEntry {
  haystack: string;
}

/** Build lowercase "name keywords" once per catalog entry. */
function indexEntry(entry: EmojiEntry): IndexedEmoji {
  return {
    ...entry,
    haystack: `${entry.name} ${entry.keywords.join(" ")}`.toLowerCase(),
  };
}

const INDEXED: IndexedEmoji[] = EMOJI_DATA.map(indexEntry);

/** Pre-grouped category lists (browse without scanning the full catalog). */
const BY_CATEGORY = INDEXED.reduce(
  (map, entry) => {
    const list = map.get(entry.category);
    if (list) list.push(entry);
    else map.set(entry.category, [entry]);
    return map;
  },
  new Map<EmojiCategoryId, IndexedEmoji[]>(),
);

/** Glyph → entry for recent-row hydration (base + FE0F-stripped). */
const BY_GLYPH = new Map<string, IndexedEmoji>();
for (const entry of INDEXED) {
  BY_GLYPH.set(entry.glyph, entry);
  const stripped = entry.glyph.replace(/\uFE0F/g, "");
  if (!BY_GLYPH.has(stripped)) BY_GLYPH.set(stripped, entry);
}

/** Apply a Fitzpatrick modifier to a base glyph (strips VS16 first). */
export function applySkinTone(glyph: string, modifier: string): string {
  if (!modifier) return glyph;
  const base = glyph.replace(/\uFE0F/g, "");
  return `${base}${modifier}`;
}

/** Match against a pre-lowercased query (caller trims/lowercases once). */
export function matchesQuery(entry: IndexedEmoji | EmojiEntry, queryLower: string): boolean {
  if (!queryLower) return true;
  const haystack =
    "haystack" in entry && typeof entry.haystack === "string"
      ? entry.haystack
      : `${entry.name} ${entry.keywords.join(" ")}`.toLowerCase();
  return haystack.includes(queryLower);
}

/** Look up catalog entry by glyph (strips skin tones / VS16). */
export function findEmojiByGlyph(glyph: string): EmojiEntry | undefined {
  const direct = BY_GLYPH.get(glyph);
  if (direct) return direct;
  const stripped = glyph
    .replace(/[\u{1F3FB}-\u{1F3FF}]/gu, "")
    .replace(/\uFE0F/g, "");
  return BY_GLYPH.get(stripped) ?? BY_GLYPH.get(`${stripped}\uFE0F`);
}

/**
 * Filter catalog by category + search query.
 * `recentGlyphs` is only used when category is `"recent"`.
 */
export function filterEmojis(
  category: CategoryFilter,
  query: string,
  recentGlyphs: string[],
): EmojiEntry[] {
  const q = query.trim().toLowerCase();

  if (category === "recent") {
    const out: EmojiEntry[] = [];
    for (const glyph of recentGlyphs) {
      const found = findEmojiByGlyph(glyph);
      const entry: EmojiEntry = found
        ? { ...found, glyph }
        : { glyph, name: glyph, keywords: [], category: "smileys" };
      if (!q || matchesQuery(entry, q) || entry.glyph.includes(query.trim())) {
        out.push(entry);
      }
    }
    return out;
  }

  const list = BY_CATEGORY.get(category) ?? [];
  if (!q) return list;
  return list.filter((e) => matchesQuery(e, q));
}

/** Scan the full catalog; stops after MAX_SEARCH_RESULTS hits. */
export function searchAllEmojis(query: string): EmojiEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: EmojiEntry[] = [];
  for (const entry of INDEXED) {
    if (matchesQuery(entry, q)) {
      out.push(entry);
      if (out.length >= MAX_SEARCH_RESULTS) break;
    }
  }
  return out;
}

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
