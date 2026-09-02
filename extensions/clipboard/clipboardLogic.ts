export type ClipboardKind = "text" | "image" | "file";

export interface ClipboardSourceApp {
  name: string;
  path: string;
}

export interface ClipboardEntry {
  id: string;
  kind: ClipboardKind;
  text?: string;
  imagePath?: string;
  filePaths?: string[];
  hash: string;
  createdAt: number;
  revealed: boolean;
  sourceApp?: ClipboardSourceApp;
}

export const MAX_ENTRIES = 20;
export const MASKED_TEXT = "••••••";
const DEFAULT_PREVIEW_CHARS = 48;

/** Truncate a single-line preview with ellipsis. */
export function truncatePreview(text: string, maxChars = DEFAULT_PREVIEW_CHARS): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= maxChars) return oneLine;
  return `${oneLine.slice(0, Math.max(0, maxChars - 1))}…`;
}

/** Text shown in a row: masked dots or truncated body. */
export function displayText(entry: ClipboardEntry): string {
  if (!entry.revealed) return MASKED_TEXT;
  if (entry.kind === "text") return truncatePreview(entry.text ?? "");
  if (entry.kind === "file") return fileSummary(entry.filePaths ?? []);
  return "";
}

export function fileName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function fileSummary(paths: string[]): string {
  const first = paths[0];
  if (!first) return "File";
  const remaining = paths.length - 1;
  return remaining > 0 ? `${fileName(first)} +${remaining}` : fileName(first);
}

function normalizeSourceApp(raw: unknown): ClipboardSourceApp | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const source = raw as Record<string, unknown>;
  if (typeof source.name !== "string" || !source.name.trim()) return undefined;
  if (typeof source.path !== "string" || !source.path.trim()) return undefined;
  return { name: source.name.trim(), path: source.path.trim() };
}

/** Normalize one entry from the backend payload; null if invalid. */
export function normalizeEntry(raw: unknown): ClipboardEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id.trim()) return null;
  if (typeof o.hash !== "string" || !o.hash.trim()) return null;
  if (typeof o.createdAt !== "number" || !Number.isFinite(o.createdAt)) return null;
  const revealed = o.revealed !== false;
  const sourceApp = normalizeSourceApp(o.sourceApp);
  if (o.kind === "text" && typeof o.text === "string" && o.text.length > 0) {
    return {
      id: o.id,
      kind: "text",
      text: o.text,
      hash: o.hash,
      createdAt: o.createdAt,
      revealed,
      ...(sourceApp ? { sourceApp } : {}),
    };
  }
  if (o.kind === "image" && typeof o.imagePath === "string" && o.imagePath.trim()) {
    return {
      id: o.id,
      kind: "image",
      imagePath: o.imagePath.trim(),
      hash: o.hash,
      createdAt: o.createdAt,
      revealed,
      ...(sourceApp ? { sourceApp } : {}),
    };
  }
  if (o.kind === "file" && Array.isArray(o.filePaths)) {
    const filePaths = o.filePaths
      .filter((path): path is string => typeof path === "string" && Boolean(path.trim()))
      .map((path) => path.trim());
    if (filePaths.length === 0) return null;
    return {
      id: o.id,
      kind: "file",
      filePaths,
      hash: o.hash,
      createdAt: o.createdAt,
      revealed,
      ...(sourceApp ? { sourceApp } : {}),
    };
  }
  return null;
}

/** Normalize a full list payload; drop invalids; cap length. */
export function normalizeList(raw: unknown): ClipboardEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ClipboardEntry[] = [];
  for (const item of raw) {
    const e = normalizeEntry(item);
    if (e) out.push(e);
    if (out.length >= MAX_ENTRIES) break;
  }
  return out;
}
