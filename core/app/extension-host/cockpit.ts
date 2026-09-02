import { h, nextTick, reactive, ref, type Component } from "vue";
import type { ExtensionAction, RegisteredExtension } from "@sdk/types";
import type {
  ConfigField,
  WidgetDefinitionId,
  WidgetInstance,
} from "@sdk/contract/sdk";
import { ExtensionRegistry, bundledDefinitionId } from "./registry";
import { describeProvider, type ProviderSchema } from "@sdk/contract/providerSchema";
import { Host } from "./runtime";
import { type WidgetCall, JsonBridge } from "./bridge";
import type { GuestFault } from "@sdk/contract/sandbox-guest";
import { redactText } from "./redact";
import {
  WidgetPackageLoader,
  type WidgetPackageInstall,
  type WidgetPackageRow,
} from "./widgetPackageLoad";
import { createCommandUi } from "./commandUi";
import { tauriProviderTransport } from "./tauriProviderTransport";
import { tauriWidgetCapabilityTransport } from "./tauriWidgetCapabilityTransport";
import { bundledExtensions, type BundledExtension, type BundledWidget } from "./bundledExtensions";
import { widgetViews } from "./widgetViews";
import CockpitWidget from "./ui/CockpitWidget.vue";
import CockpitWidgetSettings from "./ui/CockpitWidgetSettings.vue";
import { useSettingsModal } from "../settings/useSettingsModal";

/**
 * Where the extension host meets the running app.
 *
 * Everything above this file is testable without a cockpit; everything below it
 * is the cockpit's own vocabulary. Keeping the seam here is what let Phases 1-3
 * be verified before any of this existed.
 *
 * The registry contains the contract definitions used by the running app. The
 * remaining fixtures stay available to the dev board and assertion suite.
 */

/**
 * The `Fetcher` is the in-process fallback and stays unused in the app: with a
 * transport present every provider request goes to Rust. It throws rather than
 * returning empty so a path that quietly avoided the broker would be loud.
 */
const noDirectNetwork = async () => {
  throw new Error("extension host: provider requests must go through the Rust broker");
};

/**
 * The command UI (Phase 5). `runCommand` awaits these and does not care what
 * draws them; `CommandHost.vue` renders whatever `commandUi.request` holds.
 */
export const commandUi = createCommandUi();

const registry = new ExtensionRegistry();

/**
 * Everything under `extensions/<id>/` written against the contract.
 *
 * `{ kind: "bundled" }` is the whole trust story and it is stated here rather
 * than in any of those folders — an extension cannot name itself into a tier
 * (invariant 1), and a manifest.json sitting next to a widget changes nothing
 * about that. It carries presentation only.
 *
 * `extensions/tado` is the real client, not `fixtures/tado`. They share ids and
 * never meet: the assert suite builds its own registry, the cockpit builds this
 * one.
 */
for (const extension of bundledExtensions) {
  registry.load(extension.definition, { kind: "bundled" });
}
const failedLinks = registry.link();
if (failedLinks.length > 0) {
  console.error("[extension-host] extensions failed to link:", failedLinks);
}
// Reported independently of linking. A refused extension — a duplicate id, a
// reserved namespace — links fine because it is not there at all, and the one
// symptom is a widget that is quietly absent from the catalog.
if (registry.errors.length > 0) {
  console.error("[extension-host] extensions refused at load:", registry.errors);
}

export const extensionHost = new Host(
  registry,
  noDirectNetwork,
  commandUi.ui,
  tauriProviderTransport,
  tauriWidgetCapabilityTransport,
  syncWizardRuntimePackages,
  (section, credentialType) => useSettingsModal().showSection(section, credentialType),
);

/**
 * Every loaded provider as plain data, for the Widget Wizard's picker and for
 * the block injected into its prompt.
 *
 * Derived here rather than read from `docs/provider-schema.md`: the generated
 * document exists for people, and a second reader of a generated file is a
 * second thing that can be stale. The app has the definitions already.
 *
 * Deliberately free of connection state — combine with
 * `extensionHost.providerStatus(id)` where that matters. A schema does not
 * change when an account connects, and mixing the two would make this
 * re-evaluate on every status tick for nothing.
 *
 * Carries no actions, by the shape of `ProviderSchema`. See `describeProvider`.
 */
export function providerSchemas(): ProviderSchema[] {
  return [...registry.providers.entries()]
    .map(([id, entry]) => describeProvider(id, entry.def))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

// --- widget packages -------------------------------------------------------

/**
 * One bridge for every sandboxed widget in the app.
 *
 * Shared safely because a bridge hands out one `BridgeConnection` per frame and
 * fixes its reach at that moment (finding 16). Two frames sharing this object
 * cannot address each other through it — that is the arity, not a check.
 */
export const widgetBridge = new JsonBridge(extensionHost);

/**
 * What widgets have asked the host to do, newest last.
 *
 * Capped rather than unbounded: this runs for every widget on the desk, not
 * only the one being debugged, and a log nobody reads must not grow forever.
 * A hundred is several minutes of a busy widget and more than any failure needs
 * — the call that broke is the last one, not the first.
 */
const CALL_LOG_LIMIT = 100;
export const widgetCalls = ref<WidgetCall[]>([]);
widgetBridge.onCall = (call) => {
  const next = [...widgetCalls.value, call];
  widgetCalls.value = next.length > CALL_LOG_LIMIT ? next.slice(-CALL_LOG_LIMIT) : next;
};

/**
 * What went wrong inside a widget's own frame, newest last.
 *
 * A second list rather than a second variant of `WidgetCall`, because the two
 * are not the same kind of fact: a call is something the host did and can
 * vouch for, a fault is something the guest says about itself. Keeping them
 * apart in storage and joining them by time for display means the panel can
 * show one sequence without the log pretending the host witnessed both.
 *
 * The message is redacted on the way in, not on the way out. A fault is free
 * text produced by widget code — `Failed to fetch …?token=abc` is the ordinary
 * shape of it — and the panel is the thing that ends up in screenshots.
 */
export interface WidgetFault {
  at: number;
  instanceId: string;
  source: GuestFault["source"];
  message: string;
  where?: string;
  stack?: string;
}

export const widgetFaults = ref<WidgetFault[]>([]);

export function reportWidgetFault(instanceId: string, fault: GuestFault) {
  const entry: WidgetFault = {
    at: Date.now(),
    instanceId,
    source: fault.source,
    message: redactText(fault.message),
    where: fault.where,
    stack: fault.stack === undefined ? undefined : redactText(fault.stack),
  };
  const next = [...widgetFaults.value, entry];
  widgetFaults.value = next.length > CALL_LOG_LIMIT ? next.slice(-CALL_LOG_LIMIT) : next;
}

widgetBridge.onFault = reportWidgetFault;

/** Drops the log for one instance, so a retry is read without its history. */
export function clearWidgetLog(instanceId?: string) {
  widgetCalls.value = instanceId
    ? widgetCalls.value.filter((call) => call.instanceId !== instanceId)
    : [];
  widgetFaults.value = instanceId
    ? widgetFaults.value.filter((fault) => fault.instanceId !== instanceId)
    : [];
}

const packages = new WidgetPackageLoader(registry);

/**
 * Bumped whenever the loaded set changes, for the same reason `statusTick`
 * exists: a component reading `packageDefinitionId` inside a `computed` needs
 * something reactive to depend on, or it caches whatever was true when the desk
 * first rendered — which, for a package approved a moment ago, is nothing.
 */
const packageTick = ref(0);

/**
 * Brings the host in line with what is installed and approved.
 *
 * Called from the package scan rather than at module load: a package's grant
 * lives in a file Rust owns, so there is nothing to read synchronously here.
 */
export function syncWidgetPackages(
  rows: readonly WidgetPackageRow[],
  installs: readonly WidgetPackageInstall[],
): void {
  packages.sync(rows, installs);
  packageTick.value += 1;
}

/**
 * Told when the wizard has changed what is installed.
 *
 * An inversion, not an import: the runtime registry that feeds the palette
 * already imports this module, so calling into it from here would be a cycle.
 *
 * Only the wizard path announces. `syncWidgetPackages` is also called *by* that
 * registry at the end of its own scan, and a listener on it would answer its
 * own notification for ever.
 */
const packagesChanged: (() => void)[] = [];

export function onWizardPackagesChanged(listener: () => void): void {
  packagesChanged.push(listener);
}

/**
 * Callback used by the reviewed wizard capability after package mutations.
 *
 * Two registries have to hear about a save, and they are not the same thing:
 * `syncWidgetPackages` holds the widget *definitions* a package mounts, while
 * the palette's catalog is built from the runtime registry's scan. Updating
 * only the first is why a widget saved in the wizard was not in the palette
 * until something else happened to rescan.
 */
function syncWizardRuntimePackages(rows: unknown, installs: unknown): void {
  if (!Array.isArray(rows) || !Array.isArray(installs)) return;
  syncWidgetPackages(
    rows as WidgetPackageRow[],
    installs as WidgetPackageInstall[],
  );
  for (const listener of packagesChanged) listener();
}

/** The widget definition a package mounts, or undefined when it did not load. */
export function packageDefinitionId(packageId: string): string | undefined {
  void packageTick.value;
  return packages.definitionOf(packageId);
}

/** Why an enabled package is showing no widget, in a sentence. */
export function packageRefusal(packageId: string): string | undefined {
  void packageTick.value;
  return packages.refusalOf(packageId);
}

/** Mount key: changes when the widget has to run `setup` again. */
export function packageMountKey(packageId: string): string | undefined {
  void packageTick.value;
  return packages.mountKeyOf(packageId);
}

// --- command visibility ----------------------------------------------------

/**
 * Bumped whenever a provider connects or disconnects, so the palette's
 * `computed` over `actions` re-evaluates. The getter below reads this ref
 * during that evaluation, which is what registers the dependency — without it
 * the palette would cache the command list from start-up forever.
 */
const statusTick = ref(0);

for (const providerId of registry.providers.keys()) {
  extensionHost.onStatusChange(providerId, () => {
    statusTick.value += 1;
  });
  // Connection state lives in the host process; pull it once at boot so a
  // credential stored in an earlier session does not hide its commands.
  void extensionHost.refreshProviderStatus(providerId);
}

/**
 * Deliberately not wrapped in a `computed`. The palette reads `actions` inside
 * its own computed, so the `statusTick` read below is what registers the
 * dependency; an intermediate computed only adds a second cache that has to be
 * invalidated correctly for the first one to see anything. `visibleCommands`
 * is a walk over a handful of entries — there is nothing here worth caching.
 */
function visibleCommandIds(): Set<string> {
  void statusTick.value;
  return new Set(extensionHost.visibleCommands());
}

// --- instance configuration ------------------------------------------------

/**
 * Widget config is the cockpit's to persist: the contract models it as data the
 * host hands in, and `ctx.data` is deliberately a different thing (see
 * data-store.ts). Same `kavibay:` convention, different key space.
 */
const CONFIG_PREFIX = "kavibay:widget-config:";

export function loadInstanceConfig(instanceId: string): Record<string, unknown> {
  if (typeof localStorage === "undefined") return {};
  const raw = localStorage.getItem(`${CONFIG_PREFIX}${instanceId}`);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function saveInstanceConfig(instanceId: string, values: Record<string, unknown>): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(`${CONFIG_PREFIX}${instanceId}`, JSON.stringify(values));
}

/**
 * One reactive config object per instance, shared by the widget and its
 * settings panel.
 *
 * Two copies loaded separately from storage would drift the moment either
 * wrote: the settings panel would save a new room and the mounted widget would
 * carry on with the old one until something happened to remount it.
 */
const liveConfigs = new Map<string, Record<string, unknown>>();

export function instanceConfig(instanceId: string): Record<string, unknown> {
  let config = liveConfigs.get(instanceId);
  if (!config) {
    config = reactive(loadInstanceConfig(instanceId));
    liveConfigs.set(instanceId, config);
  }
  return config;
}

/** Applies a change to the shared object and persists the result. */
export function updateInstanceConfig(instanceId: string, values: Record<string, unknown>): void {
  const config = instanceConfig(instanceId);
  Object.assign(config, values);
  saveInstanceConfig(instanceId, { ...config });
}

/** Clone config through the same seam as every other contract lifecycle hook. */
export function copyInstanceConfig(
  fromInstanceId: string,
  toInstanceId: string,
  schema: Record<string, ConfigField>,
): void {
  const source = instanceConfig(fromInstanceId);
  const defaults = Object.fromEntries(
    Object.entries(schema)
      .filter(([, field]) => field.default !== undefined)
      .map(([key, field]) => [key, field.default]),
  );
  const copy = reactive({ ...defaults, ...source });
  liveConfigs.set(toInstanceId, copy);
  saveInstanceConfig(toInstanceId, { ...copy });
}

/** Evict config memory and storage when the catalog instance is truly disposed. */
export function disposeInstanceConfig(instanceId: string): void {
  liveConfigs.delete(instanceId);
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(`${CONFIG_PREFIX}${instanceId}`);
}

// --- catalog entries -------------------------------------------------------

/**
 * One `RegisteredExtension` per widget definition, so the palette, the widget
 * catalog and the layout treat these exactly like every other first-party
 * widget. The id is the definition id (`kavibay.clock/clock`), which cannot
 * collide with a folder-named builtin because it contains a slash.
 */
/**
 * Catalog parity, read from each extension's own `manifest.json` instead of
 * from a table here.
 *
 * These two maps used to be written out by hand, and a port was not finished
 * until someone remembered to add a line to each. That is exactly the
 * bookkeeping that belongs next to the widget: an icon, a keyword and a default
 * size are facts about `extensions/clock`, not about the host.
 *
 * `replaces` is the catalog id a widget takes over from a shipping one. Keeping
 * the old id is what makes a replacement invisible — a placed tile stores
 * `typeId: "clock"` in the layout, so reusing it resolves every existing
 * instance to the new widget with no layout migration and no lost desks, and
 * `addWidget("clock")` keeps working for callers that never heard of the
 * contract. A widget without one is still a duplicate of a shipping widget and
 * stays out of a release build (see `extensionHostWidgets`).
 */
/**
 * Everything the manifest half of a bundled widget carries, under its definition
 * id — `replaces`, catalog metadata, icon, menu, and the action declarations.
 *
 * ONE MAP, ON PURPOSE. This was three (`REPLACES`, `CONTRACT_CATALOG_METADATA`,
 * `CONTRACT_ACTIONS`), each filled by its own line in the loop below, and the
 * action split added the third field to the type and the read site but never to
 * the loop. `Partial<Record<...>>` makes a map that is never written a legal
 * program, the read falls back to `[]`, and every declared action silently
 * vanished from the palette. Nothing caught it: this module reaches for
 * `import.meta.glob`, so it only executes under Vite and never in the assert
 * suite. Adding a field to a widget must not be something a loop can forget.
 */
const BUNDLED: Partial<Record<WidgetDefinitionId, BundledWidget>> = {};

for (const extension of bundledExtensions) {
  for (const widget of extension.widgets) {
    BUNDLED[bundledDefinitionId(extension.definition.name, widget.name) as WidgetDefinitionId] = widget;
  }
}

function toRegistered(definitionId: string): RegisteredExtension | undefined {
  const found = registry.widget(definitionId);
  if (!found) return undefined;
  const { widget, ext } = found;
  const bundled = BUNDLED[definitionId as WidgetDefinitionId];
  const catalogId = bundled?.replaces ?? definitionId;
  const metadata = bundled?.catalog ?? {};

  // Closes over the definition id; the instance id is injected by the host at
  // mount, which is the same contract every builtin widget already uses.
  const component: Component = {
    name: `ExtensionHost(${definitionId})`,
    setup: () => () => h(CockpitWidget, { definitionId }),
  };

  // The gear, for widgets that declare configuration. Without it the gate's
  // form is a one-way door: asked once, never reachable again.
  const settingsComponent: Component | undefined = bundled?.settings ?? (widget.configuration
    ? {
        name: `ExtensionHostSettings(${definitionId})`,
        setup: () => () => h(CockpitWidgetSettings, { definitionId }),
      }
    : undefined);

  // Declared in the manifest, implemented in the definition, paired by
  // `bundledExtensions.ts` — which refuses either half without the other.
  const localActions = bundled?.actions ?? [];
  const actions: ExtensionAction[] = localActions.map((action) => ({
    id: action.id,
    title: action.title,
    ...(action.subtitle ? { subtitle: action.subtitle } : {}),
    keywords: [...(action.keywords ?? [])],
    params: [...(action.params ?? [])],
    needsInstance: action.needsInstance !== false,
    ...(action.replacesCatalogRow ? { replacesCatalogRow: true } : {}),
  }));
  const actionHandlers = Object.fromEntries(
    localActions.map((action) => [
      action.id,
      async ({ instanceId, args }: { instanceId: string; args: Record<string, string> }) => {
        const instance: WidgetInstance = {
          id: instanceId,
          definitionId,
          configuration: instanceId ? instanceConfig(instanceId) : {},
          position: { x: 0, y: 0 },
          size: { w: widget.defaultSize.w, h: widget.defaultSize.h },
          mode: "expanded",
        };
        await widget.actions![action.id]({
          ctx: extensionHost.buildWidgetContext(instance),
          args,
          setConfig: (values) => {
            if (instanceId) updateInstanceConfig(instanceId, values);
          },
        });
      },
    ]),
  );

  return {
    id: catalogId,
    // Contract implementation details stay out of the user-facing catalog.
    // The internal definition id still distinguishes dev-only duplicates.
    title: widget.displayName,
    description: widget.description ?? ext.manifest.displayName,
    version: ext.version,
    author: ext.manifest.author ?? "Kavibay",
    keywords: [...(metadata.keywords ?? [])],
    categories: [...(metadata.categories ?? [])],
    isWidget: true,
    iconComponent: bundled?.icon,
    menuComponent: bundled?.menu,
    position: metadata.position ? { ...metadata.position } : { x: 0, y: 0 },
    defaultSize: metadata.defaultSize
      ? { ...metadata.defaultSize }
      : { w: widget.defaultSize.w * 120, h: widget.defaultSize.h * 90 },
    allowDuplicate: metadata.allowDuplicate ?? true,
    flush: metadata.flush ?? false,
    compact: metadata.compact ?? false,
    defaultHideTitle: metadata.defaultHideTitle ?? false,
    defaultScale: metadata.defaultScale ?? 1,
    grabCursor: metadata.grabCursor ?? true,
    fullDrag: metadata.fullDrag ?? false,
    resizable: metadata.resizable ?? true,
    playground: metadata.playground ?? false,
    hugHeight: metadata.hugHeight ?? false,
    opaque: metadata.opaque ?? false,
    keepAliveWhenHidden: metadata.keepAliveWhenHidden ?? false,
    permissions: [],
    commands: [],
    actions,
    actionHandlers,
    ...(widget.dynamicActionParams ? { dynamicActionParams: widget.dynamicActionParams } : {}),
    component,
    settingsComponent,
    inlineView: widget.palette?.inlineView,
    searchText: widget.palette?.searchText,
    instanceActions: widget.palette?.instanceActions,
    onDuplicate:
      widget.configuration || widget.duplicateData
        ? (fromId, toId) => {
            if (widget.configuration) {
              copyInstanceConfig(fromId, toId, widget.configuration);
            }
            if (widget.duplicateData) {
              extensionHost.data.clone(fromId, toId, widget.duplicateDataTransform);
            }
          }
        : undefined,
    onDispose: (instanceId) => {
      if (widget.configuration) disposeInstanceConfig(instanceId);
      // Layout disposal runs before Vue has unmounted the card. Waiting for
      // that flush prevents a widget's onScopeDispose handoff from recreating
      // data after the host evicted it.
      void nextTick().then(() => extensionHost.data.evict(instanceId));
    },
  };
}

/**
 * One catalog entry per extension that contributes commands, carrying its
 * commands as palette actions.
 *
 * `isWidget: false` is what puts them in the palette's action rows at all — it
 * filters on exactly that. `needsInstance: false` because a command is not
 * attached to a widget; `join-next-meeting` has none.
 *
 * `params` stays empty and the runtime asks instead. The palette's argument
 * chips are declared at load with fixed `enum` options, and a provider-sourced
 * argument has none until its account is connected (finding 3). Declaring them
 * up front would mean showing an empty list or a stale one.
 *
 * `actions` is a getter rather than an array. Command visibility is dynamic — a
 * disconnected provider hides its commands — and a getter that reads
 * `visibleCommandIds` during the palette's own `computed` makes that dependency
 * real. The alternative was mutating an array behind a reader's back, which
 * works only for as long as nobody caches it.
 */
function toCommandEntry(extensionId: string): RegisteredExtension | undefined {
  const ext = registry.extensions.get(extensionId);
  if (!ext || ext.commands.size === 0) return undefined;

  const handlers: Record<string, () => Promise<void>> = {};
  for (const commandId of ext.commands.keys()) {
    handlers[commandId] = () => extensionHost.runCommand(commandId);
  }

  return {
    id: `${extensionId}#commands`,
    title: ext.manifest.displayName,
    description: ext.manifest.description ?? ext.manifest.displayName,
    version: ext.version,
    author: ext.manifest.author ?? "Kavibay",
    keywords: [],
    categories: [],
    isWidget: false,
    position: { x: 0, y: 0 },
    defaultSize: { w: 0, h: 0 },
    allowDuplicate: false,
    flush: false,
    compact: false,
    defaultHideTitle: false,
    defaultScale: 1,
    grabCursor: false,
    fullDrag: false,
    resizable: false,
    playground: false,
    hugHeight: false,
    opaque: false,
    keepAliveWhenHidden: false,
    permissions: [],
    commands: [],
    actions: [],
    actionHandlers: handlers,
  };
}

/**
 * Standalone contract actions keep the old palette surface without pretending
 * to be widgets. Their declarations live in manifest.json and their handlers
 * in extension.ts, then this adapter exposes the existing palette row shape.
 */
function toActionEntry(extension: BundledExtension): RegisteredExtension | undefined {
  if (extension.actions.length === 0) return undefined;

  const handlers: RegisteredExtension["actionHandlers"] = Object.fromEntries(
    extension.actions.map((action) => [
      action.id,
      async ({ args }: { instanceId: string; args: Record<string, string> }) => {
        const handler = extension.definition.contributes.actions?.[action.id];
        if (!handler) {
          throw new Error(`missing handler for standalone action ${extension.folder}.${action.id}`);
        }
        await handler({ args });
      },
    ]),
  );

  return {
    id: extension.folder,
    title: extension.definition.displayName,
    description: extension.definition.description ?? extension.definition.displayName,
    version: extension.definition.version,
    author: extension.definition.author ?? "Kavibay",
    keywords: [...(extension.catalog.keywords ?? [])],
    categories: [...(extension.catalog.categories ?? [])],
    isWidget: false,
    icon: extension.icon,
    iconComponent: extension.iconComponent,
    iconUrl: extension.iconUrl,
    position: { x: 0, y: 0 },
    defaultSize: { w: 0, h: 0 },
    allowDuplicate: false,
    flush: false,
    compact: false,
    defaultHideTitle: false,
    defaultScale: 1,
    grabCursor: false,
    fullDrag: false,
    resizable: false,
    playground: false,
    hugHeight: false,
    opaque: false,
    keepAliveWhenHidden: false,
    permissions: [],
    commands: [],
    actions: extension.actions.map((action) => ({
      id: action.id,
      title: action.title,
      ...(action.subtitle ? { subtitle: action.subtitle } : {}),
      keywords: [...(action.keywords ?? [])],
      params: [...(action.params ?? [])],
      needsInstance: false,
    })),
    actionHandlers: handlers,
  };
}

/** Replaces the static `actions` with one that tracks provider status. */
function withLiveActions(entry: RegisteredExtension, extensionId: string): RegisteredExtension {
  const ext = registry.extensions.get(extensionId)!;
  return Object.defineProperty(entry, "actions", {
    enumerable: true,
    get(): ExtensionAction[] {
      const visible = visibleCommandIds();
      return [...ext.commands.entries()]
        .filter(([commandId]) => visible.has(commandId))
        .map(([commandId, command]) => ({
          id: commandId,
          title: command.title,
          subtitle: ext.manifest.displayName,
          keywords: command.keywords ?? [],
          params: [],
          needsInstance: false,
        }));
    },
  });
}

/**
 * Widgets and commands the extension host contributes to the cockpit catalog.
 *
 * DEV ONLY for definitions that have not replaced a shipping widget. Todo and
 * `kavibay.tado/temperature` duplicates a *working* Tado integration with one
 * that cannot fetch at all (finding 13). Two "Clock" entries in the palette is
 * a worse product, and a broken Tado beside a working one is worse still.
 *
 * The mapping below is not scaffolding waiting to be used — it is exercised
 * every time the app runs in development, which is what keeps it honest. What
 * it deliberately does not do is ship a second copy of a widget to a user.
 *
 * Migration fills this in the other direction: when a real widget moves to the
 * contract, its old folder goes away in the same change, so the catalog never
 * carries both.
 */
export function extensionHostWidgets(): RegisteredExtension[] {
  // A widget that has replaced a shipping one ships too — it is the only copy
  // now. The rest are still duplicates and stay in development.
  const definitions = Object.keys(widgetViews).filter(
    (definitionId) => import.meta.env.DEV || Boolean(BUNDLED[definitionId as WidgetDefinitionId]?.replaces),
  );

  const widgets = definitions
    .map(toRegistered)
    .filter((entry): entry is RegisteredExtension => entry !== undefined);

  const standaloneActions = bundledExtensions
    .map(toActionEntry)
    .filter((entry): entry is RegisteredExtension => entry !== undefined);

  const commands = (import.meta.env.DEV ? [...registry.extensions.keys()] : [])
    .map((id) => {
      const entry = toCommandEntry(id);
      return entry ? withLiveActions(entry, id) : undefined;
    })
    .filter((entry): entry is RegisteredExtension => entry !== undefined);

  return [...widgets, ...standaloneActions, ...commands];
}
