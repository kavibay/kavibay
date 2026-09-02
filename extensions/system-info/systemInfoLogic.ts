// SPDX-License-Identifier: MIT

export interface SystemInfoConfig {
  showOs: boolean;
  showCpu: boolean;
  showMemory: boolean;
  showBattery: boolean;
  showUptime: boolean;
}

/** Default visible fields for System Info instances. */
export const DEFAULT_SYSTEM_INFO_CONFIG: SystemInfoConfig = {
  showOs: true,
  showCpu: true,
  showMemory: true,
  showBattery: true,
  showUptime: true,
};

/** Normalize the schema-driven configuration handed to widget setup. */
export function normalizeSystemInfoConfig(raw: unknown): SystemInfoConfig {
  const settings = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    showOs: settings.showOs !== false,
    showCpu: settings.showCpu !== false,
    showMemory: settings.showMemory !== false,
    showBattery: settings.showBattery !== false,
    showUptime: settings.showUptime !== false,
  };
}

/** Format an uptime duration as total hours and minutes. */
export function formatUptime(secs: number): string {
  const safeSecs = Number.isFinite(secs) ? Math.max(0, secs) : 0;
  const hours = Math.floor(safeSecs / 3600);
  const minutes = Math.floor((safeSecs % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

/** Format used and total memory from megabytes as gigabytes. */
export function formatMemoryGb(usedMb: number, totalMb: number): string {
  return `${(usedMb / 1024).toFixed(1)} / ${(totalMb / 1024).toFixed(1)} GB`;
}

/** Calculate memory usage as a rounded percentage. */
export function memoryUsagePercent(usedMb: number, totalMb: number): number {
  return totalMb > 0 ? roundPercent((usedMb / totalMb) * 100) : 0;
}

/** Round and clamp a percentage to the inclusive 0–100 range. */
export function roundPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** Choose the battery tile accent from charge state and percentage. */
export function batteryAccent(state: string, percent: number): "green" | "amber" | "red" {
  if (state === "charging" || state === "full") return "green";
  return percent <= 20 ? "red" : "amber";
}

/** List enabled hero metrics, omitting battery when unavailable. */
export function visibleHeroKeys(
  settings: SystemInfoConfig,
  batteryPresent: boolean,
): Array<"cpu" | "memory" | "battery"> {
  const keys: Array<"cpu" | "memory" | "battery"> = [];
  if (settings.showCpu) keys.push("cpu");
  if (settings.showMemory) keys.push("memory");
  if (settings.showBattery && batteryPresent) keys.push("battery");
  return keys;
}
