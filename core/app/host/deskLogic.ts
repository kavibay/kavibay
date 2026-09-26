import { clampContentScale } from "./resizeLogic";
import type {
  Desk,
  DeskPlacement,
  SavedLayoutV3,
  SavedLayoutV4,
  WidgetCatalogEntry,
  WidgetInstance,
  WidgetPosition,
} from "./types";
import { currentViewportSize, normalizeViewport } from "./viewportLayout";
import { normalizeWidgetAppearance } from "./widgetAppearance";

/** Default palette center for a new desk (viewport center when available). */
function defaultPalettePosition(): WidgetPosition {
  return {
    x: typeof window !== "undefined" ? window.innerWidth / 2 : 0,
    y: typeof window !== "undefined" ? window.innerHeight / 2 : 0,
  };
}

/** Display label for a newly created desk ("Desk 1", "Desk 2", …). */
function defaultDeskName(deskNumber: string): string {
  return `Desk ${deskNumber}`;
}

/**
 * Next unused numeric desk id ("1", "2", …).
 * Also skips bare numeric names so old layouts that stored name === id stay unique.
 */
function nextDeskNumber(desks: Desk[]): string {
  const used = new Set(desks.flatMap((d) => [d.id, d.name]));
  let n = 1;
  while (used.has(String(n))) n++;
  return String(n);
}

/** Strip a catalog entry down to the fields we persist. */
export function normalizeCatalogEntry(e: WidgetCatalogEntry): WidgetCatalogEntry {
  const next: WidgetCatalogEntry = {
    instanceId: e.instanceId,
    typeId: e.typeId,
  };
  if (typeof e.title === "string") next.title = e.title;
  if (typeof e.hideTitle === "boolean") next.hideTitle = e.hideTitle;
  const appearance = normalizeWidgetAppearance(e.appearance);
  if (appearance) next.appearance = appearance;
  return next;
}

/** Strip a desk placement down to the fields we persist. */
export function normalizePlacement(p: DeskPlacement): DeskPlacement {
  const next: DeskPlacement = {
    instanceId: p.instanceId,
    offset: { x: p.offset.x, y: p.offset.y },
  };
  if (typeof p.width === "number" && Number.isFinite(p.width)) {
    next.width = Math.round(p.width);
  }
  if (typeof p.height === "number" && Number.isFinite(p.height)) {
    next.height = Math.round(p.height);
  }
  if (typeof p.contentScale === "number" && Number.isFinite(p.contentScale)) {
    next.contentScale = Math.round(clampContentScale(p.contentScale) * 1000) / 1000;
  }
  if (p.hidden === true) {
    next.hidden = true;
    if (typeof p.hiddenAt === "number" && Number.isFinite(p.hiddenAt)) {
      next.hiddenAt = Math.round(p.hiddenAt);
    }
  }
  if (p.pinned === true) next.pinned = true;
  return next;
}

/**
 * Upgrade legacy default labels ("1") to "Desk 1" when name still equals the numeric id.
 * Custom renames are left alone.
 */
function upgradeLegacyDeskName(desk: Desk): string {
  if (desk.name === desk.id && /^\d+$/.test(desk.id)) {
    return defaultDeskName(desk.id);
  }
  return desk.name;
}

/** Strip a v4 layout document down to the fields we persist. */
export function normalizeLayoutV4(layout: SavedLayoutV4): SavedLayoutV4 {
  return {
    activeDeskId: layout.activeDeskId,
    desks: layout.desks.map((d) => {
      const viewport = normalizeViewport(d.viewport);
      return {
        id: d.id,
        name: upgradeLegacyDeskName(d),
        palette: { ...d.palette },
        ...(d.palettePinned === true ? { palettePinned: true } : {}),
        ...(typeof d.paletteWidth === "number" && Number.isFinite(d.paletteWidth)
          ? { paletteWidth: Math.round(d.paletteWidth) }
          : {}),
        ...(typeof d.paletteListHeight === "number" && Number.isFinite(d.paletteListHeight)
          ? { paletteListHeight: Math.round(d.paletteListHeight) }
          : {}),
        ...(viewport ? { viewport } : {}),
        placements: d.placements.map((p) => normalizePlacement(p)),
      };
    }),
    catalog: layout.catalog.map((e) => normalizeCatalogEntry(e)),
  };
}

/** Convert a layout-v3 snapshot into a single-desk layout-v4 document. */
export function migrateV3ToV4(v3: SavedLayoutV3): SavedLayoutV4 {
  const deskId = "1";
  const catalog: WidgetCatalogEntry[] = v3.instances.map((i) => ({
    instanceId: i.instanceId,
    typeId: i.typeId,
    ...(i.title !== undefined ? { title: i.title } : {}),
    ...(i.hideTitle !== undefined ? { hideTitle: i.hideTitle } : {}),
  }));
  const placements: DeskPlacement[] = v3.instances.map((i) => ({
    instanceId: i.instanceId,
    offset: { x: i.offset.x, y: i.offset.y },
    ...(typeof i.width === "number" ? { width: i.width } : {}),
    ...(typeof i.height === "number" ? { height: i.height } : {}),
    ...(typeof i.contentScale === "number" ? { contentScale: i.contentScale } : {}),
    ...(i.hidden === true ? { hidden: true } : {}),
    ...(i.hidden === true && typeof i.hiddenAt === "number" && Number.isFinite(i.hiddenAt)
      ? { hiddenAt: i.hiddenAt }
      : {}),
    ...(i.pinned === true ? { pinned: true } : {}),
  }));
  const desk: Desk = {
    id: deskId,
    name: defaultDeskName(deskId),
    palette: { ...v3.palette },
    ...(v3.palettePinned === true ? { palettePinned: true } : {}),
    ...(typeof v3.paletteWidth === "number" ? { paletteWidth: v3.paletteWidth } : {}),
    ...(typeof v3.paletteListHeight === "number"
      ? { paletteListHeight: v3.paletteListHeight }
      : {}),
    placements,
  };
  return { activeDeskId: deskId, desks: [desk], catalog };
}

/** Return the currently active desk (throws if missing). */
export function activeDesk(layout: SavedLayoutV4): Desk {
  const desk = layout.desks.find((d) => d.id === layout.activeDeskId);
  if (!desk) {
    throw new Error(`Active desk "${layout.activeDeskId}" not found`);
  }
  return desk;
}

/** Join catalog entries with a desk's placements into live widget instances. */
export function instancesForDesk(layout: SavedLayoutV4, deskId: string): WidgetInstance[] {
  const desk = layout.desks.find((d) => d.id === deskId);
  if (!desk) return [];
  const catalogById = new Map(layout.catalog.map((c) => [c.instanceId, c]));
  const instances: WidgetInstance[] = [];
  for (const placement of desk.placements) {
    const entry = catalogById.get(placement.instanceId);
    if (!entry) continue;
    instances.push({
      instanceId: entry.instanceId,
      typeId: entry.typeId,
      offset: { ...placement.offset },
      ...(entry.title !== undefined ? { title: entry.title } : {}),
      ...(entry.hideTitle !== undefined ? { hideTitle: entry.hideTitle } : {}),
      ...(entry.appearance !== undefined ? { appearance: { ...entry.appearance } } : {}),
      ...(placement.hidden === true ? { hidden: true } : {}),
      ...(placement.hidden === true &&
      typeof placement.hiddenAt === "number" &&
      Number.isFinite(placement.hiddenAt)
        ? { hiddenAt: placement.hiddenAt }
        : {}),
      ...(placement.pinned === true ? { pinned: true } : {}),
      ...(typeof placement.width === "number" ? { width: placement.width } : {}),
      ...(typeof placement.height === "number" ? { height: placement.height } : {}),
      ...(typeof placement.contentScale === "number"
        ? { contentScale: placement.contentScale }
        : {}),
    });
  }
  return instances;
}

/** Append a new empty desk with the next default label ("Desk n"). */
export function addDesk(layout: SavedLayoutV4): { layout: SavedLayoutV4; deskId: string } {
  const deskId = nextDeskNumber(layout.desks);
  const viewport = currentViewportSize();
  const desk: Desk = {
    id: deskId,
    name: defaultDeskName(deskId),
    palette: defaultPalettePosition(),
    viewport,
    placements: [],
  };
  return {
    layout: { ...layout, desks: [...layout.desks, desk] },
    deskId,
  };
}

/** Rename a desk's display label (id unchanged). */
export function renameDesk(
  layout: SavedLayoutV4,
  deskId: string,
  name: string,
): SavedLayoutV4 {
  return {
    ...layout,
    desks: layout.desks.map((d) => (d.id === deskId ? { ...d, name } : d)),
  };
}

/** Remove a desk and dispose catalog entries exclusive to it. */
export function deleteDesk(
  layout: SavedLayoutV4,
  deskId: string,
): { layout: SavedLayoutV4; disposedInstanceIds: string[] } {
  if (layout.desks.length === 1) {
    throw new Error("Cannot delete the last desk");
  }
  const target = layout.desks.find((d) => d.id === deskId);
  if (!target) {
    throw new Error(`Desk "${deskId}" not found`);
  }

  const remainingDesks = layout.desks.filter((d) => d.id !== deskId);
  const disposedInstanceIds: string[] = [];
  for (const instanceId of target.placements.map((p) => p.instanceId)) {
    const stillPlaced = remainingDesks.some((d) =>
      d.placements.some((p) => p.instanceId === instanceId),
    );
    if (!stillPlaced) disposedInstanceIds.push(instanceId);
  }

  let activeDeskId = layout.activeDeskId;
  if (activeDeskId === deskId) {
    activeDeskId = remainingDesks[0]!.id;
  }

  const disposedSet = new Set(disposedInstanceIds);
  return {
    layout: {
      activeDeskId,
      desks: remainingDesks,
      catalog: layout.catalog.filter((c) => !disposedSet.has(c.instanceId)),
    },
    disposedInstanceIds,
  };
}

/** Switch the active desk without changing placements. */
export function setActiveDesk(layout: SavedLayoutV4, deskId: string): SavedLayoutV4 {
  if (!layout.desks.some((d) => d.id === deskId)) {
    throw new Error(`Desk "${deskId}" not found`);
  }
  return { ...layout, activeDeskId: deskId };
}

/** Add a catalog entry and place it on the active desk. */
export function addCatalogInstance(
  layout: SavedLayoutV4,
  entry: WidgetCatalogEntry,
  placement: DeskPlacement,
): SavedLayoutV4 {
  return {
    ...layout,
    catalog: [...layout.catalog, entry],
    desks: layout.desks.map((d) =>
      d.id === layout.activeDeskId
        ? { ...d, placements: [...d.placements, placement] }
        : d,
    ),
  };
}

/** Place an existing catalog instance on another desk (also-on); no-op if already there. */
export function placeOnDesk(
  layout: SavedLayoutV4,
  instanceId: string,
  deskId: string,
  offset: WidgetPosition,
): SavedLayoutV4 | null {
  if (!layout.catalog.some((c) => c.instanceId === instanceId)) return null;
  const desk = layout.desks.find((d) => d.id === deskId);
  if (!desk) return null;
  if (desk.placements.some((p) => p.instanceId === instanceId)) return null;
  return {
    ...layout,
    desks: layout.desks.map((d) =>
      d.id === deskId
        ? { ...d, placements: [...d.placements, { instanceId, offset }] }
        : d,
    ),
  };
}

/** Remove a placement from one desk; dispose catalog when it was the last placement. */
export function removeFromDesk(
  layout: SavedLayoutV4,
  instanceId: string,
  deskId: string,
): { layout: SavedLayoutV4; disposed: boolean } {
  const desks = layout.desks.map((d) =>
    d.id === deskId
      ? { ...d, placements: d.placements.filter((p) => p.instanceId !== instanceId) }
      : d,
  );
  const stillPlaced = desks.some((d) =>
    d.placements.some((p) => p.instanceId === instanceId),
  );
  if (stillPlaced) {
    return { layout: { ...layout, desks }, disposed: false };
  }
  return {
    layout: {
      ...layout,
      desks,
      catalog: layout.catalog.filter((c) => c.instanceId !== instanceId),
    },
    disposed: true,
  };
}

/** Remove an instance from every desk and drop its catalog entry. */
export function removeEverywhere(
  layout: SavedLayoutV4,
  instanceId: string,
): SavedLayoutV4 {
  return {
    ...layout,
    catalog: layout.catalog.filter((c) => c.instanceId !== instanceId),
    desks: layout.desks.map((d) => ({
      ...d,
      placements: d.placements.filter((p) => p.instanceId !== instanceId),
    })),
  };
}

/**
 * Reinsert a removed instance for close-undo.
 * Adds the catalog entry when missing; merges each placement onto its desk
 * (skips desks that already have that instanceId).
 */
export function restoreRemovedInstance(
  layout: SavedLayoutV4,
  catalog: WidgetCatalogEntry,
  placements: Array<{ deskId: string; placement: DeskPlacement }>,
): SavedLayoutV4 {
  const entry = normalizeCatalogEntry(catalog);
  const hasCatalog = layout.catalog.some((c) => c.instanceId === entry.instanceId);
  let next: SavedLayoutV4 = hasCatalog
    ? layout
    : { ...layout, catalog: [...layout.catalog, entry] };

  for (const { deskId, placement } of placements) {
    const normalized = normalizePlacement({
      ...placement,
      instanceId: entry.instanceId,
    });
    const desk = next.desks.find((d) => d.id === deskId);
    if (!desk) continue;
    if (desk.placements.some((p) => p.instanceId === entry.instanceId)) continue;
    next = {
      ...next,
      desks: next.desks.map((d) =>
        d.id === deskId
          ? { ...d, placements: [...d.placements, normalized] }
          : d,
      ),
    };
  }
  return next;
}

/** typeId for a catalog instance, or undefined when unknown. */
function typeIdFor(layout: SavedLayoutV4, instanceId: string): string | undefined {
  return layout.catalog.find((c) => c.instanceId === instanceId)?.typeId;
}

/** All placements of one catalog instance across desks. */
function placementsFor(
  layout: SavedLayoutV4,
  instanceId: string,
): DeskPlacement[] {
  return layout.desks.flatMap((d) =>
    d.placements.filter((p) => p.instanceId === instanceId),
  );
}

/**
 * Soft-hidden-only catalog ids for `typeId` (every placement has hidden:true).
 * These are the usual "still in Hidden after Remove" orphans from Gallery/New.
 */
export function fullyHiddenInstanceIds(
  layout: SavedLayoutV4,
  typeId: string,
  exceptInstanceId?: string,
): string[] {
  const out: string[] = [];
  for (const entry of layout.catalog) {
    if (entry.typeId !== typeId) continue;
    if (exceptInstanceId && entry.instanceId === exceptInstanceId) continue;
    const rows = placementsFor(layout, entry.instanceId);
    if (rows.length === 0) continue;
    if (rows.every((p) => p.hidden === true)) out.push(entry.instanceId);
  }
  return out;
}

/**
 * Drop soft-hidden-only instances when the same type already has a visible
 * placement (or `forceTypeId` was just removed/shown). Returns removed ids.
 */
export function purgeRedundantHiddenInstances(
  layout: SavedLayoutV4,
  forceTypeId?: string,
): { layout: SavedLayoutV4; removedInstanceIds: string[] } {
  const typeHasVisible = new Set<string>();
  for (const desk of layout.desks) {
    for (const p of desk.placements) {
      if (p.hidden === true) continue;
      const typeId = typeIdFor(layout, p.instanceId);
      if (typeId) typeHasVisible.add(typeId);
    }
  }
  if (forceTypeId) typeHasVisible.add(forceTypeId);

  const removedInstanceIds: string[] = [];
  let next = layout;
  for (const typeId of typeHasVisible) {
    for (const id of fullyHiddenInstanceIds(next, typeId)) {
      next = removeEverywhere(next, id);
      removedInstanceIds.push(id);
    }
  }
  return { layout: next, removedInstanceIds };
}

/** Desk ids that currently place the given catalog instance. */
export function desksWithInstance(layout: SavedLayoutV4, instanceId: string): string[] {
  return layout.desks
    .filter((d) => d.placements.some((p) => p.instanceId === instanceId))
    .map((d) => d.id);
}

/** Catalog entries not yet placed on the given desk. */
export function catalogNotOnDesk(
  layout: SavedLayoutV4,
  deskId: string,
): WidgetCatalogEntry[] {
  const desk = layout.desks.find((d) => d.id === deskId);
  if (!desk) return [];
  const placed = new Set(desk.placements.map((p) => p.instanceId));
  return layout.catalog.filter((c) => !placed.has(c.instanceId));
}
