import type { WidgetInstanceId } from "../sdk.js";

const QUOTA_BYTES = 256 * 1024;

/**
 * Per-instance persisted data. Scoped by the host so Todo needs neither a
 * filesystem nor a storage capability. JSON only, hard-failing quota.
 */
export class InstanceDataStore {
  private store = new Map<string, unknown>();

  private k(instance: WidgetInstanceId, key: string) {
    if (key.includes("\u0000")) throw new Error("invalid key");
    return `${instance}\u0000${key}`;
  }

  scoped(instance: WidgetInstanceId) {
    return {
      get: async <T>(key: string) => this.store.get(this.k(instance, key)) as T | undefined,
      set: async <T>(key: string, value: T) => {
        const encoded = JSON.stringify(value);
        if (encoded === undefined) throw new Error("data.set: value must be JSON-serializable");
        if (Buffer.byteLength(encoded) > QUOTA_BYTES) {
          throw new Error(`data.set: quota exceeded (${QUOTA_BYTES} bytes)`);
        }
        this.store.set(this.k(instance, key), JSON.parse(encoded));
      },
      delete: async (key: string) => {
        this.store.delete(this.k(instance, key));
      },
    };
  }

  /** Called when an instance is removed from the canvas. */
  evict(instance: WidgetInstanceId) {
    for (const k of [...this.store.keys()]) {
      if (k.startsWith(`${instance}\u0000`)) this.store.delete(k);
    }
  }
}
