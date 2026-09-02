export type ImageSource = "file" | "url";
export type ImageVariant = "full" | "framed";

export interface ImageWidgetState {
  source: ImageSource | null;
  /** Absolute path inside app data when source === "file" */
  path?: string;
  /** Remote URL when source === "url" */
  url?: string;
  /** Widget content width in CSS pixels */
  width: number;
  /** Widget content height in CSS pixels */
  height: number;
  /** Full bleed image or an inset image with a visible frame. */
  variant: ImageVariant;
}

export const DEFAULT_WIDTH = 220;
export const DEFAULT_HEIGHT = 140;
export const MIN_WIDTH = 120;
export const MIN_HEIGHT = 80;
export const MAX_WIDTH = 900;
export const MAX_HEIGHT = 700;

export const EMPTY_STATE: ImageWidgetState = {
  source: null,
  width: DEFAULT_WIDTH,
  height: DEFAULT_HEIGHT,
  variant: "full",
};

const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;

/** Accept only http(s) absolute URLs. */
export function isValidImageUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const u = new URL(trimmed);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** True when path looks like a supported image file. */
export function isImagePath(path: string): boolean {
  return IMAGE_EXT.test(path.trim());
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
export function normalizeState(raw: unknown): ImageWidgetState {
  const size =
    raw && typeof raw === "object"
      ? clampSize(
          typeof (raw as { width?: unknown }).width === "number"
            ? ((raw as { width: number }).width as number)
            : DEFAULT_WIDTH,
          typeof (raw as { height?: unknown }).height === "number"
            ? ((raw as { height: number }).height as number)
            : DEFAULT_HEIGHT,
        )
      : { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };

  if (!raw || typeof raw !== "object") {
    return { source: null, ...size, variant: "full" };
  }
  const o = raw as Record<string, unknown>;
  const variant: ImageVariant = o.variant === "framed" ? "framed" : "full";
  if (o.source === "file" && typeof o.path === "string" && o.path.trim()) {
    return { source: "file", path: o.path.trim(), ...size, variant };
  }
  if (o.source === "url" && typeof o.url === "string" && isValidImageUrl(o.url)) {
    return { source: "url", url: o.url.trim(), ...size, variant };
  }
  return { source: null, ...size, variant };
}
