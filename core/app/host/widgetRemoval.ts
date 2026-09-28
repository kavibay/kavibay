import { shallowRef, type InjectionKey, type Ref } from "vue";

export interface WidgetRemovalRequest {
  instanceId: string;
  surface: "card" | "palette";
}

export interface WidgetRemoval {
  pending: Readonly<Ref<WidgetRemovalRequest | null>>;
  request(instanceId: string, surface: WidgetRemovalRequest["surface"]): Promise<boolean>;
  answer(request: WidgetRemovalRequest, confirmed: boolean): void;
  cancel(): void;
}

export const WIDGET_REMOVAL_KEY: InjectionKey<WidgetRemoval> = Symbol("widgetRemoval");

/** One pending deletion, rendered on the surface where it was requested. */
export function createWidgetRemoval(): WidgetRemoval {
  const pending = shallowRef<WidgetRemovalRequest | null>(null);
  let settle: ((confirmed: boolean) => void) | undefined;

  function cancel() {
    const resolve = settle;
    settle = undefined;
    pending.value = null;
    resolve?.(false);
  }

  return {
    pending,
    request(instanceId, surface) {
      cancel();
      return new Promise((resolve) => {
        settle = resolve;
        pending.value = { instanceId, surface };
      });
    },
    answer(request, confirmed) {
      // A closing control must never answer a newer request for another widget.
      if (pending.value !== request) return;
      const resolve = settle;
      settle = undefined;
      pending.value = null;
      resolve?.(confirmed);
    },
    cancel,
  };
}
