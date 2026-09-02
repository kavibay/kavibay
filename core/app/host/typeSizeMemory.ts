/**
 * Per-type size memory: the size you last left a widget of some type at, reused
 * the next time you add one.
 *
 * The manifest's `ui.defaultSize` is a first guess by the widget's author. Once
 * someone has resized a Notes card to what they actually want, adding a second
 * one at the author's guess makes them do the same drag again — so the last
 * size wins, and the manifest stays the fallback for a type never resized here.
 *
 * Keyed by typeId, not instance: instances keep their own size in the layout.
 */
import { DEFAULT_WIDGET_CLAMPS, clampSize } from "./resizeLogic";

/**
 * A remembered size. `h` is absent for `hugHeight` docks, where the host owns
 * width only and the height follows content.
 */
export interface RememberedSize {
  w: number;
  h?: number;
}

export const TYPE_SIZE_STORAGE_KEY = "kavibay:widget-type-size-v1";

/**
 * Cap on remembered types. A layout has tens of widget types, so this is only
 * a guard against a storage entry growing without bound after a package churns
 * through ids — oldest keys are dropped first.
 */
export const MAX_REMEMBERED_TYPES = 200;

/** One entry, clamped to the host's resize bounds, or null when unusable. */
function normalizeSize(raw: unknown): RememberedSize | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as { w?: unknown; h?: unknown };
  if (typeof row.w !== "number" || !Number.isFinite(row.w)) return null;
  const hasHeight = typeof row.h === "number" && Number.isFinite(row.h);
  // clampSize needs both axes; for width-only entries the height is a throwaway.
  const clamped = clampSize(row.w, hasHeight ? (row.h as number) : DEFAULT_WIDGET_CLAMPS.minHeight);
  return hasHeight ? { w: clamped.width, h: clamped.height } : { w: clamped.width };
}

/** Normalize a persisted map; malformed entries are dropped, not repaired. */
export function normalizeTypeSizes(raw: unknown): Record<string, RememberedSize> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, RememberedSize> = {};
  for (const [typeId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!typeId) continue;
    const size = normalizeSize(value);
    if (size) out[typeId] = size;
  }
  return out;
}

/**
 * Map with `typeId` set to `size`, trimmed to `MAX_REMEMBERED_TYPES`.
 * Pure — the caller decides whether to persist the result.
 */
export function rememberTypeSizeIn(
  map: Record<string, RememberedSize>,
  typeId: string,
  size: RememberedSize,
): Record<string, RememberedSize> {
  const normalized = normalizeSize(size);
  if (!typeId || !normalized) return map;
  // Re-insert last so the trim below drops the least recently touched types.
  const next: Record<string, RememberedSize> = {};
  for (const [key, value] of Object.entries(map)) {
    if (key !== typeId) next[key] = value;
  }
  next[typeId] = normalized;

  const keys = Object.keys(next);
  if (keys.length <= MAX_REMEMBERED_TYPES) return next;
  const trimmed: Record<string, RememberedSize> = {};
  for (const key of keys.slice(keys.length - MAX_REMEMBERED_TYPES)) {
    trimmed[key] = next[key];
  }
  return trimmed;
}

/** In-memory mirror so adding a widget does not re-read storage each time. */
let cache: Record<string, RememberedSize> | null = null;

/** Load the remembered sizes (cached after the first read). */
export function loadTypeSizes(): Record<string, RememberedSize> {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(TYPE_SIZE_STORAGE_KEY);
    cache = raw ? normalizeTypeSizes(JSON.parse(raw) as unknown) : {};
  } catch {
    cache = {};
  }
  return cache;
}

/** The size a new widget of this type should open at, when one is remembered. */
export function rememberedSizeFor(typeId: string): RememberedSize | undefined {
  return loadTypeSizes()[typeId];
}

/**
 * Record the size a widget of `typeId` was left at. Pass `h: undefined` for
 * `hugHeight` docks so only the width is remembered.
 */
export function rememberTypeSize(typeId: string, size: RememberedSize): void {
  const next = rememberTypeSizeIn(loadTypeSizes(), typeId, size);
  cache = next;
  try {
    localStorage.setItem(TYPE_SIZE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota / private mode: the in-memory cache still serves this session.
  }
}
