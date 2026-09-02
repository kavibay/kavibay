// SPDX-License-Identifier: MIT
import { onScopeDispose, ref, type Ref } from "vue";
import { defineWidget, type WidgetContext } from "@sdk/contract/sdk";
import {
  normalizeSystemInfoConfig,
  type SystemInfoConfig,
} from "../systemInfoLogic";

export interface BatteryInfo {
  percent: number;
  state: string;
  time_to_empty_secs: number | null;
}

export interface SystemInfo {
  os_name: string;
  os_version: string;
  hostname: string;
  cpu_count: number;
  cpu_brand: string;
  cpu_usage_percent: number;
  used_memory_mb: number;
  total_memory_mb: number;
  uptime_secs: number;
  battery: BatteryInfo | null;
}

export interface SystemInfoModel {
  settings: SystemInfoConfig;
  data: Ref<SystemInfo | null>;
  loading: Ref<boolean>;
  error: Ref<string | null>;
  refresh(): Promise<void>;
}

const REFRESH_MS = 5_000;

export const systemInfoWidget = defineWidget<Record<string, boolean>>({
  name: "system-info",
  displayName: "System Info",
  description: "CPU, memory, and battery information from the host.",
  defaultSize: { w: 5, h: 3 },
  minSize: { w: 3, h: 2 },
  mode: "both",
  capabilities: { systemInfo: true },
  configuration: {
    showOs: { type: "boolean", label: "OS & host", default: true },
    showCpu: { type: "boolean", label: "CPU", default: true },
    showMemory: { type: "boolean", label: "Memory", default: true },
    showBattery: { type: "boolean", label: "Battery", default: true },
    showUptime: { type: "boolean", label: "Uptime", default: true },
  },
  component: {
    setup(ctx: WidgetContext<Record<string, boolean>>): SystemInfoModel {
      const settings = normalizeSystemInfoConfig(ctx.config);
      const data = ref<SystemInfo | null>(null);
      const loading = ref(false);
      const error = ref<string | null>(null);
      let request: Promise<void> | undefined;
      let sequence = 0;

      const refresh = (): Promise<void> => {
        if (request) return request;
        const current = ++sequence;
        loading.value = true;
        request = (async () => {
          if (!ctx.systemInfo) {
            error.value = "System Info capability unavailable";
            return;
          }
          try {
            data.value = await ctx.systemInfo.snapshot<SystemInfo>();
            error.value = null;
          } catch (cause) {
            if (current === sequence) {
              error.value = cause instanceof Error ? cause.message : String(cause);
            }
          }
        })().finally(() => {
          if (current === sequence) loading.value = false;
          request = undefined;
        });
        return request;
      };

      const timer = ctx.systemInfo ? setInterval(() => void refresh(), REFRESH_MS) : undefined;
      onScopeDispose(() => {
        sequence++;
        if (timer !== undefined) clearInterval(timer);
      });

      void refresh();
      return { settings, data, loading, error, refresh };
    },
  },
});
