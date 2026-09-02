/**
 * Shared types for runtime extension packages (manifest, validation results).
 */

import type { Component } from "vue";

/** Built-in Vue extension vs AppData runtime package. */
export type ExtensionOrigin = "builtin" | "runtime";

/**
 * Adapter used by host/palette for both tiers.
 * Built-ins keep their Vue component; runtime carries a kavibay-ext entry URL.
 */
export interface HostExtensionRef {
  id: string;
  title: string;
  description: string;
  origin: ExtensionOrigin;
  /**
   * Loads the built-in extension README, unavailable for sandboxed runtime
   * packages. Lazy so About text never lands in the start-up graph.
   */
  loadReadme?: () => Promise<string>;
  /** Built-in: Vue component. Runtime: absent. */
  component?: Component;
  /** Built-in optional chrome panels. */
  settingsComponent?: Component;
  menuComponent?: Component;
  /** Runtime: convertFileSrc URL under protocol kavibay-ext. */
  runtimeEntryUrl?: string;
  /**
   * Which package format this ref came from, for `origin === "runtime"`.
   *
   * The one thing the host branches on when choosing a frame:
   * `RuntimeExtensionFrame` speaks `kavibay.ext.*`, `SandboxedWidgetFrame`
   * speaks the contract's channel, and a package handed to the wrong one gets
   * its messages dropped without a word.
   */
  packageFormat?: PackageFormat;
  allowDuplicate: boolean;
  position: { x: number; y: number };
  /** Size the widget opens at, from the manifest. */
  defaultSize?: { w: number; h: number };
  flush: boolean;
  compact: boolean;
  defaultHideTitle: boolean;
  /** Content zoom new instances open at (1 = unzoomed). */
  defaultScale: number;
  grabCursor: boolean;
  fullDrag: boolean;
  resizable: boolean;
  playground: boolean;
  hugHeight: boolean;
  /** Card is drawn on an opaque ground rather than the shared glass. */
  opaque: boolean;
  /** Keep the widget mounted while the cockpit is hidden. */
  keepAliveWhenHidden?: boolean;
  permissions: string[];
  commands: string[];
  /** Built-in: optional Tauri poll command (ignored for runtime). */
  backendCommand?: string;
  refreshInterval?: number;
  /** From install record when origin is runtime. */
  grantedPermissions?: string[];
  /** Resolved icon URL for palette / Widgets menu (missing → generic mark). */
  iconUrl?: string;
}

/** One row from `runtime_extensions_scan` (camelCase JSON). */
export interface ScannedRuntimeExtension {
  id: string;
  name: string;
  version: string;
  description?: string | null;
  path: string;
  uiEntry: string;
  /** Optional package-relative icon path from manifest (e.g. icon.svg). */
  icon?: string | null;
  permissions: string[];
  commands: string[];
  /**
   * Declared HTTP endpoints from the package's `api.json` (empty unless it
   * ships one). Exactly what the consent dialog has to show — and nothing that
   * grants anything. `description` is author-supplied: render as text.
   */
  apiEndpoints: ScannedApiEndpoint[];
  /**
   * Hash of the declaration as it is on disk right now. Compared with the hash
   * stored at consent time to notice a package that changed what it calls.
   */
  apiHash?: string | null;
  /**
   * Which root holds the package: `installed` (dropped in or, later, from the
   * store) or `custom` (built here — updates never touch it).
   */
  origin: PackageOrigin;
  /**
   * Which of the two package formats this is. Derived in Rust from the
   * manifest's `widget` object and never re-derived here — it decides which
   * frame embeds the package, and a second opinion on that is what made a
   * contract package render as a black rectangle inside the runtime bridge.
   */
  format: PackageFormat;
  /**
   * A contract package's manifest, verbatim; absent for a runtime package.
   *
   * The approval dialog and the loader both read this rather than the file, so
   * the bytes that were consented to are the bytes that get loaded.
   */
  contractManifest?: unknown;
  /** `ui.defaultSize` from the manifest, when it declares one. */
  defaultSize?: { w: number; h: number };
  /** `ui.defaultHideTitle` from the manifest, when it declares one. */
  defaultHideTitle?: boolean;
  /** `ui.defaultScale` from the manifest, when it declares one. */
  defaultScale?: number;
  status: "ready" | "error" | string;
  error?: string | null;
}

/** Where a package came from. */
export type PackageOrigin = "installed" | "custom";

/**
 * Which contract a package is written against — `docs/runtime-packages.md` or
 * `docs/contract-packages.md`. Not a trust level: it says which runtime serves
 * the package and therefore which frame the host embeds it with.
 */
export type PackageFormat = "runtime" | "contract";

/** Consent-facing view of one declared endpoint. */
export interface ScannedApiEndpoint {
  id: string;
  description: string;
  method: "GET" | "POST" | string;
  /** Primary host plus any fallback hosts — all of them are shown. */
  hosts: string[];
  credential?: string | null;
}

/** Validated runtime package manifest (AppData drop-in). */
export interface RuntimeManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  keywords?: string[];
  categories?: string[];
  /** Optional package-relative icon path (e.g. icon.svg). */
  icon?: string;
  ui: {
    entry: string;
    defaultOffset: { x: number; y: number };
    defaultSize?: { w: number; h: number };
    /** Content zoom the card opens at; clamped by the host to 0.5…3. */
    defaultScale?: number;
    allowDuplicate?: boolean;
    flush?: boolean;
    compact?: boolean;
    defaultHideTitle?: boolean;
    grabCursor?: boolean;
    fullDrag?: boolean;
    resizable?: boolean;
    playground?: boolean;
    hugHeight?: boolean;
  };
  commands: string[];
  permissions: string[];
  /** Optional backend descriptor; sidecars are not enableable in P1. */
  backend?: unknown;
}

/** Successful pure validation of a runtime manifest. */
export type ValidateOk = { ok: true; manifest: RuntimeManifest };

/** Failed pure validation with a machine-readable-ish error string. */
export type ValidateErr = { ok: false; error: string };

export type ValidateResult = ValidateOk | ValidateErr;
