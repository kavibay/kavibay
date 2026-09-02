/**
 * Sort order for file listings — one rule set, applied to browsing a folder
 * and to searching inside one alike.
 *
 * Sorting happens here rather than in the backend so switching the order is
 * instant: the rows are already in memory, and a re-fetch per column would
 * make a sort click feel like a reload.
 */

/** Available orders, in the order the cycle steps through them. */
export const FILE_SORT_MODES = ["modified", "name", "size"] as const;

export type FileSortMode = (typeof FILE_SORT_MODES)[number];

/** Default when a folder is opened: what was touched last is what you want. */
export const DEFAULT_FILE_SORT: FileSortMode = "modified";

/** Everything the sort needs from a row; rows carry more, this is the contract. */
export interface SortableFileRow {
  title: string;
  isDir: boolean;
  modifiedMs?: number | null;
  size?: number;
}

/** Label for the sort control, with the direction it actually applies. */
export function sortModeLabel(mode: FileSortMode): string {
  if (mode === "modified") return "Modified ↓";
  if (mode === "size") return "Size ↓";
  return "Name ↑";
}

/** Next order in the cycle (the sort control has no menu — it steps). */
export function nextSortMode(mode: FileSortMode): FileSortMode {
  const index = FILE_SORT_MODES.indexOf(mode);
  return FILE_SORT_MODES[(index + 1) % FILE_SORT_MODES.length]!;
}

/** Accept only a known mode (persisted values outlive this list). */
export function parseSortMode(raw: unknown): FileSortMode {
  return FILE_SORT_MODES.includes(raw as FileSortMode)
    ? (raw as FileSortMode)
    : DEFAULT_FILE_SORT;
}

/** Relative for anything recent, absolute once "3 weeks ago" stops helping. */
export function formatModified(
  ms: number | null | undefined,
  now = Date.now(),
): string {
  if (!ms || ms <= 0) return "";
  const diff = now - ms;
  if (diff < 60_000) return "now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(ms).toLocaleDateString();
}

/** Bytes in the unit a person would say out loud. */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // One decimal below 10 (2.4 MB), none above it (240 MB) — the second digit
  // stops carrying information once the first one is that big.
  const rounded = value >= 10 || unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

const SORT_MODE_KEY = "kavibay:palette-file-sort-v1";

/** Chosen order from the last session; the default when nothing is stored. */
export function loadFileSortMode(): FileSortMode {
  try {
    return parseSortMode(localStorage.getItem(SORT_MODE_KEY));
  } catch {
    return DEFAULT_FILE_SORT;
  }
}

/** Remember the order — picking it again every session is the annoying part. */
export function saveFileSortMode(mode: FileSortMode): void {
  try {
    localStorage.setItem(SORT_MODE_KEY, mode);
  } catch {
    // Private mode / quota — the order still applies for this session.
  }
}

/**
 * Sorted copy of `rows`.
 *
 * Only name order groups directories first. Sorting by date or size is a
 * question about the values themselves — pinning folders to the top there
 * would answer a different question than the one that was asked, and it is
 * also what Explorer does.
 */
export function sortFileRows<T extends SortableFileRow>(
  rows: readonly T[],
  mode: FileSortMode,
): T[] {
  const out = [...rows];
  const byName = (a: T, b: T) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: "base" });

  if (mode === "name") {
    return out.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return byName(a, b);
    });
  }

  if (mode === "size") {
    // Directories have no meaningful size; they sink to the bottom in name
    // order rather than pretending to be zero bytes among real files.
    return out.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? 1 : -1;
      if (a.isDir) return byName(a, b);
      return (b.size ?? 0) - (a.size ?? 0) || byName(a, b);
    });
  }

  return out.sort((a, b) => {
    // Unknown timestamps sort last: an entry we could not stat should not
    // claim the top of a newest-first list.
    const at = a.modifiedMs ?? -1;
    const bt = b.modifiedMs ?? -1;
    return bt - at || byName(a, b);
  });
}
