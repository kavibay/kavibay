/** Host-side KV helpers for runtime extension instance storage. */

/** Build the localStorage key for a runtime extension instance. */
export function runtimeStorageKey(extId: string, instanceId: string): string {
  return `kavibay:runtime:${extId}:${instanceId}`;
}

/** Resolve storage backend; defaults to globalThis.localStorage. */
function resolveStorage(storage?: Storage): Storage {
  return storage ?? globalThis.localStorage;
}

/** Load JSON for a runtime instance; missing/invalid → null. */
export function loadRuntimeInstanceJson(
  extId: string,
  instanceId: string,
  storage?: Storage,
): unknown | null {
  const store = resolveStorage(storage);
  const raw = store.getItem(runtimeStorageKey(extId, instanceId));
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** Persist JSON for a runtime instance. */
export function saveRuntimeInstanceJson(
  extId: string,
  instanceId: string,
  value: unknown,
  storage?: Storage,
): void {
  const store = resolveStorage(storage);
  store.setItem(runtimeStorageKey(extId, instanceId), JSON.stringify(value));
}

/** Remove one runtime instance key. */
export function clearRuntimeInstance(
  extId: string,
  instanceId: string,
  storage?: Storage,
): void {
  const store = resolveStorage(storage);
  store.removeItem(runtimeStorageKey(extId, instanceId));
}

/**
 * Move every runtime key of `from` to `to`, keeping each instance id.
 *
 * A runtime package's storage is keyed by its package id, so a renamed widget
 * would come back empty — its notes, its counter, whatever it kept — while the
 * old cells sat on disk under a name nothing reads. The instance ids do not
 * change, so the data lands back in the same cards.
 *
 * A key already present under the new id is left alone: it belongs to whatever
 * is installed there.
 */
export function renameRuntimeStorageExt(
  from: string,
  to: string,
  storage?: Storage,
): void {
  if (!from || !to || from === to) return;
  const store = resolveStorage(storage);
  const prefix = `kavibay:runtime:${from}:`;
  const moving: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key != null && key.startsWith(prefix)) moving.push(key);
  }
  for (const key of moving) {
    const raw = store.getItem(key);
    store.removeItem(key);
    if (raw == null) continue;
    const target = runtimeStorageKey(to, key.slice(prefix.length));
    if (store.getItem(target) != null) continue;
    store.setItem(target, raw);
  }
}

/** Remove all runtime keys for an extension id; leave other ext ids intact. */
export function clearAllRuntimeStorageForExt(
  extId: string,
  storage?: Storage,
): void {
  const store = resolveStorage(storage);
  const prefix = `kavibay:runtime:${extId}:`;
  const toRemove: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key != null && key.startsWith(prefix)) {
      toRemove.push(key);
    }
  }
  for (const key of toRemove) {
    store.removeItem(key);
  }
}

/** Ids `newInstanceId` mints. Wizard preview and palette scratch ids never look like this. */
const LAYOUT_INSTANCE_ID =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|inst-\d+-[a-z0-9]+)$/;

/** Remove runtime keys of layout instances that are not in `liveInstanceIds`. */
export function pruneOrphanRuntimeStorage(
  liveInstanceIds: ReadonlySet<string>,
  storage?: Storage,
): void {
  const store = resolveStorage(storage);
  const orphans: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key == null || !key.startsWith("kavibay:runtime:")) continue;
    const instanceId = key.slice(key.lastIndexOf(":") + 1);
    if (LAYOUT_INSTANCE_ID.test(instanceId) && !liveInstanceIds.has(instanceId)) {
      orphans.push(key);
    }
  }
  for (const key of orphans) store.removeItem(key);
}
