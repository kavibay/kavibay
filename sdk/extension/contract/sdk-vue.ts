// SPDX-License-Identifier: MIT
import { ref, shallowRef, watch, onScopeDispose, toValue, type Component, type Ref, type MaybeRefOrGetter } from "vue";
import type { ProviderId, QueryState, ProviderStatus, WidgetContext } from "./sdk";

/**
 * SECTION 8 — SDK layer. Convenience over the wire, and the ONLY file in the
 * SDK that imports a framework. Nothing here is part of the contract: it can
 * be rewritten or ported without a breaking change, and sections 1-7 compile
 * with no framework dependency at all.
 *
 * A Ref must never appear in a WidgetRequest. Everything below unwraps to
 * plain values before calling ctx.
 *
 * Ported unchanged from docs/extension-sdk-reference/sdk-vue.ts (Phase 1);
 * only the SPDX header and the extensionless import were added.
 */

/**
 * `provider` is now the first argument, and it is not optional.
 *
 * It could have defaulted to "the one provider, if there is exactly one",
 * which would have left every existing call site untouched. That default is a
 * trap: a widget that grows a second provider keeps compiling and starts
 * subscribing to whichever one the default happens to pick. Naming it costs
 * one argument and cannot silently mean something else later.
 */
export function useProviderQuery<T>(
  ctx: WidgetContext<any>,
  provider: ProviderId,
  name: string,
  args: MaybeRefOrGetter<Record<string, unknown>> = {},
) {
  const state = shallowRef<QueryState<T>>({ status: "loading" });
  let sub: { unsubscribe(): void } | undefined;

  const bind = async () => {
    sub?.unsubscribe();
    const api = ctx.providers?.[provider];
    if (!api) return;
    sub = await api.subscribe<T>(name, toValue(args), (s) => { state.value = s; });
  };

  watch(() => JSON.stringify(toValue(args)), bind, { immediate: true });
  onScopeDispose(() => sub?.unsubscribe());

  return {
    state,
    refresh: async () => { await bind(); },
  };
}

/**
 * The Vue half of a bundled extension — what `extensions/<id>/view.ts`
 * default-exports.
 *
 * A widget definition is deliberately framework-free (sections 1-7, and the
 * assert suite loads definitions headlessly under `tsx`, which cannot compile
 * an SFC). So a bundled extension is three files that each answer one question:
 * `extension.ts` is what the widget IS, `manifest.json` is how the catalog
 * lists it, and this is how it draws.
 *
 * Keyed by the widget `name` from `defineWidget`, not by the fully qualified
 * definition id: an extension folder cannot know the namespace the host will
 * derive for it, and it must not be able to claim one.
 */
export interface WidgetView {
  view: Component;
  /** Palette/catalog icon. Optional — the catalog falls back to no icon. */
  icon?: Component;
  /** Optional host menu rendered in the card/palette chrome. */
  menu?: Component;
  /** Optional custom settings panel rendered by the host card chrome. */
  settings?: Component;
}

/** View metadata for an extension that contributes palette actions only. */
export interface ExtensionActionView {
  icon?: Component;
}

/**
 * Vue metadata keyed by widget name. `__extension__` is reserved for an
 * action-only extension's catalog icon, which has no widget view to attach to.
 */
export type ExtensionViews = Record<string, WidgetView | ExtensionActionView>;

export function useProviderStatus(
  ctx: WidgetContext<any>,
  provider: ProviderId,
): Ref<ProviderStatus> {
  const status = ref<ProviderStatus>({ state: "disconnected" });
  const api = ctx.providers?.[provider];
  if (api) {
    void api.status().then((s) => { status.value = s; });
    const sub = api.onStatusChange((s) => { status.value = s; });
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
