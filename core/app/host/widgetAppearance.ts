/**
 * A widget's own surface: background, opacity, blur, corner radius and shadow.
 *
 * Every field is optional, and an absent field keeps the shared appearance from
 * Settings › Appearance. A bundled widget sets its defaults under `ui.appearance`
 * in its manifest; with `editable`, each instance can change them in its
 * settings, and those values win over the manifest's.
 */

import type { WidgetAppearance } from "@sdk/types";
import {
  cornerGeometry,
  hexToRgbChannels,
  MAX_SURFACE_BLUR,
  type CornerShape,
} from "../settings/appearanceLogic";

export type { WidgetAppearance };

export const MAX_WIDGET_RADIUS = 64;
export const MAX_WIDGET_BLUR = MAX_SURFACE_BLUR;

const APPEARANCE_KEYS = ["background", "opacity", "blur", "radius", "shadow"] as const;

function hexColor(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const hex = raw.trim();
  const short = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/.exec(hex);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : undefined;
}

function clamped(raw: unknown, min: number, max: number, round: boolean): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  const value = Math.min(max, Math.max(min, raw));
  return round ? Math.round(value) : Math.round(value * 100) / 100;
}

/**
 * Keeps only valid fields, clamped into range. Undefined when nothing valid is
 * left, so an instance without its own look stores nothing.
 */
export function normalizeWidgetAppearance(raw: unknown): WidgetAppearance | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const next: WidgetAppearance = {};
  const background = hexColor(value.background);
  const opacity = clamped(value.opacity, 0, 1, false);
  const blur = clamped(value.blur, 0, MAX_WIDGET_BLUR, true);
  const radius = clamped(value.radius, 0, MAX_WIDGET_RADIUS, true);
  if (background !== undefined) next.background = background;
  if (opacity !== undefined) next.opacity = opacity;
  if (blur !== undefined) next.blur = blur;
  if (radius !== undefined) next.radius = radius;
  if (typeof value.shadow === "boolean") next.shadow = value.shadow;
  return APPEARANCE_KEYS.some((key) => next[key] !== undefined) ? next : undefined;
}

/** The instance's own values over the manifest's, field by field. */
export function effectiveWidgetAppearance(
  manifest: WidgetAppearance | undefined,
  instance: WidgetAppearance | undefined,
): WidgetAppearance {
  return { ...manifest, ...instance };
}

/**
 * CSS variables for the card's glass layer. Only fields the appearance sets are
 * written; the rest fall through to the shared values on `:root`.
 */
export function surfaceStyle(appearance: WidgetAppearance): Record<string, string> {
  const style: Record<string, string> = {};
  if (appearance.background !== undefined) {
    style["--surface-bg-rgb"] = hexToRgbChannels(appearance.background);
  }
  if (appearance.opacity !== undefined) {
    style["--surface-alpha"] = String(appearance.opacity);
  }
  if (appearance.blur !== undefined) {
    style["--surface-backdrop-filter"] =
      appearance.blur > 0 ? `blur(${appearance.blur}px) saturate(var(--surface-saturate, 1))` : "none";
  }
  // A transparent shadow rather than `none`: the variable sits in a
  // comma-separated list with the inner highlight, which `none` would invalidate.
  if (appearance.shadow === false) {
    style["--surface-box-shadow"] = "0 0 transparent";
  }
  return style;
}

/**
 * The radius as the engine will draw it with the shared corner shape. Set on
 * the whole card, since its outline, the glass layer and the chrome all derive
 * their corners from it.
 */
export function radiusStyle(
  appearance: WidgetAppearance,
  shape: CornerShape,
  cornerShapeSupported: boolean,
): Record<string, string> {
  if (appearance.radius === undefined) return {};
  const geometry = cornerGeometry(appearance.radius, shape, cornerShapeSupported);
  return { "--surface-radius": `${geometry.radiusPx}px` };
}
