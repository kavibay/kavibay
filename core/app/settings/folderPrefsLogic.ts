/**
 * Persistence for the palette's folder catalog: which built-in folders stay
 * searchable, plus folders the user added by hand.
 *
 * The built-in list itself (Desktop, Downloads, …) stays in
 * `palette/knownFolders.ts` — it needs the Tauri path API. This module only
 * knows already-resolved entries, so all of it is pure and assert-testable.
 */

/** A folder the user picked themselves. */
export interface CustomFolder {
  /** Derived from the path, so adding the same folder twice cannot duplicate it. */
  id: string;
  title: string;
  path: string;
  /** Extra search terms; empty means "use the derived defaults". */
  aliases: string[];
}

export interface FolderPrefs {
  /** Built-in folder ids switched off (absent = searchable). */
  disabledBuiltinIds: string[];
  custom: CustomFolder[];
}

/** One searchable folder as the palette consumes it. */
export interface FolderCatalogEntry {
  id: string;
  title: string;
  path: string;
  aliases: string[];
}

export const FOLDER_PREFS_KEY = "kavibay:palette-folders-v1";

export const DEFAULT_FOLDER_PREFS: FolderPrefs = {
  disabledBuiltinIds: [],
  custom: [],
};

/** Case/separator-insensitive path key — `C:/x\` and `c:\X` are one folder. */
export function folderPathKey(path: string): string {
  return path.trim().replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}

/** Trailing segment of a path; a bare drive keeps its own name. */
export function folderLeafName(path: string): string {
  const norm = path.trim().replace(/\//g, "\\").replace(/\\+$/, "");
  if (!norm) return "";
  if (/^[a-zA-Z]:$/.test(norm)) return `${norm.toUpperCase()}\\`;
  return norm.slice(norm.lastIndexOf("\\") + 1) || norm;
}

/** Stable id for a user folder — path-derived, never collides with a built-in id. */
export function customFolderId(path: string): string {
  return `custom:${folderPathKey(path)}`;
}

/** Fallback search terms when the user typed none: the name and the folder leaf. */
export function defaultFolderAliases(title: string, path: string): string[] {
  const out = new Set<string>();
  for (const term of [title, folderLeafName(path)]) {
    const t = term.trim().toLowerCase();
    if (t) out.add(t);
  }
  return [...out];
}

/** Split a user-typed keyword field ("work, projekte") into alias terms. */
export function parseAliasInput(input: string): string[] {
  const out = new Set<string>();
  for (const part of input.split(/[,\n]+/)) {
    const term = part.trim().toLowerCase();
    if (term) out.add(term);
  }
  return [...out];
}

/** Render aliases back into the input field. */
export function formatAliasInput(aliases: readonly string[]): string {
  return aliases.join(", ");
}

/** Normalize one persisted custom entry; unusable shapes return null. */
function normalizeCustomFolder(raw: unknown): CustomFolder | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const path = typeof o.path === "string" ? o.path.trim() : "";
  if (!path) return null;
  const title = typeof o.title === "string" && o.title.trim() ? o.title.trim() : folderLeafName(path);
  const aliases = Array.isArray(o.aliases)
    ? [
        ...new Set(
          o.aliases
            .filter((a): a is string => typeof a === "string")
            .map((a) => a.trim().toLowerCase())
            .filter(Boolean),
        ),
      ]
    : [];
  return { id: customFolderId(path), title, path, aliases };
}

/** Normalize persisted prefs; unknown shape → defaults. */
export function normalizeFolderPrefs(raw: unknown): FolderPrefs {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const disabled = Array.isArray(o.disabledBuiltinIds)
    ? o.disabledBuiltinIds.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  const custom: CustomFolder[] = [];
  const seen = new Set<string>();
  if (Array.isArray(o.custom)) {
    for (const entry of o.custom) {
      const folder = normalizeCustomFolder(entry);
      if (!folder || seen.has(folder.id)) continue;
      seen.add(folder.id);
      custom.push(folder);
    }
  }
  return { disabledBuiltinIds: [...new Set(disabled)], custom };
}

/** Load folder prefs from localStorage. */
export function loadFolderPrefs(): FolderPrefs {
  try {
    const raw = localStorage.getItem(FOLDER_PREFS_KEY);
    if (!raw) return { disabledBuiltinIds: [], custom: [] };
    return normalizeFolderPrefs(JSON.parse(raw) as unknown);
  } catch {
    return { disabledBuiltinIds: [], custom: [] };
  }
}

/** Persist normalized folder prefs. */
export function saveFolderPrefs(prefs: FolderPrefs): void {
  try {
    localStorage.setItem(FOLDER_PREFS_KEY, JSON.stringify(normalizeFolderPrefs(prefs)));
  } catch {
    // Best-effort — a full quota must not break the settings panel.
  }
}

/** Whether a built-in folder id is searchable (default). */
export function isBuiltinFolderEnabled(prefs: FolderPrefs, id: string): boolean {
  return !prefs.disabledBuiltinIds.includes(id);
}

/** Switch a built-in folder on or off (immutable). */
export function setBuiltinFolderEnabled(
  prefs: FolderPrefs,
  id: string,
  enabled: boolean,
): FolderPrefs {
  const next = new Set(prefs.disabledBuiltinIds);
  if (enabled) next.delete(id);
  else next.add(id);
  return { ...prefs, disabledBuiltinIds: [...next].sort() };
}

/** Add a user folder; a path that is already listed is a no-op (immutable). */
export function addCustomFolder(
  prefs: FolderPrefs,
  path: string,
  title?: string,
): FolderPrefs {
  const trimmed = path.trim();
  if (!trimmed) return prefs;
  const id = customFolderId(trimmed);
  if (prefs.custom.some((folder) => folder.id === id)) return prefs;
  const name = title?.trim() || folderLeafName(trimmed);
  return {
    ...prefs,
    custom: [...prefs.custom, { id, title: name, path: trimmed, aliases: [] }],
  };
}

/** Drop a user folder (immutable). */
export function removeCustomFolder(prefs: FolderPrefs, id: string): FolderPrefs {
  return { ...prefs, custom: prefs.custom.filter((folder) => folder.id !== id) };
}

/** Rename a user folder; an empty name falls back to the folder leaf (immutable). */
export function renameCustomFolder(
  prefs: FolderPrefs,
  id: string,
  title: string,
): FolderPrefs {
  return {
    ...prefs,
    custom: prefs.custom.map((folder) =>
      folder.id === id
        ? { ...folder, title: title.trim() || folderLeafName(folder.path) }
        : folder,
    ),
  };
}

/** Replace a user folder's extra search terms (immutable). */
export function setCustomFolderAliases(
  prefs: FolderPrefs,
  id: string,
  aliases: readonly string[],
): FolderPrefs {
  return {
    ...prefs,
    custom: prefs.custom.map((folder) =>
      folder.id === id ? { ...folder, aliases: [...aliases] } : folder,
    ),
  };
}

/**
 * The catalog the palette searches: enabled built-ins plus user folders.
 *
 * Deduped by path, built-in wins — a user who picks their own Downloads gets
 * one row with the localized built-in aliases, not two rows that race.
 */
export function mergeFolderCatalog(
  builtin: readonly FolderCatalogEntry[],
  prefs: FolderPrefs,
): FolderCatalogEntry[] {
  const out: FolderCatalogEntry[] = [];
  const seen = new Set<string>();

  for (const entry of builtin) {
    if (!isBuiltinFolderEnabled(prefs, entry.id)) continue;
    const key = folderPathKey(entry.path);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }

  for (const folder of prefs.custom) {
    const key = folderPathKey(folder.path);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const title = folder.title.trim() || folderLeafName(folder.path);
    out.push({
      id: folder.id,
      title,
      path: folder.path,
      aliases:
        folder.aliases.length > 0
          ? folder.aliases
          : defaultFolderAliases(title, folder.path),
    });
  }

  return out;
}
