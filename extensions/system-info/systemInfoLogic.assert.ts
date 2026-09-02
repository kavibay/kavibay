/**
 * Quick checks for System Info helpers (run: npx tsx src/extensions/system-info/systemInfoLogic.assert.ts).
 */
import {
  batteryAccent,
  formatMemoryGb,
  formatUptime,
  memoryUsagePercent,
  normalizeSystemInfoConfig,
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

console.log("systemInfoLogic.assert: ok");
