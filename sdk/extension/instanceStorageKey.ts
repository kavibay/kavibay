// SPDX-License-Identifier: MIT
/**
 * Canonical per-instance localStorage key: kavibay:<extId>:<instanceId>.
 * Use for new extensions; leave existing legacy keys as-is.
 */
export function instanceStorageKey(extId: string, instanceId: string): string {
  return `kavibay:${extId}:${instanceId}`;
}
