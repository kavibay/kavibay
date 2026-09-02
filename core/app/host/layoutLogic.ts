import type { RegisteredExtension } from "@sdk";
import {
  migrateV3ToV4,
  normalizeCatalogEntry,
  normalizeLayoutV4,
  normalizePlacement,
  purgeRedundantHiddenInstances,
} from "./deskLogic";
import type {
  Desk,
  DeskPlacement,
  SavedLayoutV3,
  SavedLayoutV4,
  WidgetCatalogEntry,
  WidgetInstance,
  WidgetPosition,
} from "./types";
import { DEFAULT_CONTENT_SCALE, clampContentScale } from "./resizeLogic";

export const LAYOUT_STORAGE_KEY = "kavibay:layout-v3";
export const LAYOUT_STORAGE_KEY_V2 = "kavibay:layout-v2";
export const LAYOUT_STORAGE_KEY_V4 = "kavibay:layout-v4";
/** One-shot: installer "Start Kavibay" / first launch should show the search bar. */
export const FIRST_OPEN_KEY = "kavibay:first-open-done";

const DUPLICATE_DELTA = 32;
const JITTER = 24;
/**
 * Pull manifest `defaultOffset` closer to the palette on spawn.
 * Keeps each type’s direction; only shortens the radius.
 */
export const SPAWN_OFFSET_SCALE = 0.5;

/**
 * True once on the very first app start (no prior marker). Marks the key so
 * later launches stay tray-only until a Ctrl double tap / tray Open.
 */
export function consumeFirstOpen(): boolean {
  try {
    if (localStorage.getItem(FIRST_OPEN_KEY)) return false;
    localStorage.setItem(FIRST_OPEN_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

/** Skip the first-open search-bar reveal (existing layouts / migrations). */
export function markFirstOpenDone(): void {
  try {
    localStorage.setItem(FIRST_OPEN_KEY, "1");
  } catch {
    // ignore quota / private-mode failures
  }
}

/** Cryptographically random instance id (falls back if crypto unavailable). */
export function newInstanceId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `inst-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Fresh-install default: empty desk (palette / search only).
 * Registry is accepted so callers can stay registry-driven if we seed again later.
 */
export function defaultInstances(_registry: RegisteredExtension[]): WidgetInstance[] {
  return [];
}

function jitter(n: number): number {
  return n + (Math.random() * 2 - 1) * JITTER;
}

/**
 * Scale a manifest default offset toward the palette center.
 * Used for New / place-on-desk; cursor drops pass through unscaled.
 */
export function spawnOffsetNearPalette(pos: WidgetPosition): WidgetPosition {
  return {
    x: Math.round(pos.x * SPAWN_OFFSET_SCALE),
    y: Math.round(pos.y * SPAWN_OFFSET_SCALE),
  };
}

/** New instance at base offset (optional small random jitter; default on). */
export function createInstance(
  typeId: string,
  baseOffset: WidgetPosition,
  opts?: {
    hideTitle?: boolean;
    width?: number;
    height?: number;
    /**
     * Content zoom to open at (manifest `ui.defaultScale`). Omitted or 1 stores
     * nothing, so untouched instances stay absent from the layout JSON.
     */
    contentScale?: number;
    /** When false, place exactly at baseOffset (e.g. cursor drop). Default true. */
    jitter?: boolean;
  },
): WidgetInstance {
  const useJitter = opts?.jitter !== false;
  const scale =
    typeof opts?.contentScale === "number"
      ? clampContentScale(opts.contentScale)
      : DEFAULT_CONTENT_SCALE;
  return {
    instanceId: newInstanceId(),
    typeId,
    offset: useJitter
      ? { x: jitter(baseOffset.x), y: jitter(baseOffset.y) }
      : { x: baseOffset.x, y: baseOffset.y },
    ...(opts?.hideTitle ? { hideTitle: true } : {}),
    ...(typeof opts?.width === "number" ? { width: opts.width } : {}),
    ...(typeof opts?.height === "number" ? { height: opts.height } : {}),
    ...(scale !== DEFAULT_CONTENT_SCALE ? { contentScale: scale } : {}),
  };
}

/** Clone instance with new id and +32/+32 offset (keeps custom title / hideTitle / pinned / size when set). */
export function duplicateInstance(source: WidgetInstance): WidgetInstance {
  return {
    instanceId: newInstanceId(),
    typeId: source.typeId,
    offset: {
      x: source.offset.x + DUPLICATE_DELTA,
      y: source.offset.y + DUPLICATE_DELTA,
    },
    ...(source.title !== undefined ? { title: source.title } : {}),
    ...(source.hideTitle !== undefined ? { hideTitle: source.hideTitle } : {}),
    ...(source.pinned === true ? { pinned: true } : {}),
    ...(typeof source.width === "number" ? { width: source.width } : {}),
    ...(typeof source.height === "number" ? { height: source.height } : {}),
    ...(typeof source.contentScale === "number"
      ? { contentScale: clampContentScale(source.contentScale) }
      : {}),
  };
}

interface SavedLayoutV2 {
  palette?: WidgetPosition;
  offsets?: Record<string, WidgetPosition>;
}

function defaultPalettePosition(): WidgetPosition {
  return {
    x: typeof window !== "undefined" ? window.innerWidth / 2 : 0,
    y: typeof window !== "undefined" ? window.innerHeight / 2 : 0,
  };
}

function isValidDeskPlacement(p: unknown): p is DeskPlacement {
  if (!p || typeof p !== "object") return false;
  const row = p as DeskPlacement;
  return (
    typeof row.instanceId === "string" &&
    !!row.offset &&
    typeof row.offset.x === "number" &&
    typeof row.offset.y === "number"
  );
}

function isValidDesk(d: unknown): d is Desk {
  if (!d || typeof d !== "object") return false;
  const desk = d as Desk;
  return (
    typeof desk.id === "string" &&
    typeof desk.name === "string" &&
    !!desk.palette &&
    typeof desk.palette.x === "number" &&
    typeof desk.palette.y === "number" &&
    Array.isArray(desk.placements) &&
    desk.placements.every(isValidDeskPlacement)
  );
}

function isValidCatalogEntry(c: unknown): c is WidgetCatalogEntry {
  if (!c || typeof c !== "object") return false;
  const entry = c as WidgetCatalogEntry;
  return typeof entry.instanceId === "string" && typeof entry.typeId === "string";
}

/** Drop unknown typeIds from catalog and orphan placements; warn for skipped entries. */
function filterKnownCatalog(
  layout: SavedLayoutV4,
  knownIds: Set<string>,
): SavedLayoutV4 {
  const catalog = layout.catalog
    .map((c) => normalizeCatalogEntry(c))
    .filter((c) => {
      if (knownIds.has(c.typeId)) return true;
      console.warn(
        `[kavibay] Skipping layout catalog entry with unknown typeId "${c.typeId}"`,
      );
      return false;
    });
  const knownInstanceIds = new Set(catalog.map((c) => c.instanceId));
  const desks = layout.desks.map((d) => ({
    ...d,
    palette: { ...d.palette },
    placements: d.placements
      .map((p) => normalizePlacement(p))
      .filter((p) => knownInstanceIds.has(p.instanceId)),
  }));
  return { ...layout, catalog, desks };
}

/**
 * Layouts saved before the Sticky→Pin rename stored `sticky` / `paletteSticky`.
 * Read on load only; normalize rebuilds every row, so the next save drops them.
 */
interface LegacyPinFields {
  sticky?: boolean;
  paletteSticky?: boolean;
}

/** Pinned under the current or the pre-rename field name. */
function readPinned(row: { pinned?: boolean } & LegacyPinFields): boolean {
  return row.pinned === true || row.sticky === true;
}

/** Palette pinned under the current or the pre-rename field name. */
function readPalettePinned(
  row: { palettePinned?: boolean } & LegacyPinFields,
): boolean {
  return row.palettePinned === true || row.paletteSticky === true;
}

/** Copy pre-rename pin flags onto `pinned` / `palettePinned` before normalizing. */
function upgradeLegacyPinFields(layout: SavedLayoutV4): SavedLayoutV4 {
  return {
    ...layout,
    desks: layout.desks.map((desk) => ({
      ...desk,
      ...(readPalettePinned(desk) ? { palettePinned: true } : {}),
      placements: desk.placements.map((p) =>
        readPinned(p) ? { ...p, pinned: true } : p,
      ),
    })),
  };
}

/** Parse and normalize a stored layout-v4 document. */
function parseLayoutV4(raw: string, knownIds: Set<string>): SavedLayoutV4 | null {
  try {
    const parsed = JSON.parse(raw) as SavedLayoutV4;
    if (
      typeof parsed.activeDeskId !== "string" ||
      !Array.isArray(parsed.desks) ||
      !Array.isArray(parsed.catalog) ||
      !parsed.desks.every(isValidDesk) ||
      !parsed.catalog.every(isValidCatalogEntry) ||
      !parsed.desks.some((d) => d.id === parsed.activeDeskId)
    ) {
      return null;
    }
    return filterKnownCatalog(
      normalizeLayoutV4(upgradeLegacyPinFields(parsed)),
      knownIds,
    );
  } catch {
    return null;
  }
}

/** Load layout-v3 from storage, or migrate v2, or return defaults (no v4 write). */
function loadLayoutV3(registry: RegisteredExtension[]): SavedLayoutV3 {
  const defaultPalette = defaultPalettePosition();
  const knownIds = new Set(registry.map((d) => d.id));

  try {
    const v3raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (v3raw) {
      const v3 = JSON.parse(v3raw) as SavedLayoutV3;
      if (Array.isArray(v3.instances) && v3.palette) {
        const instances = v3.instances
          .filter(
            (i) =>
              i &&
              typeof i.instanceId === "string" &&
              typeof i.typeId === "string" &&
              i.offset &&
              typeof i.offset.x === "number" &&
              typeof i.offset.y === "number",
          )
          .map((i) => normalizeInstance(readPinned(i) ? { ...i, pinned: true } : i))
          .filter((i) => {
            if (knownIds.has(i.typeId)) return true;
            console.warn(
              `[kavibay] Skipping layout instance with unknown typeId "${i.typeId}"`,
            );
            return false;
          });
        return {
          palette: { ...v3.palette },
          ...(readPalettePinned(v3) ? { palettePinned: true } : {}),
          ...(typeof v3.paletteWidth === "number" ? { paletteWidth: v3.paletteWidth } : {}),
          ...(typeof v3.paletteListHeight === "number"
            ? { paletteListHeight: v3.paletteListHeight }
            : {}),
          instances,
        };
      }
    }
  } catch {
    // fall through
  }

  try {
    const v2raw = localStorage.getItem(LAYOUT_STORAGE_KEY_V2);
    if (v2raw) {
      const v2 = JSON.parse(v2raw) as SavedLayoutV2;
      const palette = v2.palette ?? defaultPalette;
      const instances = registry.map((def) => ({
        instanceId: newInstanceId(),
        typeId: def.id,
        offset: v2.offsets?.[def.id]
          ? { ...v2.offsets[def.id] }
          : { ...def.position },
      }));
      return { palette: { ...palette }, instances };
    }
  } catch {
    // fall through
  }

  return {
    palette: defaultPalette,
    instances: defaultInstances(registry),
  };
}

/**
 * Load layout-v4, or migrate v3/v2/defaults, persist v4, and return the document.
 * Unknown typeIds are dropped with a console warning.
 * Existing / migrated installs skip the first-open search-bar reveal.
 */
export function loadLayout(registry: RegisteredExtension[]): SavedLayoutV4 {
  const knownIds = new Set(registry.map((d) => d.id));

  try {
    const v4raw = localStorage.getItem(LAYOUT_STORAGE_KEY_V4);
    if (v4raw) {
      const v4 = parseLayoutV4(v4raw, knownIds);
      if (v4) {
        markFirstOpenDone();
        // Drop soft-hidden orphans left behind by older New/Gallery stacks.
        const cleaned = purgeRedundantHiddenInstances(v4);
        if (cleaned.removedInstanceIds.length > 0) {
          saveLayout(cleaned.layout);
          return cleaned.layout;
        }
        return v4;
      }
    }
  } catch {
    // fall through
  }

  const hadPriorLayout =
    localStorage.getItem(LAYOUT_STORAGE_KEY) != null ||
    localStorage.getItem(LAYOUT_STORAGE_KEY_V2) != null;

  const v3 = loadLayoutV3(registry);
  const v4 = migrateV3ToV4(v3);
  saveLayout(v4);
  // Migrating an older layout is not a first install — stay tray-only.
  if (hadPriorLayout) markFirstOpenDone();
  return v4;
}

/**
 * Point every card of `from` at `to`, after a package was renamed.
 *
 * A layout stores the package id as `typeId`, so a rename that stopped at the
 * folder leaves every card on the desk resolving to nothing: the load path
 * drops unknown typeIds with a console warning, and the person's widget is
 * simply gone — with its position, its title and its instance data still on
 * disk under an id nothing points at.
 *
 * Placements are untouched. They reference instances, and an instance keeps its
 * id through a rename.
 */
export function renameWidgetType(
  layout: SavedLayoutV4,
  from: string,
  to: string,
): SavedLayoutV4 {
  if (!from || !to || from === to) return layout;
  if (!layout.catalog.some((entry) => entry.typeId === from)) return layout;
  return {
    ...layout,
    catalog: layout.catalog.map((entry) =>
      entry.typeId === from ? { ...entry, typeId: to } : entry,
    ),
  };
}

/** Strip a loaded instance down to the fields we persist. */
export function normalizeInstance(i: WidgetInstance): WidgetInstance {
  const next: WidgetInstance = {
    instanceId: i.instanceId,
    typeId: i.typeId,
    offset: { x: i.offset.x, y: i.offset.y },
  };
  if (typeof i.title === "string") next.title = i.title;
  if (typeof i.hideTitle === "boolean") next.hideTitle = i.hideTitle;
  if (i.hidden === true) next.hidden = true;
  if (i.pinned === true) next.pinned = true;
  if (typeof i.width === "number" && Number.isFinite(i.width)) {
    next.width = Math.round(i.width);
  }
  if (typeof i.height === "number" && Number.isFinite(i.height)) {
    next.height = Math.round(i.height);
  }
  if (typeof i.contentScale === "number" && Number.isFinite(i.contentScale)) {
    // Round to 3 decimals so layout JSON stays stable across tiny float noise.
    next.contentScale = Math.round(clampContentScale(i.contentScale) * 1000) / 1000;
  }
  return next;
}

/** True when any pinned instance is still available (not menu-Hidden). */
export function hasVisiblePinnedInstance(instances: WidgetInstance[]): boolean {
  return instances.some((i) => i.pinned === true && i.hidden !== true);
}

/**
 * Instances the user grabbed out of a hold-to-peek, by id.
 *
 * Session-only and deliberately *not* the same thing as `pinned`: a grab is one
 * click during a peek, it never reaches the saved layout, and it is forgotten on
 * the next ordinary cockpit close. Nothing about it survives a restart.
 */
export type PeekKeptIds = ReadonlySet<string>;

/**
 * Does this instance stay on screen once the cockpit session ends?
 *
 * Two independent reasons, and they must not be collapsed into one flag: pinned
 * is the user's persisted decision about a widget, kept is a grab that lasts
 * until they close it.
 */
export function survivesDismiss(instance: WidgetInstance, kept: PeekKeptIds): boolean {
  if (instance.hidden === true) return false;
  return instance.pinned === true || kept.has(instance.instanceId);
}

/** True when any grabbed instance is still on the desk and not menu-Hidden. */
export function hasKeptInstance(instances: WidgetInstance[], kept: PeekKeptIds): boolean {
  return instances.some((i) => i.hidden !== true && kept.has(i.instanceId));
}

/**
 * Keep the Kavibay window open when pinned or grabbed palette/widgets remain
 * after a cockpit close.
 *
 * Getting `kept` wrong here is invisible in review and obvious in use: the window
 * hides while a widget the user just clicked is still supposed to be on it.
 */
export function shouldKeepWindowAfterDismiss(
  instances: WidgetInstance[],
  palettePinned: boolean,
  kept: PeekKeptIds = new Set<string>(),
): boolean {
  return (
    palettePinned === true ||
    hasVisiblePinnedInstance(instances) ||
    hasKeptInstance(instances, kept)
  );
}

/** Persist layout-v4. */
export function saveLayout(layout: SavedLayoutV4): void {
  localStorage.setItem(LAYOUT_STORAGE_KEY_V4, JSON.stringify(normalizeLayoutV4(layout)));
}
