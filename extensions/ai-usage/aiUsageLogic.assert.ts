// SPDX-License-Identifier: MIT
import {
  formatPercent,
  formatReset,
  elapsedTimeLabel,
  isOutdated,
  lastSeenLabel,
  normalizeAiUsageConfig,
  presentUsageWindow,
  usagePercent,
  usageTone,
  statusLabel,
  timeProgressPercent,
} from "./aiUsageLogic";
import extension from "./extension";
import { aiUsageWidget } from "./widgets/aiUsage";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(extension.name === "ai-usage", "contract extension name");
assert(aiUsageWidget.capabilities?.aiUsage === true, "AI Usage capability");
assert(aiUsageWidget.capabilities?.notification === true, "notification capability");
assert(aiUsageWidget.configuration?.codexEnabled?.default === true, "Codex enabled by default");
assert(aiUsageWidget.configuration?.claudeEnabled?.default === true, "Claude enabled by default");
assert(normalizeAiUsageConfig({ codexEnabled: false }).codexEnabled === false, "disable Codex");
assert(normalizeAiUsageConfig({ claudeEnabled: false }).claudeEnabled === false, "disable Claude");
assert(normalizeAiUsageConfig({}).claudeEnabled === true, "enable Claude by default");
assert(usagePercent(72) === 72, "used percentage");
assert(usagePercent(33.35) === 33.4, "round used percentage");
assert(usagePercent(-20) === 0, "clamp low provider percentage");
assert(usagePercent(140) === 100, "clamp high provider percentage");
assert(usagePercent(Number.NaN) === 0, "handle non-finite provider percentage");
assert(formatPercent(28) === "28%", "format whole percentage");
assert(formatPercent(66.7) === "66.7%", "format decimal percentage");

assert(formatReset(null, 1_000) === "Reset unknown", "unknown reset");
assert(formatReset(1_000, 1_000) === "Reset due", "due reset");
assert(formatReset(1_061, 1_000) === "Resets in 2m", "minute reset");
assert(formatReset(8_200, 1_000) === "Resets in 2h", "exact hour reset");
assert(formatReset(8_300, 1_000) === "Resets in 2h 2m", "hour reset");
assert(formatReset(18_959, 1_000) === "Resets in 5h", "round 60 minutes into next hour");
assert(formatReset(87_400, 1_000) === "Resets in 1d", "exact day reset");
assert(formatReset(98_200, 1_000) === "Resets in 1d 3h", "day reset");

assert(usageTone(59) === "healthy", "healthy threshold");
assert(usageTone(60) === "warning", "warning threshold");
assert(usageTone(85) === "critical", "critical threshold");
assert(statusLabel("notConfigured") === "Setup needed", "status label");
assert(
  timeProgressPercent({ id: "primary", label: "7 days", resetsAt: 5 * 86_400 }, 0) === 28.6,
  "seven-day time marker",
);
assert(
  elapsedTimeLabel({ id: "primary", label: "7 days", resetsAt: 5 * 86_400 }, 0) ===
    "Elapsed: 2d · 29%",
  "seven-day elapsed time label",
);
assert(
  elapsedTimeLabel({ id: "five_hour", label: "5 hours", resetsAt: 5 * 3_600 }, 4 * 3_600 * 1_000) ===
    "Elapsed: 4h · 80%",
  "five-hour elapsed time label",
);

const demoWindow = {
  id: "seven_day",
  label: "7 days",
  usedPercent: 100,
  resetsAt: 20,
};
assert(presentUsageWindow(demoWindow, 15_000).countdownSeconds === 5, "reset countdown");
assert(presentUsageWindow(demoWindow, 20_000).resetting, "reset animation starts at zero");
assert(presentUsageWindow(demoWindow, 20_750).usedPercent === 50, "reset animation counts down");
assert(presentUsageWindow(demoWindow, 20_750).resetting, "reset animation is active");
assert(!presentUsageWindow(demoWindow, 20_750).celebratingReset, "LFG waits for animation end");
assert(presentUsageWindow(demoWindow, 21_750).celebratingReset, "LFG follows reset animation");
assert(presentUsageWindow(demoWindow, 22_000).usedPercent === 0, "reset animation ends at zero");
assert(!presentUsageWindow(demoWindow, 23_000).celebratingReset, "LFG ends after one second");
const codexSevenDay = { ...demoWindow, id: "primary" };
assert(
  presentUsageWindow(codexSevenDay, 22_000).resetsAt === 20 + 7 * 24 * 60 * 60,
  "Codex seven-day window uses its label duration",
);

console.log("aiUsageLogic.assert: ok");

const day = 86_400;
const fiveHours = { id: "five_hour", label: "5 hours", usedPercent: 25 };
const sevenDays = { id: "seven_day", label: "7 days", usedPercent: 4 };
assert(!isOutdated([], 10 * day * 1_000), "no windows is not outdated");
assert(
  isOutdated([{ ...fiveHours, resetsAt: 1 * day }, { ...sevenDays, resetsAt: 6 * day }], 10 * day * 1_000),
  "every window reset since the read",
);
assert(
  !isOutdated([{ ...fiveHours, resetsAt: 1 * day }, { ...sevenDays, resetsAt: 12 * day }], 10 * day * 1_000),
  "the 7-day window still holds",
);
assert(
  !isOutdated([{ ...sevenDays, resetsAt: 10 * day }], 10 * day * 1_000 + 2_000),
  "the last window's reset animation still plays",
);
assert(!isOutdated([{ ...sevenDays, resetsAt: null }], 10 * day * 1_000), "unknown reset is not outdated");
assert(lastSeenLabel(null, 0) === "No recent data", "no read time");
assert(lastSeenLabel(0, 12 * day * 1_000 + 5_000) === "Last seen 12d ago", "days");
assert(lastSeenLabel(0, 3 * 3_600 * 1_000 + 60_000) === "Last seen 3h ago", "hours");
assert(lastSeenLabel(0, 10_000) === "Last seen 1m ago", "under a minute rounds up");
