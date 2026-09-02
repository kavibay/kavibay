export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

export const DEFAULT_RGB: Rgb = { r: 0, g: 0, b: 0 };

/** Clamp to integer 0–255. */
export function clampByte(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(255, Math.max(0, Math.round(n)));
}

/** CSS hex `#RRGGBB` (uppercase). */
export function rgbToHex({ r, g, b }: Rgb): string {
  const hex = [clampByte(r), clampByte(g), clampByte(b)]
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("");
  return `#${hex.toUpperCase()}`;
}

/** Convert sRGB 0–255 to HSL (h degrees, s/l percent). */
export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const R = clampByte(r) / 255;
  const G = clampByte(g) / 255;
  const B = clampByte(b) / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) {
    return { h: 0, s: 0, l: Math.round(l * 100) };
  }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === R) h = (G - B) / d + (G < B ? 6 : 0);
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  h *= 60;
  return {
    h: Math.round(h) % 360,
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

/** `rgb(r, g, b)` for CSS. */
export function formatRgbCss(rgb: Rgb): string {
  return `rgb(${clampByte(rgb.r)}, ${clampByte(rgb.g)}, ${clampByte(rgb.b)})`;
}

/** `hsl(h, s%, l%)` for CSS. */
export function formatHslCss(hsl: Hsl): string {
  return `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`;
}
