// SPDX-License-Identifier: MIT
/**
 * Pure Moodist state helpers: volumes, category, and normalization.
 * Catalog ids are passed in by callers — this module does not import catalog.
 */

/** Persisted mixer state (playing is never stored). */
export interface MoodistPersisted {
  version: 1;
  activeCategoryId: string;
  /** Sound id → volume in (0, 1]; zeros are omitted. */
  volumes: Record<string, number>;
}

/** Stub default until catalog exists (Task 2); callers should pass real ids. */
export const DEFAULT_CATEGORY_ID = "nature";

/** Empty mix with the given default category selected. */
export function emptyState(defaultCategoryId: string): MoodistPersisted {
  return {
    version: 1,
    activeCategoryId: defaultCategoryId,
    volumes: {},
  };
}

/** Clamp raw input to a finite volume in [0, 1]. */
export function clampVolume(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Repair raw persisted JSON into a safe state.
 * Falls back category, clamps volumes, drops unknown sound keys and zero volumes.
 */
export function normalizeState(
  raw: unknown,
  opts: {
    defaultCategoryId: string;
    categoryIds: ReadonlySet<string>;
    soundIds: ReadonlySet<string>;
  },
): MoodistPersisted {
  if (!raw || typeof raw !== "object") {
    return emptyState(opts.defaultCategoryId);
  }
  const o = raw as Record<string, unknown>;
  const activeCategoryId =
    typeof o.activeCategoryId === "string" && opts.categoryIds.has(o.activeCategoryId)
      ? o.activeCategoryId
      : opts.defaultCategoryId;

  const volumes: Record<string, number> = {};
  const rawVolumes =
    o.volumes && typeof o.volumes === "object" && !Array.isArray(o.volumes)
      ? (o.volumes as Record<string, unknown>)
      : {};
  for (const [soundId, value] of Object.entries(rawVolumes)) {
    if (!opts.soundIds.has(soundId)) continue;
    const v = clampVolume(value);
    if (v > 0) volumes[soundId] = v;
  }

  return {
    version: 1,
    activeCategoryId,
    volumes,
  };
}

/** Whether a sound is currently in the mix (volume > 0). */
export function isActive(volumes: Record<string, number>, soundId: string): boolean {
  return (volumes[soundId] ?? 0) > 0;
}

/**
 * Toggle a sound in/out of the mix.
 * Active → remove key; inactive → set defaultVolume (clamped).
 */
export function toggleSound(
  volumes: Record<string, number>,
  soundId: string,
  defaultVolume = 0.5,
): Record<string, number> {
  const next = { ...volumes };
  if (isActive(next, soundId)) {
    delete next[soundId];
    return next;
  }
  const v = clampVolume(defaultVolume);
  if (v > 0) next[soundId] = v;
  else delete next[soundId];
  return next;
}

/**
 * Set a sound’s volume. Volume ≤ 0 removes the key; otherwise stores clamped value.
 */
export function setSoundVolume(
  volumes: Record<string, number>,
  soundId: string,
  volume: number,
): Record<string, number> {
  const next = { ...volumes };
  const v = clampVolume(volume);
  if (v <= 0) {
    delete next[soundId];
    return next;
  }
  next[soundId] = v;
  return next;
}

/** Clear all volumes (empty mix). */
export function clearVolumes(): Record<string, number> {
  return {};
}

/** Deep-copy volumes + category for duplicate (playing is not stored). */
export function stateForDuplicate(state: MoodistPersisted): MoodistPersisted {
  return {
    version: 1,
    activeCategoryId: state.activeCategoryId,
    volumes: { ...state.volumes },
  };
}
