/**
 * File-type marks for the demo's palette rows.
 *
 * WHY THESE ARE DRAWN AND THE APP'S ARE NOT:
 *
 * On the desktop a file row carries the *shell* icon for its type — the real
 * Explorer one, fetched per extension by `fileTypeIcons.ts` through the
 * `get_file_type_icons` command and cached for the whole session. A browser
 * has no shell to ask, so the demo draws its own: a sheet in the type's colour
 * with a small white mark on it.
 *
 * They are approximations and are meant to read as such. What they reproduce
 * is the thing that actually matters in a list — that a PDF, a spreadsheet and
 * a photo are told apart at a glance, in colour, before the name is read.
 *
 * Directories are deliberately absent. `fileTypeIconKey` returns null for one
 * in the app, and that is the whole reason a folder keeps the drawn folder
 * mark instead of joining the colourful icons; the same rule holds here.
 */

export interface FileMark {
  /** Sheet colour. */
  color: string;
  /** White marks drawn on the sheet, as `d` attributes. */
  glyph: string[];
}

/** The sheet itself, shared by every mark: a page with its corner folded. */
export const FILE_SHEET_PATH = "M6.5 2.5h8l4 4v15h-12z";
export const FILE_FOLD_PATH = "M14.5 2.5l4 4h-4z";

const LINES = ["M9 12h7", "M9 15h7", "M9 18h4.5"];

/**
 * By extension, the way the app keys its icon cache: one entry serves every
 * file of that type, and an unlisted extension falls back to the plain sheet
 * rather than to nothing.
 */
const MARKS: Record<string, FileMark> = {
  // Colour is the PDF cue, the way it is in Explorer; the lines only say
  // "a document", which is what a stroked box on a red sheet failed to.
  pdf: { color: "#d93025", glyph: LINES },
  // Spreadsheets: the white grid is what tells them from a document at 20px.
  xlsx: { color: "#1d7044", glyph: ["M9 11.5h7v7h-7z", "M12.5 11.5v7", "M9 15h7"] },
  csv: { color: "#1d7044", glyph: ["M9 11.5h7v7h-7z", "M12.5 11.5v7", "M9 15h7"] },
  docx: { color: "#1a56c4", glyph: LINES },
  // Pictures: horizon and sun, the shape every gallery uses.
  jpg: { color: "#8a3fc0", glyph: ["M9 18l2.5-3 2 2.2 2-2.6 2.5 3.4z", "M11 12.6a1 1 0 1 0 .01 0z"] },
  jpeg: { color: "#8a3fc0", glyph: ["M9 18l2.5-3 2 2.2 2-2.6 2.5 3.4z", "M11 12.6a1 1 0 1 0 .01 0z"] },
  png: { color: "#8a3fc0", glyph: ["M9 18l2.5-3 2 2.2 2-2.6 2.5 3.4z", "M11 12.6a1 1 0 1 0 .01 0z"] },
  mp4: { color: "#b5411f", glyph: ["M11 12.5l6 3.5-6 3.5z"] },
  // A window with its title bar: an application, not a document.
  exe: { color: "#2a6ea6", glyph: ["M9 12h7.5v7H9z", "M9 14.2h7.5"] },
  md: { color: "#5a6270", glyph: LINES },
  txt: { color: "#5a6270", glyph: LINES },
  json: { color: "#a07a1e", glyph: ["M11.5 11.5c-1.5 0-1.5 2-1.5 3s0 3-1.5 3", "M15 11.5c1.5 0 1.5 2 1.5 3s0 3 1.5 3"] },
  ts: { color: "#1a56c4", glyph: ["M9 13.5l-2 2.5 2 2.5", "M15 13.5l2 2.5-2 2.5"] },
};

/** The plain sheet, for a type this demo has no drawing for. */
const DEFAULT_MARK: FileMark = { color: "#5a6270", glyph: LINES };

/**
 * Extension of `name`, lowercased — the app's `fileTypeIconKey`, minus its
 * directory branch, which the caller has already decided by row kind.
 *
 * Reimplemented rather than imported: that module reaches for Tauri to fetch
 * the real icons, and this package may not.
 */
export function fileExtension(name: string): string {
  const trimmed = name.trim();
  const dot = trimmed.lastIndexOf(".");
  // `dot <= 0` also covers dotfiles (`.gitignore`), which have no extension.
  if (dot <= 0 || dot === trimmed.length - 1) return "";
  return trimmed.slice(dot + 1).toLowerCase();
}

export function fileMarkFor(name: string): FileMark {
  return MARKS[fileExtension(name)] ?? DEFAULT_MARK;
}
