import type { QueryKey, QueryState, ProviderError } from "@sdk/contract/sdk";

/**
 * Ported unchanged from docs/extension-sdk-reference/query-cache.ts (Phase 1).
 * The port map marks it "port unchanged: no environment dependency" — only the
 * import specifier changed.
 */

const serialize = (key: QueryKey) => JSON.stringify(key);

interface Entry {
  key: QueryKey;
  state: QueryState<unknown>;
  inflight?: Promise<unknown>;
  subscribers: Set<(s: QueryState<unknown>) => void>;
  staleTime: number;
  /**
   * FINDING 1: a QueryKey alone cannot be refetched. Going from
   * ["swetlow.tado/tado","roomState","living-room"] back to
   * (queryName, args) is not possible without parsing the key, and the key
   * shape is author-defined. The cache must therefore retain the resolved
   * fetcher. Consequence for the contract: `key(args)` is for identity and
   * invalidation only, never for reconstruction.
   */
  fetcher?: () => Promise<unknown>;
  /** Set only while the entry has subscribers. See `schedule`. */
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * Owned by the host. Dedupes concurrent reads of the same key, tracks
 * staleness, and pushes invalidation to every active subscriber so no widget
 * ever polls.
 */
export class QueryCache {
  private entries = new Map<string, Entry>();
  /** Test instrumentation: how many times a fetch actually hit the provider. */
  public fetchCount = 0;

  private entry(key: QueryKey, staleTime: number): Entry {
    const k = serialize(key);
    let e = this.entries.get(k);
    if (!e) {
      e = { key, state: { status: "loading" }, subscribers: new Set(), staleTime };
      this.entries.set(k, e);
    }
    return e;
  }

  async read<T>(key: QueryKey, staleTime: number, fetcher: () => Promise<T>): Promise<T> {
    const e = this.entry(key, staleTime);

    if (e.state.status === "success" && !e.state.isStale) {
      if (Date.now() - e.state.updatedAt < e.staleTime) return e.state.data as T;
    }
    if (e.inflight) return e.inflight as Promise<T>;
    e.fetcher = fetcher as () => Promise<unknown>;

    const p = (async () => {
      try {
        this.fetchCount++;
        const data = await fetcher();
        this.set(e, { status: "success", data, isStale: false, updatedAt: Date.now() });
        return data;
      } catch (err) {
        this.set(e, { status: "error", error: toProviderError(err), data: peekData(e.state) });
        throw err;
      } finally {
        e.inflight = undefined;
      }
    })();

    e.inflight = p;
    return p;
  }

  subscribe(
    key: QueryKey,
    staleTime: number,
    fetcher: () => Promise<unknown>,
    onState: (s: QueryState<unknown>) => void,
  ) {
    const e = this.entry(key, staleTime);
    e.subscribers.add(onState);
    onState(e.state);
    e.fetcher = fetcher;
    void this.read(key, staleTime, fetcher).catch(() => {});
    this.schedule(e);
    return {
      unsubscribe: () => {
        e.subscribers.delete(onState);
        if (e.subscribers.size === 0) this.unschedule(e);
      },
    };
  }

  /**
   * Keeps a watched entry fresh, which is what makes the class comment above
   * true. It promised no widget ever polls, and delivered that only for data
   * some action invalidates — a read-only provider has no action, so its
   * widgets rendered whatever was true at mount and never moved again. The
   * shipping tado° tile did exactly that: correct on open, silently frozen
   * after. See FINDINGS.md finding 15.
   *
   * `staleTime` doubles as the interval rather than a second field: for a
   * subscribed query, "this data expires after N" and "someone is watching it"
   * already say when to fetch, and a `refetchInterval` that disagreed with
   * `staleTime` would only be a way to get it wrong.
   *
   * Chained, not `setInterval`, so a slow or failing fetch cannot stack up
   * requests behind itself.
   */
  private schedule(e: Entry) {
    if (e.timer || e.subscribers.size === 0 || !(e.staleTime > 0)) return;
    const timer = setTimeout(() => {
      e.timer = undefined;
      const f = e.fetcher;
      if (e.subscribers.size === 0 || !f) return;
      void this.read(e.key, e.staleTime, f)
        .catch(() => {})
        .finally(() => this.schedule(e));
    }, e.staleTime);
    // A pending timer otherwise keeps the process alive, which would hang the
    // assert files — they exit on their own and nothing there unsubscribes.
    (timer as { unref?: () => void }).unref?.();
    e.timer = timer;
  }

  private unschedule(e: Entry) {
    if (e.timer) clearTimeout(e.timer);
    e.timer = undefined;
  }

  /** Prefix match: ["tado","roomState"] invalidates every room. */
  invalidate(prefix: QueryKey) {
    for (const e of this.entries.values()) {
      if (!isPrefix(prefix, e.key)) continue;
      if (e.state.status === "success") this.set(e, { ...e.state, isStale: true });
      const f = e.fetcher;
      if (e.subscribers.size > 0 && f) {
        void this.read(e.key, 0, f).catch(() => {});
      }
    }
  }

  /** Drop everything for a provider so stale data cannot survive a disconnect. */
  evictProvider(providerId: string) {
    for (const [k, e] of this.entries) {
      if (e.key[0] === providerId) {
        // Before the state push: a refresh timer outliving its entry would go
        // on calling a provider the user just disconnected.
        this.unschedule(e);
        this.set(e, { status: "error", error: { kind: "disconnected", message: "Provider disconnected" } });
        this.entries.delete(k);
      }
    }
  }

  private set(e: Entry, state: QueryState<unknown>) {
    e.state = state;
    for (const s of e.subscribers) s(state);
  }
}

const isPrefix = (prefix: QueryKey, key: QueryKey) =>
  prefix.length <= key.length && prefix.every((p, i) => key[i] === p);

const peekData = (s: QueryState<unknown>) => (s.status === "success" ? s.data : undefined);

export const toProviderError = (err: unknown): ProviderError => {
  if (err && typeof err === "object" && "kind" in err && "message" in err) return err as ProviderError;
  return { kind: "provider-error", message: err instanceof Error ? err.message : String(err) };
};
