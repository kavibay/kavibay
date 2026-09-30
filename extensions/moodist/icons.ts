/**
 * Tiny inline-SVG icon map for Moodist categories and sounds.
 * Soft filled colors (readable on dark glass) — no npm icon package.
 */

/** Path-based SVG definition with a stable accent color. */
export interface MoodistIconSvg {
  viewBox: string;
  /** Path `d` attributes drawn with the icon `color`. */
  paths: readonly string[];
  /** Accent fill for dark Kavibay chrome (not neon/glow). */
  color: string;
}

/**
 * Icon string ids used by the catalog.
 * Keep this set small; reuse the same key across related sounds.
 */
const ICONS: Record<string, MoodistIconSvg> = {
  tree: {
    viewBox: "0 0 24 24",
    color: "#5dba6f",
    paths: ["M12 2L7 9h3v2H6l4 5h2v4h2v-4h2l4-5h-4V9h3L12 2z"],
  },
  water: {
    viewBox: "0 0 24 24",
    color: "#4aa3d9",
    paths: ["M12 2c-3 5-6 8.5-6 12a6 6 0 0012 0c0-3.5-3-7-6-12z"],
  },
  waves: {
    viewBox: "0 0 24 24",
    color: "#3b8ec9",
    paths: [
      "M2 8c2 0 3 1.5 5 1.5S10 8 12 8s3 1.5 5 1.5S20 8 22 8v2c-2 0-3 1.5-5 1.5S14 10 12 10s-3 1.5-5 1.5S4 10 2 10V8zm0 6c2 0 3 1.5 5 1.5S10 14 12 14s3 1.5 5 1.5S20 14 22 14v2c-2 0-3 1.5-5 1.5S14 16 12 16s-3 1.5-5 1.5S4 16 2 16v-2z",
    ],
  },
  fire: {
    viewBox: "0 0 24 24",
    color: "#e08a3c",
    paths: [
      "M12 2c1 3 4 5 4 9a4 4 0 01-8 0c0-2 1-3.5 2-5-.5 2 1 3 2 3 0-2 0-5 0-7z",
    ],
  },
  leaf: {
    viewBox: "0 0 24 24",
    color: "#6fbf63",
    paths: [
      "M17 8C8 10 6 16 6 20c4 0 10-2 12-11-1 2-3 3-5 3 2-2 3.5-3.5 4-4z",
    ],
  },
  rain: {
    viewBox: "0 0 24 24",
    color: "#6b9fd4",
    paths: [
      "M7 10a5 5 0 019.9-1A4 4 0 0118 17H7a4 4 0 010-7zm1 8l1.5 3h-1L7 18h1zm4 0l1.5 3h-1L11 18h1zm4 0l1.5 3h-1L15 18h1z",
    ],
  },
  thunder: {
    viewBox: "0 0 24 24",
    color: "#e0b84a",
    paths: [
      "M7 10a5 5 0 019.9-1A4 4 0 0118 16h-3l-2 6-1.5-6H7a4 4 0 010-6zm6-1l-1.5 5H14l-3 7 1-5H9.5L13 9z",
    ],
  },
  car: {
    viewBox: "0 0 24 24",
    color: "#8a96a8",
    paths: [
      "M5 11l1.5-4.5A2 2 0 018.4 5h7.2a2 2 0 011.9 1.5L19 11h1a1 1 0 011 1v3a1 1 0 01-1 1h-1a2.5 2.5 0 01-5 0H10a2.5 2.5 0 01-5 0H4a1 1 0 01-1-1v-3a1 1 0 011-1h1zm2.5 5.5a1 1 0 100-2 1 1 0 000 2zm9 0a1 1 0 100-2 1 1 0 000 2zM7.2 11h9.6l-1.1-3.3a.5.5 0 00-.5-.3H8.8a.5.5 0 00-.5.3L7.2 11z",
    ],
  },
  moon: {
    viewBox: "0 0 24 24",
    color: "#b9b4e6",
    paths: ["M14.5 3a8.5 8.5 0 107 13.4A7 7 0 0114.5 3z"],
  },
  noise: {
    viewBox: "0 0 24 24",
    color: "#9a8fd4",
    paths: [
      "M4 8h2v8H4V8zm3.5 3h2v5h-2v-5zM11 5h2v14h-2V5zm3.5 4h2v8h-2V9zM18 7h2v10h-2V7z",
    ],
  },
  soundwave: {
    viewBox: "0 0 24 24",
    color: "#a78bfa",
    paths: [
      "M4 10v4h2v-4H4zm4-3v10h2V7H8zm4-3v16h2V4h-2zm4 5v6h2v-6h-2zm4 2v2h2v-2h-2z",
    ],
  },
};

const FALLBACK_ICON: MoodistIconSvg = {
  viewBox: "0 0 24 24",
  color: "#9aa3af",
  paths: ["M12 6a6 6 0 110 12 6 6 0 010-12z"],
};

/** Look up an icon definition by catalog icon id. */
export function moodistIcon(id: string): MoodistIconSvg | undefined {
  return ICONS[id];
}

/** Resolve icon def with a gray circle fallback. */
export function moodistIconOrFallback(id: string): MoodistIconSvg {
  return ICONS[id] ?? FALLBACK_ICON;
}

/**
 * Render a Moodist icon as an SVG markup string.
 * Falls back to a simple circle when the id is unknown.
 */
export function moodistIconSvg(
  id: string,
  opts: { size?: number; className?: string } = {},
): string {
  const size = opts.size ?? 16;
  const classAttr = opts.className ? ` class="${opts.className}"` : "";
  const icon = moodistIconOrFallback(id);
  const paths = icon.paths
    .map((d) => `<path fill="${icon.color}" d="${d}"/>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${icon.viewBox}" aria-hidden="true"${classAttr}>${paths}</svg>`;
}

/** All known icon ids (for asserts / docs). */
export function moodistIconIds(): ReadonlySet<string> {
  return new Set(Object.keys(ICONS));
}
