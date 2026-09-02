import { ref, shallowRef, watch, onScopeDispose, toValue, type Ref, type MaybeRefOrGetter } from "vue";
import type { QueryState, ProviderStatus, WidgetContext } from "./sdk.js";

/**
 * SECTION 8 — SDK layer. Convenience over the wire, and the ONLY file in the
 * SDK that imports a framework. Nothing here is part of the contract: it can
 * be rewritten or ported without a breaking change, and sections 1-7 compile
 * with no framework dependency at all.
 *
 * A Ref must never appear in a WidgetRequest. Everything below unwraps to
 * plain values before calling ctx.
 */

export function useProviderQuery<T>(
  ctx: WidgetContext<any>,
  name: string,
  args: MaybeRefOrGetter<Record<string, unknown>> = {},
) {
  const state = shallowRef<QueryState<T>>({ status: "loading" });
  let sub: { unsubscribe(): void } | undefined;

  const bind = async () => {
    sub?.unsubscribe();
    if (!ctx.provider) return;
    sub = await ctx.provider.subscribe<T>(name, toValue(args), (s) => { state.value = s; });
  };

  watch(() => JSON.stringify(toValue(args)), bind, { immediate: true });
  onScopeDispose(() => sub?.unsubscribe());

  return {
    state,
    refresh: async () => { await bind(); },
  };
}

export function useProviderStatus(ctx: WidgetContext<any>): Ref<ProviderStatus> {
  const status = ref<ProviderStatus>({ state: "disconnected" });
  if (ctx.provider) {
    void ctx.provider.status().then((s) => { status.value = s; });
    const sub = ctx.provider.onStatusChange((s) => { status.value = s; });
    onScopeDispose(() => sub.unsubscribe());
  }
  return status;
}

/**
 * Reactive wrapper over ctx.data with write-through persistence.
 * `loaded` exists so a widget does not flash empty before the first read
 * resolves — the host renders the skeleton, but the widget still needs to know.
 */
export function useWidgetData<T>(ctx: WidgetContext<any>, key: string, initial: T) {
  const value = ref(initial) as Ref<T>;
  const loaded = ref(false);

  void ctx.data.get<T>(key).then((v) => {
    if (v !== undefined) value.value = v;
    loaded.value = true;
  });

  watch(value, (v) => { if (loaded.value) void ctx.data.set(key, JSON.parse(JSON.stringify(v))); }, { deep: true });

  return { value, loaded };
}
