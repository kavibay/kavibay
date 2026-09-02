import type { Component } from "vue";
import type { ExtensionManifest, WidgetDefinition } from "@sdk/contract/sdk";
import type { ExtensionViews } from "@sdk/contract/sdk-vue";

import clockExtension from "../../../extensions/clock/extension";
import clockViews from "../../../extensions/clock/view";
import clockManifest from "../../../extensions/clock/manifest.json";

import todoExtension from "../../../extensions/todo/extension";
import todoViews from "../../../extensions/todo/view";
import todoManifest from "../../../extensions/todo/manifest.json";

import calculatorExtension from "../../../extensions/calculator/extension";
import calculatorViews from "../../../extensions/calculator/view";
import calculatorManifest from "../../../extensions/calculator/manifest.json";

import stopwatchExtension from "../../../extensions/stopwatch/extension";
import stopwatchViews from "../../../extensions/stopwatch/view";
import stopwatchManifest from "../../../extensions/stopwatch/manifest.json";

import pomodoroExtension from "../../../extensions/pomodoro/extension";
import pomodoroViews from "../../../extensions/pomodoro/view";
import pomodoroManifest from "../../../extensions/pomodoro/manifest.json";

import timerExtension from "../../../extensions/timer/extension";
import timerViews from "../../../extensions/timer/view";
import timerManifest from "../../../extensions/timer/manifest.json";

import redactedExtension from "../../../extensions/redacted/extension";
import redactedViews from "../../../extensions/redacted/view";
import redactedManifest from "../../../extensions/redacted/manifest.json";

import timeTrackerExtension from "../../../extensions/time-tracker/extension";
import timeTrackerViews from "../../../extensions/time-tracker/view";
import timeTrackerManifest from "../../../extensions/time-tracker/manifest.json";


/**
 * The widgets this package can mount, listed one by one.
 *
 * WHY A HAND-WRITTEN LIST AND NOT THE APP'S REGISTRY:
 *
 * `bundledExtensions.ts` finds extensions with two eager globs, which is right
 * for an app that ships all of them and fatal for a page that ships a few: it
 * pulls every extension and about a megabyte of tiptap along with them.
 * `scripts/embedImportGuard.assert.mjs` refuses that import, so this file names
 * its entries instead and pays for exactly what it shows.
 *
 * WHAT IS AND IS NOT REUSED:
 *
 * Everything. Each entry is the shipping `extension.ts`, the shipping
 * `view.ts` and the shipping `manifest.json` — the same three files the app
 * assembles a widget from. Nothing here re-declares a default size, a title or
 * a card option; if a manifest changes, this page changes with it.
 *
 * ADMISSION RULE — a widget belongs here only when it needs neither the
 * operating system nor a network call:
 *
 *   - no `capabilities` that a browser cannot answer (clipboard, launcher,
 *     colorPicker, focusTracker, nowPlaying, systemInfo, image, alarm,
 *     notification, aiUsage, wizard)
 *   - no `requires.providers`, no `http`, no `endpoint`
 *
 * "Cannot answer" is the test, not "is a capability". Snake declares
 * `openExternal` and is in: opening a link is what a browser does, and
 * `browserCapabilityTransport` answers it with `window.open`.
 *
 * Those widgets are not "not ported yet"; they are widgets whose whole point
 * is a machine this page does not have. A store preview shows them through
 * the sandbox path with fixture data instead — that is L2's job.
 *
 * THE ONE EXCEPTION — the Widget Wizard:
 *
 * It declares `capabilities: { wizard: true }`, so by the rule above it does
 * not belong here. It is admitted because what it shows is a conversation, and
 * a conversation can be replayed truthfully: `wizardFixture.ts` answers from a
 * script, no model is called, and its drafts live in memory. The page that
 * mounts it has to say so — a visitor must not believe they watched a model
 * write a widget when they watched a recording.
 *
 * Nothing else gets this treatment. The clipboard cannot be replayed, because
 * a scripted clipboard is a screenshot of someone else's data.
 *
 * Weight decides eager or lazy, never in or out: `notes` carries Tiptap and
 * ProseMirror and `widget-wizard` is 350 KB of source, so both load through
 * `LAZY` below. `moodist` is still absent — its audio is tens of megabytes,
 * which is a hosting question rather than a bundling one.
 */
export interface EmbedWidgetUi {
  defaultSize?: { w: number; h: number };
  defaultHideTitle?: boolean;
  allowDuplicate?: boolean;
  flush?: boolean;
  compact?: boolean;
  opaque?: boolean;
  fullDrag?: boolean;
  hugHeight?: boolean;
  playground?: boolean;
  grabCursor?: boolean;
}

export interface EmbedWidget {
  /** Widget name as the manifest spells it; the `definition` attribute. */
  name: string;
  /** Extension name, needed to address the widget in the registry. */
  extensionName: string;
  /** Card title, from the manifest's display name. */
  title: string;
  definition: WidgetDefinition;
  view: Component;
  menu?: Component;
  ui: EmbedWidgetUi;
}

type ManifestWidgets = Record<string, { ui?: EmbedWidgetUi; displayName?: string }>;

/** The shape `entries` reads off a shipping `extension.ts` default export. */
type EmbedExtension = ExtensionManifest & {
  contributes?: { widgets?: WidgetDefinition[] };
};

/**
 * One extension's widgets, assembled the way the host assembles them: the
 * definition from `contributes.widgets`, the component from `view.ts`, the
 * card options from the manifest.
 */
function entries(
  extension: EmbedExtension,
  views: ExtensionViews,
  manifest: unknown,
): EmbedWidget[] {
  const widgets = (manifest as ExtensionManifest & { widgets?: ManifestWidgets }).widgets ?? {};
  const out: EmbedWidget[] = [];

  for (const definition of extension.contributes?.widgets ?? []) {
    const entry = views[definition.name];
    // An action view carries no component; only widget views can be mounted.
    if (!entry || !("view" in entry) || !entry.view) continue;

    out.push({
      name: definition.name,
      extensionName: extension.name,
      title: widgets[definition.name]?.displayName ?? definition.displayName,
      definition,
      view: entry.view as Component,
      menu: "menu" in entry ? (entry.menu as Component | undefined) : undefined,
      ui: widgets[definition.name]?.ui ?? {},
    });
  }

  return out;
}

/**
 * The extensions the host registry loads. Same objects the entries above are
 * built from, so a widget can never be in the catalog without its extension
 * being registered.
 */
export const EMBED_EXTENSIONS: EmbedExtension[] = [
  clockExtension,
  todoExtension,
  calculatorExtension,
  stopwatchExtension,
  pomodoroExtension,
  timerExtension,
  redactedExtension,
  timeTrackerExtension,
];

const ALL: EmbedWidget[] = [
  ...entries(clockExtension, clockViews, clockManifest),
  ...entries(todoExtension, todoViews, todoManifest),
  ...entries(calculatorExtension, calculatorViews, calculatorManifest),
  ...entries(stopwatchExtension, stopwatchViews, stopwatchManifest),
  ...entries(pomodoroExtension, pomodoroViews, pomodoroManifest),
  ...entries(timerExtension, timerViews, timerManifest),
  ...entries(redactedExtension, redactedViews, redactedManifest),
  ...entries(timeTrackerExtension, timeTrackerViews, timeTrackerManifest),
];

const BY_NAME = new Map(ALL.map((widget) => [widget.name, widget]));

/**
 * Widgets fetched only by the pages that show them.
 *
 * Everything above is imported eagerly, which is right for a few kilobytes of
 * clock. The Wizard is 350 KB of source and would ride along on a page that
 * shows none of it — measured: 72 KB gzip became 116. A loader keyed by name
 * keeps the decision in one table instead of scattering `import()` calls.
 *
 * `main.ts` resolves these *before* it defines the custom element, so
 * `embedWidget` stays synchronous and every mount finds a complete catalog.
 * The consequence, stated because it is a real limit: an element added to the
 * page after that point with a lazy `definition` finds nothing and renders the
 * broken-widget placeholder.
 */
const LAZY: Record<string, () => Promise<{ default: LazyModule }>> = {
  "widget-wizard": () => import("./lazyWizard"),
  notes: () => import("./lazyNotes"),
  "emoji-picker": () => import("./lazyEmoji"),
  snake: () => import("./lazySnake"),
  gallery: () => import("./lazyGallery"),
};

interface LazyModule {
  extension: EmbedExtension;
  views: ExtensionViews;
  manifest: unknown;
  /**
   * Extensions to put in the registry without putting them on screen.
   *
   * The Widget Wizard needs this: it lists every provider the host knows, and
   * the host reads that straight off its registry. Those extensions also
   * contribute widgets, and none of them belongs in this catalog — they fetch,
   * and this package refuses to. Registered, not mountable.
   */
  providers?: EmbedExtension[];
}

/** Names this package can mount but has not loaded yet. */
export function lazyWidgetNames(): string[] {
  return Object.keys(LAZY).filter((name) => !BY_NAME.has(name));
}

/**
 * Load one lazy widget and fold it into the catalog.
 *
 * Idempotent, and safe to call for a name that is already there or is not
 * lazy at all — the caller is a page scan, not a curated list.
 */
export async function loadLazyWidget(name: string): Promise<void> {
  if (BY_NAME.has(name)) return;
  const loader = LAZY[name];
  if (!loader) return;

  const { default: mod } = await loader();
  EMBED_EXTENSIONS.push(mod.extension, ...(mod.providers ?? []));
  for (const widget of entries(mod.extension, mod.views, mod.manifest)) {
    ALL.push(widget);
    BY_NAME.set(widget.name, widget);
  }
}

export function embedWidget(name: string): EmbedWidget | undefined {
  return BY_NAME.get(name);
}

export function embedWidgetNames(): string[] {
  return [...BY_NAME.keys()];
}

/**
 * Every widget currently in the catalog, lazily loaded ones included.
 *
 * For the one caller that has an id and no name: a palette action row says
 * which action to run, never which widget implements it, so finding the
 * handler means asking all of them (`embedActions.ts`).
 */
export function embedWidgets(): readonly EmbedWidget[] {
  return ALL;
}
