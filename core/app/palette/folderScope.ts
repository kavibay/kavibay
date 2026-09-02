/**
 * Folder scope: the palette state where the result list stops being "everything
 * you can run" and becomes "what is inside this folder".
 *
 * Entered with Tab on a folder row, and stacked when descending further, so
 * Shift+Tab / Backspace can walk back up the way it came instead of dropping
 * the user straight back into the global search.
 *
 * Path handling is Windows-shaped (`\`) but tolerates `/`, so the same helpers
 * work once a POSIX backend lands.
 */
import type { PaletteRow } from "./paletteResults";

/** One level of the scope stack. */
export interface FolderScopeEntry {
  /** Absolute directory path. */
  path: string;
  /** Leaf name shown on the chip. */
  title: string;
}

/** A row that points at a directory — the only kind scope can be entered from. */
export type BrowsableRow = Extract<PaletteRow, { kind: "folder" | "path" }>;

/** Rows you can descend into: well-known folders and directory path hits. */
export function isBrowsableRow(row: PaletteRow | undefined): row is BrowsableRow {
  if (!row) return false;
  if (row.kind === "folder") return true;
  return row.kind === "path" && row.isDir;
}

/** Trailing segment of a path — `C:\Users\Alex\Downloads` → `Downloads`. */
export function folderTitle(path: string): string {
  const norm = path.replace(/\//g, "\\").replace(/\\+$/, "");
  if (!norm) return path;
  // A bare drive has no leaf; show the drive itself.
  if (/^[a-zA-Z]:$/.test(norm)) return `${norm.toUpperCase()}\\`;
  const leaf = norm.slice(norm.lastIndexOf("\\") + 1);
  return leaf || norm;
}

/** Parent directory, or null at a drive root. */
export function parentFolder(path: string): string | null {
  const norm = path.replace(/\//g, "\\").replace(/\\+$/, "");
  const idx = norm.lastIndexOf("\\");
  if (idx <= 0) return null;
  const parent = norm.slice(0, idx);
  if (/^[a-zA-Z]:$/.test(parent)) return `${parent}\\`;
  return parent || null;
}

/** Push a level; a repeat of the current folder is ignored. */
export function enterFolder(
  stack: readonly FolderScopeEntry[],
  path: string,
): FolderScopeEntry[] {
  const trimmed = path.trim();
  if (!trimmed) return [...stack];
  const current = stack[stack.length - 1];
  if (current && samePath(current.path, trimmed)) return [...stack];
  return [...stack, { path: trimmed, title: folderTitle(trimmed) }];
}

/** Pop a level; an empty result means "leave folder scope". */
export function leaveFolder(
  stack: readonly FolderScopeEntry[],
): FolderScopeEntry[] {
  return stack.slice(0, -1);
}

/** The folder currently being browsed, or null when scope is off. */
export function currentFolder(
  stack: readonly FolderScopeEntry[],
): FolderScopeEntry | null {
  return stack[stack.length - 1] ?? null;
}

/** Case-insensitive path compare, `/` and `\` equivalent, trailing sep ignored. */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string) =>
    p.trim().replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
  return norm(a) === norm(b);
}

/** Chip placeholder — the folder is named on the chip, so this is the verb. */
export function scopePlaceholder(entry: FolderScopeEntry | null): string {
  return entry ? `Search in ${entry.title}` : "Search in folder";
}
