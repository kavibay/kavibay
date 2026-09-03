export type FontId = "jakarta" | "manrope" | "jetbrains";

export type ColorMode = "system" | "dark" | "light";

export type CornerShape = "round" | "squircle";

/** Fill for the empty space between widgets (fullscreen underlay). */
export type DesktopFillMode = "transparent" | "color";

/** Which monitor the cockpit covers when opened (multi-display). */
export type OpenMonitor = "cursor" | "primary" | "activeWindow";

/** How widgets move/resize on the desk. */
export type WidgetLayoutMode = "freehand" | "grid";

/**
 * Shared drop-shadow preset id (Default + CSS Scan gallery, skipping #7/#14).
 * CSS uses --shadow-rgb and scales alphas by --surface-shadow.
 */
export type ShadowStyleId =
  | "default"
  | "s0"
  | "s1"
  | "s2"
  | "s3"
  | "s4"
  | "s5"
  | "s6"
  | "s8"
  | "s9"
  | "s10"
  | "s11"
  | "s12"
  | "s13"
  | "s15";

export interface AppearanceState {
  fontId: FontId;
  colorMode: ColorMode;
  /** When true, click outside widgets/palette hides the Kavibay window. */
  hideOnOutsideClick: boolean;
  /** Monitor to cover when opening the cockpit. */
  openMonitor: OpenMonitor;
  /** Free-hand vs snap-to-grid while moving/resizing widgets. */
  widgetLayoutMode: WidgetLayoutMode;
  /** Shared glass opacity for widgets + command palette (0–1). */
  surfaceOpacity: number;
  /** Shared backdrop blur in CSS pixels (0 = off). */
  surfaceBlur: number;
  /** Shared drop-shadow strength (0 = none, 1 = full). */
  surfaceShadow: number;
  /** Shared drop-shadow shape/preset. */
  surfaceShadowStyle: ShadowStyleId;
  /** Shared border-radius in CSS pixels for widgets + palette. */
  surfaceRadius: number;
  /** Corner geometry: classic round arcs or squircle (Chromium). */
  cornerShape: CornerShape;
  /** Empty space between widgets: clear or tinted underlay. */
  desktopFillMode: DesktopFillMode;
  /** Hex color for desktop fill when mode is `color` (e.g. `#000000`). */
  desktopFillColor: string;
  /** Opacity of desktop fill when mode is `color` (0–1). */
  desktopFillOpacity: number;
}

export interface FontOption {
  id: FontId;
  name: string;
  stack: string;
  sample: string;
}

export interface ShadowStyleOption {
  id: ShadowStyleId;
  name: string;
  hint: string;
  /** Full box-shadow value; alphas respect --surface-shadow. */
  css: string;
}

export const APPEARANCE_STORAGE_KEY = "kavibay:appearance-v1";

/** Near-solid glass: the desktop still tints a panel, text never competes with it. */
export const DEFAULT_SURFACE_OPACITY = 0.95;
export const MIN_SURFACE_OPACITY = 0.15;
export const MAX_SURFACE_OPACITY = 1;

/**
 * Off by default. At 0.95 opacity there is almost nothing left to blur, and a
 * live backdrop filter over the whole desktop is the most expensive effect the
 * overlay can ask a GPU for.
 */
export const DEFAULT_SURFACE_BLUR = 0;
export const MIN_SURFACE_BLUR = 0;
export const MAX_SURFACE_BLUR = 24;

/** Default keeps current shadow alphas at full strength. */
export const DEFAULT_SURFACE_SHADOW = 1;
export const MIN_SURFACE_SHADOW = 0;
export const MAX_SURFACE_SHADOW = 1;

/** Paired with the squircle default; a shallow radius reads as a plain rectangle. */
export const DEFAULT_SURFACE_RADIUS = 32;
export const MIN_SURFACE_RADIUS = 0;
export const MAX_SURFACE_RADIUS = 32;

export const DEFAULT_COLOR_MODE: ColorMode = "dark";

export const DEFAULT_CORNER_SHAPE: CornerShape = "squircle";

export const DEFAULT_DESKTOP_FILL_MODE: DesktopFillMode = "transparent";
export const DEFAULT_DESKTOP_FILL_COLOR = "#000000";
export const DEFAULT_DESKTOP_FILL_OPACITY = 0.35;
export const MIN_DESKTOP_FILL_OPACITY = 0.05;
export const MAX_DESKTOP_FILL_OPACITY = 0.95;

export const DEFAULT_SHADOW_STYLE: ShadowStyleId = "s2";

/** Default matches historic behavior (cover monitor under the mouse). */
export const DEFAULT_OPEN_MONITOR: OpenMonitor = "cursor";

/** Snapped by default: a desk of hand-placed cards drifts a few pixels out of line. */
export const DEFAULT_WIDGET_LAYOUT_MODE: WidgetLayoutMode = "grid";

/**
 * Alpha channel that multiplies with --surface-shadow strength (the user's
 * slider) and --shadow-scale (the mode's own correction — see styles.css; the
 * same alpha that reads as depth under a dark card reads as grime under a
 * light one).
 */
function sa(alpha: number): string {
  return `rgba(var(--shadow-rgb), calc(${alpha} * var(--surface-shadow, 1) * var(--shadow-scale, 1)))`;
}

/** Curated shadow presets (CSS Scan #0–#15, skipping border #7 and inset #14). */
export const SHADOW_STYLE_OPTIONS: ShadowStyleOption[] = [
  {
    id: "default",
    name: "Default",
    hint: "Kavibay glass",
    css: `0 8px 24px ${sa(0.35)}`,
  },
  {
    id: "s0",
    name: "#0",
    hint: "Soft haze",
    css: `0 8px 24px ${sa(0.2)}`,
  },
  {
    id: "s1",
    name: "#1",
    hint: "Soft mist",
    css: `0 7px 29px 0 ${sa(0.2)}`,
  },
  {
    id: "s2",
    name: "#2",
    hint: "Crisp",
    css: `1.95px 1.95px 2.6px ${sa(0.15)}`,
  },
  {
    id: "s3",
    name: "#3",
    hint: "Bottom drop",
    css: `0 5px 15px ${sa(0.35)}`,
  },
  {
    id: "s4",
    name: "#4",
    hint: "3drops",
    css: `0 1px 4px ${sa(0.16)}`,
  },
  {
    id: "s5",
    name: "#5",
    hint: "Light lift",
    css: `0 3px 8px ${sa(0.24)}`,
  },
  {
    id: "s6",
    name: "#6",
    hint: "Quiet",
    css: `0 2px 8px 0 ${sa(0.2)}`,
  },
  {
    id: "s8",
    name: "#8",
    hint: "Hairline",
    css: `0 1px 3px 0 ${sa(0.02)}, 0 0 0 1px ${sa(0.15)}`,
  },
  {
    id: "s9",
    name: "#9",
    hint: "Sketch",
    css: `0 4px 12px ${sa(0.1)}`,
  },
  {
    id: "s10",
    name: "#10",
    hint: "Deep float",
    css: `0 54px 55px ${sa(0.25)}, 0 -12px 30px ${sa(0.12)}, 0 4px 6px ${sa(0.12)}, 0 12px 13px ${sa(0.17)}, 0 -3px 5px ${sa(0.09)}`,
  },
  {
    id: "s11",
    name: "#11",
    hint: "Sketch ring",
    css: `0 6px 24px 0 ${sa(0.05)}, 0 0 0 1px ${sa(0.08)}`,
  },
  {
    id: "s12",
    name: "#12",
    hint: "Sketch lift",
    css: `0 10px 36px 0 ${sa(0.16)}, 0 0 0 1px ${sa(0.06)}`,
  },
  {
    id: "s13",
    name: "#13",
    hint: "Wide bloom",
    css: `0 48px 100px 0 ${sa(0.15)}`,
  },
  {
    id: "s15",
    name: "#15",
    hint: "Stripe",
    css: `0 50px 100px -20px ${sa(0.25)}, 0 30px 60px -30px ${sa(0.3)}`,
  },
];

const ALLOWED_SHADOW_STYLES = new Set<ShadowStyleId>(
  SHADOW_STYLE_OPTIONS.map((s) => s.id),
);

export const COLOR_MODE_OPTIONS: { id: ColorMode; name: string; hint: string }[] = [
  { id: "system", name: "System", hint: "Match system theme" },
  { id: "dark", name: "Dark", hint: "Dark frosted glass" },
  { id: "light", name: "Light", hint: "Light frosted glass" },
];

export const CORNER_SHAPE_OPTIONS: { id: CornerShape; name: string; hint: string }[] = [
  { id: "round", name: "Round", hint: "Classic circular corners" },
  { id: "squircle", name: "Squircle", hint: "Smoother continuous curve" },
];

export const DESKTOP_FILL_MODE_OPTIONS: {
  id: DesktopFillMode;
  name: string;
  hint: string;
}[] = [
  {
    id: "transparent",
    name: "Transparent",
    hint: "Gaps stay fully clear — desktop shows through",
  },
  {
    id: "color",
    name: "Color",
    hint: "Tint gaps while the cockpit is open (not pinned-only)",
  },
];

export const OPEN_MONITOR_OPTIONS: {
  id: OpenMonitor;
  name: string;
  hint: string;
}[] = [
  {
    id: "primary",
    name: "Main screen",
    hint: "A double tap on Ctrl opens on the primary display (Shift+Ctrl+Space = mouse screen)",
  },
  {
    id: "cursor",
    name: "Screen with mouse",
    hint: "A double tap on Ctrl opens on the display under the pointer",
  },
  {
    id: "activeWindow",
    name: "Active window",
    hint: "A double tap on Ctrl opens on the display holding the focused window",
  },
];

export const WIDGET_LAYOUT_MODE_OPTIONS: {
  id: WidgetLayoutMode;
  name: string;
  hint: string;
}[] = [
  {
    id: "freehand",
    name: "Free-hand",
    hint: "Pixel-exact position and size while dragging",
  },
  {
    id: "grid",
    name: "Snap to grid",
    hint: "Snap position and size to an invisible 15px grid while dragging",
  },
];

export const DEFAULT_APPEARANCE: AppearanceState = {
  fontId: "manrope",
  colorMode: DEFAULT_COLOR_MODE,
  hideOnOutsideClick: true,
  openMonitor: DEFAULT_OPEN_MONITOR,
  widgetLayoutMode: DEFAULT_WIDGET_LAYOUT_MODE,
  surfaceOpacity: DEFAULT_SURFACE_OPACITY,
  surfaceBlur: DEFAULT_SURFACE_BLUR,
  surfaceShadow: DEFAULT_SURFACE_SHADOW,
  surfaceShadowStyle: DEFAULT_SHADOW_STYLE,
  surfaceRadius: DEFAULT_SURFACE_RADIUS,
  cornerShape: DEFAULT_CORNER_SHAPE,
  desktopFillMode: DEFAULT_DESKTOP_FILL_MODE,
  desktopFillColor: DEFAULT_DESKTOP_FILL_COLOR,
  desktopFillOpacity: DEFAULT_DESKTOP_FILL_OPACITY,
};

/**
 * Curated fonts offered in Appearance settings.
 *
 * The "… Variable" names come from the bundled @fontsource-variable packages
 * (imported once in core/app/styles.css) — they are the family names those
 * @font-face rules declare, not a label. The non-variable name stays in the
 * stack behind it so a system-installed copy still counts as a hit.
 */
export const FONT_OPTIONS: FontOption[] = [
  {
    id: "jakarta",
    name: "Plus Jakarta Sans",
    stack: '"Plus Jakarta Sans Variable", "Plus Jakarta Sans", system-ui, sans-serif',
    sample: "14:32 · Focus",
  },
  {
    id: "manrope",
    name: "Manrope",
    stack: '"Manrope Variable", "Manrope", system-ui, sans-serif',
    sample: "14:32 · Focus",
  },
  {
    id: "jetbrains",
    name: "JetBrains Mono",
    stack: '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace',
    sample: "14:32 · Focus",
  },
];

const ALLOWED = new Set<FontId>(FONT_OPTIONS.map((f) => f.id));

/** Clamp surface opacity into the allowed range. */
export function normalizeSurfaceOpacity(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_SURFACE_OPACITY;
  return Math.min(MAX_SURFACE_OPACITY, Math.max(MIN_SURFACE_OPACITY, n));
}

/** Clamp surface blur (px) into the allowed range. */
export function normalizeSurfaceBlur(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_SURFACE_BLUR;
  return Math.min(MAX_SURFACE_BLUR, Math.max(MIN_SURFACE_BLUR, Math.round(n)));
}

/** Clamp shadow strength into the allowed range. */
export function normalizeSurfaceShadow(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_SURFACE_SHADOW;
  return Math.min(MAX_SURFACE_SHADOW, Math.max(MIN_SURFACE_SHADOW, n));
}

/** Normalize shadow style id; unknown / missing → default. */
export function normalizeShadowStyle(raw: unknown): ShadowStyleId {
  return typeof raw === "string" && ALLOWED_SHADOW_STYLES.has(raw as ShadowStyleId)
    ? (raw as ShadowStyleId)
    : DEFAULT_SHADOW_STYLE;
}

/** CSS box-shadow value for a style id. */
export function shadowStyleCss(id: ShadowStyleId): string {
  return (
    SHADOW_STYLE_OPTIONS.find((s) => s.id === id)?.css ??
    SHADOW_STYLE_OPTIONS[0]!.css
  );
}

/** Clamp surface border-radius (px) into the allowed range. */
export function normalizeSurfaceRadius(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_SURFACE_RADIUS;
  return Math.min(MAX_SURFACE_RADIUS, Math.max(MIN_SURFACE_RADIUS, Math.round(n)));
}

/** Normalize color mode; unknown / missing → dark. */
export function normalizeColorMode(raw: unknown): ColorMode {
  if (raw === "system") return "system";
  if (raw === "light") return "light";
  return "dark";
}

/** Resolve effective color mode ("dark" | "light") from setting (handling system preference). */
export function resolveEffectiveColorMode(mode: ColorMode): "dark" | "light" {
  const norm = normalizeColorMode(mode);
  if (norm === "system") {
    if (typeof window !== "undefined" && window.matchMedia) {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return "dark";
  }
  return norm;
}

/** Flip dark ↔ light based on current effective mode. */
export function toggleColorModeValue(mode: ColorMode): ColorMode {
  const effective = resolveEffectiveColorMode(mode);
  return effective === "dark" ? "light" : "dark";
}

/** Normalize corner shape; unknown → round. */
export function normalizeCornerShape(raw: unknown): CornerShape {
  return raw === "squircle" ? "squircle" : "round";
}

/** Normalize desktop fill mode; unknown → transparent. */
export function normalizeDesktopFillMode(raw: unknown): DesktopFillMode {
  return raw === "color" ? "color" : "transparent";
}

/** Normalize `#RRGGBB` hex; invalid → default black. */
export function normalizeDesktopFillColor(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_DESKTOP_FILL_COLOR;
  const hex = raw.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) return hex.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
    const r = hex[1]!;
    const g = hex[2]!;
    const b = hex[3]!;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return DEFAULT_DESKTOP_FILL_COLOR;
}

/** Clamp desktop fill opacity into the allowed range. */
export function normalizeDesktopFillOpacity(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_DESKTOP_FILL_OPACITY;
  return Math.min(
    MAX_DESKTOP_FILL_OPACITY,
    Math.max(MIN_DESKTOP_FILL_OPACITY, n),
  );
}

/** Parse `#RRGGBB` into `r, g, b` components for CSS rgba(). */
export function hexToRgbChannels(hex: string): string {
  const normalized = normalizeDesktopFillColor(hex).slice(1);
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

/** Build CSS background for the desktop fill underlay. */
export function desktopFillBackground(
  mode: DesktopFillMode,
  color: string,
  opacity: number,
): string {
  if (normalizeDesktopFillMode(mode) !== "color") return "transparent";
  const alpha = normalizeDesktopFillOpacity(opacity);
  return `rgba(${hexToRgbChannels(color)}, ${alpha})`;
}

/** Normalize open-monitor target; unknown → cursor (legacy default). */
export function normalizeOpenMonitor(raw: unknown): OpenMonitor {
  if (raw === "primary") return "primary";
  if (raw === "activeWindow") return "activeWindow";
  return "cursor";
}

/** Normalize layout mode; unknown / missing → the shipped default. */
export function normalizeWidgetLayoutMode(raw: unknown): WidgetLayoutMode {
  if (raw === "freehand") return "freehand";
  if (raw === "grid") return "grid";
  return DEFAULT_WIDGET_LAYOUT_MODE;
}

/** Normalize raw persisted appearance; unknown font → manrope. */
export function normalizeAppearance(raw: unknown): AppearanceState {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const fontId =
    typeof o.fontId === "string" && ALLOWED.has(o.fontId as FontId)
      ? (o.fontId as FontId)
      : DEFAULT_APPEARANCE.fontId;
  return {
    fontId,
    colorMode: normalizeColorMode(o.colorMode),
    // Missing means "older save", not "off" — same rule as every field below.
    hideOnOutsideClick:
      o.hideOnOutsideClick === undefined
        ? DEFAULT_APPEARANCE.hideOnOutsideClick
        : o.hideOnOutsideClick === true,
    openMonitor:
      o.openMonitor === undefined
        ? DEFAULT_OPEN_MONITOR
        : normalizeOpenMonitor(o.openMonitor),
    widgetLayoutMode:
      o.widgetLayoutMode === undefined
        ? DEFAULT_WIDGET_LAYOUT_MODE
        : normalizeWidgetLayoutMode(o.widgetLayoutMode),
    surfaceOpacity: normalizeSurfaceOpacity(o.surfaceOpacity),
    // Missing keys (older saves) → defaults so look stays unchanged.
    surfaceBlur:
      o.surfaceBlur === undefined ? DEFAULT_SURFACE_BLUR : normalizeSurfaceBlur(o.surfaceBlur),
    surfaceShadow:
      o.surfaceShadow === undefined
        ? DEFAULT_SURFACE_SHADOW
        : normalizeSurfaceShadow(o.surfaceShadow),
    surfaceShadowStyle:
      o.surfaceShadowStyle === undefined
        ? DEFAULT_SHADOW_STYLE
        : normalizeShadowStyle(o.surfaceShadowStyle),
    surfaceRadius:
      o.surfaceRadius === undefined
        ? DEFAULT_SURFACE_RADIUS
        : normalizeSurfaceRadius(o.surfaceRadius),
    cornerShape:
      o.cornerShape === undefined
        ? DEFAULT_CORNER_SHAPE
        : normalizeCornerShape(o.cornerShape),
    desktopFillMode:
      o.desktopFillMode === undefined
        ? DEFAULT_DESKTOP_FILL_MODE
        : normalizeDesktopFillMode(o.desktopFillMode),
    desktopFillColor:
      o.desktopFillColor === undefined
        ? DEFAULT_DESKTOP_FILL_COLOR
        : normalizeDesktopFillColor(o.desktopFillColor),
    desktopFillOpacity:
      o.desktopFillOpacity === undefined
        ? DEFAULT_DESKTOP_FILL_OPACITY
        : normalizeDesktopFillOpacity(o.desktopFillOpacity),
  };
}

/** CSS font-family stack for a font id. */
export function fontStack(id: FontId): string {
  return FONT_OPTIONS.find((f) => f.id === id)?.stack ?? FONT_OPTIONS[0].stack;
}

/** Load appearance from localStorage. */
export function loadAppearance(): AppearanceState {
  try {
    const raw = localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_APPEARANCE };
    return normalizeAppearance(JSON.parse(raw) as unknown);
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

/** Persist normalized appearance. */
export function saveAppearance(state: AppearanceState): void {
  localStorage.setItem(
    APPEARANCE_STORAGE_KEY,
    JSON.stringify(normalizeAppearance(state)),
  );
}

/** Apply color mode to document root (`data-color-mode`). */
export function applyColorModeToDocument(mode: ColorMode): void {
  document.documentElement.dataset.colorMode = resolveEffectiveColorMode(mode);
}

/** Apply font id to document root (CSS variable + data attribute). */
export function applyFontToDocument(id: FontId): void {
  const root = document.documentElement;
  root.style.setProperty("--font-family", fontStack(id));
  root.dataset.font = id;
}

/** Apply shared surface opacity used by widgets and the command palette. */
export function applySurfaceOpacityToDocument(opacity: number): void {
  const value = normalizeSurfaceOpacity(opacity);
  document.documentElement.style.setProperty("--surface-opacity", String(value));
}

/**
 * Apply backdrop blur. 0 → `none` (avoids a live blur filter); otherwise
 * `blur(Npx)` plus the mode's saturation lift, which stays a CSS variable so
 * light/dark can differ without this function knowing the color mode. Blur 0
 * means the user turned glass off, so nothing is added there either.
 * Consumed as `backdrop-filter: var(--surface-backdrop-filter)`.
 */
export function applySurfaceBlurToDocument(blurPx: number): void {
  const value = normalizeSurfaceBlur(blurPx);
  const filter =
    value <= 0 ? "none" : `blur(${value}px) saturate(var(--surface-saturate, 1))`;
  document.documentElement.style.setProperty("--surface-backdrop-filter", filter);
  document.documentElement.style.setProperty("--surface-blur", String(value));
}

/**
 * Apply drop-shadow strength (0–1). CSS multiplies shadow alphas by
 * `var(--surface-shadow)`.
 */
export function applySurfaceShadowToDocument(strength: number): void {
  const value = normalizeSurfaceShadow(strength);
  document.documentElement.style.setProperty("--surface-shadow", String(value));
}

/** Apply shared drop-shadow preset to `--surface-box-shadow`. */
export function applySurfaceShadowStyleToDocument(style: ShadowStyleId): void {
  const id = normalizeShadowStyle(style);
  document.documentElement.style.setProperty(
    "--surface-box-shadow",
    shadowStyleCss(id),
  );
  document.documentElement.dataset.shadowStyle = id;
}

/** Apply shared border-radius (px) for widgets + palette. */
export function applySurfaceRadiusToDocument(radiusPx: number): void {
  const value = normalizeSurfaceRadius(radiusPx);
  document.documentElement.style.setProperty("--surface-radius", `${value}px`);
}

/**
 * Apply corner geometry. Uses CSS `corner-shape` (Chromium/WebView2);
 * unsupported engines keep classic round arcs from border-radius alone.
 */
export function applyCornerShapeToDocument(shape: CornerShape): void {
  const value = normalizeCornerShape(shape);
  const root = document.documentElement;
  root.style.setProperty("--surface-corner-shape", value);
  root.dataset.cornerShape = value;
}

/**
 * Apply fullscreen underlay behind widgets/palette. Transparent keeps click-through
 * look; color mode tints gaps without capturing pointer events.
 */
export function applyDesktopFillToDocument(
  mode: DesktopFillMode,
  color: string,
  opacity: number,
): void {
  const root = document.documentElement;
  const nextMode = normalizeDesktopFillMode(mode);
  root.style.setProperty(
    "--desktop-fill-bg",
    desktopFillBackground(nextMode, color, opacity),
  );
  root.dataset.desktopFill = nextMode;
}
