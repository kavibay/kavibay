import type {
  ActionParam,
  ExtensionAction,
  ExtensionActionContext,
  ExtensionActionHandler,
  ExtensionManifest,
  ExtensionModule,
  RegisteredExtension,
} from "@sdk/types";
import { isSafeExtensionIconPath } from "./extensionIcon";
import { DEFAULT_CONTENT_SCALE, clampContentScale } from "../host/resizeLogic";
import { extensionHostWidgets } from "../extension-host/cockpit";
import { isContractManifest } from "../extension-host/bundledExtensions";
import { copyConnections, disposeConnections } from "../settings/credentials/connections";

/**
 * Discover first-party extensions via Vite glob.
 * Pairing key is the folder segment under extensions/<folder>/.
 */

const manifestModules = import.meta.glob("/extensions/*/manifest.json", {
  eager: true,
  import: "default",
}) as Record<string, ExtensionManifest>;

const extensionModules = import.meta.glob("/extensions/*/index.ts", {
  eager: true,
  import: "default",
}) as Record<string, ExtensionModule>;

/**
 * Short bundled documentation shown by the generic widget About dialog.
 *
 * The only lazy glob of the four, and deliberately so: this is prose nobody
 * reads at start-up, but eagerly it put one request per extension (~25) on the
 * boot path — in dev the slowest entries in the whole waterfall. Loading it
 * when the dialog opens costs a single fetch of an already-local chunk.
 */
const readmeModules = import.meta.glob("/extensions/*/README.md", {
  query: "?raw",
  import: "default",
}) as Record<string, () => Promise<string>>;

/** Bundled icon assets referenced by manifest.icon (folder-root or nested). */
const iconUrlModules = import.meta.glob("/extensions/**/*.{svg,png}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

/** Resolve manifest.icon to a Vite URL, or undefined when missing/unsafe/unbundled. */
function resolveBuiltinIconUrl(folder: string, icon?: string): string | undefined {
  if (!icon || !isSafeExtensionIconPath(icon)) return undefined;
  const key = `/extensions/${folder}/${icon}`;
  return iconUrlModules[key];
}

/** Extract `extensions/<folder>` from a glob path. */
function folderFromGlobPath(path: string): string {
  const match = path.match(/extensions\/([^/]+)\//);
  if (!match) {
    throw new Error(`Extension path not recognized: ${path}`);
  }
  return match[1];
}

/** Validate required manifest fields; throw with a clear reason. */
function assertManifest(folder: string, raw: unknown): ExtensionManifest {
  if (!raw || typeof raw !== "object") {
    throw new Error(`Extension "${folder}": manifest.json is missing or invalid`);
  }
  const m = raw as Partial<ExtensionManifest>;
  const required = ["id", "name", "description", "version", "author"] as const;
  for (const key of required) {
    if (typeof m[key] !== "string" || !m[key]) {
      throw new Error(`Extension "${folder}": manifest.${key} must be a non-empty string`);
    }
  }
  if (!Array.isArray(m.keywords)) {
    throw new Error(`Extension "${folder}": manifest.keywords must be an array`);
  }
  if (!Array.isArray(m.categories)) {
    throw new Error(`Extension "${folder}": manifest.categories must be an array`);
  }
  if (!Array.isArray(m.commands)) {
    throw new Error(`Extension "${folder}": manifest.commands must be an array`);
  }
  if (!Array.isArray(m.permissions)) {
    throw new Error(`Extension "${folder}": manifest.permissions must be an array`);
  }
  if (!m.ui || typeof m.ui !== "object" || !m.ui.defaultOffset) {
    throw new Error(`Extension "${folder}": manifest.ui.defaultOffset is required`);
  }
  const { x, y } = m.ui.defaultOffset;
  if (typeof x !== "number" || typeof y !== "number") {
    throw new Error(`Extension "${folder}": manifest.ui.defaultOffset must be {x,y} numbers`);
  }
  const ds = m.ui.defaultSize;
  if (
    !ds ||
    typeof ds !== "object" ||
    typeof ds.w !== "number" ||
    typeof ds.h !== "number" ||
    !(ds.w > 0) ||
    !(ds.h > 0)
  ) {
    throw new Error(
      `Extension "${folder}": manifest.ui.defaultSize must be {w,h} positive numbers`,
    );
  }
  const scale = m.ui.defaultScale;
  if (scale !== undefined && (typeof scale !== "number" || !Number.isFinite(scale) || scale <= 0)) {
    throw new Error(
      `Extension "${folder}": manifest.ui.defaultScale must be a positive number`,
    );
  }
  return m as ExtensionManifest;
}

/** Validate the default export from index.ts. */
function assertModule(folder: string, raw: unknown): ExtensionModule {
  if (!raw || typeof raw !== "object") {
    throw new Error(`Extension "${folder}": index.ts must default-export an ExtensionModule`);
  }
  return raw as ExtensionModule;
}

/** Drop obviously broken params instead of failing the whole extension. */
function normalizeParams(folder: string, raw: unknown): ActionParam[] {
  if (!Array.isArray(raw)) return [];
  const out: ActionParam[] = [];

  for (const item of raw) {
    const param = item as Partial<ActionParam>;
    if (!param || typeof param.name !== "string" || param.name.length === 0) {
      console.warn(`[kavibay] Extension "${folder}": action param without a name — skipped`);
      continue;
    }
    const type =
      param.type === "number" || param.type === "enum" ? param.type : "text";
    out.push({
      name: param.name,
      type,
      required: param.required === true,
      ...(typeof param.placeholder === "string" ? { placeholder: param.placeholder } : {}),
      ...(Array.isArray(param.options)
        ? { options: param.options.filter((o): o is string => typeof o === "string") }
        : {}),
    });
  }

  return out;
}

/**
 * Normalize manifest actions and pair them with their handlers.
 * Fails soft: a malformed or handler-less action is dropped with a warning so a
 * broken declaration can never produce a dead palette row.
 */
function normalizeActions(
  folder: string,
  manifest: ExtensionManifest,
  mod: ExtensionModule,
): { actions: ExtensionAction[]; actionHandlers: Record<string, ExtensionActionHandler> } {
  const declared = Array.isArray(manifest.actions) ? manifest.actions : [];
  const handlers = mod.actions ?? {};

  const actions: ExtensionAction[] = [];
  const actionHandlers: Record<string, ExtensionActionHandler> = {};

  for (const raw of declared) {
    const action = raw as Partial<ExtensionAction>;
    if (typeof action?.id !== "string" || typeof action?.title !== "string") {
      console.warn(`[kavibay] Extension "${folder}": action without id/title — skipped`);
      continue;
    }
    const handler = handlers[action.id];
    if (typeof handler !== "function") {
      console.warn(
        `[kavibay] Extension "${folder}": action "${action.id}" has no handler in index.ts — skipped`,
      );
      continue;
    }
    actions.push({
      id: action.id,
      title: action.title,
      ...(typeof action.subtitle === "string" ? { subtitle: action.subtitle } : {}),
      keywords: Array.isArray(action.keywords)
        ? action.keywords.filter((k): k is string => typeof k === "string")
        : [],
      params: normalizeParams(folder, action.params),
      needsInstance: action.needsInstance !== false,
    });
    actionHandlers[action.id] = handler;
  }

  for (const id of Object.keys(handlers)) {
    if (!actionHandlers[id]) {
      console.warn(
        `[kavibay] Extension "${folder}": handler "${id}" is not declared in manifest.actions — ignored`,
      );
    }
  }

  return { actions, actionHandlers };
}

/** Merge one manifest + module into the runtime registry shape. */
function toRegistered(
  folder: string,
  manifest: ExtensionManifest,
  mod: ExtensionModule,
): RegisteredExtension {
  if (folder !== manifest.id) {
    console.warn(
      `[kavibay] Extension folder "${folder}" does not match manifest.id "${manifest.id}"`,
    );
  }
  const { actions, actionHandlers } = normalizeActions(folder, manifest, mod);
  const isWidget = manifest.ui.widget !== false;
  if (isWidget && !mod.component) {
    throw new Error(`Extension "${folder}": ExtensionModule.component is required for widgets`);
  }
  if (!isWidget && actions.some((action) => action.needsInstance !== false)) {
    throw new Error(`Extension "${folder}": action-only extensions require needsInstance: false`);
  }
  return {
    id: manifest.id,
    title: manifest.name,
    description: manifest.description,
    loadReadme: readmeModules[`/extensions/${folder}/README.md`],
    version: manifest.version,
    author: manifest.author,
    keywords: [...manifest.keywords],
    categories: [...manifest.categories],
    isWidget,
    icon: manifest.icon,
    iconUrl: resolveBuiltinIconUrl(folder, manifest.icon),
    position: { ...manifest.ui.defaultOffset },
    defaultSize: { w: manifest.ui.defaultSize.w, h: manifest.ui.defaultSize.h },
    allowDuplicate: manifest.ui.allowDuplicate !== false,
    flush: Boolean(manifest.ui.flush),
    ...(manifest.ui.padding === false ? { padding: false } : {}),
    compact: Boolean(manifest.ui.compact),
    defaultHideTitle: Boolean(manifest.ui.defaultHideTitle),
    // Out-of-range values clamp instead of failing the load — a manifest asking
    // for 10x is a typo, not a reason to drop the whole extension.
    defaultScale:
      typeof manifest.ui.defaultScale === "number"
        ? clampContentScale(manifest.ui.defaultScale)
        : DEFAULT_CONTENT_SCALE,
    grabCursor: manifest.ui.grabCursor !== false,
    fullDrag: Boolean(manifest.ui.fullDrag),
    resizable: manifest.ui.resizable !== false,
    playground: Boolean(manifest.ui.playground),
    hugHeight: Boolean(manifest.ui.hugHeight),
    opaque: Boolean(manifest.ui.opaque),
    keepAliveWhenHidden: Boolean(manifest.ui.keepAliveWhenHidden),
    commands: [...manifest.commands],
    actions,
    actionHandlers,
    ...(mod.dynamicActionParams ? { dynamicActionParams: mod.dynamicActionParams } : {}),
    permissions: [...manifest.permissions],
    component: mod.component,
    iconComponent: mod.iconComponent,
    inlineView: mod.inlineView,
    instanceActions: mod.instanceActions,
    settingsComponent: mod.settingsComponent,
    menuComponent: mod.menuComponent,
    backendCommand: mod.backendCommand,
    refreshInterval: mod.refreshInterval,
    onCreate: mod.onCreate,
    onDuplicate: mod.onDuplicate,
    onSuspend: mod.onSuspend,
    onResume: mod.onResume,
    onDispose: mod.onDispose,
  };
}

/** Load, validate, and merge all first-party extensions (eager at module init). */
function loadAll(): RegisteredExtension[] {
  const byFolder = new Map<
    string,
    { manifest?: ExtensionManifest; module?: ExtensionModule; manifestPath?: string }
  >();

  for (const [path, raw] of Object.entries(manifestModules)) {
    // Contract extensions share this folder during the migration and are read
    // by `bundledExtensions.ts` instead. Skipped before `assertManifest`,
    // because they have neither the old manifest's required fields nor an
    // `index.ts` — both of which are a hard throw a few lines down.
    if (isContractManifest(raw)) continue;
    const folder = folderFromGlobPath(path);
    const entry = byFolder.get(folder) ?? {};
    entry.manifest = assertManifest(folder, raw);
    entry.manifestPath = path;
    byFolder.set(folder, entry);
  }

  for (const [path, raw] of Object.entries(extensionModules)) {
    const folder = folderFromGlobPath(path);
    const entry = byFolder.get(folder) ?? {};
    entry.module = assertModule(folder, raw);
    byFolder.set(folder, entry);
  }

  if (byFolder.size === 0) {
    // A clean contract-only build has no legacy manifest/index pairs. The
    // contract registry is merged immediately below, so an empty legacy tier
    // is valid and must not abort application startup.
    return [];
  }

  const registered: RegisteredExtension[] = [];
  const seenIds = new Set<string>();

  for (const [folder, entry] of byFolder) {
    if (!entry.manifest) {
      throw new Error(`Extension "${folder}": missing manifest.json`);
    }
    if (!entry.module) {
      throw new Error(`Extension "${folder}": missing index.ts`);
    }
    if (seenIds.has(entry.manifest.id)) {
      throw new Error(`Duplicate extension id "${entry.manifest.id}"`);
    }
    seenIds.add(entry.manifest.id);
    registered.push(toRegistered(folder, entry.manifest, entry.module));
  }

  registered.sort((a, b) => a.id.localeCompare(b.id));
  return registered;
}

/**
 * Folder-discovered first-party extensions, plus the ones the extension host
 * contributes. Both arrive as `RegisteredExtension`, so nothing downstream —
 * palette, catalog, layout, hooks — needs to know which tier a widget came
 * from. That is the same reason runtime packages adapt to `HostExtensionRef`
 * rather than getting their own branch in the host.
 */
const extensionRegistry: RegisteredExtension[] = [...loadAll(), ...extensionHostWidgets()].sort(
  (a, b) => a.id.localeCompare(b.id),
);

/** Full catalog (sorted by id). */
export function listExtensions(): RegisteredExtension[] {
  return extensionRegistry;
}

/** Lookup by manifest id. */
export function getExtension(id: string): RegisteredExtension | undefined {
  return extensionRegistry.find((ext) => ext.id === id);
}

/**
 * Simple keyword search over name, id, keywords, and description.
 * Empty query returns the full list.
 */
export function searchExtensions(query: string): RegisteredExtension[] {
  const q = query.trim().toLowerCase();
  if (!q) return listExtensions();
  return extensionRegistry.filter((ext) => {
    const hay = [ext.id, ext.title, ext.description, ...ext.keywords]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

/** Safe lifecycle call — one bad hook must not break the host. */
export function runExtensionHook(
  ext: RegisteredExtension | undefined,
  hook: "onCreate" | "onSuspend" | "onResume" | "onDispose",
  instanceId: string,
): void {
  if (hook === "onDispose") void disposeConnections(instanceId).catch(console.error);
  if (!ext) return;
  const fn = ext[hook];
  if (!fn) return;
  try {
    fn(instanceId);
  } catch (err) {
    console.error(`[kavibay] Extension "${ext.id}" ${hook} failed:`, err);
  }
}

/**
 * Safe action call — returns false when the action is unknown or the handler
 * throws, so the palette can stay open instead of pretending it worked.
 */
export async function runExtensionAction(
  ext: RegisteredExtension | undefined,
  actionId: string,
  ctx: ExtensionActionContext,
): Promise<boolean> {
  const handler = ext?.actionHandlers[actionId];
  if (!handler) {
    console.warn(`[kavibay] Unknown action "${actionId}" on extension "${ext?.id ?? "?"}"`);
    return false;
  }
  try {
    await handler(ctx);
    return true;
  } catch (err) {
    console.error(`[kavibay] Extension "${ext!.id}" action "${actionId}" failed:`, err);
    return false;
  }
}

/** Safe onDuplicate lifecycle call. */
export async function runDuplicateHook(
  ext: RegisteredExtension | undefined,
  fromInstanceId: string,
  toInstanceId: string,
): Promise<void> {
  const copied = copyConnections(fromInstanceId, toInstanceId);
  if (!ext?.onDuplicate) { await copied; return; }
  try {
    ext.onDuplicate(fromInstanceId, toInstanceId);
  } catch (err) {
    console.error(`[kavibay] Extension "${ext.id}" onDuplicate failed:`, err);
  }
  await copied;
}
