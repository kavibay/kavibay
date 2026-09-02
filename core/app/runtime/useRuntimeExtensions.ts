/**
 * FE registry for AppData runtime packages: scan, enable, HostExtensionRef map.
 */

import { computed, ref, type Ref } from "vue";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { RegisteredExtension } from "@sdk/types";
import { getExtension } from "../extensions/registry";
import { withRealPathSeparators } from "./manifestValidate";
import { DEFAULT_CONTENT_SCALE, clampContentScale } from "../host/resizeLogic";
import { useDeveloperPrefs } from "../settings/useDeveloperPrefs";
import {
  canEnableRuntimeExt,
  runtimeExtVisible,
  clearLegacyRuntimeInstalls,
  loadRuntimeInstalls,
  type ContractGrant,
  type RuntimeInstallRecord,
} from "./runtimeInstallLogic";
import { onWizardPackagesChanged, syncWidgetPackages } from "../extension-host/cockpit";
import type { HostExtensionRef, ScannedRuntimeExtension } from "./runtimeTypes";

/**
 * A widget saved in the wizard belongs in the palette immediately.
 *
 * The wizard runs its own scan through the reviewed capability and keeps the
 * answer to itself; this registry is what the palette's catalog is built from,
 * and nothing connected the two. A freshly saved widget was therefore installed,
 * enabled, and absent from the palette until the next time anything else
 * happened to rescan — which the Wizard's own docs had settled for as "the
 * palette does not reliably have it the moment the save returns".
 *
 * Registered at module scope because the palette holds no instance of this: the
 * refs are module-level and the composable is a view onto them.
 */
onWizardPackagesChanged(() => {
  void useRuntimeExtensions().rescan();
});

const scanned: Ref<ScannedRuntimeExtension[]> = ref([]);
/** Mirror of the backend's `installs.json`; never the source of truth. */
const installs: Ref<RuntimeInstallRecord[]> = ref([]);
let importedLegacyInstalls = false;

/**
 * Loads the install records from Rust, importing the legacy `localStorage`
 * records once on the way (the backend ignores the import when its file already
 * exists).
 */
async function refreshInstalls(): Promise<void> {
  if (!importedLegacyInstalls) {
    importedLegacyInstalls = true;
    const legacy = loadRuntimeInstalls();
    installs.value = await invoke<RuntimeInstallRecord[]>(
      "runtime_extensions_installs_import",
      { records: legacy },
    );
    clearLegacyRuntimeInstalls();
    return;
  }
  installs.value = await invoke<RuntimeInstallRecord[]>(
    "runtime_extensions_installs_list",
  );
}

/** Find install row for an id (if any). */
function installFor(id: string): RuntimeInstallRecord | undefined {
  return installs.value.find((r) => r.id === id);
}

/**
 * Build a kavibay-ext URL for a package entry.
 *
 * `convertFileSrc` knows the per-platform origin, which is why it is still used
 * — but it percent-encodes the whole path, separators included, so the document
 * ends up at a URL with exactly one segment. A page there has `/` as its
 * directory, and every relative `src` in it resolves to the origin root:
 * `app.js` becomes `/app.js`, which the protocol reads as an extension id and
 * cannot serve. Scripts and assets inside a package silently 404, and the
 * widget renders its static markup and does nothing at all.
 *
 * Restoring the separators gives the document a real directory, so relative
 * references resolve inside the package the way their author expects.
 */
export function runtimeEntryUrlFor(extId: string, uiEntry: string): string {
  const rel = `${extId}/${uiEntry}`.replace(/\\/g, "/");
  return withRealPathSeparators(convertFileSrc(rel, "kavibay-ext"));
}

/** Map a ready+enabled scanned package + install to HostExtensionRef. */
export function scannedToHostRef(
  row: ScannedRuntimeExtension,
  install: RuntimeInstallRecord | undefined,
): HostExtensionRef {
  const iconPath =
    typeof row.icon === "string" && row.icon.length > 0 ? row.icon : undefined;
  return {
    id: row.id,
    title: row.name,
    description: row.description ?? "",
    origin: "runtime",
    runtimeEntryUrl: runtimeEntryUrlFor(row.id, row.uiEntry),
    // Carried, not inferred. The frame that embeds this package is chosen from
    // it, and the two frames speak different protocols.
    packageFormat: row.format,
    // Carried through from the manifest. Without it the host falls back to its
    // own default, and a package's declared size never applied at all.
    ...(row.defaultSize ? { defaultSize: { ...row.defaultSize } } : {}),
    iconUrl: iconPath ? runtimeEntryUrlFor(row.id, iconPath) : undefined,
    allowDuplicate: true,
    position: { x: 0, y: 0 },
    flush: false,
    compact: false,
    defaultHideTitle: row.defaultHideTitle === true,
    defaultScale:
      typeof row.defaultScale === "number"
        ? clampContentScale(row.defaultScale)
        : DEFAULT_CONTENT_SCALE,
    grabCursor: true,
    fullDrag: false,
    resizable: true,
    playground: false,
    hugHeight: false,
    // A dropped-in package cannot declare itself opaque; see `ui.opaque`.
    opaque: false,
    keepAliveWhenHidden: false,
    permissions: [...row.permissions],
    commands: [...row.commands],
    grantedPermissions: install?.grantedPermissions
      ? [...install.grantedPermissions]
      : [],
  };
}

/** Adapt a built-in RegisteredExtension to HostExtensionRef. */
export function builtinToHostRef(ext: RegisteredExtension): HostExtensionRef {
  if (!ext.isWidget || !ext.component) {
    throw new Error(`Extension "${ext.id}" does not provide a widget component`);
  }
  return {
    id: ext.id,
    title: ext.title,
    description: ext.description,
    loadReadme: ext.loadReadme,
    origin: "builtin",
    component: ext.component,
    settingsComponent: ext.settingsComponent,
    menuComponent: ext.menuComponent,
    allowDuplicate: ext.allowDuplicate,
    position: { ...ext.position },
    defaultSize: { ...ext.defaultSize },
    flush: ext.flush,
    compact: ext.compact,
    defaultHideTitle: ext.defaultHideTitle,
    defaultScale: ext.defaultScale,
    grabCursor: ext.grabCursor,
    fullDrag: ext.fullDrag,
    resizable: ext.resizable,
    playground: ext.playground,
    hugHeight: ext.hugHeight,
    opaque: ext.opaque,
    keepAliveWhenHidden: ext.keepAliveWhenHidden,
    permissions: [...ext.permissions],
    commands: [...ext.commands],
    backendCommand: ext.backendCommand,
    refreshInterval: ext.refreshInterval,
    iconUrl: ext.iconUrl,
  };
}

/**
 * Resolve typeId via built-in registry, else ready+enabled runtime registry.
 * Hidden packages resolve to undefined — see `runtimeExtVisible`.
 */
export function resolveExtension(typeId: string): HostExtensionRef | undefined {
  const builtin = getExtension(typeId);
  if (builtin?.isWidget) return builtinToHostRef(builtin);

  const { developerExtensionsEnabled } = useDeveloperPrefs();
  const row = scanned.value.find((s) => s.id === typeId);
  if (!row || row.status !== "ready") return undefined;
  if (
    !runtimeExtVisible({
      developerExtensionsEnabled: developerExtensionsEnabled.value,
      origin: row.origin,
    })
  ) {
    return undefined;
  }
  const install = installFor(typeId);
  if (!install?.enabled) return undefined;
  return scannedToHostRef(row, install);
}

/**
 * App-wide runtime extension registry (scan + installs).
 * When Developer Extensions is off, palette-facing lists are empty.
 */
export function useRuntimeExtensions() {
  const { developerExtensionsEnabled } = useDeveloperPrefs();

  /**
   * Invoke the Rust scan.
   *
   * With Developer Extensions off, packages from the installed root are hidden
   * — that flag is what keeps a folder drop-in from loading. Custom packages
   * stay visible: they were built here, and hiding a widget the person just
   * made would be a puzzle, not a safeguard.
   */
  async function rescan(): Promise<ScannedRuntimeExtension[]> {
    // Grants come from the backend, so refresh them alongside the scan: an
    // install.json edited outside the app must not be shadowed by a stale
    // in-memory copy.
    try {
      await refreshInstalls();
    } catch (err) {
      console.error("[kavibay] runtime install records failed to load:", err);
      installs.value = [];
    }
    try {
      const rows = await invoke<ScannedRuntimeExtension[]>(
        "runtime_extensions_scan",
      );
      const all = Array.isArray(rows) ? rows : [];
      scanned.value = all.filter((row) =>
        runtimeExtVisible({
          developerExtensionsEnabled: developerExtensionsEnabled.value,
          origin: row.origin,
        }),
      );
    } catch (err) {
      console.error("[kavibay] runtime_extensions_scan failed:", err);
      scanned.value = [];
    }
    // Contract packages are loaded into the extension host here rather than in
    // each caller: every path that refreshes the scan — boot, the settings
    // panel, the wizard, the developer toggle — is a path where a grant may
    // just have been given or withdrawn, and one of them forgetting is a widget
    // that renders nothing with no way to tell why.
    syncWidgetPackages(scanned.value, installs.value);
    return scanned.value;
  }

  /** Current scanned packages (may be empty when developer mode off). */
  function list(): ScannedRuntimeExtension[] {
    return scanned.value;
  }

  /**
   * Enable/disable a package. Enable only when canEnableRuntimeExt is true.
   *
   * The grant itself is decided in Rust: this passes the scan row's requested
   * permissions, and the backend intersects them with its own catalogue.
   *
   * `contractGrant` is the other consent screen's answer, for a contract
   * package. Enabling one without it stores no grant and the widget reports
   * that it has not been approved — the caller cannot skip the question and get
   * a working widget, which is the same shape `widgetPackageManifest` has for
   * the same reason.
   */
  async function setEnabled(
    id: string,
    on: boolean,
    contractGrant?: ContractGrant,
  ): Promise<boolean> {
    const row = scanned.value.find((s) => s.id === id);
    // Credential types the confirm step listed. The backend filters these
    // against the declaration on disk, so this cannot widen the grant.
    const credentialTypes = Array.from(
      new Set(
        (row?.apiEndpoints ?? [])
          .map((endpoint) => endpoint.credential)
          .filter((type): type is string => typeof type === "string" && type.length > 0),
      ),
    );
    if (on) {
      const status = row?.status === "ready" ? "ready" : "error";
      if (
        !canEnableRuntimeExt({
          developerExtensionsEnabled: developerExtensionsEnabled.value,
          scanStatus: status,
          origin: row?.origin,
        })
      ) {
        return false;
      }
    }
    installs.value = await invoke<RuntimeInstallRecord[]>(
      "runtime_extensions_installs_set",
      {
        id,
        enabled: on,
        manifestPermissions: row?.permissions ?? [],
        credentialTypes,
        contractGrant: contractGrant ?? null,
      },
    );
    // Enabling *is* the grant changing, and the reply above is the record Rust
    // just wrote. Waiting for the next scan would leave the widget the user has
    // this moment approved still showing that it has not been.
    syncWidgetPackages(scanned.value, installs.value);
    return true;
  }

  /** Ready + enabled runtime packages as HostExtensionRef, minus hidden ones. */
  const enabledHostRefs = computed(() => {
    const out: HostExtensionRef[] = [];
    for (const row of scanned.value) {
      if (row.status !== "ready") continue;
      if (
        !runtimeExtVisible({
          developerExtensionsEnabled: developerExtensionsEnabled.value,
          origin: row.origin,
        })
      ) {
        continue;
      }
      const install = installFor(row.id);
      if (!install?.enabled) continue;
      out.push(scannedToHostRef(row, install));
    }
    return out;
  });

  /** Lookup one ready+enabled runtime HostExtensionRef by id. */
  function getRuntimeHostRef(id: string): HostExtensionRef | undefined {
    return enabledHostRefs.value.find((r) => r.id === id);
  }

  return {
    scanned,
    installs,
    developerExtensionsEnabled,
    rescan,
    list,
    setEnabled,
    enabledHostRefs,
    getRuntimeHostRef,
    resolveExtension,
  };
}
