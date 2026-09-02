// SPDX-License-Identifier: MIT
import { onScopeDispose, ref, watch, type Ref } from "vue";
import {
  defineWidget,
  type FocusTrackerCapability,
  type FocusTrackerGroupBy,
  type FocusTrackerIgnoreKind,
  type FocusTrackerRange,
  type WidgetContext,
} from "@sdk/contract/sdk";
import type { FocusSummary, FocusTrackerStatus } from "../focusTrackerLogic";

export interface FocusTrackerModel {
  range: Ref<FocusTrackerRange>;
  groupBy: Ref<FocusTrackerGroupBy>;
  summary: Ref<FocusSummary | null>;
  status: Ref<FocusTrackerStatus | null>;
  error: Ref<string | null>;
  loading: Ref<boolean>;
  ignoringKey: Ref<string | null>;
  setRange(next: FocusTrackerRange): void;
  setGroupBy(next: FocusTrackerGroupBy): void;
  refresh(): Promise<void>;
  ignore(kind: FocusTrackerIgnoreKind, value: string, key: string): Promise<void>;
}

/**
 * Settings is a Vue chrome component rather than the widget view, so it does
 * not receive the model prop. Keep the host capability discoverable by the
 * current widget instance without importing host code into the extension.
 */
const liveCapabilities = new Map<string, FocusTrackerCapability>();

export function getFocusTrackerCapability(instanceId: string): FocusTrackerCapability | undefined {
  return liveCapabilities.get(instanceId);
}

const POLL_MS = 5_000;

export const focusTrackerWidget = defineWidget({
  name: "focus-tracker",
  displayName: "Focus Tracker",
  description: "Day, week, and month focus time by app or window title, with habit limits.",
  defaultSize: { w: 4, h: 5 },
  minSize: { w: 3, h: 3 },
  mode: "both",
  capabilities: { focusTracker: true },
  component: {
    setup(ctx: WidgetContext): FocusTrackerModel {
      const range = ref<FocusTrackerRange>("day");
      const groupBy = ref<FocusTrackerGroupBy>("app");
      const summary = ref<FocusSummary | null>(null);
      const status = ref<FocusTrackerStatus | null>(null);
      const error = ref<string | null>(null);
      const loading = ref(false);
      const ignoringKey = ref<string | null>(null);
      const api = ctx.focusTracker;
      let alive = true;
      let sequence = 0;

      if (api) liveCapabilities.set(ctx.instanceId, api);

      async function refresh(): Promise<void> {
        const current = ++sequence;
        if (!api) {
          error.value = "Focus Tracker capability unavailable";
          return;
        }
        if (!summary.value) loading.value = true;
        try {
          const [nextStatus, nextSummary] = await Promise.all([
            api.status<FocusTrackerStatus>(),
            api.summary<FocusSummary>(range.value, groupBy.value),
          ]);
          if (!alive || current !== sequence) return;
          status.value = nextStatus;
          summary.value = nextSummary;
          error.value = null;
        } catch (cause) {
          if (alive && current === sequence) {
            error.value = cause instanceof Error ? cause.message : String(cause);
          }
        } finally {
          if (alive && current === sequence) loading.value = false;
        }
      }

      function setRange(next: FocusTrackerRange): void {
        if (range.value === next) return;
        range.value = next;
      }

      function setGroupBy(next: FocusTrackerGroupBy): void {
        if (groupBy.value === next) return;
        groupBy.value = next;
      }

      async function ignore(kind: FocusTrackerIgnoreKind, value: string, key: string): Promise<void> {
        if (!api || !value || ignoringKey.value) return;
        ignoringKey.value = key;
        try {
          await api.upsertIgnoreRule(kind, value);
          await refresh();
        } catch (cause) {
          error.value = cause instanceof Error ? cause.message : String(cause);
        } finally {
          ignoringKey.value = null;
        }
      }

      watch([range, groupBy], () => { void refresh(); });
      const timer = api ? setInterval(() => { void refresh(); }, POLL_MS) : undefined;
      onScopeDispose(() => {
        alive = false;
        sequence++;
        if (timer !== undefined) clearInterval(timer);
        if (api && liveCapabilities.get(ctx.instanceId) === api) {
          liveCapabilities.delete(ctx.instanceId);
        }
      });

      void refresh();
      return { range, groupBy, summary, status, error, loading, ignoringKey, setRange, setGroupBy, refresh, ignore };
    },
  },
});
