/**
 * Known runtime-package permission ids.
 * `backend.sidecar` is catalogued but not enableable in P1 (see validateRuntimeManifest).
 */
export type RuntimePermission =
  | "storage.instance"
  | "network.client"
  | "network.declared"
  | "background.pop";

/**
 * Turns a package's `api.json` endpoints into callable host-mediated requests.
 * `network.client` (raw fetch through an opened CSP) stays catalogued but
 * unimplemented — see the declarative HTTP design, section 3.
 */
export const NETWORK_DECLARED: RuntimePermission = "network.declared";

/**
 * Keeps the widget running while the cockpit is hidden and lets it call
 * `kavibay.pop()` — the runtime-package twin of the Alarm widget's `alarm`
 * capability. One permission for both: popping needs a widget that is still
 * running, and running hidden is only worth its CPU for one that may pop.
 */
export const BACKGROUND_POP: RuntimePermission = "background.pop";

/** All recognized permission strings, including P2-only `backend.sidecar`. */
export const KNOWN_RUNTIME_PERMISSIONS: ReadonlySet<string> = new Set([
  "storage.instance",
  "network.client",
  "network.declared",
  "background.pop",
  "backend.sidecar",
]);

/** True when `id` is in the known permission catalog. */
export function isKnownRuntimePermission(id: string): boolean {
  return KNOWN_RUNTIME_PERMISSIONS.has(id);
}
