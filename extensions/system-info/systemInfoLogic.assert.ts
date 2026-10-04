/**
 * Quick checks for System Info helpers (run: npx tsx src/extensions/system-info/systemInfoLogic.assert.ts).
 */
import {
  batteryAccent,
  formatBytes,
  formatCpuShare,
  formatMemoryGb,
  formatUptime,
  memoryUsagePercent,
  networkRate,
  normalizeSystemInfoConfig,
  sparklinePoints,
  visibleHeroKeys,
} from "./systemInfoLogic";
import extension from "./extension";
import { systemInfoWidget } from "./widgets/systemInfo";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(extension.name === "system-info", "contract extension name");
assert(systemInfoWidget.capabilities?.systemInfo === true, "system info capability");

const defaults = normalizeSystemInfoConfig(undefined);
assert(defaults.showOs, "default OS visible");
assert(defaults.showCpu, "default CPU visible");
assert(defaults.showMemory, "default memory visible");
assert(defaults.showBattery, "default battery visible");
assert(defaults.showUptime, "default uptime visible");

const partial = normalizeSystemInfoConfig({ showCpu: false, showUptime: false });
assert(!partial.showCpu, "preserve CPU setting");
assert(!partial.showUptime, "preserve uptime setting");
assert(partial.showMemory, "default missing fields");

assert(formatUptime(45_240) === "12h 34m", "format uptime");
assert(formatMemoryGb(18_432, 65_536) === "18.0 / 64.0 GB", "format memory");
assert(memoryUsagePercent(25, 100) === 25, "calculate memory percentage");
assert(memoryUsagePercent(1, 0) === 0, "zero total memory");

assert(batteryAccent("charging", 10) === "green", "charging accent");
assert(batteryAccent("discharging", 20) === "red", "low battery accent");
assert(batteryAccent("discharging", 50) === "amber", "normal battery accent");

const allTiles = visibleHeroKeys(defaults, true);
assert(allTiles.join(",") === "cpu,memory,battery", "all hero tiles");
assert(
  visibleHeroKeys({ ...defaults, showMemory: false }, true).join(",") === "cpu,battery",
  "two hero tiles",
);
assert(
  visibleHeroKeys(
    { ...defaults, showCpu: false, showMemory: false, showBattery: false },
    true,
  ).length === 0,
  "no hero tiles",
);

assert(defaults.showHistory && defaults.showDisks, "large-view sections default on");
assert(!normalizeSystemInfoConfig({ showProcesses: false }).showProcesses, "preserve processes setting");

assert(formatBytes(0) === "0 B", "zero bytes");
assert(formatBytes(1536) === "1.5 KB", "one decimal below 10");
assert(formatBytes(412 * 1024 ** 3) === "412 GB", "whole number from 10");
assert(formatBytes(2 * 1024 ** 4) === "2.0 TB", "terabytes");
assert(formatBytes(Number.NaN) === "0 B", "non-finite bytes");

assert(formatCpuShare(0) === "0.0%", "idle share");
assert(formatCpuShare(4.25) === "4.3%", "share below 10");
assert(formatCpuShare(37.6) === "38%", "share from 10");

assert(sparklinePoints([], 5) === "", "empty sparkline");
assert(sparklinePoints([10, 90], 5) === "3,90 4,10", "newest at the right edge");
assert(sparklinePoints([0, 50, 100], 3) === "0,100 1,50 2,0", "full sparkline");

const iface = (name: string, rx: number, tx: number) => ({
  name,
  received_bytes: rx,
  transmitted_bytes: tx,
});
assert(networkRate(undefined, { interfaces: [], at: 0 }) === null, "first sample has no rate");
const rate = networkRate(
  { interfaces: [iface("Ethernet", 1000, 500)], at: 0 },
  { interfaces: [iface("Ethernet", 6000, 1500), iface("Wi-Fi", 9e12, 9e12)], at: 5000 },
);
assert(rate?.down === 1000 && rate.up === 200, "per adapter, new adapter skipped");
const alias = networkRate(
  { interfaces: [iface("Wi-Fi", 0, 0), iface("Wi-Fi-VirtualBox Filter", 0, 0)], at: 0 },
  { interfaces: [iface("Wi-Fi", 4000, 2000), iface("Wi-Fi-VirtualBox Filter", 4000, 2000)], at: 2000 },
);
assert(alias?.down === 2000 && alias.up === 1000, "a card listed twice is not counted twice");
const reset = networkRate(
  { interfaces: [iface("Ethernet", 5000, 5000)], at: 0 },
  { interfaces: [iface("Ethernet", 10, 10)], at: 1000 },
);
assert(reset?.down === 0 && reset.up === 0, "counter reset reads as no traffic");
assert(
  networkRate({ interfaces: [], at: 1000 }, { interfaces: [], at: 1000 }) === null,
  "no interval",
);

console.log("systemInfoLogic.assert: ok");
