/**
 * Shell icons per file type — the ones the user already knows from Explorer.
 *
 * The unit is the extension, not the file: one `.pdf` icon serves every PDF in
 * a listing, so scrolling a big folder costs nothing after the first frame.
 * Everything here is best-effort — a missing icon leaves the palette's own
 * drawn file mark in place, which is also what non-Windows gets.
 */
import { invoke } from "@tauri-apps/api/core";
import { shallowRef, type ShallowRef } from "vue";

/** Rendered icons by type key (`pdf`, `mp4`, `file`). */
export const fileTypeIcons: ShallowRef<Record<string, string>> = shallowRef({});

/** Keys already asked for, hit or miss — a type without an icon is not retried. */
const requested = new Set<string>();

/**
 * Type key for one entry. Directories have none: they keep the drawn folder
 * mark, which is what tells them apart from the colorful file icons.
 */
export function fileTypeIconKey(name: string, isDir: boolean): string | null {
  if (isDir) return null;
  const trimmed = name.trim();
  const dot = trimmed.lastIndexOf(".");
  // `dot <= 0` also covers dotfiles (`.gitignore`), which have no extension.
  if (dot <= 0 || dot === trimmed.length - 1) return "file";
  return trimmed.slice(dot + 1).toLowerCase();
}

/** Fetch any icons among `keys` that are not loaded or in flight yet. */
export async function ensureFileTypeIcons(keys: readonly (string | null)[]) {
  const missing = [...new Set(keys)].filter(
    (key): key is string => Boolean(key) && !requested.has(key as string),
  );
  if (missing.length === 0) return;
  // Mark before awaiting so a second call in the same frame does not re-ask.
  for (const key of missing) requested.add(key);

  try {
    const icons = await invoke<Record<string, string>>("get_file_type_icons", {
      keys: missing,
      size: 32,
    });
    if (!icons || Object.keys(icons).length === 0) return;
    fileTypeIcons.value = { ...fileTypeIcons.value, ...icons };
  } catch {
    // Command unavailable (or this platform has no shell icons) — allow a
    // later retry rather than pinning the failure for the whole session.
    for (const key of missing) requested.delete(key);
  }
}
