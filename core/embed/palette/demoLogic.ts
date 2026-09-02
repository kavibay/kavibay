import { fuzzyMatch } from "../../app/palette/fuzzy";
import { DEMO_ROWS, type DemoRow } from "./demoRows";

export interface RankedRow {
  row: DemoRow;
  score: number;
}

/**
 * An empty query has no results, and that is the app's rule rather than a
 * simplification: `filterPaletteRows` returns `[]` for an empty query, and
 * `showResultsList` keeps the panel out of the DOM entirely until something is
 * typed. A demo that opens with twelve rows showing is a different product —
 * the palette is a search bar, not a menu.
 *
 * A typed query is scored with `fuzzyMatch` against title and keywords; misses
 * drop out.
 */
export function rankRows(query: string, rows: DemoRow[] = DEMO_ROWS): RankedRow[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return [];
  }

  const hits: RankedRow[] = [];
  for (const row of rows) {
    let best = fuzzyMatch(trimmed, row.title);
    for (const keyword of row.keywords) {
      const hit = fuzzyMatch(trimmed, keyword);
      if (hit.matched && hit.score > best.score) best = hit;
    }
    if (best.matched) hits.push({ row, score: best.score });
  }
  hits.sort((a, b) => b.score - a.score || a.row.title.localeCompare(b.row.title));
  return hits;
}

/**
 * Clamp, do not wrap. The real palette stops at the ends; wrapping would make
 * the scripted walk look like a carousel.
 */
export function moveSelection(index: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(length - 1, index + delta));
}
