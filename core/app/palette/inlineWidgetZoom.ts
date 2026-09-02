/**
 * Content zoom for the palette's inline widget view, remembered per widget.
 *
 * Its own store rather than the instance's `contentScale` for two reasons: the
 * palette's scratch copies have no layout instance to write to at all, and the
 * panel is a different box from a card — a zoom that makes the inline view
 * readable should not silently resize the card on the desk.
 */
import { clampContentScale, DEFAULT_CONTENT_SCALE } from "../host/resizeLogic";

const STORAGE_KEY = "kavibay:palette-inline-zoom-v1";

/** Inline instance id (real or scratch) → content zoom. */
export type InlineZoomMap = Record<string, number>;

/** Read a persisted map, dropping anything that is not a usable scale. */
export function parseInlineZoom(raw: string | null): InlineZoomMap {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: InlineZoomMap = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!id) continue;
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      const scale = clampContentScale(value);
      if (scale === DEFAULT_CONTENT_SCALE) continue;
      out[id] = scale;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Map with `id` set to `scale`, or without `id` when that is the default zoom.
 *
 * Storing nothing for 1 is what keeps the map from collecting an entry per
 * widget the user ever glanced at — and it means a stale id from a deleted
 * instance costs nothing unless it was actually zoomed.
 */
export function withInlineZoom(
  map: InlineZoomMap,
  id: string,
  scale: number,
): InlineZoomMap {
  const next = { ...map };
  const clamped = clampContentScale(scale);
  if (clamped === DEFAULT_CONTENT_SCALE) delete next[id];
  else next[id] = clamped;
  return next;
}

export function loadInlineZoom(): InlineZoomMap {
  try {
    return parseInlineZoom(localStorage.getItem(STORAGE_KEY));
  } catch {
    return {};
  }
}

export function saveInlineZoom(map: InlineZoomMap): void {
  try {
    if (Object.keys(map).length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Private mode / quota: the zoom just does not survive the session.
  }
}
