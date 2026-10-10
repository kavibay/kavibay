import type { Component } from "vue";
import type { ExtensionViews, WidgetView } from "@sdk/contract/sdk-vue";
import type { ExtensionActionDeclaration, ExtensionManifest } from "@sdk/contract/sdk";
import { toActionDeclarations, type WidgetActionDeclaration } from "./widgetActions";
import { isSafeExtensionIconPath } from "../extensions/extensionIcon";
import { normalizeWidgetAppearance, type WidgetAppearance } from "../host/widgetAppearance";

/**
 * Discovers bundled contract extensions under `extensions/<id>/`, the same
 * folder and the same glob shape the old host already uses.
 *
 * WHY THEY LIVE THERE AND NOT NEXT TO THE HOST: a widget written against the
 * contract is not host code — invariant 7 is that a bundled widget uses exactly
 * the API an external one does. Parking migrated widgets inside the host folder
 * made that false in the one way that is easy to miss, because `extensions/` is
 * MIT and `core/app/` is GPL, so the folder a widget sits in decides its
 * licence. It also grew three parallel maps in `cockpit.ts` — catalog metadata,
 * `REPLACES`, and the view map — that every future port had to be added to.
 *
 * A bundled extension is three files, each answering one question:
 *
 *   extension.ts    what the widget IS      framework-free, loadable under tsx
 *   manifest.json   how the catalog lists it
 *   view.ts         how it draws            the only file that needs Vue
 *
 * THE MANIFEST IS NOT A TRUST OR PERMISSION INPUT. It carries presentation and
 * nothing else. Trust still comes from the load source (`registry.ts`,
 * invariant 1) and permissions still come from the contract definition, which
 * is compiled rather than parsed. `format` selects a reader, not a tier — the
 * old loader skips what this one claims and vice versa.
 */

/** Host UI/lifecycle metadata the contract deliberately does not model. */
export interface ContractCatalogMetadata {
  keywords?: string[];
  categories?: string[];
  /** Off on a fresh profile; absent means on. See `RegisteredExtension`. */
  enabledByDefault?: boolean;
  /** Place this on the very first desk, lowest first. See `starterDesk.ts`. */
  starter?: number;
  position?: { x: number; y: number };
  defaultSize?: { w: number; h: number };
  allowDuplicate?: boolean;
  flush?: boolean;
  padding?: boolean;
  compact?: boolean;
  defaultHideTitle?: boolean;
  defaultScale?: number;
  grabCursor?: boolean;
  fullDrag?: boolean;
  resizable?: boolean;
  playground?: boolean;
  hugHeight?: boolean;
  opaque?: boolean;
  keepAliveWhenHidden?: boolean;
  ownWindow?: boolean;
  appearance?: WidgetAppearance;
  appearanceEditable?: boolean;
}

export type { WidgetActionDeclaration };

export interface BundledWidget {
  /** The `name` from `defineWidget` — the join key across the three files. */
  name: string;
  /**
   * The catalog id this widget takes over from a shipping widget.
   *
   * Keeping the old id is what makes a replacement invisible: a placed tile
   * stores `typeId: "clock"` in the layout, so reusing that id resolves every
   * existing instance to the new widget with no layout migration and no lost
   * desks. A widget without it is still a duplicate of a shipping one and
   * stays out of a release build.
   */
  replaces?: string;
  catalog: ContractCatalogMetadata;
  /** Declared in the manifest, already paired with a handler in the definition. */
  actions: WidgetActionDeclaration[];
  view?: Component;
  icon?: Component;
  menu?: Component;
  settings?: Component;
}

export interface BundledExtension {
  folder: string;
  definition: ExtensionManifest;
  widgets: BundledWidget[];
  /** Standalone palette actions, for extensions without a widget card. */
  actions: ExtensionActionDeclaration[];
  /** Root-level catalog metadata used by standalone action entries. */
  catalog: ContractCatalogMetadata;
  icon?: string;
  iconComponent?: Component;
  iconUrl?: string;
}

const manifestModules = import.meta.glob("/extensions/*/manifest.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;

const definitionModules = import.meta.glob("/extensions/*/extension.ts", {
  eager: true,
  import: "default",
}) as Record<string, ExtensionManifest>;

/**
 * Eager, like the definitions: `widgetViews` is read synchronously when the gate
 * resolves, and this is the same handful of components the host imported
 * statically before. `/extensions/*` + `view.ts` is also why this is a named
 * file rather than a glob over `*.vue` — the latter would eagerly pull in every
 * SFC of all 29 old extensions, which is precisely the boot-path cost the old
 * loader's README glob was made lazy to avoid.
 */
const viewModules = import.meta.glob("/extensions/*/view.ts", {
  eager: true,
  import: "default",
}) as Record<string, ExtensionViews>;

const iconUrlModules = import.meta.glob("/extensions/**/*.{svg,png}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

/** Extract `<folder>` from `/extensions/<folder>/<file>`. */
function folderOf(path: string): string {
  const match = path.match(/^\/extensions\/([^/]+)\//);
  if (!match) throw new Error(`bundledExtensions: unrecognized path ${path}`);
  return match[1];
}

/** True for a manifest written against the contract rather than the old host. */
export function isContractManifest(raw: unknown): boolean {
  return (
    typeof raw === "object" &&
    raw !== null &&
    (raw as { format?: unknown }).format === "contract"
  );
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asStrings = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : undefined;

const asBool = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

const asPoint = (value: unknown): { x: number; y: number } | undefined => {
  const p = asRecord(value);
  return typeof p.x === "number" && typeof p.y === "number" ? { x: p.x, y: p.y } : undefined;
};

const asSize = (value: unknown): { w: number; h: number } | undefined => {
  const s = asRecord(value);
  return typeof s.w === "number" && typeof s.h === "number" && s.w > 0 && s.h > 0
    ? { w: s.w, h: s.h }
    : undefined;
};

function toCatalogMetadata(entry: Record<string, unknown>): ContractCatalogMetadata {
  const ui = asRecord(entry.ui);
  return {
    keywords: asStrings(entry.keywords),
    categories: asStrings(entry.categories),
    // A catalog fact, not a geometry one, so it sits beside keywords rather
    // than under `ui`.
    enabledByDefault: asBool(entry.enabledByDefault),
    // Also a catalog fact rather than a geometry one: it says which desk a
    // widget belongs on, not where on it.
    starter: typeof entry.starter === "number" ? entry.starter : undefined,
    position: asPoint(ui.defaultOffset),
    defaultSize: asSize(ui.defaultSize),
    allowDuplicate: asBool(ui.allowDuplicate),
    flush: asBool(ui.flush),
    padding: asBool(ui.padding),
    compact: asBool(ui.compact),
    defaultHideTitle: asBool(ui.defaultHideTitle),
    defaultScale: typeof ui.defaultScale === "number" ? ui.defaultScale : undefined,
    grabCursor: asBool(ui.grabCursor),
    fullDrag: asBool(ui.fullDrag),
    resizable: asBool(ui.resizable),
    playground: asBool(ui.playground),
    hugHeight: asBool(ui.hugHeight),
    opaque: asBool(ui.opaque),
    keepAliveWhenHidden: asBool(ui.keepAliveWhenHidden),
    ownWindow: asBool(ui.ownWindow),
    appearance: normalizeWidgetAppearance(ui.appearance),
    appearanceEditable: asBool(asRecord(ui.appearance).editable),
  };
}

function resolveIconUrl(folder: string, icon: unknown): string | undefined {
  if (typeof icon !== "string" || !isSafeExtensionIconPath(icon)) return undefined;
  return iconUrlModules[`/extensions/${folder}/${icon}`];
}

function widgetView(views: ExtensionViews, name: string): WidgetView | undefined {
  const candidate = views[name];
  return candidate && "view" in candidate ? candidate : undefined;
}

function extensionIcon(views: ExtensionViews): Component | undefined {
  const candidate = views.__extension__;
  return candidate && !("view" in candidate) ? candidate.icon : undefined;
}



function loadAll(): BundledExtension[] {
  const found: BundledExtension[] = [];

  for (const [path, raw] of Object.entries(manifestModules)) {
    if (!isContractManifest(raw)) continue; // an old-host extension; not ours
    const folder = folderOf(path);
    const manifestRecord = asRecord(raw);

    const definition = definitionModules[`/extensions/${folder}/extension.ts`];
    if (!definition) {
      throw new Error(
        `Extension "${folder}": manifest.json declares format "contract" but there is no extension.ts`,
      );
    }
    if (definition.name !== folder) {
      console.warn(
        `[kavibay] Extension folder "${folder}" does not match defineExtension name "${definition.name}"`,
      );
    }

    const views = viewModules[`/extensions/${folder}/view.ts`] ?? {};
    const extensionIconComponent = extensionIcon(views);
    const declared = new Set((definition.contributes.widgets ?? []).map((w) => w.name));

    const widgets: BundledWidget[] = [];
    for (const [name, value] of Object.entries(asRecord(asRecord(raw).widgets))) {
      // Catches the drift the three separate host maps could not: a widget
      // renamed in extension.ts left the manifest entry pointing at nothing,
      // and the symptom was a catalog tile with default placement and no icon.
      if (!declared.has(name)) {
        throw new Error(
          `Extension "${folder}": manifest.json describes widget "${name}", which extension.ts does not contribute`,
        );
      }
      const entry = asRecord(value);
      widgets.push({
        name,
        replaces: typeof entry.replaces === "string" ? entry.replaces : undefined,
        catalog: toCatalogMetadata(entry),
        actions: toActionDeclarations(
          folder,
          name,
          entry.actions,
          (definition.contributes.widgets ?? []).find((w) => w.name === name)?.actions,
        ),
        view: widgetView(views, name)?.view,
        icon: widgetView(views, name)?.icon,
        menu: widgetView(views, name)?.menu,
        settings: widgetView(views, name)?.settings,
      });
    }

    const actions = toActionDeclarations(
      folder,
      "extension",
      manifestRecord.actions,
      definition.contributes.actions,
    );
    if (actions.some((action) => action.needsInstance !== false)) {
      throw new Error(
        `Extension "${folder}": standalone actions must declare needsInstance: false`,
      );
    }
    const standaloneActions: ExtensionActionDeclaration[] = actions.map((action) => ({
      ...action,
      needsInstance: false,
    }));

    found.push({
      folder,
      definition,
      widgets,
      actions: standaloneActions,
      catalog: toCatalogMetadata(manifestRecord),
      ...(typeof manifestRecord.icon === "string" ? { icon: manifestRecord.icon } : {}),
      ...(extensionIconComponent ? { iconComponent: extensionIconComponent } : {}),
      ...(resolveIconUrl(folder, manifestRecord.icon)
        ? { iconUrl: resolveIconUrl(folder, manifestRecord.icon) }
        : {}),
    });
  }

  return found.sort((a, b) => a.folder.localeCompare(b.folder));
}

export const bundledExtensions: BundledExtension[] = loadAll();
