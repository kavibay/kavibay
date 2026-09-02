/**
 * Legacy frontend store for runtime package installs.
 *
 * The records now live in `{appData}/extensions/installs.json`, owned by Rust:
 * the backend builds HTTP requests for declared endpoints and must not ask the
 * frontend for permission (declarative HTTP design, section 8). What remains
 * here is the pure enable gate plus the reader used once to import whatever the
 * old `localStorage` key still holds.
 */

/** Permissions that may be granted when enabling a ready package. */
const GRANTABLE_ON_ENABLE = new Set(["storage.instance", "network.declared"]);

import type { PackageOrigin } from "./runtimeTypes";

export const RUNTIME_INSTALLS_KEY = "kavibay:runtime-installs-v1";

/**
 * What a contract package was approved to read, as Rust stores it.
 *
 * Mirrors `ContractGrant` in `installs.rs`, including what it does not have: no
 * per-action list. Approving an account approves its actions too; the shape
 * cannot grow a second grant. The same reason `grantFrom` does not take
 * actions as a parameter.
 */
export interface ContractGrant {
  /** Current shape: which accounts the person approved. */
  approved: string[];
  /**
   * Two older shapes, read and never written. Both carried per-query grants,
   * which no longer exist. Kept because dropping them would not fail loudly:
   * the grant would parse as empty and the package would load approved for
   * nothing and render blank.
   */
  providers?: { provider: string; queries: string[] }[];
  provider?: string;
  queries?: string[];
}

/** One enabled/disabled install row for a scanned package id. */
export interface RuntimeInstallRecord {
  id: string;
  enabled: boolean;
  grantedPermissions: string[];
  /** Declaration hash the user consented to (backend-owned). */
  apiHash?: string | null;
  /**
   * The contract package's approval, or absent when it is not one / was never
   * approved. Absent is "never asked", not "approved for nothing": the loader
   * refuses to build a manifest at all without a grant, so the two cannot be
   * confused into loading something.
   */
  contractGrant?: ContractGrant | null;
}

/**
 * True when a package's declaration changed since it was enabled.
 *
 * Consent was given for a specific set of endpoints; different bytes mean the
 * user has not seen what the package would call now. The backend refuses the
 * calls either way — this is what lets the panel say so.
 */
export function needsReconsent(
  install: Pick<RuntimeInstallRecord, "enabled" | "apiHash"> | undefined,
  currentApiHash: string | null | undefined,
): boolean {
  if (!install?.enabled) return false;
  return (install.apiHash ?? null) !== (currentApiHash ?? null);
}

/**
 * Pure gate: may this package appear at all — in the palette, in a resolve, in
 * the scan?
 *
 * One rule, asked from every place that shows a package. It used to be spelled
 * out in three of them, which is how the wizard's own widgets ended up
 * enabled-but-invisible: two copies were updated and one was not.
 */
export function runtimeExtVisible(opts: {
  developerExtensionsEnabled: boolean;
  origin?: PackageOrigin;
}): boolean {
  return opts.origin === "custom" || opts.developerExtensionsEnabled === true;
}

/**
 * Pure gate: may this package be enabled?
 *
 * Developer Extensions gates the **installed** root — packages that appeared in
 * a folder, which the app has no other reason to trust. A package in the custom
 * root was built here, through the app's own UI, so requiring a developer
 * toggle for it would put a technical flag in front of the one audience the
 * wizard exists for. Origin, not trust level, is what the flag is really about.
 */
export function canEnableRuntimeExt(opts: {
  developerExtensionsEnabled: boolean;
  scanStatus: "ready" | "error";
  origin?: PackageOrigin;
}): boolean {
  if (opts.scanStatus !== "ready") return false;
  return runtimeExtVisible(opts);
}

/**
 * True when enabling would grant something the user must see first.
 *
 * Network access and credentials are exactly what the consent screen exists
 * for, so the wizard may not hand them out on a button press — not even for a
 * package the same person just asked for. Storage is per-instance and grants
 * access to nothing but the widget's own key-value slot.
 */
export function needsReviewBeforeEnable(row: {
  permissions?: readonly string[];
  apiEndpoints?: readonly unknown[];
}): boolean {
  const permissions = row.permissions ?? [];
  return (
    (row.apiEndpoints?.length ?? 0) > 0 ||
    permissions.some((permission) => permission !== "storage.instance")
  );
}

/** One capability line as the consent screen phrases it. */
export function permissionLabel(permission: string): string {
  switch (permission) {
    case "storage.instance":
      return "Store its own settings for each widget instance";
    case "network.declared":
      return "Call the endpoints listed below (the host makes the requests)";
    default:
      return permission;
  }
}

/** Minimal endpoint shape the consent text needs; matches `ScannedApiEndpoint`. */
export interface ConsentEndpoint {
  description: string;
  method: string;
  hosts: string[];
  credential?: string | null;
}

/**
 * Everything enabling this package would grant, one plain line each.
 *
 * Lives here rather than in the settings panel because the wizard shows the
 * same list: two copies of a consent text drift, and the copy that drifts is
 * the one that stops describing what the package actually does.
 */
export function consentLinesFor(row: {
  permissions?: readonly string[];
  apiEndpoints?: readonly ConsentEndpoint[];
}): string[] {
  const lines = (row.permissions ?? []).map(permissionLabel);
  for (const endpoint of row.apiEndpoints ?? []) {
    const target = `${endpoint.method} ${endpoint.hosts.join(", ")}`;
    // The credential clause carries the reassurance with it: naming the secret
    // without saying it stays behind reads as "this package gets your token".
    const credential = endpoint.credential
      ? ` — using your ${endpoint.credential} credential, which the package never sees`
      : "";
    lines.push(`${endpoint.description} (${target})${credential}`);
  }
  return lines;
}

/**
 * Filter manifest permissions to those grantable at enable time (not sidecar).
 */
export function grantablePermissionsFromManifest(
  permissions: readonly string[],
): string[] {
  return permissions.filter((p) => GRANTABLE_ON_ENABLE.has(p));
}

/** Normalize one install row; invalid → null. */
function normalizeOne(raw: unknown): RuntimeInstallRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || o.id.length === 0) return null;
  const enabled = o.enabled === true;
  const grantedPermissions = Array.isArray(o.grantedPermissions)
    ? o.grantedPermissions.filter(
        (p): p is string => typeof p === "string" && GRANTABLE_ON_ENABLE.has(p),
      )
    : [];
  return { id: o.id, enabled, grantedPermissions };
}

/**
 * Normalize persisted install list; unknown shape → [].
 * Duplicate ids: last wins.
 */
export function normalizeRuntimeInstalls(raw: unknown): RuntimeInstallRecord[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map<string, RuntimeInstallRecord>();
  for (const item of raw) {
    const row = normalizeOne(item);
    if (row) byId.set(row.id, row);
  }
  return [...byId.values()];
}

/** Load install records from localStorage. */
export function loadRuntimeInstalls(): RuntimeInstallRecord[] {
  try {
    const raw = localStorage.getItem(RUNTIME_INSTALLS_KEY);
    if (!raw) return [];
    return normalizeRuntimeInstalls(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

/**
 * Drops the legacy key once Rust has taken the records over, so a stale browser
 * entry can never resurrect a grant the user revoked.
 */
export function clearLegacyRuntimeInstalls(): void {
  try {
    localStorage.removeItem(RUNTIME_INSTALLS_KEY);
  } catch {
    // A storage that refuses removal is not worth failing a startup over.
  }
}
