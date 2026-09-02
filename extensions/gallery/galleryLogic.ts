// SPDX-License-Identifier: MIT

/** Parse `extensions/<id>/intro.mp4` from a Vite glob key. */
export function extensionIdFromIntroPath(path: string): string | null {
  const m = path.match(/extensions\/([^/]+)\/intro\.mp4$/);
  return m ? m[1] : null;
}

/** Manifest fields needed to render / filter a gallery tile. */
export interface GalleryRegistryEntry {
  id: string;
  title: string;
  description: string;
  categories: string[];
  keywords: string[];
  /** Manifest folder whose intro.mp4 should preview this widget. */
  videoId?: string;
}

export interface GalleryTile {
  id: string;
  title: string;
  description: string;
  categories: string[];
  keywords: string[];
  /** Resolved intro URL, or null when the extension has no intro.mp4. */
  videoUrl: string | null;
}

/**
 * One tile per registry extension (except gallery itself).
 * Missing intro.mp4 → `videoUrl: null` (blank tile media).
 * Sort: tiles with video first, then A→Z by id within each group.
 */
export function buildGalleryTiles(
  registry: GalleryRegistryEntry[],
  videoById: Record<string, string>,
): GalleryTile[] {
  const tiles: GalleryTile[] = [];
  for (const entry of registry) {
    if (entry.id === "gallery") continue;
    tiles.push({
      id: entry.id,
      title: entry.title,
      description: entry.description,
      categories: [...entry.categories],
      keywords: [...entry.keywords],
      videoUrl: videoById[entry.id] ?? (entry.videoId ? videoById[entry.videoId] : undefined) ?? null,
    });
  }
  tiles.sort((a, b) => {
    const aHas = a.videoUrl ? 0 : 1;
    const bHas = b.videoUrl ? 0 : 1;
    if (aHas !== bHas) return aHas - bHas;
    return a.id.localeCompare(b.id);
  });
  return tiles;
}

/** Unique categories across tiles, sorted A→Z. */
export function collectGalleryCategories(tiles: GalleryTile[]): string[] {
  const set = new Set<string>();
  for (const tile of tiles) {
    for (const c of tile.categories) {
      if (c) set.add(c);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/**
 * Filter tiles by free-text query and optional category chip.
 * `category === null` means All. Query matches id/title/description/categories/keywords.
 */
export function filterGalleryTiles(
  tiles: GalleryTile[],
  query: string,
  category: string | null,
): GalleryTile[] {
  const q = query.trim().toLowerCase();
  return tiles.filter((tile) => {
    if (category && !tile.categories.includes(category)) return false;
    if (!q) return true;
    if (tile.id.toLowerCase().includes(q)) return true;
    if (tile.title.toLowerCase().includes(q)) return true;
    if (tile.description.toLowerCase().includes(q)) return true;
    if (tile.categories.some((c) => c.toLowerCase().includes(q))) return true;
    if (tile.keywords.some((k) => k.toLowerCase().includes(q))) return true;
    return false;
  });
}
