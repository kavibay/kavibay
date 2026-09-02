export interface NotesWidgetState {
  /** Markdown body (may include HTML <u> for underline). */
  markdown: string;
  /** Widget content width in CSS pixels. */
  width: number;
  /** Widget content height in CSS pixels. */
  height: number;
  /** When true, show the formatting toolbar. Hidden by default. */
  toolbarVisible: boolean;
}

export const DEFAULT_WIDTH = 280;
export const DEFAULT_HEIGHT = 200;
export const MIN_WIDTH = 180;
export const MIN_HEIGHT = 120;
export const MAX_WIDTH = 900;
export const MAX_HEIGHT = 700;

export const EMPTY_STATE: NotesWidgetState = {
  markdown: "",
  width: DEFAULT_WIDTH,
  height: DEFAULT_HEIGHT,
  toolbarVisible: false,
};

/** Accept only http(s) absolute URLs for links. */
export function isValidNoteUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const u = new URL(trimmed);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Clamp width/height into allowed bounds. */
export function clampSize(width: number, height: number): { width: number; height: number } {
  const w = Number.isFinite(width) ? width : DEFAULT_WIDTH;
  const h = Number.isFinite(height) ? height : DEFAULT_HEIGHT;
  return {
    width: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(w))),
    height: Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(h))),
  };
}

/** Normalize raw persisted JSON into a safe state. */
export function normalizeState(raw: unknown): NotesWidgetState {
  if (!raw || typeof raw !== "object") {
    return { ...EMPTY_STATE };
  }
  const o = raw as Record<string, unknown>;
  const size = clampSize(
    typeof o.width === "number" ? o.width : DEFAULT_WIDTH,
    typeof o.height === "number" ? o.height : DEFAULT_HEIGHT,
  );
  const markdown = typeof o.markdown === "string" ? o.markdown : "";
  const toolbarVisible = o.toolbarVisible === true;
  return { markdown, toolbarVisible, ...size };
}

/**
 * Flatten note markdown/HTML into plain text for palette search.
 * Strips tags and collapses whitespace so fuzzy match sees readable words.
 */
export function markdownToSearchText(markdown: string): string {
  return markdown
    .replace(/<[^>]+>/g, " ")
    .replace(/[`*_#~>[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Escape text for safe insertion into an HTML paste payload. */
export function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Convert clipboard plain text into HTML paragraphs that preserve each line break.
 * Empty lines become empty paragraphs so blank lines survive paste.
 */
export function plainTextWithBreaksToHtml(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return normalized
    .split("\n")
    .map((line) => {
      const escaped = escapeHtmlText(line);
      return `<p>${escaped.length > 0 ? escaped : "<br>"}</p>`;
    })
    .join("");
}

/**
 * Prefer plain-text paste when it has newlines and HTML does not already
 * express line/paragraph breaks (common when apps put \\n inside one element).
 * A single wrapping block close (e.g. one </div>) does not count as breaks.
 */
export function shouldPreferPlainTextLineBreaks(
  plain: string | null | undefined,
  html: string | null | undefined,
): boolean {
  if (plain == null || plain === "") return false;
  if (!/[\r\n]/.test(plain)) return false;
  if (html == null || html === "") return true;
  const brCount = (html.match(/<br\s*\/?>/gi) ?? []).length;
  if (brCount > 0) return false;
  const blockCloseCount = (html.match(/<\/(p|div|li|h[1-6]|tr|blockquote|pre)>/gi) ?? []).length;
  return blockCloseCount <= 1;
}
