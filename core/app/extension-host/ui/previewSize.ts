export interface PreviewSize { width: number; height: number }
export type PreviewFormat = "landscape" | "portrait" | "custom";
export interface PreviewFraming extends PreviewSize { format: PreviewFormat }

export const PREVIEW_PRESETS = {
  landscape: { width: 1280, height: 720 },
  portrait: { width: 720, height: 1280 },
} satisfies Record<Exclude<PreviewFormat, "custom">, PreviewSize>;

export const MIN_PREVIEW_SIZE = 64;
export const MAX_PREVIEW_SIZE = 4096;

export function validPreviewDimension(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_PREVIEW_SIZE && value <= MAX_PREVIEW_SIZE;
}

/** Fit the canvas, not the widget, and never stretch a small custom canvas. */
export function fitPreviewSize(size: PreviewSize, available: PreviewSize): PreviewSize {
  const scale = Math.max(0, Math.min(1, available.width / size.width, available.height / size.height));
  return { width: size.width * scale, height: size.height * scale };
}
