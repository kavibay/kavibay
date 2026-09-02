/**
 * Quick checks for focus-tracker helpers
 * (run: npx tsx src/extensions/focus-tracker/focusTrackerLogic.assert.ts).
 */
import {
  barPercent,
  formatDuration,
  habitsOverLimit,
  rangeBounds,
  topRows,
  type FocusSummaryRow,
} from "./focusTrackerLogic";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

// Fixed local Tuesday afternoon — week starts Monday 20 Jul 2026.
const now = new Date(2026, 6, 21, 15, 30, 0);
const endMs = now.getTime();

const day = rangeBounds("day", now);
assert(day.startMs === new Date(2026, 6, 21, 0, 0, 0, 0).getTime(), "day start midnight");
assert(day.endMs === endMs, "day end is now");

const week = rangeBounds("week", now);
assert(week.startMs === new Date(2026, 6, 20, 0, 0, 0, 0).getTime(), "week start Monday");
assert(week.endMs === endMs, "week end is now");

const month = rangeBounds("month", now);
assert(month.startMs === new Date(2026, 6, 1, 0, 0, 0, 0).getTime(), "month start 1st");
assert(month.endMs === endMs, "month end is now");

// Sunday → prior Monday (not next week).
const sunday = new Date(2026, 6, 19, 12, 0, 0);
const weekSun = rangeBounds("week", sunday);
assert(
  weekSun.startMs === new Date(2026, 6, 13, 0, 0, 0, 0).getTime(),
  "week from Sunday starts prior Monday",
);

assert(formatDuration(2 * 3_600_000 + 14 * 60_000) === "2h 14m", "format 2h 14m");
assert(formatDuration(45 * 60_000) === "45m", "format 45m");
assert(formatDuration(30_000) === "30s", "format 30s");
assert(formatDuration(2 * 3_600_000) === "2h", "omit zero minutes");
assert(formatDuration(0) === "0s", "format zero");

assert(barPercent(50, 100) === 50, "bar 50%");
assert(barPercent(1, 0) === 0, "bar total 0");
assert(barPercent(0, 100) === 0, "bar duration 0");
assert(barPercent(150, 100) === 100, "bar clamp 100");

const rows: FocusSummaryRow[] = Array.from({ length: 12 }, (_, i) => ({
  key: `k${i}`,
  app_name: `app${i}`,
  window_title: `t${i}`,
  duration_ms: 1000 - i,
}));
const top = topRows(rows, 10);
assert(top.visible.length === 10, "topRows visible");
assert(top.moreCount === 2, "topRows moreCount");
assert(top.visible[0]?.key === "k0", "topRows preserves order");
const topDefault = topRows(rows);
assert(topDefault.visible.length === 10 && topDefault.moreCount === 2, "topRows default limit");

const over = habitsOverLimit([
  { app_name: "Chrome", duration_ms: 61 * 60_000, limit_minutes: 60 },
  { app_name: "Code", duration_ms: 60 * 60_000, limit_minutes: 60 },
  { app_name: "Slack", duration_ms: 10 * 60_000, limit_minutes: 30 },
]);
assert(over.length === 1 && over[0]?.app_name === "Chrome", "habitsOverLimit strict >");

console.log("focusTrackerLogic.assert: ok");
