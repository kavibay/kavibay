/**
 * Curated virtual-key shortcuts for the Apps dock (media / browser / system).
 * `path` on launcher entries is stored as `key:{id}`.
 */

export interface LauncherKeyDef {
  /** Stable id persisted in `path` as `key:{id}`. */
  id: string;
  /** Full label for menus and tooltips. */
  label: string;
  /** Short dock glyph (1–4 chars). */
  glyph: string;
}

/** Built-in key catalog shown under + → Taste… */
export const LAUNCHER_KEYS: LauncherKeyDef[] = [
  { id: "media_play_pause", label: "Play / Pause", glyph: "⏯" },
  { id: "media_next", label: "Next", glyph: "⏭" },
  { id: "media_prev", label: "Previous", glyph: "⏮" },
  { id: "media_stop", label: "Stop", glyph: "⏹" },
  { id: "vol_mute", label: "Mute", glyph: "🔇" },
  { id: "vol_up", label: "Volume Up", glyph: "Vol+" },
  { id: "vol_down", label: "Volume Down", glyph: "Vol−" },
  { id: "browser_back", label: "Browser Back", glyph: "◀" },
  { id: "browser_forward", label: "Browser Forward", glyph: "▶" },
  { id: "browser_refresh", label: "Refresh", glyph: "↻" },
  { id: "browser_home", label: "Browser Home", glyph: "Home" },
  { id: "browser_search", label: "Search", glyph: "Find" },
  { id: "launch_mail", label: "Mail", glyph: "Mail" },
  { id: "launch_media", label: "Media Player", glyph: "Media" },
  { id: "print_screen", label: "Print Screen", glyph: "Prt" },
  { id: "escape", label: "Escape", glyph: "Esc" },
];

/** Persistable path for a catalog key. */
export function keyPath(id: string): string {
  return `key:${id}`;
}

/** Extract catalog id from `key:{id}`, or null. */
export function parseKeyId(path: string): string | null {
  if (!path.startsWith("key:")) return null;
  const id = path.slice(4);
  return id || null;
}

/** Look up a catalog entry by id. */
export function findKeyDef(id: string): LauncherKeyDef | undefined {
  return LAUNCHER_KEYS.find((k) => k.id === id);
}

/** Dock label for a key entry (glyph), falling back to first letter of name. */
export function keyGlyph(path: string, name: string): string {
  const id = parseKeyId(path);
  if (id) {
    const def = findKeyDef(id);
    if (def) return def.glyph;
  }
  return name.slice(0, 1).toUpperCase() || "?";
}
