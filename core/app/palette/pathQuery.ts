/**
 * Detect and parse path-like palette queries for directory autocomplete.
 * Absolute / ~ paths only — fail closed on relative junk.
 */

export interface PathQueryParts {
  /** Absolute directory to list. */
  dir: string;
  /** Case-insensitive name prefix filter (may be empty). */
  prefix: string;
}

/** True when the query looks like an absolute / home path worth completing. */
export function looksLikePathQuery(query: string): boolean {
  const t = query.trim();
  if (!t) return false;
  if (t === "~" || t.startsWith("~/") || t.startsWith("~\\")) return true;
  if (/^[a-zA-Z]:$/i.test(t)) return true;
  if (/^[a-zA-Z]:[\\/]/.test(t)) return true;
  // UNC (`\\server\share\…`) deferred — drive + ~ cover the common cases.
  return false;
}

/**
 * Expand `~` using `home` (absolute). Returns null when home is required but missing.
 */
export function expandHomePrefix(query: string, home: string | null): string | null {
  const t = query.trim();
  if (t === "~" || t === "~/" || t === "~\\") {
    if (!home?.trim()) return null;
    return home.trim();
  }
  if (t.startsWith("~/") || t.startsWith("~\\")) {
    if (!home?.trim()) return null;
    const rest = t.slice(2).replace(/^[\\/]+/, "");
    const base = home.trim().replace(/[\\/]+$/, "");
    return rest ? `${base}\\${rest.replace(/\//g, "\\")}` : base;
  }
  return t;
}

/**
 * Parse a path-like query into directory + name prefix.
 * `home` is required for `~` queries; ignored otherwise.
 */
export function parsePathQuery(
  query: string,
  home: string | null,
): PathQueryParts | null {
  if (!looksLikePathQuery(query)) return null;

  let expanded = expandHomePrefix(query, home);
  if (expanded == null) return null;
  expanded = expanded.trim();
  if (!expanded) return null;

  // Reject null bytes and parent segments — fail closed.
  if (expanded.includes("\0")) return null;
  const norm = expanded.replace(/\//g, "\\");
  const parts = norm.split("\\").filter((p, i) => !(i > 0 && p === ""));
  // Allow "C:" as first segment; reject ".." anywhere.
  for (const part of parts) {
    if (part === "..") return null;
  }

  // Bare drive → list drive root.
  if (/^[a-zA-Z]:$/i.test(norm)) {
    return { dir: `${norm}\\`, prefix: "" };
  }

  const endsWithSep = /[\\/]$/.test(expanded);
  if (endsWithSep) {
    let dir = norm.replace(/\\+$/, "");
    if (/^[a-zA-Z]:$/i.test(dir)) dir = `${dir}\\`;
    if (!dir) return null;
    return { dir: dir.endsWith("\\") ? dir : `${dir}\\`, prefix: "" };
  }

  const lastSep = norm.lastIndexOf("\\");
  if (lastSep < 0) return null;

  let dir = norm.slice(0, lastSep);
  const prefix = norm.slice(lastSep + 1);
  if (/^[a-zA-Z]:$/i.test(dir)) dir = `${dir}\\`;
  if (!dir) return null;
  // UNC `\\server` with no share yet — not listable.
  if (dir === "\\" || dir === "\\\\") return null;

  return {
    dir: dir.endsWith("\\") ? dir : `${dir}\\`,
    prefix,
  };
}

/** Short parent label for the row subtitle (e.g. `C:` or `Downloads`). */
export function pathParentLabel(fullPath: string): string {
  const norm = fullPath.replace(/\//g, "\\").replace(/\\+$/, "");
  const idx = norm.lastIndexOf("\\");
  if (idx <= 0) return norm || fullPath;
  const parent = norm.slice(0, idx);
  if (/^[a-zA-Z]:$/i.test(parent)) return parent.toUpperCase();
  const leaf = parent.slice(parent.lastIndexOf("\\") + 1);
  return leaf || parent;
}
