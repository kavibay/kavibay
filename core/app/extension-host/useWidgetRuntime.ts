import { computed, effectScope, onScopeDispose, ref, shallowRef, watch, type EffectScope } from "vue";
import type {
  ProviderError, ProviderId, ProviderStatus, QueryState, Subscription,
  WidgetInstance, WidgetProviderApi,
} from "@sdk/contract/sdk";
import type { Host } from "./runtime";
import { toProviderError } from "./query-cache";
import { resolveBodyError, resolveBodyPhase } from "./widgetPhase";

/**
 * PHASE 3 — the runtime half of widget rendering.
 *
 * Everything a widget must not implement itself lives here: resolving the gate,
 * building the context, mounting, and deciding whether what the user sees is a
 * connect prompt, a settings form, a skeleton, an error, or the widget.
 *
 * Why the runtime owns skeleton and error: in a transparent always-on-top
 * overlay, five widgets inventing five loading states reads as breakage, not as
 * variety. Centralising it also means a widget cannot accidentally render stale
 * or half-fetched data — `phase` only reaches "ready" on `status: "success"`.
 *
 * The gate order (`provider` before `unconfigured`) is deliberate and comes from
 * the contract: a config field whose options come from a provider query cannot
 * be filled in before that provider connects.
 */

export type WidgetPhase =
  /** No such widget definition — usually an extension that failed to link. */
  | "missing-definition"
  /** Provider is not connected yet. Runtime shows the connect prompt. */
  | "provider"
  /** Required configuration is missing. Runtime shows the generated form. */
  | "unconfigured"
  /** Mounting, or a query the widget opened has not resolved yet. */
  | "loading"
  /** Setup threw, or a query the widget opened failed. */
  | "error"
  /** The only phase in which the widget component renders. */
  | "ready";

export interface WidgetRuntime {
  phase: Readonly<{ value: WidgetPhase }>;
  /** Present for `provider`, so the prompt can name the state it is in. */
  provider: Readonly<{ value: { id: ProviderId; status: ProviderStatus } | undefined }>;
  /** Present for `unconfigured`: the required keys the user still has to fill. */
  missingConfig: Readonly<{ value: string[] }>;
  /** Present for `error`. */
  error: Readonly<{ value: ProviderError | undefined }>;
  /** Whatever `component.setup(ctx)` returned. The view's only input. */
  model: Readonly<{ value: unknown }>;
  /** Re-resolves the gate. Call after connecting a provider or saving config. */
  refresh(): void;
  /**
   * Tears the widget down and mounts it again. Distinct from `refresh`: after a
   * failed query the gate is still `ready`, so re-resolving it changes nothing
   * and the retry has to go through setup again.
   */
  retry(): void;
}

export interface WidgetRuntimeOptions {
  /**
   * Set false when the widget runs somewhere this runtime cannot reach — inside
   * a sandboxed frame, where `setup` happens in another document.
   *
   * The gate is still this runtime's: whether a provider is connected and
   * whether required configuration exists are host-side facts, and they must be
   * answered the same way for a sandboxed widget as for any other. Only the
   * mounting is somebody else's.
   */
  mount?: boolean;
}

export function useWidgetRuntime(
  host: Host,
  instance: WidgetInstance<any>,
  options: WidgetRuntimeOptions = {},
): WidgetRuntime {
  const shouldMount = options.mount !== false;
  const gate = shallowRef(host.widgetGate(instance));
  const model = shallowRef<unknown>(undefined);
  const setupFailure = shallowRef<ProviderError | undefined>(undefined);
  const mounting = ref(false);

  /**
   * One entry per query the widget has opened, keyed by name and args.
   *
   * A single slot was wrong in a way nothing on screen would have shown:
   * whichever query reported last won, so a second query succeeding erased the
   * first one's failure and the widget went back to rendering — missing
   * whatever the failed query was meant to supply, with nothing saying so.
   *
   * Copy-on-write because `shallowRef` notifies on assignment, not on mutation.
   * These maps hold one to three entries.
   */
  const queryStates = shallowRef<ReadonlyMap<string, QueryState<unknown>>>(new Map());
  const recordQueryState = (slot: string, state: QueryState<unknown>) => {
    queryStates.value = new Map(queryStates.value).set(slot, state);
  };

  /** Shared with the sandboxed path, so the two cannot drift apart. */
  const bodyInput = computed(() => ({
    mounting: mounting.value,
    setupFailure: setupFailure.value,
    queryStates: [...queryStates.value.values()],
  }));

  /** Owns everything the widget registered, so unmount is one call. */
  let scope: EffectScope | undefined;

  const found = host.registry.widget(instance.definitionId);
  const declaredProviders = found?.widget.requires?.providers ?? [];

  const refresh = () => { gate.value = host.widgetGate(instance); };

  // A provider connecting is what moves this widget off the connect prompt, so
  // the runtime watches status rather than making the user re-open the widget.
  // One subscription per declared provider: any of them connecting can be what
  // completes the set the gate is waiting for.
  let statusSub: Subscription | undefined;
  if (declaredProviders.length > 0) {
    const subs = declaredProviders.map((pid) => host.onStatusChange(pid, refresh));
    statusSub = { unsubscribe: () => subs.forEach((sub) => sub.unsubscribe()) };
    // A credential stored in an earlier session is already valid; without this
    // the widget would open on a connect prompt for a provider that is in fact
    // connected, and only correct itself after the user acted.
    for (const pid of declaredProviders) void host.refreshProviderStatus(pid);
  }

  function unmount() {
    scope?.stop();
    scope = undefined;
    model.value = undefined;
    queryStates.value = new Map();
    setupFailure.value = undefined;
  }

  async function mount() {
    // Resets rather than just returning: `retry` raises `mounting` before
    // calling, so an early return here would leave the widget on a skeleton
    // that never resolves.
    if (!found || scope) {
      mounting.value = false;
      return;
    }
    mounting.value = true;
    const ctx = host.buildWidgetContext(instance);
    // Tee every query this widget opens into the runtime, so the runtime can
    // drive the skeleton without the widget reporting anything.
    if (ctx.providers) {
      ctx.providers = Object.fromEntries(
        Object.entries(ctx.providers).map(([pid, api]) => [
          pid,
          observeQueries(api, recordQueryState),
        ]),
      );
    }

    scope = effectScope();
    try {
      model.value = await scope.run(() => found.widget.component.setup(ctx));
    } catch (err) {
      setupFailure.value = toProviderError(err);
    } finally {
      mounting.value = false;
    }
  }

  watch(
    gate,
    (g) => { if (g.state === "ready" && shouldMount) void mount(); else unmount(); },
    { immediate: true },
  );

  /**
   * Configuration is read once, in `setup(ctx)` — a widget holds `ctx.config`
   * as a plain value, which is what makes it simple to write. So a change has
   * to remount rather than propagate, and the gate has to be re-resolved first
   * because clearing a required field moves the widget back to `unconfigured`.
   */
  watch(
    () => JSON.stringify(instance.configuration ?? {}),
    (next, previous) => {
      if (next === previous) return;
      refresh();
      retry();
    },
  );

  onScopeDispose(() => {
    statusSub?.unsubscribe();
    unmount();
  });

  const phase = computed<WidgetPhase>(() => {
    const g = gate.value;
    if (g.state !== "ready") return g.state;
    return resolveBodyPhase(bodyInput.value);
  });

  const provider = computed(() =>
    gate.value.state === "provider"
      ? { id: gate.value.provider, status: gate.value.status }
      : undefined,
  );

  const missingConfig = computed(() =>
    gate.value.state === "unconfigured" ? gate.value.missing : [],
  );

  const error = computed(() => resolveBodyError(bodyInput.value));

  // The panel shows a kind and a message; the raw object carries more (a
  // retryAfter, a nested cause) and is what a bug report needs.
  watch(error, (value) => {
    if (value) console.error(`[extension-host] ${instance.definitionId} failed:`, value);
  });

  function retry() {
    // `mounting` goes up *before* anything is cleared. Otherwise there is a
    // moment where the phase is still "error" but the error is already gone,
    // and the error panel renders with nothing to say — which is exactly what
    // it did. Clearing state a consumer is rendering from needs a destination,
    // not just an absence.
    mounting.value = true;
    unmount();
    if (gate.value.state !== "ready") {
      mounting.value = false;
      return;
    }
    void mount();
  }

  return { phase, provider, missingConfig, error, model, refresh, retry };
}

/**
 * Wraps the provider handle so the runtime sees the state of everything the
 * widget reads. `action` and `status` pass through untouched — an action is a
 * write the user asked for, not something the skeleton should react to.
 *
 * Each report is tagged with the query it came from, because the runtime has to
 * aggregate them rather than keep the last one.
 */
function observeQueries(
  api: WidgetProviderApi,
  onState: (slot: string, s: QueryState<unknown>) => void,
): WidgetProviderApi {
  /**
   * Name and args, matching the cache's own notion of identity, so re-reading a
   * query replaces its entry instead of adding one — and so the same query at
   * two different arguments is two independent states, which is the whole point.
   *
   * The cost: a widget that queries one name across many arguments accumulates
   * a slot per argument set, and a single failed one holds the widget on the
   * error panel until it is retried. That is the honest reading of "this query
   * failed"; no widget here does it, and a widget that needs to tolerate a
   * failing query should catch it rather than have the runtime guess.
   */
  const slotOf = (name: string, args?: Record<string, unknown>) =>
    `${name}:${JSON.stringify(args ?? {})}`;

  return {
    ...api,
    query: (async (name: string, args?: Record<string, unknown>) => {
      const slot = slotOf(name, args);
      onState(slot, { status: "loading" });
      try {
        const value = await api.query(name, args);
        onState(slot, { status: "success", data: value, isStale: false, updatedAt: Date.now() });
        return value;
      } catch (err) {
        onState(slot, { status: "error", error: toProviderError(err) });
        throw err;
      }
    }) as WidgetProviderApi["query"],
    subscribe: ((name: string, args: Record<string, unknown> | undefined, cb: (s: QueryState<unknown>) => void) =>
      api.subscribe(name, args, (s) => { onState(slotOf(name, args), s); cb(s); })) as WidgetProviderApi["subscribe"],
  };
}
