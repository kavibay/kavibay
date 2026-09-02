import { onScopeDispose, ref } from "vue";
import { defineExtension, defineWidget, type WidgetContext } from "@sdk/contract/sdk";

/**
 * The second no-provider case. Todo proves persisted data without a provider;
 * Clock proves a widget that is purely local and still owns no lifecycle.
 *
 * It does own a timer, and that is not a contradiction. "No lifecycle code"
 * means no connect screen, no loading spinner, no error state — the four things
 * the runtime renders, which a widget must never duplicate. A clock genuinely
 * needs to tick, and the tick is domain logic.
 *
 * The teardown is the part worth reading: `setup` runs inside an `effectScope`
 * owned by the runtime (see useWidgetRuntime.ts), so `onScopeDispose` fires
 * when the instance unmounts. That is the whole disposal contract — a widget
 * never sees a mount or unmount hook, it just registers cleanup.
 */

interface ClockConfig {
  showSeconds?: boolean;
}

const clockWidget = defineWidget<ClockConfig>({
  name: "clock",
  displayName: "Clock",
  defaultSize: { w: 2, h: 2 },
  minSize: { w: 1, h: 1 },
  mode: "both",
  // Optional, with a default: the gate stays `ready`, unlike a required field.
  configuration: {
    showSeconds: { type: "boolean", label: "Show seconds", default: true },
  },
  component: {
    setup(ctx: WidgetContext<ClockConfig>) {
      const now = ref(new Date());
      const timer = setInterval(() => { now.value = new Date(); }, 1000);
      onScopeDispose(() => clearInterval(timer));

      return { now, showSeconds: ctx.config.showSeconds ?? true };
    },
  },
});

export const clockExtension = defineExtension({
  name: "clock",
  version: "1.0.0",
  displayName: "Clock",
  engines: { kavibay: "^0.1" },
  contributes: { widgets: [clockWidget] },
});
