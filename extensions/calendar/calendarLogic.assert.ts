/**
 * Quick checks for calendar helpers (run: npx tsx extensions/calendar/calendarLogic.assert.ts).
 */
import {
  buildMonthGrid,
  dateKeyFromDate,
  dateKeyFromEventStart,
  defaultQuickAddEnd,
  defaultQuickAddStart,
  eventDotsForMonth,
  eventOccupiesDateKey,
  eventsForDay,
  monthRangeIso,
  type CalendarEventLike,
} from "./calendarLogic";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

/** Format an absolute instant as RFC3339 wall time in the given UTC offset (minutes). */
function formatRfc3339WithOffset(date: Date, offsetMinutes: number): string {
  const wall = new Date(date.getTime() + offsetMinutes * 60_000);
  const y = wall.getUTCFullYear();
  const mo = String(wall.getUTCMonth() + 1).padStart(2, "0");
  const day = String(wall.getUTCDate()).padStart(2, "0");
  const h = String(wall.getUTCHours()).padStart(2, "0");
  const min = String(wall.getUTCMinutes()).padStart(2, "0");
  const sec = String(wall.getUTCSeconds()).padStart(2, "0");
  if (offsetMinutes === 0) {
    return `${y}-${mo}-${day}T${h}:${min}:${sec}Z`;
  }
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const oh = String(Math.floor(abs / 60)).padStart(2, "0");
  const om = String(abs % 60).padStart(2, "0");
  return `${y}-${mo}-${day}T${h}:${min}:${sec}${sign}${oh}:${om}`;
}

// --- month grid ---
const jan2026 = buildMonthGrid(2026, 0, "2026-01-15");
assert(jan2026.length === 42, "grid length 42");
assert(jan2026[0]?.dateKey === "2025-12-29", "grid starts on leading Monday");
assert(jan2026[0]?.inMonth === false, "leading cell out of month");
assert(jan2026.find((c) => c.dateKey === "2026-01-01")?.inMonth === true, "Jan 1 in month");
assert(jan2026.find((c) => c.dateKey === "2026-01-15")?.isToday === true, "today flag");
assert(jan2026.find((c) => c.dateKey === "2026-01-14")?.isToday === false, "non-today flag");

// --- dateKeyFromDate ---
const local = new Date(2026, 0, 5, 23, 59, 59);
assert(dateKeyFromDate(local) === "2026-01-05", "dateKey local not UTC");

// --- event start parsing ---
assert(dateKeyFromEventStart("2026-01-10") === "2026-01-10", "all-day dateKey");
assert(
  dateKeyFromEventStart("2026-01-10T22:30:00-05:00") === dateKeyFromDate(new Date("2026-01-10T22:30:00-05:00")),
  "datetime to local dateKey",
);

// --- event dots ---
const dotEvents: CalendarEventLike[] = [
  { start: "2026-01-05T10:00:00", allDay: false },
  { start: "2026-03-01", allDay: true },
  { start: "2025-12-30", allDay: true },
];
const dots = eventDotsForMonth(dotEvents, 2026, 0);
assert(dots.has("2026-01-05"), "dot on timed event in grid");
assert(dots.has("2025-12-30"), "dot on leading overflow day");
assert(!dots.has("2026-03-01"), "no dot outside grid month view");

// --- events for day ---
// Use local naive datetimes (no Z) so dateKey filtering matches any host timezone.
const targetDayKey = "2026-01-15";
const earlyTimedStart = `${targetDayKey}T09:00:00`;
const lateTimedStart = `${targetDayKey}T15:00:00`;
const dayEvents: CalendarEventLike[] = [
  { start: lateTimedStart, allDay: false },
  { start: targetDayKey, allDay: true },
  { start: earlyTimedStart, allDay: false },
  { start: "2026-01-16T09:00:00", allDay: false },
];
const onDay = eventsForDay(dayEvents, targetDayKey);
assert(onDay.length === 3, "filter to selected day");
assert(onDay[0]!.start === targetDayKey, "all-day sorts before timed");
assert(onDay[1]!.start === earlyTimedStart, "sorted by parsed time");
assert(onDay[2]!.start === lateTimedStart, "later timed event last");

// Mixed offsets: build instants on the same local calendar day, then encode with
// different numeric offsets so string sort disagrees with chronological order.
const mixedOffsetLocalDay = new Date(2026, 0, 15);
const earlierInstant = new Date(2026, 0, 15, 11, 0, 0);
const laterInstant = new Date(2026, 0, 15, 12, 30, 0);
const earlierOffsetStart = formatRfc3339WithOffset(earlierInstant, 120); // +02:00
const laterOffsetStart = formatRfc3339WithOffset(laterInstant, 0); // Z
const offsetDayKey = dateKeyFromDate(mixedOffsetLocalDay);
assert(
  dateKeyFromEventStart(earlierOffsetStart) === offsetDayKey,
  "earlier mixed-offset fixture on local day",
);
assert(
  dateKeyFromEventStart(laterOffsetStart) === offsetDayKey,
  "later mixed-offset fixture on local day",
);
assert(Date.parse(earlierOffsetStart) < Date.parse(laterOffsetStart), "earlier instant parses before later");
assert(
  laterOffsetStart < earlierOffsetStart,
  "mixed-offset string order disagrees with chronological order",
);
const offsetEvents: CalendarEventLike[] = [
  { start: laterOffsetStart, allDay: false },
  { start: earlierOffsetStart, allDay: false },
];
const offsetSorted = eventsForDay(offsetEvents, offsetDayKey);
assert(
  offsetSorted[0]!.start === earlierOffsetStart,
  "earlier instant (+02:00) before Z even when string sort differs",
);
assert(offsetSorted[1]!.start === laterOffsetStart, "later instant second");

// --- multi-day all-day (Google exclusive end.date) ---
const multiDayAllDay: CalendarEventLike = {
  start: "2026-07-21",
  end: "2026-07-23",
  allDay: true,
};
assert(eventOccupiesDateKey(multiDayAllDay, "2026-07-21"), "multi-day occupies start day");
assert(eventOccupiesDateKey(multiDayAllDay, "2026-07-22"), "multi-day occupies middle day");
assert(!eventOccupiesDateKey(multiDayAllDay, "2026-07-23"), "exclusive end day excluded");
assert(!eventOccupiesDateKey(multiDayAllDay, "2026-07-20"), "day before start excluded");
const multiDots = eventDotsForMonth([multiDayAllDay], 2026, 6);
assert(multiDots.has("2026-07-21"), "dot on multi-day start");
assert(multiDots.has("2026-07-22"), "dot on multi-day middle");
assert(!multiDots.has("2026-07-23"), "no dot on exclusive end");
assert(eventsForDay([multiDayAllDay], "2026-07-21").length === 1, "list on start day");
assert(eventsForDay([multiDayAllDay], "2026-07-22").length === 1, "list on middle day");
assert(eventsForDay([multiDayAllDay], "2026-07-23").length === 0, "no list on exclusive end");

// --- quick add defaults ---
const todayNow = new Date(2026, 0, 15, 14, 20, 0);
const todayStart = defaultQuickAddStart("2026-01-15", todayNow);
assert(todayStart.getHours() === 15 && todayStart.getMinutes() === 0, "today next whole hour");

const onHourNow = new Date(2026, 0, 15, 14, 0, 0);
const onHourStart = defaultQuickAddStart("2026-01-15", onHourNow);
assert(onHourStart.getHours() === 14 && onHourStart.getMinutes() === 0, "today on the hour stays");

const futureStart = defaultQuickAddStart("2026-01-20", todayNow);
assert(futureStart.getHours() === 9 && futureStart.getDate() === 20, "future day 09:00");

const pastStart = defaultQuickAddStart("2026-01-10", todayNow);
assert(pastStart.getHours() === 9 && pastStart.getDate() === 10, "past day 09:00");

const end = defaultQuickAddEnd(todayStart);
assert(end.getTime() - todayStart.getTime() === 30 * 60_000, "default 30 min end");
const end60 = defaultQuickAddEnd(todayStart, 60);
assert(end60.getTime() - todayStart.getTime() === 60 * 60_000, "custom duration end");

// --- month range iso ---
const range = monthRangeIso(2026, 0);
assert(range.rangeStart === new Date(2025, 11, 29, 0, 0, 0, 0).toISOString(), "rangeStart first grid cell");
assert(
  range.rangeEnd === new Date(2026, 1, 9, 0, 0, 0, 0).toISOString(),
  "rangeEnd exclusive day after last cell",
);

console.log("ok");
