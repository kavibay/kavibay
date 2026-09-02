/** Pure calendar helpers: month grid, event dots, and quick-add defaults. */

export interface MonthCell {
  dateKey: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
}

export interface CalendarEventLike {
  start: string;
  /** Exclusive end for all-day (Google `end.date`); RFC3339 for timed events. */
  end?: string;
  allDay?: boolean;
}

/** Format a local Date as YYYY-MM-DD. */
export function dateKeyFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Build a 6-week month grid (42 cells) with Monday as the default week start. */
export function buildMonthGrid(
  year: number,
  monthIndex0: number,
  todayKey: string,
  weekStartsOn = 1,
): MonthCell[] {
  const firstOfMonth = new Date(year, monthIndex0, 1);
  const leading = (firstOfMonth.getDay() - weekStartsOn + 7) % 7;
  const gridStart = new Date(year, monthIndex0, 1 - leading);
  const cells: MonthCell[] = [];

  for (let i = 0; i < 42; i += 1) {
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    const dateKey = dateKeyFromDate(d);
    cells.push({
      dateKey,
      day: d.getDate(),
      inMonth: d.getMonth() === monthIndex0,
      isToday: dateKey === todayKey,
    });
  }

  return cells;
}

/** Map event start (RFC3339 datetime or YYYY-MM-DD) to a local dateKey. */
export function dateKeyFromEventStart(start: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    return start;
  }
  return dateKeyFromDate(new Date(start));
}

/** True when the event start is an all-day date (YYYY-MM-DD) or flagged allDay. */
function isAllDayEvent(event: CalendarEventLike): boolean {
  return Boolean(event.allDay) || /^\d{4}-\d{2}-\d{2}$/.test(event.start);
}

/** Parse YYYY-MM-DD to local midnight. */
function dateKeyToLocalMidnight(dateKey: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/** Add `deltaDays` to a YYYY-MM-DD key (local calendar arithmetic). */
function addDaysToDateKey(dateKey: string, deltaDays: number): string {
  const d = dateKeyToLocalMidnight(dateKey);
  d.setDate(d.getDate() + deltaDays);
  return dateKeyFromDate(d);
}

/**
 * Local date keys an event occupies.
 * - All-day: inclusive start through day before exclusive Google `end.date`.
 * - Timed: every local calendar day from start through end (inclusive start day;
 *   if end is exactly local midnight, that end day is exclusive).
 */
export function dateKeysForEvent(event: CalendarEventLike): string[] {
  if (isAllDayEvent(event)) {
    const startKey = dateKeyFromEventStart(event.start);
    if (!event.end || !/^\d{4}-\d{2}-\d{2}$/.test(event.end)) {
      return [startKey];
    }
    // Google all-day end.date is exclusive.
    const keys: string[] = [];
    for (let key = startKey; key < event.end; key = addDaysToDateKey(key, 1)) {
      keys.push(key);
    }
    return keys.length > 0 ? keys : [startKey];
  }

  const startKey = dateKeyFromEventStart(event.start);
  if (!event.end) {
    return [startKey];
  }
  const endDate = new Date(event.end);
  if (Number.isNaN(endDate.getTime())) {
    return [startKey];
  }
  // Timed end at local midnight belongs to the previous day (half-open).
  let lastKey = dateKeyFromDate(endDate);
  if (
    endDate.getHours() === 0 &&
    endDate.getMinutes() === 0 &&
    endDate.getSeconds() === 0 &&
    endDate.getMilliseconds() === 0
  ) {
    lastKey = addDaysToDateKey(lastKey, -1);
  }
  if (lastKey < startKey) {
    return [startKey];
  }
  const keys: string[] = [];
  for (let key = startKey; key <= lastKey; key = addDaysToDateKey(key, 1)) {
    keys.push(key);
  }
  return keys;
}

/** True when `dateKey` falls in the event's occupied local days. */
export function eventOccupiesDateKey(event: CalendarEventLike, dateKey: string): boolean {
  return dateKeysForEvent(event).includes(dateKey);
}

/** Date keys in the visible month grid that have at least one event. */
export function eventDotsForMonth(
  events: CalendarEventLike[],
  year: number,
  monthIndex0: number,
  weekStartsOn = 1,
): Set<string> {
  const gridKeys = new Set(
    buildMonthGrid(year, monthIndex0, "", weekStartsOn).map((cell) => cell.dateKey),
  );
  const dots = new Set<string>();
  for (const event of events) {
    for (const key of dateKeysForEvent(event)) {
      if (gridKeys.has(key)) {
        dots.add(key);
      }
    }
  }
  return dots;
}

/**
 * Events on a day, sorted for display:
 * - All-day events first (stable by dateKey/start string)
 * - Timed events by parsed instant (RFC3339 offsets normalized via Date)
 */
export function eventsForDay(events: CalendarEventLike[], dateKey: string): CalendarEventLike[] {
  return events
    .filter((event) => eventOccupiesDateKey(event, dateKey))
    .slice()
    .sort((a, b) => {
      const aAllDay = isAllDayEvent(a);
      const bAllDay = isAllDayEvent(b);
      if (aAllDay !== bAllDay) {
        return aAllDay ? -1 : 1;
      }
      if (aAllDay) {
        return a.start.localeCompare(b.start);
      }
      return new Date(a.start).getTime() - new Date(b.start).getTime();
    });
}

/** Default quick-add start: next whole hour today, otherwise 09:00 local on that day. */
export function defaultQuickAddStart(selectedDayKey: string, now: Date): Date {
  const [y, m, d] = selectedDayKey.split("-").map(Number);
  const todayKey = dateKeyFromDate(now);

  if (selectedDayKey === todayKey) {
    const start = new Date(now);
    start.setMinutes(0, 0, 0);
    if (start.getTime() < now.getTime()) {
      start.setHours(start.getHours() + 1);
    }
    return start;
  }

  return new Date(y, m - 1, d, 9, 0, 0, 0);
}

/** Default quick-add end: start plus duration (default 30 minutes). */
export function defaultQuickAddEnd(start: Date, durationMinutes = 30): Date {
  return new Date(start.getTime() + durationMinutes * 60_000);
}

/**
 * RFC3339 bounds for the visible month grid (includes leading/trailing overflow days).
 * rangeEnd is exclusive: start of the day after the last grid cell.
 */
export function monthRangeIso(
  year: number,
  monthIndex0: number,
  weekStartsOn = 1,
): { rangeStart: string; rangeEnd: string } {
  const grid = buildMonthGrid(year, monthIndex0, "", weekStartsOn);
  const firstKey = grid[0]!.dateKey;
  const lastKey = grid[41]!.dateKey;
  const rangeStart = dateKeyToLocalMidnight(firstKey).toISOString();
  const lastMidnight = dateKeyToLocalMidnight(lastKey);
  const rangeEnd = new Date(
    lastMidnight.getFullYear(),
    lastMidnight.getMonth(),
    lastMidnight.getDate() + 1,
  ).toISOString();
  return { rangeStart, rangeEnd };
}

// --- Menu → widget refresh (no host changes) ---

type CalendarRefreshCb = () => void;

const refreshListeners = new Map<string, Set<CalendarRefreshCb>>();

/** Ask the mounted calendar widget for this instance to refetch. */
export function requestCalendarRefresh(instanceId: string): void {
  const listeners = refreshListeners.get(instanceId);
  if (!listeners) return;
  for (const cb of listeners) {
    cb();
  }
}

/**
 * Subscribe the widget to menu Refresh requests.
 * Returns an unsubscribe function (call on unmount).
 */
export function onCalendarRefreshRequest(
  instanceId: string,
  cb: CalendarRefreshCb,
): () => void {
  let listeners = refreshListeners.get(instanceId);
  if (!listeners) {
    listeners = new Set();
    refreshListeners.set(instanceId, listeners);
  }
  listeners.add(cb);
  return () => {
    listeners!.delete(cb);
    if (listeners!.size === 0) {
      refreshListeners.delete(instanceId);
    }
  };
}
