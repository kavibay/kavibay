export type AppKind = "exe" | "lnk" | "folder" | "url" | "key";

/** Bump when extract quality changes so dock icons re-fetch once. */
export const ICON_EXTRACT_GEN = 2;

export interface LauncherApp {
  id: string;
  /**
   * Absolute filesystem path, http(s) URL (`url`), or `key:{id}` (`key`).
   */
  path: string;
  kind: AppKind;
  name: string;
  iconDataUrl?: string;
  /** When true, custom/extracted icons fill the button (no inset). */
  iconNoPadding?: boolean;
  /**
   * GIF icons only:
   * - `"hover"` — animate while hovered
   * - `"always"` — animate continuously
   * - absent — frozen on the first frame
   */
  iconGifAnimate?: GifAnimateMode;
  /** User-uploaded icon — never overwritten by extract refresh. */
  iconCustom?: boolean;
  /** Last successful `extract_app_icon` generation (see `ICON_EXTRACT_GEN`). */
  iconExtractGen?: number;
  muted?: boolean;
}

/** True when this dock entry should re-run shell icon extraction. */
export function shouldRefreshExtractedIcon(app: LauncherApp): boolean {
  if (app.kind !== "exe" && app.kind !== "lnk" && app.kind !== "folder") return false;
  if (app.iconCustom) return false;
  if (isGifIconDataUrl(app.iconDataUrl)) return false;
  return app.iconExtractGen !== ICON_EXTRACT_GEN;
}

/** How a GIF icon should animate in the dock. */
export type GifAnimateMode = "hover" | "always";

/** True when a data URL is a GIF (animated icons). */
export function isGifIconDataUrl(dataUrl: string | undefined): boolean {
  return !!dataUrl?.startsWith("data:image/gif");
}

/** True when `value` is a known GIF animate mode. */
export function isGifAnimateMode(value: unknown): value is GifAnimateMode {
  return value === "hover" || value === "always";
}

/** Dock-wide icon button size (persisted; defaults to medium). */
export type LauncherIconSize = "s" | "m" | "l" | "xl" | "xxl";

export interface AppLauncherState {
  apps: LauncherApp[];
  /** Dock content width in CSS pixels (icons wrap when they exceed this). */
  width: number;
  /** Dock content height in CSS pixels (content scrolls if taller). */
  height: number;
  /** When true, the dock “+” control is hidden (add via widget menu). */
  hideAddButton?: boolean;
  /** Dock icon button size; default medium. */
  iconSize?: LauncherIconSize;
}

/** Icon button edge length in CSS px for each size. */
export const ICON_SIZE_PX: Record<LauncherIconSize, number> = {
  s: 32,
  m: 48,
  l: 64,
  xl: 80,
  xxl: 96,
};

/** Inner glyph / image size (padded icons) for each button size. */
export const ICON_FACE_PX: Record<LauncherIconSize, number> = {
  s: 22,
  m: 32,
  l: 44,
  xl: 56,
  xxl: 68,
};

/** True when value is a known dock icon size. */
export function isLauncherIconSize(value: unknown): value is LauncherIconSize {
  return (
    value === "s" ||
    value === "m" ||
    value === "l" ||
    value === "xl" ||
    value === "xxl"
  );
}

/** Resolve persisted / missing icon size to a concrete key. */
export function normalizeIconSize(value: unknown): LauncherIconSize {
  return isLauncherIconSize(value) ? value : "m";
}

/** Default wrap width: 4 medium icon columns. */
export const DEFAULT_WIDTH = ICON_SIZE_PX.m * 4 + 10 * 3;
export const DEFAULT_HEIGHT = 120;
export const MIN_HEIGHT = 72;
export const MAX_WIDTH = 900;
export const MAX_HEIGHT = 700;

/** Medium icon size — kept for callers that assume the classic 48px dock. */
export const LAUNCHER_ICON_PX = ICON_SIZE_PX.m;
export const LAUNCHER_GAP_PX = 10;
export const LAUNCHER_MIN_COLS = 1;
export const LAUNCHER_MAX_COLS = 12;

/** Minimum dock width for the current icon size (one column). */
export function minLauncherWidth(iconPx: number = LAUNCHER_ICON_PX): number {
  return iconPx;
}

/** Pixel width of `cols` icon slots (icons + gaps, no trailing gap). */
export function launcherWidthForCols(
  cols: number,
  iconPx: number = LAUNCHER_ICON_PX,
): number {
  const n = Math.min(
    LAUNCHER_MAX_COLS,
    Math.max(LAUNCHER_MIN_COLS, Math.round(cols)),
  );
  return n * iconPx + (n - 1) * LAUNCHER_GAP_PX;
}

/** How many icon columns fit in a pixel width (nearest). */
export function launcherColsFromWidth(
  width: number,
  iconPx: number = LAUNCHER_ICON_PX,
): number {
  const w = Number.isFinite(width) ? width : DEFAULT_WIDTH;
  const cols = Math.round((w + LAUNCHER_GAP_PX) / (iconPx + LAUNCHER_GAP_PX));
  return Math.min(LAUNCHER_MAX_COLS, Math.max(LAUNCHER_MIN_COLS, cols));
}

/** Snap an arbitrary width onto the icon column grid. */
export function snapLauncherWidth(
  width: number,
  iconPx: number = LAUNCHER_ICON_PX,
): number {
  return launcherWidthForCols(launcherColsFromWidth(width, iconPx), iconPx);
}

/** Clamp dock size into allowed bounds (same idea as Image widget). */
export function clampSize(
  width: number,
  height: number,
  iconPx: number = LAUNCHER_ICON_PX,
): { width: number; height: number } {
  const h = Number.isFinite(height) ? height : DEFAULT_HEIGHT;
  const minH = Math.max(MIN_HEIGHT, iconPx + 24);
  return {
    width: snapLauncherWidth(
      Number.isFinite(width) ? width : launcherWidthForCols(4, iconPx),
      iconPx,
    ),
    height: Math.min(MAX_HEIGHT, Math.max(minH, Math.round(h))),
  };
}

/** True when the value looks like an http(s) URL. */
export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

/**
 * Normalize user input into an absolute http(s) URL.
 * Adds `https://` when the scheme is missing. Returns null if invalid.
 */
export function normalizeUrl(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  } catch {
    return null;
  }
}

/** Windows-insensitive path key for duplicate detection (filesystem paths). */
export function normalizePath(path: string): string {
  return path.trim().replace(/\//g, "\\").toLowerCase();
}

/** Dedup key: URLs/keys stay as-is (lowercased); filesystem paths use Windows norms. */
export function normalizeEntryKey(path: string): string {
  const trimmed = path.trim();
  if (isHttpUrl(trimmed) || trimmed.toLowerCase().startsWith("key:")) {
    return trimmed.toLowerCase();
  }
  return normalizePath(trimmed);
}

/** Derive kind from path + directory flag (not used for URLs). */
export function detectKind(path: string, isDirectory: boolean): AppKind {
  if (isDirectory) return "folder";
  const lower = path.toLowerCase();
  if (lower.endsWith(".lnk")) return "lnk";
  return "exe";
}

/** Hostname for URL entries (strip leading www.). */
export function displayNameForUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "") || url;
  } catch {
    return url;
  }
}

/** File/folder stem for display (strip trailing separators). */
export function displayName(path: string): string {
  if (isHttpUrl(path)) return displayNameForUrl(path);
  const cleaned = path.replace(/[\\/]+$/, "");
  const parts = cleaned.split(/[\\/]/);
  const base = parts[parts.length - 1] || cleaned;
  return base.replace(/\.(exe|lnk)$/i, "") || base;
}

/** Cryptographically random id when available. */
export function newAppId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `app-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isAppKind(v: unknown): v is AppKind {
  return (
    v === "exe" || v === "lnk" || v === "folder" || v === "url" || v === "key"
  );
}

/** Normalize raw persisted JSON into a safe state. */
export function normalizeState(raw: unknown): AppLauncherState {
  if (!raw || typeof raw !== "object") {
    return { apps: [], width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, iconSize: "m" };
  }
  const o = raw as {
    width?: unknown;
    height?: unknown;
    apps?: unknown;
    hideAddButton?: unknown;
    iconSize?: unknown;
  };
  const iconSize = normalizeIconSize(o.iconSize);
  const iconPx = ICON_SIZE_PX[iconSize];
  const size = clampSize(
    typeof o.width === "number" ? o.width : launcherWidthForCols(4, iconPx),
    typeof o.height === "number" ? o.height : DEFAULT_HEIGHT,
    iconPx,
  );
  const hideAddButton = o.hideAddButton === true ? true : undefined;
  const appsRaw = o.apps;
  if (!Array.isArray(appsRaw)) {
    return {
      apps: [],
      ...size,
      iconSize,
      ...(hideAddButton ? { hideAddButton } : {}),
    };
  }

  const apps: LauncherApp[] = [];
  for (const item of appsRaw) {
    if (!item || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    if (typeof a.id !== "string" || typeof a.path !== "string") continue;
    if (!isAppKind(a.kind) || typeof a.name !== "string") continue;
    const entry: LauncherApp = {
      id: a.id,
      path: a.path,
      kind: a.kind,
      name: a.name,
    };
    if (typeof a.iconDataUrl === "string") entry.iconDataUrl = a.iconDataUrl;
    if (a.iconNoPadding === true) entry.iconNoPadding = true;
    if (a.iconCustom === true) entry.iconCustom = true;
    if (typeof a.iconExtractGen === "number" && Number.isFinite(a.iconExtractGen)) {
      entry.iconExtractGen = a.iconExtractGen;
    }
    if (isGifAnimateMode(a.iconGifAnimate)) {
      entry.iconGifAnimate = a.iconGifAnimate;
    } else if (a.iconAnimateOnHover === true) {
      // Migrate older boolean flag → hover mode.
      entry.iconGifAnimate = "hover";
    }
    if (a.muted === true) entry.muted = true;
    apps.push(entry);
  }
  return {
    apps,
    ...size,
    iconSize,
    ...(hideAddButton ? { hideAddButton } : {}),
  };
}

/** True if path/URL already exists in the list (case-insensitive). */
export function hasPath(apps: LauncherApp[], path: string): boolean {
  const key = normalizeEntryKey(path);
  return apps.some((a) => normalizeEntryKey(a.path) === key);
}

/** Append entries, skipping duplicate paths. */
export function addApps(apps: LauncherApp[], entries: LauncherApp[]): LauncherApp[] {
  const next = [...apps];
  for (const entry of entries) {
    if (hasPath(next, entry.path)) continue;
    next.push(entry);
  }
  return next;
}

/** Remove one app by id. */
export function removeApp(apps: LauncherApp[], id: string): LauncherApp[] {
  return apps.filter((a) => a.id !== id);
}

/** Move item fromIndex → toIndex (clamped). */
export function reorderApps(
  apps: LauncherApp[],
  fromIndex: number,
  toIndex: number,
): LauncherApp[] {
  if (
    fromIndex < 0 ||
    fromIndex >= apps.length ||
    toIndex < 0 ||
    toIndex >= apps.length ||
    fromIndex === toIndex
  ) {
    return apps;
  }
  const next = [...apps];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

/** Set or clear muted flag on one app. */
export function setMuted(
  apps: LauncherApp[],
  id: string,
  muted: boolean,
): LauncherApp[] {
  return apps.map((a) => {
    if (a.id !== id) return a;
    if (muted) return { ...a, muted: true };
    const { muted: _m, ...rest } = a;
    return rest;
  });
}

/** Merge a partial update into one app by id. */
export function patchApp(
  apps: LauncherApp[],
  id: string,
  patch: Partial<Omit<LauncherApp, "id">>,
): LauncherApp[] {
  return apps.map((a) => {
    if (a.id !== id) return a;
    const next: LauncherApp = { ...a, ...patch };
    if (patch.iconNoPadding === false) delete next.iconNoPadding;
    if (patch.iconCustom === false) delete next.iconCustom;
    if (patch.iconGifAnimate === undefined && "iconGifAnimate" in patch) {
      delete next.iconGifAnimate;
    }
    if (patch.muted === false) delete next.muted;
    if (patch.iconDataUrl === undefined && "iconDataUrl" in patch) {
      delete next.iconDataUrl;
    }
    // Non-GIF icons never keep a GIF animate mode.
    if (!isGifIconDataUrl(next.iconDataUrl)) delete next.iconGifAnimate;
    return next;
  });
}
