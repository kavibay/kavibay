// SPDX-License-Identifier: MIT
import type { Component } from "vue";
import type { LlmCapability } from "./contract/sdk";

/**
 * A widget card's own surface. Every field is optional; an absent one keeps
 * the shared appearance from Settings.
 */
export interface WidgetAppearance {
  /** `#rrggbb`. */
  background?: string;
  /** 0–1, the alpha of the background. */
  opacity?: number;
  /** Backdrop blur in CSS pixels; 0 is none. */
  blur?: number;
  /** Corner radius in CSS pixels. */
  radius?: number;
  /** `false` drops the card's drop shadow; absent keeps the shared one. */
  shadow?: boolean;
}

/** Center offset of a card relative to the palette, in CSS pixels. */
export interface WidgetPosition {
  x: number;
  y: number;
}

/** Preferred card size in CSS pixels (host sets width/height on create). */
export interface WidgetSize {
  w: number;
  h: number;
}

/** One parameter of an action, rendered as an inline chip in the palette. */
export interface ActionParam {
  /** Key under which the trimmed value lands in the handler’s args record. */
  name: string;
  type: "text" | "number" | "enum";
  required: boolean;
  /** Grey chip text before input, e.g. "Volume (0-100)". Defaults to `name`. */
  placeholder?: string;
  /** `enum` only — accepted values, matched case-insensitively. */
  options?: string[];
}

/**
 * A palette-invokable operation declared in manifest.json.
 * Unrelated to `ExtensionManifest.commands`, which lists Tauri command names.
 */
export interface ExtensionAction {
  /** Unique within the extension; key into the module’s handler map. */
  id: string;
  title: string;
  subtitle?: string;
  keywords: string[];
  /** Omitted / empty = runs straight from Enter, no argument chips. */
  params?: ActionParam[];
  /**
   * When false the action runs without a widget instance (nothing is created).
   * Default true: the host resolves one instance (visible → hidden → create).
   */
  needsInstance?: boolean;
  /**
   * This action opens the widget itself, so its catalog row is redundant beside
   * it and is left out of search results. The + menu and the gallery keep it.
   */
  replacesCatalogRow?: boolean;
}

/** Validated action arguments, keyed by `ActionParam.name`. */
export type ActionArgs = Record<string, string>;

/**
 * One text-in / text-out transform offered on text selected anywhere on the
 * desktop (Ctrl+Shift+Q). Declared in manifest.json, handled in index.ts.
 *
 * Separate from `ExtensionAction` because the two answer different questions:
 * a palette action operates on a widget instance and returns nothing, a text
 * action has no instance at all and its whole point is the string it returns.
 */
export interface TextAction {
  /** Unique within the extension; key into the module’s `textActions` map. */
  id: string;
  /** Menu row label, e.g. "Translate". */
  title: string;
  /** One short line under the label; omit for a bare row. */
  subtitle?: string;
  /**
   * Optional widget hand-off shown beside this quick action. The quick-action
   * window is separate from the host, so it declares the instance action to
   * run once the selected text reaches the widget.
   */
  widgetAction?: {
    id: string;
    args?: ActionArgs;
  };
}

/** What a text-action handler receives for one invocation. */
export interface TextActionContext {
  /** The selection, exactly as the source application reported it. */
  text: string;
  /** Aborts when the user dismisses the menu mid-run. */
  signal: AbortSignal;
  /**
   * Incremental pieces of the answer, when the handler produces them.
   * The promise still resolves with the finished text — callers that replace
   * a selection must wait for that, never paste a chunk.
   */
  onChunk?: (text: string) => void;
  /** Host-reviewed LLM surface for text transforms; absent for other hosts. */
  llm?: LlmCapability;
}

/**
 * Transforms the selection and resolves with the replacement text.
 *
 * Runs in the popup window, which mounts no widgets — a handler must not
 * assume any instance state exists. Throwing (or rejecting) surfaces the
 * message in the menu and leaves the user's selection untouched.
 */
export type TextActionHandler = (ctx: TextActionContext) => Promise<string>;

/** Handles an action whose menu metadata is generated at runtime. `undefined`
 * means the action is no longer available (for example, a deleted template). */
export type DynamicTextActionHandler = (
  actionId: string,
  ctx: TextActionContext,
) => Promise<string | undefined>;

/** Accent for an inline value; the host owns the actual colors. */
export type InlineViewTone = "neutral" | "active" | "warn" | "done";

/**
 * What one widget instance shows on its palette row — a live glance at the
 * instance without opening it (Timer: "09:38" + "Paused").
 *
 * Data, not a component, on purpose: rows rebuild on every keystroke so
 * per-row component mounts would be costly, the list has to stay visually
 * uniform across extensions, and sandboxed runtime packages can hand over
 * JSON but never a Vue component.
 */
export interface ExtensionInlineView {
  /** Primary reading, rendered in tabular figures, e.g. "09:38" or "18°". */
  value?: string;
  /** Short state word next to the value, e.g. "Paused". */
  label?: string;
  /** Drives the accent color of `value`. Defaults to neutral. */
  tone?: InlineViewTone;
  /**
   * Where the summary sits in the palette row. `detail` reads like secondary
   * content below the widget title; the default remains the right-hand glance.
   */
  placement?: "inline" | "detail";
}

/**
 * Live palette-row summary for one instance.
 *
 * Called during render, so reading reactive state makes the row update itself
 * (a running countdown ticks in the list). Must stay a cheap pure read: no
 * fetches, no writes, no timers. Return null for "nothing worth showing".
 */
export type ExtensionInlineViewFn = (
  instanceId: string,
) => ExtensionInlineView | null;

/** Plain text an extension wants indexed by the palette for one instance. */
export type ExtensionSearchTextFn = (instanceId: string) => string;

/**
 * One state-dependent button on an instance's palette row — "Pause" on a
 * running timer, "Resume" on a paused one.
 *
 * Carries its own `run` rather than an id into `actionHandlers`: those come
 * from the manifest and would each become a searchable palette row of their
 * own, which is exactly what these must not be. They exist only on the row of
 * the instance they belong to.
 */
export interface ExtensionInstanceAction {
  /** Stable within the instance; used as the render key. */
  id: string;
  /** Button label, e.g. "Pause". */
  title: string;
  /**
   * When set, the chip turns into a text field and `run` receives what was
   * typed. One value per chip on purpose — these sit inline in the search bar
   * next to the query, where a multi-field form has no room.
   */
  param?: ActionParam;
  /** Receives the typed value, or "" for a plain button chip. */
  run: (value: string) => void;
}

/**
 * Row buttons for one instance, chosen from its current state.
 *
 * Like `ExtensionInlineViewFn` this is called during render, so returning a
 * different set as state changes is the whole point. Keep it a cheap read —
 * the work belongs in `run`, not here.
 */
export type ExtensionInstanceActionsFn = (
  instanceId: string,
) => ExtensionInstanceAction[];

/** What a handler receives for one invocation. */
export interface ExtensionActionContext {
  /** Resolved target instance; empty string when `needsInstance` is false. */
  instanceId: string;
  args: ActionArgs;
}

/**
 * Runs one action. Handlers write to the per-instance state cache, so they work
 * before the widget mounts — never assume a mounted component.
 */
export type ExtensionActionHandler = (
  ctx: ExtensionActionContext,
) => void | Promise<void>;

/** Catalog / store-ready metadata (lives in each extension’s manifest.json). */
export interface ExtensionManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  keywords: string[];
  categories: string[];
  /** Optional path relative to the extension folder (e.g. icon.svg). */
  icon?: string;
  ui: {
    /** False for palette actions that never create a widget card. */
    widget?: boolean;
    defaultOffset: WidgetPosition;
    defaultSize: WidgetSize;
    allowDuplicate?: boolean;
    flush?: boolean;
    compact?: boolean;
    /** Spawn the card with its title bar hidden (menu can bring it back). */
    defaultHideTitle?: boolean;
    /**
     * Content zoom the card opens at — same factor Ctrl+wheel writes.
     * 1 = unzoomed; clamped to the host's 0.5…3 range. Default 1.
     */
    defaultScale?: number;
    /** When false, host uses default cursor instead of grab (e.g. text widgets). Default true. */
    grabCursor?: boolean;
    /**
     * When true, pointer-down anywhere on the card (except chrome/resize/menus)
     * starts a move drag — for cover-style widgets like Redacted.
     */
    fullDrag?: boolean;
    /** When false, hide host edge-resize handles. Default true. */
    resizable?: boolean;
    /**
     * Playground widgets (e.g. Snake): flush edge-to-edge content, square resize,
     * playfield hugs the card border.
     */
    playground?: boolean;
    /**
     * Dock-style widgets (e.g. App Launcher): host owns width only;
     * card height hugs content (no empty vertical chrome).
     */
    hugHeight?: boolean;
    /**
     * Opt this card out of the glass, whatever the appearance setting says.
     *
     * For a widget that is a workspace rather than a reading: the Wizard has a
     * file editor, a transcript and a live preview of somebody else's widget in
     * it, and three columns of dense text over a wallpaper and whatever cards
     * are behind it is not a taste question — the preview in particular is
     * showing a *different* widget, which has to be judged against a plain
     * ground rather than against the desk showing through it.
     *
     * Unreachable from a package manifest, like every other `ui` flag: it is
     * read out of a bundled extension's manifest only. A drop-in that could
     * overrule the surface opacity somebody chose would be overruling a
     * preference, not declaring a property of itself.
     */
    opaque?: boolean;
    /** Keep running when hidden or on another desk; disabling/deleting ends background work. */
    keepAliveWhenHidden?: boolean;
    /**
     * The card's own surface, over the shared appearance. With `editable`, each
     * instance can change it under Appearance in its settings. Bundled
     * extensions only, like every other `ui` flag.
     */
    appearance?: WidgetAppearance & { editable?: boolean };
  };
  /** Declared Tauri command names this extension uses (Rust split later). */
  commands: string[];
  /** Palette actions this extension offers; handlers live in index.ts. */
  actions?: ExtensionAction[];
  /**
   * Selection quick actions offered on text selected in any application.
   * Declared here rather than derived from code so the popup window can build
   * its menu from manifests alone, without loading any extension module.
   */
  textActions?: TextAction[];
  /**
   * Loads user-defined text actions from the extension at runtime. The quick
   * action popup imports only modules that opt in, keeping its normal path
   * manifest-only and lightweight.
   */
  dynamicTextActions?: boolean;
  /**
   * Credential types this extension needs (first-party only — sandboxed
   * runtime packages may not declare them). The host owns the secret: the
   * extension only learns whether the credential is connected.
   */
  credentials?: ExtensionCredentialRequest[];
  /** Declared permission ids (enforced later). */
  permissions: string[];
}

/** One credential type an extension depends on. */
export interface ExtensionCredentialRequest {
  /** Credential type id from the host registry, e.g. `githubPat`. */
  type: string;
  /** When true the widget cannot work without it (renders a setup state). */
  required: boolean;
}

/**
 * Code wiring exported from each extension’s index.ts.
 * Lifecycle hooks keep the host free of typeId switches.
 */
export interface ExtensionModule {
  /** Required for widgets; action-only extensions deliberately omit it. */
  component?: Component;
  settingsComponent?: Component;
  menuComponent?: Component;
  /**
   * Inline icon component, normally one from `@sdk/icons`. Takes precedence
   * over the manifest's `icon` file wherever the host draws this extension.
   *
   * Only first-party extensions can supply one — a sandboxed runtime package
   * hands over JSON, never a Vue component — so `icon`/`iconUrl` stays the
   * universal path and this is the upgrade. It exists because an icon drawn
   * through `mask: url(...)` is flattened to an alpha mask with no addressable
   * paths, which rules out per-path motion.
   */
  iconComponent?: Component;
  /** Rust command for useWidgetData; omit for pure client widgets. */
  backendCommand?: string;
  refreshInterval?: number;
  /** Handlers keyed by `ExtensionAction.id` from the manifest. */
  actions?: Record<string, ExtensionActionHandler>;
  /**
   * Rebuilds this action's chips from the values typed so far.
   * Used so `{name}` in a snippet template becomes a chip, without the host
   * knowing what a snippet is.
   */
  dynamicActionParams?: (
    actionId: string,
    values: readonly string[],
  ) => ActionParam[];
  /** Handlers keyed by `TextAction.id` from the manifest. */
  textActions?: Record<string, TextActionHandler>;
  /** Runtime text-action rows, enabled by `manifest.dynamicTextActions`. */
  dynamicTextActions?: () => TextAction[];
  /** Resolves one runtime text-action id when the popup runs it. */
  dynamicTextActionHandler?: DynamicTextActionHandler;
  /** Filters static and runtime text actions whose availability is user-defined. */
  isTextActionAvailable?: (actionId: string) => boolean;
  /** Per-instance glance shown on that instance's palette row. */
  inlineView?: ExtensionInlineViewFn;
  /** Optional persisted body text used for generic palette search and previews. */
  searchText?: ExtensionSearchTextFn;
  /** State-dependent buttons on that instance's palette row. */
  instanceActions?: ExtensionInstanceActionsFn;
  /** Called when a new instance is added (and once at host boot for existing ones). */
  onCreate?: (instanceId: string) => void;
  onDuplicate?: (fromInstanceId: string, toInstanceId: string) => void;
  onSuspend?: (instanceId: string) => void;
  onResume?: (instanceId: string) => void;
  onDispose?: (instanceId: string) => void;
}

/** Manifest + module merged for host / palette consumption. */
export interface RegisteredExtension {
  id: string;
  title: string;
  description: string;
  /**
   * Loads the bundled README shown by the host's About dialog.
   * A loader rather than the text itself so the prose stays off the boot path.
   */
  loadReadme?: () => Promise<string>;
  version: string;
  author: string;
  keywords: string[];
  categories: string[];
  /** Whether this extension owns a widget card and belongs in widget catalogs. */
  isWidget: boolean;
  /**
   * Off on a fresh profile. Absent means on, which is what nearly every
   * extension wants and therefore what a manifest should not have to say.
   *
   * This is not "we are unsure about it" — everything shipped works. It marks
   * the ones tied to an account nobody has connected yet, or narrow enough to
   * belong in the catalog rather than on a first-run desk. It lives here
   * because the alternative was a list of ids in core, and that list had
   * already drifted: it still named `github-actions`, an extension that no
   * longer exists, and nothing could have noticed.
   *
   * Only the *default* — once a profile has a stored record, that record wins
   * and this is never consulted again.
   */
  enabledByDefault?: boolean;
  /**
   * Place this widget on the desk the very first time Kavibay is opened,
   * lowest number first. Absent means no.
   *
   * Here for the same reason `enabledByDefault` is: the alternative was a list
   * of ids in core, and core is not supposed to know what is in `extensions/`.
   * A widget that needs a connected account should not claim it — it would
   * greet a new user with a connect prompt shaped like a card. See
   * `core/app/host/starterDesk.ts`.
   */
  starter?: number;
  /** Manifest-relative icon path (e.g. icon.svg). */
  icon?: string;
  /** Inline icon component from the module; wins over `iconUrl` when present. */
  iconComponent?: Component;
  /** Host-resolved URL for palette / catalog display (builtin Vite URL or kavibay-ext). */
  iconUrl?: string;
  position: WidgetPosition;
  defaultSize: WidgetSize;
  allowDuplicate: boolean;
  flush: boolean;
  compact: boolean;
  defaultHideTitle: boolean;
  /** Content zoom applied to new instances (clamped, 1 = unzoomed). */
  defaultScale: number;
  /** When false, widget-anchor does not show the grab cursor. */
  grabCursor: boolean;
  /** Whole-card move drag (except interactive chrome). */
  fullDrag: boolean;
  /** When false, host does not show edge-resize handles. */
  resizable: boolean;
  /** Playground: flush square playfield that hugs the card edges. */
  playground: boolean;
  /** Host width only; card height hugs content (docks). */
  hugHeight: boolean;
  /** Card is drawn on an opaque ground rather than the shared glass. */
  opaque: boolean;
  /** Keep running when hidden or on another desk; disabling/deleting ends background work. */
  keepAliveWhenHidden?: boolean;
  /** The card's own surface from `ui.appearance`. */
  appearance?: WidgetAppearance;
  /** `ui.appearance.editable`: each instance may change it in its settings. */
  appearanceEditable?: boolean;
  commands: string[];
  /** Normalized manifest actions; entries without a handler are dropped. */
  actions: ExtensionAction[];
  permissions: string[];
  component?: Component;
  /** Normalized handler map (empty when the extension declares no actions). */
  actionHandlers: Record<string, ExtensionActionHandler>;
  /**
   * Optional live chip list for one action; absent = use the manifest params.
   */
  dynamicActionParams?: (
    actionId: string,
    values: readonly string[],
  ) => ActionParam[];
  /** Per-instance glance for palette rows; absent = title only. */
  inlineView?: ExtensionInlineViewFn;
  /** Optional persisted body text used for generic palette search and previews. */
  searchText?: ExtensionSearchTextFn;
  /** State-dependent row buttons; absent = only the host's Hide / Remove. */
  instanceActions?: ExtensionInstanceActionsFn;
  settingsComponent?: Component;
  menuComponent?: Component;
  backendCommand?: string;
  refreshInterval?: number;
  onCreate?: (instanceId: string) => void;
  onDuplicate?: (fromInstanceId: string, toInstanceId: string) => void;
  onSuspend?: (instanceId: string) => void;
  onResume?: (instanceId: string) => void;
  onDispose?: (instanceId: string) => void;
}

/**
 * Props every extension component receives from the host data bridge. Populated
 * from `backendCommand` / `useWidgetData`; all four are `null`/`false` for widgets
 * that fetch nothing.
 */
export interface WidgetProps<T = unknown> {
  data: T | null;
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
}
