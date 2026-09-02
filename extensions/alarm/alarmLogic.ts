// SPDX-License-Identifier: MIT
/** How an alarm announces itself when it fires. */
export type AlarmNotifyMode = "sound_and_pop" | "pop" | "sound" | "none";

export interface AlarmItem {
  id: string;
  hours: number;
  minutes: number;
  enabled: boolean;
  label: string;
  /** Sound / cockpit-pop combination; defaults to both. */
  notifyMode: AlarmNotifyMode;
}

export interface AlarmPersisted {
  alarms: AlarmItem[];
}

export const DEFAULT_ALARM_HOURS = 8;
export const DEFAULT_ALARM_MINUTES = 0;
export const DEFAULT_ALARM_NOTIFY_MODE: AlarmNotifyMode = "sound_and_pop";

/** Labels for the per-alarm notifier menu (order = display order). */
export const ALARM_NOTIFY_OPTIONS: ReadonlyArray<{
  mode: AlarmNotifyMode;
  label: string;
}> = [
  { mode: "sound_and_pop", label: "Sound and pop" },
  { mode: "pop", label: "Just pop" },
  { mode: "sound", label: "Just sound" },
  { mode: "none", label: "No notification" },
];

/** Coerce persisted / UI values to a known notify mode. */
export function normalizeAlarmNotifyMode(raw: unknown): AlarmNotifyMode {
  if (
    raw === "sound_and_pop" ||
    raw === "pop" ||
    raw === "sound" ||
    raw === "none"
  ) {
    return raw;
  }
  return DEFAULT_ALARM_NOTIFY_MODE;
}

/** True when the mode should play the alarm beep. */
export function notifyWantsSound(mode: AlarmNotifyMode): boolean {
  return mode === "sound_and_pop" || mode === "sound";
}

/** True when the mode should show/focus the cockpit and reveal the card. */
export function notifyWantsPop(mode: AlarmNotifyMode): boolean {
  return mode === "sound_and_pop" || mode === "pop";
}

/** Create a stable unique id for a new alarm row. */
export function generateAlarmId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Wall-clock HH:MM one minute from `from` (wraps past midnight). */
export function timeOneMinuteFromNow(from = new Date()): { hours: number; minutes: number } {
  const t = new Date(from.getTime() + 60_000);
  return { hours: t.getHours(), minutes: t.getMinutes() };
}

/** Default alarm row: one minute ahead (enabled), so a quick add can be verified. */
export function createDefaultAlarm(from = new Date()): AlarmItem {
  const { hours, minutes } = timeOneMinuteFromNow(from);
  return {
    id: generateAlarmId(),
    hours,
    minutes,
    enabled: true,
    label: "",
    notifyMode: DEFAULT_ALARM_NOTIFY_MODE,
  };
}

/**
 * Next fire timestamp for an alarm.
 * - Same calendar minute as now + skipCurrentMinute → tomorrow (edit/enable/after-fire)
 * - Same calendar minute without skip → due immediately (resume during alarm minute)
 * - Future today → that time
 * - Past today → tomorrow
 */
export function nextFireAtMs(
  hours: number,
  minutes: number,
  from = new Date(),
  skipCurrentMinute = false,
): number {
  const h = clampHour(hours);
  const m = clampMinute(minutes);
  const target = new Date(from);
  target.setSeconds(0, 0);
  target.setMilliseconds(0);
  target.setHours(h, m, 0, 0);

  const sameMinute = from.getHours() === h && from.getMinutes() === m;
  if (sameMinute) {
    if (skipCurrentMinute) {
      target.setDate(target.getDate() + 1);
      return target.getTime();
    }
    return from.getTime();
  }
  if (target.getTime() > from.getTime()) {
    return target.getTime();
  }
  target.setDate(target.getDate() + 1);
  return target.getTime();
}

/** Clamp hour to 0–23. */
export function clampHour(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(23, Math.max(0, Math.round(n)));
}

/** Clamp minute to 0–59. */
export function clampMinute(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(59, Math.max(0, Math.round(n)));
}

/** Format hours/minutes as HH:MM (tabular-friendly). */
export function formatAlarmTime(hours: number, minutes: number): string {
  return `${String(clampHour(hours)).padStart(2, "0")}:${String(clampMinute(minutes)).padStart(2, "0")}`;
}

/** Local calendar-minute key used to dedupe alarm fires. */
export function fireMinuteKey(now: Date): string {
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  return `${y}-${mo}-${d}-${h}:${mi}`;
}

/** Per-alarm fire key for a given local minute. */
export function alarmFireKey(alarmId: string, now: Date): string {
  return `${alarmId}:${fireMinuteKey(now)}`;
}

/**
 * True when alarm is enabled, local time matches, and it has not fired this calendar minute.
 * `lastFiredKey` is the alarmFireKey from the previous fire (or null if never fired).
 * Kept for tests; runtime scheduling uses `nextFireAtMs`.
 */
export function shouldFire(now: Date, alarm: AlarmItem, lastFiredKey: string | null): boolean {
  if (!alarm.enabled) return false;
  if (Number(alarm.hours) !== now.getHours() || Number(alarm.minutes) !== now.getMinutes()) {
    return false;
  }
  return lastFiredKey !== alarmFireKey(alarm.id, now);
}

/** Parse HH:MM, H:MM, H:M, or HHMM; returns null on invalid input. */
export function parseTimeString(value: string): { hours: number; minutes: number } | null {
  const trimmed = value.trim();
  const colon = /^(\d{1,2}):(\d{1,2})$/.exec(trimmed);
  if (colon) {
    const hours = Number(colon[1]);
    const minutes = Number(colon[2]);
    if (hours > 23 || minutes > 59) return null;
    return { hours: clampHour(hours), minutes: clampMinute(minutes) };
  }
  const compact = /^(\d{3,4})$/.exec(trimmed);
  if (compact) {
    const digits = compact[1];
    const hours = Number(digits.length === 3 ? digits.slice(0, 1) : digits.slice(0, 2));
    const minutes = Number(digits.length === 3 ? digits.slice(1) : digits.slice(2));
    if (hours > 23 || minutes > 59) return null;
    return { hours: clampHour(hours), minutes: clampMinute(minutes) };
  }
  return null;
}
/** Normalize one alarm row from persisted JSON. */
export function normalizeAlarmItem(raw: unknown): AlarmItem | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" && o.id ? o.id : generateAlarmId();
  return {
    id,
    hours: clampHour(o.hours),
    minutes: clampMinute(o.minutes),
    enabled: o.enabled !== false,
    label: typeof o.label === "string" ? o.label : "",
    notifyMode: normalizeAlarmNotifyMode(o.notifyMode),
  };
}

/** Normalize persisted alarm list JSON into a safe shape. */
export function normalizePersisted(raw: unknown): AlarmPersisted {
  if (!raw || typeof raw !== "object") return { alarms: [] };
  const o = raw as Record<string, unknown>;
  const list = Array.isArray(o.alarms) ? o.alarms : [];
  const alarms = list
    .map((item) => normalizeAlarmItem(item))
    .filter((item): item is AlarmItem => item != null);
  return { alarms };
}
