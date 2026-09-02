/**
 * Known runtime-package permission ids.
 * `backend.sidecar` is catalogued but not enableable in P1 (see validateRuntimeManifest).
 */
export type RuntimePermission =
  | "storage.instance"
  | "network.client"
  | "network.declared";

/**
 * Turns a package's `api.json` endpoints into callable host-mediated requests.
 * `network.client` (raw fetch through an opened CSP) stays catalogued but
 * unimplemented — see the declarative HTTP design, section 3.
 */
export const NETWORK_DECLARED: RuntimePermission = "network.declared";

/** All recognized permission strings, including P2-only `backend.sidecar`. */
export const KNOWN_RUNTIME_PERMISSIONS: ReadonlySet<string> = new Set([
  "storage.instance",
  "network.client",
  "network.declared",
  "backend.sidecar",
]);

/** True when `id` is in the known permission catalog. */
export function isKnownRuntimePermission(id: string): boolean {
  return KNOWN_RUNTIME_PERMISSIONS.has(id);
}
