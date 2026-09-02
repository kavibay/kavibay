// SPDX-License-Identifier: MIT
import { type Ref, ref } from "vue";

/** Persistence + normalize hooks for a per-instance reactive cache. */
export interface InstanceStoreOptions<T extends object> {
  /** Load persisted value (or defaults) for an instance. */
  load: (instanceId: string) => T;
  /** Persist a normalized value. */
  save: (instanceId: string, value: T) => void;
  /** Normalize before cache write / persist (accepts partial merges / raw). */
  normalize: (value: unknown) => T;
}

/**
 * Shared Map + ensure / update / dispose / seedFrom for extension settings/state.
 * Prefer this over hand-rolling a new use*Settings composable.
 */
export function createInstanceStore<T extends object>(opts: InstanceStoreOptions<T>) {
  const cache = new Map<string, Ref<T>>();

  /** Return cached ref, loading from persistence on first access. */
  function ensure(instanceId: string): Ref<T> {
    let existing = cache.get(instanceId);
    if (!existing) {
      existing = ref(opts.load(instanceId)) as Ref<T>;
      cache.set(instanceId, existing);
    }
    return existing;
  }

  /** Per-instance reactive state + partial update that persists. */
  function use(instanceId: string) {
    const state = ensure(instanceId);

    function update(partial: Partial<T>) {
      state.value = opts.normalize({ ...(state.value as object), ...partial });
      opts.save(instanceId, state.value);
    }

    return { state, update };
  }

  /** Drop in-memory cache entry (after Remove); does not clear storage. */
  function dispose(instanceId: string): void {
    cache.delete(instanceId);
  }

  /** Copy source value into a new instance id (Duplicate). */
  function seedFrom(fromId: string, toId: string): void {
    const from = ensure(fromId);
    const copy = opts.normalize({ ...from.value });
    cache.set(toId, ref(copy) as Ref<T>);
    opts.save(toId, copy);
  }

  return { use, dispose, seedFrom, ensure };
}
