// SPDX-License-Identifier: MIT
import { onScopeDispose, ref, type Ref } from "vue";
import { defineWidget, type WidgetContext } from "@sdk/contract/sdk";
import { WIDGET_FOCUS_EVENT, widgetFocusRequestMatches } from "@sdk";
import {
  normalizeAiUsageConfig,
  type AiUsageConfig,
  type AiUsageSettings,
} from "../aiUsageLogic";

export type UsageSourceStatus =
  | "available"
  | "notFound"
  | "notConfigured"
  | "waiting"
  | "conflict"
  | "unsupported"
  | "error";

export interface UsageWindow {
  id: string;
  label: string;
  usedPercent: number;
  resetsAt: number | null;
}

export interface UsageSource {
  status: UsageSourceStatus;
  plan: string | null;
  windows: UsageWindow[];
  updatedAt: number | null;
  detail: string | null;
}

export interface AiUsageSnapshot {
  codex: UsageSource;
  claude: UsageSource;
}

export interface AiUsageModel {
  settings: AiUsageSettings;
  data: Ref<AiUsageSnapshot | null>;
  loading: Ref<boolean>;
  enablingClaude: Ref<boolean>;
  error: Ref<string | null>;
  refresh(): Promise<void>;
  enableClaudeCapture(): Promise<void>;
  notifyReset(provider: "codex" | "claude", windowLabel: string): Promise<void>;
  testNotification(): Promise<void>;
}

/**
 * Usage is read when the widget is visible; there is no reason to keep
 * polling while it is hidden. The shared gate also protects duplicated widget
 * instances from issuing one command each.
 */
const MIN_REFRESH_MS = 60_000;
const MIN_LOADING_MS = 750;
type AiUsageCapability = NonNullable<WidgetContext["aiUsage"]>;

let cachedSnapshot: AiUsageSnapshot | undefined;
let cachedAt = 0;
let lastAttemptAt = 0;
let lastFailure: unknown;
let sharedRequest: Promise<AiUsageSnapshot> | undefined;

/** One in-flight/read per process, with a one-minute cooldown between starts. */
function readSharedSnapshot(capability: AiUsageCapability): Promise<AiUsageSnapshot> {
  const now = Date.now();
  if (cachedSnapshot && now - cachedAt < MIN_REFRESH_MS) {
    return Promise.resolve(cachedSnapshot);
  }
  if (sharedRequest) return sharedRequest;
  if (now - lastAttemptAt < MIN_REFRESH_MS) {
    return Promise.reject(
      lastFailure instanceof Error
        ? lastFailure
        : new Error("AI usage refresh is limited to once per minute"),
    );
  }

  lastAttemptAt = now;
  sharedRequest = capability
    .snapshot<AiUsageSnapshot>()
    .then((snapshot) => {
      cachedSnapshot = snapshot;
      cachedAt = Date.now();
      lastFailure = undefined;
      return snapshot;
    })
    .catch((cause) => {
      lastFailure = cause;
      throw cause;
    })
    .finally(() => {
      sharedRequest = undefined;
    });
  return sharedRequest;
}

function cacheSnapshot(snapshot: AiUsageSnapshot): void {
  cachedSnapshot = snapshot;
  cachedAt = Date.now();
  lastAttemptAt = cachedAt;
  lastFailure = undefined;
}

export const aiUsageWidget = defineWidget<AiUsageConfig>({
  name: "ai-usage",
  displayName: "AI Usage",
  description: "Codex and Claude Code subscription usage.",
  defaultSize: { w: 4, h: 4 },
  minSize: { w: 3, h: 3 },
  mode: "both",
  capabilities: { aiUsage: true, notification: true },
  configuration: {
    codexEnabled: { type: "boolean", label: "Codex", default: true },
    claudeEnabled: { type: "boolean", label: "Claude Code", default: true },
  },
  component: {
    setup(ctx: WidgetContext<AiUsageConfig>): AiUsageModel {
      const settings = normalizeAiUsageConfig(ctx.config);
      const data = ref<AiUsageSnapshot | null>(null);
      const loading = ref(false);
      const enablingClaude = ref(false);
      const error = ref<string | null>(null);
      let request: Promise<void> | undefined;
      let disposed = false;

      const refresh = (): Promise<void> => {
        if (request) return request;
        loading.value = true;
        const startedAt = performance.now();
        request = (async () => {
          try {
            if (!ctx.aiUsage) {
              error.value = "AI Usage capability unavailable";
              return;
            }
            const snapshot = await readSharedSnapshot(ctx.aiUsage);
            if (!disposed) {
              data.value = snapshot;
              error.value = null;
            }
          } catch (cause) {
            if (!disposed) error.value = cause instanceof Error ? cause.message : String(cause);
          } finally {
            const remaining = MIN_LOADING_MS - (performance.now() - startedAt);
            if (remaining > 0) {
              await new Promise<void>((resolve) => window.setTimeout(resolve, remaining));
            }
          }
        })().finally(() => {
          if (!disposed) loading.value = false;
          request = undefined;
        });
        return request;
      };

      const enableClaudeCapture = async (): Promise<void> => {
        if (!ctx.aiUsage || enablingClaude.value) return;
        enablingClaude.value = true;
        try {
          const snapshot = await ctx.aiUsage.enableClaudeCapture<AiUsageSnapshot>();
          cacheSnapshot(snapshot);
          data.value = snapshot;
          error.value = null;
        } catch (cause) {
          error.value = cause instanceof Error ? cause.message : String(cause);
        } finally {
          enablingClaude.value = false;
        }
      };

      const notifyReset = (
        provider: "codex" | "claude",
        windowLabel: string,
      ): Promise<void> => {
        if (!ctx.notification) {
          return Promise.reject(new Error("Notification capability unavailable"));
        }
        const providerLabel = provider === "codex" ? "Codex" : "Claude Code";
        const periodLabel = windowLabel === "5 hours" ? "5-hour" : "7-day";
        return ctx.notification.show({
          title: "AI Usage",
          body: `${providerLabel} ${periodLabel} usage window reset.`,
        });
      };

      const testNotification = (): Promise<void> => {
        if (!ctx.notification) {
          return Promise.reject(new Error("Notification capability unavailable"));
        }
        return ctx.notification.show({
          title: "AI Usage",
          body: "Notify on reset is enabled.",
        });
      };

      const onWidgetFocus = (event: Event) => {
        if (widgetFocusRequestMatches(event, ctx.instanceId, "desk")) void refresh();
      };
      window.addEventListener(WIDGET_FOCUS_EVENT, onWidgetFocus);
      onScopeDispose(() => {
        disposed = true;
        window.removeEventListener(WIDGET_FOCUS_EVENT, onWidgetFocus);
      });

      void refresh();
      return {
        settings,
        data,
        loading,
        enablingClaude,
        error,
        refresh,
        enableClaudeCapture,
        notifyReset,
        testNotification,
      };
    },
  },
});
