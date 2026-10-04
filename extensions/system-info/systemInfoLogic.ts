// SPDX-License-Identifier: MIT

export interface SystemInfoConfig {
  showOs: boolean;
  showCpu: boolean;
  showMemory: boolean;
  showBattery: boolean;
  showUptime: boolean;
  /** The four below appear only in the large view (see `EXTENDED_MIN_HEIGHT`). */
  showHistory: boolean;
  showNetwork: boolean;
  showDisks: boolean;
  showProcesses: boolean;
}

/** Default visible fields for System Info instances. */
export const DEFAULT_SYSTEM_INFO_CONFIG: SystemInfoConfig = {
  showOs: true,
  showCpu: true,
  showMemory: true,
  showBattery: true,
  showUptime: true,
  showHistory: true,
  showNetwork: true,
  showDisks: true,
  showProcesses: true,
};

/** Widget height in px from which the large view's sections appear. */
export const EXTENDED_MIN_HEIGHT = 420;

/** Normalize the schema-driven configuration handed to widget setup. */
export function normalizeSystemInfoConfig(raw: unknown): SystemInfoConfig {
  const settings = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    showOs: settings.showOs !== false,
    showCpu: settings.showCpu !== false,
    showMemory: settings.showMemory !== false,
    showBattery: settings.showBattery !== false,
    showUptime: settings.showUptime !== false,
    showHistory: settings.showHistory !== false,
    showNetwork: settings.showNetwork !== false,
    showDisks: settings.showDisks !== false,
    showProcesses: settings.showProcesses !== false,
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

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"];

/** Format a byte count in binary units, one decimal below 10 ("1.2 GB", "412 GB"). */
export function formatBytes(bytes: number): string {
  let value = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = value < 10 && unit > 0 ? 1 : 0;
  return `${value.toFixed(digits)} ${BYTE_UNITS[unit]}`;
}

/** Format a process group's CPU share like Task Manager: one decimal below 10 %. */
export function formatCpuShare(percent: number): string {
  return `${percent < 10 ? percent.toFixed(1) : Math.round(percent)}%`;
}

/**
 * SVG polyline points for 0–100 values in a `0 0 (slots - 1) 100` viewBox,
 * newest at the right edge so a short history grows in from the right.
 */
export function sparklinePoints(values: readonly number[], slots: number): string {
  const offset = slots - values.length;
  return values.map((value, i) => `${offset + i},${100 - roundPercent(value)}`).join(" ");
}

export interface InterfaceTotals {
  name: string;
  received_bytes: number;
  transmitted_bytes: number;
}

export interface NetworkSample {
  interfaces: InterfaceTotals[];
  /** `Date.now()` when the sample arrived. */
  at: number;
}

/** Bytes per second. */
export interface NetworkRate {
  down: number;
  up: number;
}

/**
 * Throughput between two samples of lifetime counters: per direction, the
 * busiest adapter. Not the sum — Windows lists one card more than once (a
 * VirtualBox filter shows Wi-Fi again with identical counters) and WSL traffic
 * crosses vEthernet and then Wi-Fi, so a sum counts the same bytes twice.
 * The ceiling: two cards busy at once read as the busier one.
 *
 * An adapter missing from the earlier sample just connected and is skipped:
 * its counter holds its whole lifetime, not this interval. A counter that went
 * backwards (adapter reset) reads as no traffic rather than a negative rate.
 */
export function networkRate(
  prev: NetworkSample | undefined,
  next: NetworkSample,
): NetworkRate | null {
  if (!prev) return null;
  const secs = (next.at - prev.at) / 1000;
  if (!(secs > 0)) return null;
  let down = 0;
  let up = 0;
  for (const iface of next.interfaces) {
    const before = prev.interfaces.find((p) => p.name === iface.name);
    if (!before) continue;
    down = Math.max(down, iface.received_bytes - before.received_bytes);
    up = Math.max(up, iface.transmitted_bytes - before.transmitted_bytes);
  }
  return { down: down / secs, up: up / secs };
}
