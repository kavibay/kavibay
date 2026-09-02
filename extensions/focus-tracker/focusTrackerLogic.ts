/**
 * Focus Tracker widget: pure range, duration, chart, and habit helpers.
 */

/** Summary window: current calendar day, ISO week (Mon–Sun), or calendar month. */
export type FocusRange = "day" | "week" | "month";

/** How summary rows are grouped. */
export type FocusGroupBy = "app" | "title";

/** One aggregated focus row for charts/lists. */
export interface FocusSummaryRow {
  key: string;
  app_name: string;
  window_title: string;
  duration_ms: number;
}

/** Habit rule evaluation result for an app in the current range. */
export interface FocusHabitHit {
  app_name: string;
  duration_ms: number;
  limit_minutes: number;
}

/** Full summary payload from the backend. */
export interface FocusSummary {
  range: FocusRange;
  group_by: FocusGroupBy;
  rows: FocusSummaryRow[];
  habits: FocusHabitHit[];
  total_ms: number;
}

/** Live tracker process status. */
export interface FocusTrackerStatus {
  available: boolean;
  tracking: boolean;
  idle: boolean;
}

/** Stored habit limit rule. */
export interface HabitRule {
  id: number;
  app_name: string;
  limit_minutes: number;
}

/** Persisted exclusion for either an app or an exact window title. */
export interface IgnoreRule {
  id: number;
  kind: "app" | "title";
  value: string;
}

/** Local calendar midnight for a Date's Y/M/D. */
function localMidnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/**
 * Local `[startMs, endMs)` bounds for the current day / Mon-start week / month.
 * `endMs` is `now` so open sessions clip against wall-clock time.
 */
export function rangeBounds(range: FocusRange, now: Date): { startMs: number; endMs: number } {
  const endMs = now.getTime();
  if (range === "day") {
    return { startMs: localMidnight(now).getTime(), endMs };
  }
  if (range === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    return { startMs: start.getTime(), endMs };
  }
  // Week: local Monday 00:00 (ISO-style; Sunday falls in the prior week).
  const daysSinceMonday = (now.getDay() + 6) % 7;
  const monday = localMidnight(now);
  monday.setDate(monday.getDate() - daysSinceMonday);
  return { startMs: monday.getTime(), endMs };
}

/**
 * Human duration: `2h 14m` / `45m` / `30s` — floor units, omit zeros.
 */
export function formatDuration(ms: number): string {
  const totalSec = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || parts.length === 0) parts.push(`${s}s`);
  return parts.join(" ");
}

/**
 * Bar width percent 0–100; 0 when total is 0.
 */
export function barPercent(durationMs: number, totalMs: number): number {
  if (totalMs <= 0) return 0;
  const pct = (durationMs / totalMs) * 100;
  if (pct <= 0) return 0;
  if (pct >= 100) return 100;
  return pct;
}

/**
 * Keep the first `limit` rows (default 10); `moreCount` is how many were cut.
 */
export function topRows(
  rows: FocusSummaryRow[],
  limit = 10,
): { visible: FocusSummaryRow[]; moreCount: number } {
  const visible = rows.slice(0, limit);
  return { visible, moreCount: Math.max(0, rows.length - limit) };
}

/**
 * Habits whose usage strictly exceeds `limit_minutes`.
 */
export function habitsOverLimit(habits: FocusHabitHit[]): FocusHabitHit[] {
  return habits.filter((h) => h.duration_ms > h.limit_minutes * 60_000);
}
