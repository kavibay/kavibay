/**
 * Filesystem access for the palette — one seam in front of the Rust commands.
 *
 * Which mechanism answers (the Windows Search index, a bounded directory walk,
 * Spotlight later) is the backend's business: the palette only ever asks for
 * "what is in this folder" and "what in this folder matches this".
 */
import { invoke } from "@tauri-apps/api/core";
import { formatSize } from "./fileSort";
import { parentFolder, samePath } from "./folderScope";
import { pathCompletionsToRows, type PalettePathRow } from "./paletteResults";
import { pathParentLabel } from "./pathQuery";

/** One filesystem hit as the backend returns it. */
export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  /** Last write time in epoch ms; null when it could not be read. */
  modifiedMs: number | null;
  /** Bytes; 0 for directories. */
  size: number;
}

/** Direct children of a folder, directories first. */
export async function listFolder(dir: string, limit = 100): Promise<FileEntry[]> {
  return invoke<FileEntry[]>("browse_folder", { dir, limit });
}

/** Show a file or folder in the OS file manager, selected in its parent. */
export async function revealInFileManager(path: string): Promise<void> {
  await invoke("reveal_in_file_manager", { path });
}

/** Children of `dir` whose name starts with `prefix` (path autocomplete). */
export async function completePath(
  dir: string,
  prefix: string,
  limit = 20,
): Promise<FileEntry[]> {
  return invoke<FileEntry[]>("list_path_completions", { dir, prefix, limit });
}

/** Recursive name search inside a folder; empty query lists the children. */
export async function searchFolder(
  dir: string,
  query: string,
  limit = 40,
): Promise<FileEntry[]> {
  return invoke<FileEntry[]>("search_folder", { dir, query, limit });
}

/**
 * Folder contents as palette rows.
 *
 * The second line carries the file size. It used to name the containing
 * folder, which for a direct child just repeated the path in the header above
 * the list. The folder is still named for a hit from a *subfolder*, where it
 * is the thing that tells two same-named files apart — `baseDir` is what
 * distinguishes the two cases.
 */
export function fileEntriesToRows(
  entries: FileEntry[],
  baseDir?: string,
): PalettePathRow[] {
  return pathCompletionsToRows(entries).map((row) => {
    const parent = parentFolder(row.path);
    const nested = Boolean(baseDir && parent && !samePath(parent, baseDir));
    return {
      ...row,
      // Directories have no size worth showing; the folder name carries them.
      subtitle: row.isDir ? "" : formatSize(row.size ?? 0),
      ...(nested ? { parentLabel: pathParentLabel(row.path) } : {}),
    };
  });
}
