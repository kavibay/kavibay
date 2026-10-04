// SPDX-License-Identifier: MIT
import { onScopeDispose, ref, type Ref } from "vue";
import { defineWidget, type WidgetContext } from "@sdk/contract/sdk";
import {
  memoryUsagePercent,
  networkRate,
  normalizeSystemInfoConfig,
  roundPercent,
  type InterfaceTotals,
  type NetworkRate,
  type NetworkSample,
  type SystemInfoConfig,
} from "../systemInfoLogic";

export interface BatteryInfo {
  percent: number;
  state: string;
  time_to_empty_secs: number | null;
}

export interface DiskInfo {
  mount: string;
  total_bytes: number;
  available_bytes: number;
}

export interface ProcessInfo {
  name: string;
  count: number;
  cpu_percent: number;
  memory_bytes: number;
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
  /** Null unless the snapshot asked for it — see `SystemInfoInclude`. Processes are
   * empty for the first refresh or two while Rust has no interval to measure yet. */
  disks: DiskInfo[] | null;
  network: InterfaceTotals[] | null;
  processes: ProcessInfo[] | null;
}

export interface HistorySample {
  cpu: number;
  memory: number;
}

export interface SystemInfoModel {
  settings: SystemInfoConfig;
  data: Ref<SystemInfo | null>;
  loading: Ref<boolean>;
  error: Ref<string | null>;
  /** CPU and RAM percentages, oldest first; kept in every view so the large one opens with a past. */
  history: Ref<HistorySample[]>;
  /** Null until two network samples exist. */
  network: Ref<NetworkRate | null>;
  /** Whether the large view is showing; the view reports its size here. */
  extended: Ref<boolean>;
  setExtended(on: boolean): void;
  refresh(): Promise<void>;
}

const REFRESH_MS = 5_000;
/** Five minutes of samples at `REFRESH_MS`. */
export const HISTORY_SLOTS = 60;

export const systemInfoWidget = defineWidget<Record<string, boolean>>({
  name: "system-info",
  displayName: "System Info",
  description: "CPU, memory, battery, disks, network, and processes from the host.",
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
    showHistory: { type: "boolean", label: "History graph (large view)", default: true },
    showNetwork: { type: "boolean", label: "Network (large view)", default: true },
    showDisks: { type: "boolean", label: "Disks (large view)", default: true },
    showProcesses: { type: "boolean", label: "Top processes (large view)", default: true },
  },
  component: {
    setup(ctx: WidgetContext<Record<string, boolean>>): SystemInfoModel {
      const settings = normalizeSystemInfoConfig(ctx.config);
      const data = ref<SystemInfo | null>(null);
      const loading = ref(false);
      const error = ref<string | null>(null);
      const history = ref<HistorySample[]>([]);
      const network = ref<NetworkRate | null>(null);
      const extended = ref(false);
      let lastNetwork: NetworkSample | undefined;
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
            const include = extended.value
              ? {
                  disks: settings.showDisks,
                  processes: settings.showProcesses,
                  network: settings.showNetwork,
                }
              : undefined;
            const next = await ctx.systemInfo.snapshot<SystemInfo>(include);
            history.value = [
              ...history.value,
              {
                cpu: roundPercent(next.cpu_usage_percent),
                memory: memoryUsagePercent(next.used_memory_mb, next.total_memory_mb),
              },
            ].slice(-HISTORY_SLOTS);
            const sample = next.network
              ? { interfaces: next.network, at: Date.now() }
              : undefined;
            network.value = sample ? networkRate(lastNetwork, sample) : null;
            lastNetwork = sample;
            data.value = next;
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

      const setExtended = (on: boolean): void => {
        if (extended.value === on) return;
        extended.value = on;
        // Fetch the large view's sections now rather than on the next tick;
        // a request already in flight was made without them.
        if (on) void Promise.resolve(request).then(refresh);
      };

      const timer = ctx.systemInfo ? setInterval(() => void refresh(), REFRESH_MS) : undefined;
      onScopeDispose(() => {
        sequence++;
        if (timer !== undefined) clearInterval(timer);
      });

      void refresh();
      return { settings, data, loading, error, history, network, extended, setExtended, refresh };
    },
  },
});
