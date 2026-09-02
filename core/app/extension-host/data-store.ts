import type { WidgetInstanceId } from "@sdk/contract/sdk";

/**
 * Persisted widget data (`ctx.data`) — one of the three kinds of state in the
 * contract: user config, persisted instance data, ephemeral UI state. The same
 * backend also exposes an explicitly extension-scoped `sharedData` store for
 * widgets whose product semantics require one list across instances.
 * Scoped by the host so Todo needs neither a filesystem nor a storage
 * capability. JSON only, hard-failing quota.
 *
 * Ported from docs/extension-sdk-reference/data-store.ts. The scoping and quota
 * logic is unchanged; per the port map the `Map` is replaced by real
 * persistence.
 *
 * THE BACKEND SEAM IS THE POINT. Widget data ends up in Rust alongside the
 * credential vault and the HTTP broker, so the localStorage backend below is
 * the current one, not the design. Keeping the seam explicit makes that swap a
 * single `StorageBackend` implementation, touching no widget and no host logic.
 * It is also why `data-store.assert.ts` runs against an injected fake instead
 * of localStorage: a localStorage test would pin behaviour to the part that is
 * on its way out. The store stays small and explicit rather than becoming an
 * abstraction layer.
 *
 * One further change forced by leaving Node: `Buffer.byteLength` became
 * `TextEncoder`, since this code now runs in the webview. Both measure UTF-8
 * bytes, so the quota is the same 256 KiB it was. The localStorage key carries
 * the repo's usual `kavibay:` prefix (`sdk/extension/instanceStorageKey.ts`).
 *
 * The key shape keeps the reference's NUL separator rather than reusing
 * `instanceStorageKey(extId, instanceId)`: the host resolves `ctx.data` from
 * the instance id alone (`runtime.ts` → `data.scoped(id)`), so there is no
 * extension id at this seam, and NUL is what makes `<instance><sep><key>`
 * unambiguous for a key containing the separator.
 */

const QUOTA_BYTES = 256 * 1024;
const STORAGE_PREFIX = "kavibay:widget-data:";
const SHARED_STORAGE_PREFIX = "kavibay:extension-data:";

/** The `Storage` subset used here, plus key enumeration for `evict`. */
export interface StorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  keys(): string[];
}

/** Falls back to memory where there is no DOM, so the host stays constructible. */
function defaultBackend(): StorageBackend {
  if (typeof localStorage !== "undefined") {
    return {
      getItem: (k) => localStorage.getItem(k),
      setItem: (k, v) => localStorage.setItem(k, v),
      removeItem: (k) => localStorage.removeItem(k),
      keys: () => Object.keys(localStorage),
    };
  }
  const memory = new Map<string, string>();
  return {
    getItem: (k) => memory.get(k) ?? null,
    setItem: (k, v) => { memory.set(k, v); },
    removeItem: (k) => { memory.delete(k); },
    keys: () => [...memory.keys()],
  };
}

export class InstanceDataStore {
  constructor(private backend: StorageBackend = defaultBackend()) {}

  private k(instance: WidgetInstanceId, key: string) {
    if (key.includes("\0")) throw new Error("invalid key");
    return `${STORAGE_PREFIX}${instance}\0${key}`;
  }

  private sharedK(scope: string, key: string) {
    if (key.includes("\0")) throw new Error("invalid key");
    return `${SHARED_STORAGE_PREFIX}${scope}\0${key}`;
  }

  private encode(value: unknown): string {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("data.set: value must be JSON-serializable");
    if (new TextEncoder().encode(encoded).length > QUOTA_BYTES) {
      throw new Error(`data.set: quota exceeded (${QUOTA_BYTES} bytes)`);
    }
    return encoded;
  }

  scoped(instance: WidgetInstanceId) {
    return {
      get: async <T>(key: string) => {
        const raw = this.backend.getItem(this.k(instance, key));
        if (raw === null) return undefined;
        // Corrupt or hand-edited storage must not brick the widget.
        try {
          return JSON.parse(raw) as T;
        } catch {
          return undefined;
        }
      },
      set: async <T>(key: string, value: T) => {
        this.backend.setItem(this.k(instance, key), this.encode(value));
      },
      delete: async (key: string) => {
        this.backend.removeItem(this.k(instance, key));
      },
    };
  }

  shared(scope: string) {
    return {
      get: async <T>(key: string) => {
        const raw = this.backend.getItem(this.sharedK(scope, key));
        if (raw === null) return undefined;
        try {
          return JSON.parse(raw) as T;
        } catch {
          return undefined;
        }
      },
      set: async <T>(key: string, value: T) => {
        this.backend.setItem(this.sharedK(scope, key), this.encode(value));
      },
      delete: async (key: string) => {
        this.backend.removeItem(this.sharedK(scope, key));
      },
    };
  }

  /** Copy every persisted cell for a widget whose contract opts into cloning. */
  clone(
    from: WidgetInstanceId,
    to: WidgetInstanceId,
    transform?: (key: string, value: unknown) => unknown,
  ) {
    const fromPrefix = `${STORAGE_PREFIX}${from}\0`;
    const toPrefix = `${STORAGE_PREFIX}${to}\0`;
    for (const key of this.backend.keys()) {
      if (!key.startsWith(fromPrefix)) continue;
      const suffix = key.slice(fromPrefix.length);
      if (this.backend.getItem(`${toPrefix}${suffix}`) !== null) continue;
      const raw = this.backend.getItem(key);
      if (raw === null) continue;
      if (!transform) {
        this.backend.setItem(`${toPrefix}${suffix}`, raw);
        continue;
      }
      try {
        const value = transform(suffix, JSON.parse(raw));
        this.backend.setItem(`${toPrefix}${suffix}`, this.encode(value));
      } catch {
        // A malformed or rejected transform must not make duplication lose
        // data; copy the original JSON cell instead.
        this.backend.setItem(`${toPrefix}${suffix}`, raw);
      }
    }
  }

  /**
   * Move an extension's shared cells to the scope it now runs under.
   *
   * The shared scope is the extension id, and a renamed package gets a new one
   * — so without this its `sharedData` is still on disk under a name nothing
   * reads any more, and the widget comes back empty after a rename that was
   * meant to change only what it is called. Instance data is untouched by a
   * rename: it is keyed by instance id, which does not move.
   *
   * A cell already present in the new scope wins; it belongs to whatever is
   * running there now.
   */
  renameSharedScope(from: string, to: string) {
    if (!from || !to || from === to) return;
    const fromPrefix = `${SHARED_STORAGE_PREFIX}${from}\0`;
    const toPrefix = `${SHARED_STORAGE_PREFIX}${to}\0`;
    for (const key of this.backend.keys()) {
      if (!key.startsWith(fromPrefix)) continue;
      const raw = this.backend.getItem(key);
      this.backend.removeItem(key);
      if (raw === null) continue;
      const target = `${toPrefix}${key.slice(fromPrefix.length)}`;
      if (this.backend.getItem(target) !== null) continue;
      this.backend.setItem(target, raw);
    }
  }

  /** Called when an instance is removed from the canvas. */
  evict(instance: WidgetInstanceId) {
    const prefix = `${STORAGE_PREFIX}${instance}\0`;
    for (const k of this.backend.keys()) {
      if (k.startsWith(prefix)) this.backend.removeItem(k);
    }
  }
}
