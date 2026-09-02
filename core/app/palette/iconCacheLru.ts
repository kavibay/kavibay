/**
 * LRU bookkeeping for the palette's extracted app-icon cache.
 *
 * Icons arrive as `data:image/png;base64,…` strings, so each cached entry costs
 * both the string and a decoded bitmap for as long as it is referenced. The
 * cache used to grow for the whole session; this caps it.
 */

/** Roughly ten screens of palette rows — generous, but bounded. */
export const MAX_CACHED_APP_ICONS = 256;

/**
 * Which cached icon paths to drop so at most `max` remain.
 *
 * `recencyOldestFirst` is the request order (oldest first). Cached keys that do
 * not appear in it were never requested through the palette and are evicted
 * first; beyond that, eviction follows recency.
 */
export function iconKeysToEvict(
  cached: string[],
  recencyOldestFirst: string[],
  max: number = MAX_CACHED_APP_ICONS,
): string[] {
  const overflow = cached.length - max;
  if (overflow <= 0) return [];

  const cachedSet = new Set(cached);
  const known = new Set(recencyOldestFirst);
  const coldestFirst: string[] = [];

  for (const key of cached) {
    if (!known.has(key)) coldestFirst.push(key);
  }
  for (const key of recencyOldestFirst) {
    if (cachedSet.has(key)) coldestFirst.push(key);
  }

  return coldestFirst.slice(0, overflow);
}
