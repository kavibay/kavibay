/**
 * Persisted Settings modal geometry (center + size).
 * Pure helpers — SettingsModal owns gestures and DOM.
 */

import type { ResizeClamps } from "../host/resizeLogic";
import { clampSize } from "../host/resizeLogic";

export const SETTINGS_GEOMETRY_KEY = "kavibay:settings-geometry-v1";

export const DEFAULT_SETTINGS_WIDTH = 720;
export const DEFAULT_SETTINGS_HEIGHT = 480;
export const SETTINGS_MARGIN = 24;

export const DEFAULT_SETTINGS_CLAMPS: ResizeClamps = {
  minWidth: 480,
  minHeight: 320,
  maxWidth: 1400,
  maxHeight: 1000,
};

export interface SettingsGeometry {
  /** Viewport center X of the dialog. */
  cx: number;
  /** Viewport center Y of the dialog. */
  cy: number;
  width: number;
  height: number;
}

/** Default centered size for the current viewport. */
export function defaultSettingsGeometry(
  vw = typeof window !== "undefined" ? window.innerWidth : 1280,
  vh = typeof window !== "undefined" ? window.innerHeight : 800,
): SettingsGeometry {
  const width = Math.min(DEFAULT_SETTINGS_WIDTH, Math.max(320, vw - SETTINGS_MARGIN * 2));
  const height = Math.min(DEFAULT_SETTINGS_HEIGHT, Math.max(240, vh - SETTINGS_MARGIN * 2));
  return {
    cx: vw / 2,
    cy: vh / 2,
    width,
    height,
  };
}

/** Keep the dialog fully inside the viewport (with margin). */
export function clampSettingsGeometry(
  geo: SettingsGeometry,
  vw = typeof window !== "undefined" ? window.innerWidth : 1280,
  vh = typeof window !== "undefined" ? window.innerHeight : 800,
  clamps: ResizeClamps = DEFAULT_SETTINGS_CLAMPS,
): SettingsGeometry {
  const maxW = Math.min(clamps.maxWidth, Math.max(clamps.minWidth, vw - SETTINGS_MARGIN * 2));
  const maxH = Math.min(clamps.maxHeight, Math.max(clamps.minHeight, vh - SETTINGS_MARGIN * 2));
  const size = clampSize(geo.width, geo.height, {
    minWidth: Math.min(clamps.minWidth, maxW),
    minHeight: Math.min(clamps.minHeight, maxH),
    maxWidth: maxW,
    maxHeight: maxH,
  });

  const halfW = size.width / 2;
  const halfH = size.height / 2;
  const minCx = SETTINGS_MARGIN + halfW;
  const maxCx = Math.max(minCx, vw - SETTINGS_MARGIN - halfW);
  const minCy = SETTINGS_MARGIN + halfH;
  const maxCy = Math.max(minCy, vh - SETTINGS_MARGIN - halfH);

  return {
    cx: Math.min(maxCx, Math.max(minCx, geo.cx)),
    cy: Math.min(maxCy, Math.max(minCy, geo.cy)),
    width: size.width,
    height: size.height,
  };
}

/** Normalize a stored blob; null when unusable. */
export function normalizeSettingsGeometry(raw: unknown): SettingsGeometry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const cx = o.cx;
  const cy = o.cy;
  const width = o.width;
  const height = o.height;
  if (typeof cx !== "number" || !Number.isFinite(cx)) return null;
  if (typeof cy !== "number" || !Number.isFinite(cy)) return null;
  if (typeof width !== "number" || !Number.isFinite(width)) return null;
  if (typeof height !== "number" || !Number.isFinite(height)) return null;
  return { cx, cy, width, height };
}

/** Read persisted geometry or null. */
export function loadSettingsGeometry(): SettingsGeometry | null {
  try {
    const raw = localStorage.getItem(SETTINGS_GEOMETRY_KEY);
    if (!raw) return null;
    return normalizeSettingsGeometry(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Persist geometry (already clamped by caller). */
export function saveSettingsGeometry(geo: SettingsGeometry): void {
  localStorage.setItem(SETTINGS_GEOMETRY_KEY, JSON.stringify(geo));
}

/** Load + clamp, or default centered. */
export function resolveSettingsGeometry(
  vw = typeof window !== "undefined" ? window.innerWidth : 1280,
  vh = typeof window !== "undefined" ? window.innerHeight : 800,
): SettingsGeometry {
  const loaded = loadSettingsGeometry();
  const base = loaded ?? defaultSettingsGeometry(vw, vh);
  return clampSettingsGeometry(base, vw, vh);
}
