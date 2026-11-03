// SPDX-License-Identifier: MIT
import { defineProvider, type ProviderHostContext } from "@sdk/contract/sdk";

/**
 * Fitbit: profile, today's activity and last night's sleep.
 *
 * Read from the Google Health API: Google turned the Fitbit Web API off on
 * 2026-10-30. The query names and result shapes are the ones widgets were
 * built against, so the vendor's data points, rollups and sessions stop here
 * and a widget still sees Fitbit's flat objects with wall-clock times.
 * Auth is attached host-side as Bearer.
 */

export const PROVIDER_ID = "kavibay.fitbit/fitbit";

export interface FitbitProfile {
  displayName: string;
  memberSince: string;
  avatarUrl: string;
  averageDailySteps: number;
}

export interface FitbitActivity {
  steps: number;
  caloriesOut: number;
  distance: number;
  floors: number;
  fairlyActiveMinutes: number;
  lightlyActiveMinutes: number;
  sedentaryMinutes: number;
  veryActiveMinutes: number;
  stepsGoal: number | null;
}

export interface FitbitSleep {
  minutesAsleep: number;
  timeInBed: number;
  efficiency: number | null;
  /** Main sleep's fell-asleep / woke-up time, device-local ISO without offset ("2026-10-09T23:41:30.000"). */
  startTime: string | null;
  endTime: string | null;
  records: number;
  /** Stage minutes; null when the night has no stage data (classic log, older device). */
  deepMinutes: number | null;
  lightMinutes: number | null;
  remMinutes: number | null;
  wakeMinutes: number | null;
  /**
   * The main sleep's stages in order, for a hypnogram. `level` is
   * deep/light/rem/wake for a stages log, asleep/restless/awake for a classic one.
   */
  timeline: FitbitSleepSegment[];
}

export interface FitbitSpo2Day {
  /** The date the night ended on, yyyy-MM-dd. */
  date: string;
  avg: number;
  min: number | null;
  max: number | null;
}

export interface FitbitHrvDay {
  /** The date the night ended on, yyyy-MM-dd. */
  date: string;
  rmssd: number;
  deepRmssd: number | null;
}

export interface FitbitRestingHeartRateDay {
  date: string;
  bpm: number;
}

export interface FitbitSleepNight {
  /** Fitbit's dateOfSleep: the date the night ended on, yyyy-MM-dd. */
  date: string;
  minutesAsleep: number;
  timeInBed: number;
  efficiency: number | null;
  startTime: string | null;
  endTime: string | null;
  deepMinutes: number | null;
  lightMinutes: number | null;
  remMinutes: number | null;
  wakeMinutes: number | null;
}

/** Overnight vitals for the night ending on one date; null where Fitbit has no reading. */
export interface FitbitNightVitals {
  /** Heart-rate variability, RMSSD in ms, over the main sleep. */
  hrv: number | null;
  /** RMSSD during deep sleep only. */
  deepHrv: number | null;
  /** Breaths per minute over the main sleep. */
  breathingRate: number | null;
  /** Breaths per minute in each stage; null where Fitbit had too little signal. */
  breathingDeep: number | null;
  breathingLight: number | null;
  breathingRem: number | null;
  restingHeartRate: number | null;
  spo2Avg: number | null;
  spo2Min: number | null;
  spo2Max: number | null;
  /**
   * True when Google refused a reading for a missing scope: the user unticked
   * health metrics on the consent screen and has to connect again. The other
   * readings still come through.
   */
  needsReconnect: boolean;
}

/** One intraday heart-rate reading; `time` is device-local ISO without offset. */
export interface FitbitHeartPoint {
  time: string;
  bpm: number;
}

/** One reading of a series through the night; `time` is device-local ISO without offset. */
export interface FitbitSeriesPoint {
  time: string;
  value: number;
}

/** SpO2 (%, per minute) and HRV (RMSSD ms, per 5 minutes) through one night. */
export interface FitbitNightSeries {
  spo2: FitbitSeriesPoint[];
  hrv: FitbitSeriesPoint[];
  /** Same meaning as on `nightVitals`: a series was refused for a missing scope. */
  needsReconnect: boolean;
}

export interface FitbitSleepSegment {
  start: string;
  level: string;
  minutes: number;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asString = (value: unknown): string => (typeof value === "string" ? value : "");

/** The API sends int64 as strings ("8432"); both forms count, anything else is 0. */
const asNumber = (value: unknown): number => maybeNumber(value) ?? 0;

/** A finite number (or numeric string), else null: a vital the watch did not measure is not zero. */
function maybeNumber(value: unknown): number | null {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) ? number : null;
}

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

/** Local calendar date, yyyy-MM-dd. */
function localDate(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** `date` moved by `days`, through the calendar so DST never shifts it. */
function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return localDate(new Date(year!, month! - 1, day! + days));
}

/** A google.type.Date (`{ year, month, day }`) as yyyy-MM-dd; "" when incomplete. */
function dateOf(raw: unknown): string {
  const date = asRecord(raw);
  const [year, month, day] = [date.year, date.month, date.day].map(maybeNumber);
  return year && month && day ? `${pad(year, 4)}-${pad(month)}-${pad(day)}` : "";
}

/**
 * An RFC 3339 instant shifted by its UTC offset ("7200s") to the wearer's wall
 * clock, as ISO without offset ("2026-10-08T23:41:30.000") — the form widgets
 * got from Fitbit. Without an offset this computer's time zone stands in.
 */
function localIso(instant: unknown, offset?: unknown): string | null {
  const ms = Date.parse(asString(instant));
  if (!Number.isFinite(ms)) return null;
  const seconds = Number.parseFloat(asString(offset));
  const shift = Number.isFinite(seconds) ? seconds * 1000 : -new Date(ms).getTimezoneOffset() * 60_000;
  return new Date(ms + shift).toISOString().slice(0, 23);
}

/** A sample's wall-clock time, from `sampleTime.physicalTime` + `utcOffset`. */
const sampleLocal = (point: Record<string, unknown>): string | null => {
  const time = asRecord(point.sampleTime);
  return localIso(time.physicalTime, time.utcOffset);
};

const BASE = "https://health.googleapis.com/v4/users/me";

/** Upper bound on pages per list call, so a server that never ends paging cannot loop us. */
const MAX_PAGES = 40;

/** GET after confirming a connection exists; auth is attached host-side. */
async function healthGet<T>(
  host: ProviderHostContext,
  url: string,
  params?: Record<string, string | number>,
): Promise<T> {
  if (!(await host.credentials.isConnected())) {
    throw { kind: "disconnected", message: "Fitbit is not connected" };
  }
  return host.http.get<T>(url, params);
}

/**
 * Every data point of `dataType` matching `filter`, following `nextPageToken`.
 * Each entry is the type's payload (`steps`, `sleep`, …) unwrapped from its
 * DataPoint, newest first as the API orders them.
 */
async function listPoints(
  host: ProviderHostContext,
  dataType: string,
  field: string,
  filter: string,
  pageSize: number,
): Promise<Record<string, unknown>[]> {
  const points: Record<string, unknown>[] = [];
  let pageToken = "";
  for (let page = 0; page < MAX_PAGES; page++) {
    const raw = asRecord(
      await healthGet(host, `${BASE}/dataTypes/${dataType}/dataPoints`, {
        filter,
        pageSize,
        ...(pageToken ? { pageToken } : {}),
      }),
    );
    const rows = Array.isArray(raw.dataPoints) ? raw.dataPoints : [];
    for (const row of rows) points.push(asRecord(asRecord(row)[field]));
    pageToken = asString(raw.nextPageToken);
    if (!pageToken) break;
  }
  return points;
}

/**
 * A data type's name in a filter: snake_case (`daily_resting_heart_rate`), as
 * the vitals guide's table lists it. The REST reference's one camelCase example
 * (`dailyHeartRateVariability.date`) left every multi-word type empty, while
 * one-word `steps` and `sleep` worked either way.
 */
const filterName = (dataType: string) => dataType.replace(/-/g, "_");

/** Daily summaries (`daily-…` types) for dates in [from, to). */
const listDaily = (host: ProviderHostContext, dataType: string, field: string, from: string, to: string) => {
  const name = filterName(dataType);
  return listPoints(host, dataType, field, `${name}.date >= "${from}" AND ${name}.date < "${to}"`, 1000);
};

/** Samples whose wall-clock time falls on a date in [from, to). */
const listSamples = (host: ProviderHostContext, dataType: string, field: string, from: string, to: string) => {
  const name = filterName(dataType);
  return listPoints(
    host,
    dataType,
    field,
    `${name}.sample_time.civil_time >= "${from}" AND ${name}.sample_time.civil_time < "${to}"`,
    10_000,
  );
};

/** Sleep sessions that ended on a date in [from, to); sleep pages hold at most 25. */
const listSleep = (host: ProviderHostContext, from: string, to: string) =>
  listPoints(
    host,
    "sleep",
    "sleep",
    `sleep.interval.civil_end_time >= "${from}" AND sleep.interval.civil_end_time < "${to}"`,
    25,
  );

/** One day's rollup of `dataType`; the value sits under `field` of the only row. */
async function rollupDay(
  host: ProviderHostContext,
  dataType: string,
  field: string,
  date: string,
): Promise<Record<string, unknown>> {
  if (!(await host.credentials.isConnected())) {
    throw { kind: "disconnected", message: "Fitbit is not connected" };
  }
  const civil = (day: string) => {
    const [year, month, dayOfMonth] = day.split("-").map(Number);
    return { date: { year, month, day: dayOfMonth } };
  };
  const raw = asRecord(
    await host.http.post(`${BASE}/dataTypes/${dataType}/dataPoints:dailyRollUp`, {
      range: { start: civil(date), end: civil(addDays(date, 1)) },
    }),
  );
  const rows = Array.isArray(raw.rollupDataPoints) ? raw.rollupDataPoints : [];
  return asRecord(asRecord(rows[0])[field]);
}

/** "3600s" (a protobuf Duration) in seconds. */
const durationSeconds = (value: unknown): number => {
  const seconds = Number.parseFloat(asString(value));
  return Number.isFinite(seconds) ? seconds : 0;
};

/** Maps `users/me/profile`. The Google Health profile carries no name, avatar or step average. */
function mapProfile(raw: unknown): FitbitProfile {
  return {
    displayName: "",
    memberSince: dateOf(asRecord(raw).membershipStartDate),
    avatarUrl: "",
    averageDailySteps: 0,
  };
}

/** One day's activity from six daily rollups, fetched side by side. */
async function fetchActivity(host: ProviderHostContext, date: string): Promise<FitbitActivity> {
  const [steps, distance, floors, calories, active, sedentary] = await Promise.all([
    rollupDay(host, "steps", "steps", date),
    rollupDay(host, "distance", "distance", date),
    rollupDay(host, "floors", "floors", date),
    rollupDay(host, "total-calories", "totalCalories", date),
    rollupDay(host, "active-minutes", "activeMinutes", date),
    rollupDay(host, "sedentary-period", "sedentaryPeriod", date),
  ]);
  const levels = Array.isArray(active.activeMinutesRollupByActivityLevel)
    ? active.activeMinutesRollupByActivityLevel.map(asRecord)
    : [];
  const minutesAt = (level: string) =>
    asNumber(levels.find((row) => row.activityLevel === level)?.activeMinutesSum);
  return {
    steps: asNumber(steps.countSum),
    caloriesOut: asNumber(calories.kcalSum),
    // Kilometres, as Fitbit's metric summary had it.
    distance: asNumber(distance.millimetersSum) / 1_000_000,
    floors: asNumber(floors.countSum),
    fairlyActiveMinutes: minutesAt("MODERATE"),
    lightlyActiveMinutes: minutesAt("LIGHT"),
    sedentaryMinutes: Math.round(durationSeconds(sedentary.durationSum) / 60),
    veryActiveMinutes: minutesAt("VIGOROUS"),
    // The daily goal moved out of the data API; null is the documented "no goal".
    stepsGoal: null,
  };
}

/** A sleep session in the shape the rest of this file reads. */
interface SleepLog {
  /** The date the night ended on, yyyy-MM-dd. */
  date: string;
  main: boolean;
  startTime: string | null;
  endTime: string | null;
  minutesAsleep: number;
  timeInBed: number;
  stages: Record<"deep" | "light" | "rem" | "wake", number> | null;
  timeline: FitbitSleepSegment[];
}

/** Fitbit's level names: deep/light/rem/wake for a stages log, asleep/restless/awake for classic. */
const STAGE_LEVEL: Record<string, string> = {
  DEEP: "deep",
  LIGHT: "light",
  REM: "rem",
  ASLEEP: "asleep",
  RESTLESS: "restless",
};

function toSleepLog(sleep: Record<string, unknown>): SleepLog {
  const interval = asRecord(sleep.interval);
  const summary = asRecord(sleep.summary);
  const isStages = sleep.type === "STAGES";
  const startMs = Date.parse(asString(interval.startTime));
  const endMs = Date.parse(asString(interval.endTime));
  const stageSummary = Array.isArray(summary.stagesSummary) ? summary.stagesSummary.map(asRecord) : [];
  const stageMinutes = (type: string) => asNumber(stageSummary.find((row) => row.type === type)?.minutes);
  const endTime = localIso(interval.endTime, interval.endUtcOffset);
  const stages = Array.isArray(sleep.stages) ? sleep.stages.map(asRecord) : [];
  return {
    date: dateOf(asRecord(interval.civilEndTime).date) || (endTime ?? "").slice(0, 10),
    main: asRecord(sleep.metadata).mainSleep === true,
    startTime: localIso(interval.startTime, interval.startUtcOffset),
    endTime,
    minutesAsleep: asNumber(summary.minutesAsleep),
    timeInBed: Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.round((endMs - startMs) / 60_000) : 0,
    stages: isStages
      ? { deep: stageMinutes("DEEP"), light: stageMinutes("LIGHT"), rem: stageMinutes("REM"), wake: stageMinutes("AWAKE") }
      : null,
    timeline: stages.map((stage) => {
      const type = asString(stage.type);
      const from = Date.parse(asString(stage.startTime));
      const to = Date.parse(asString(stage.endTime));
      return {
        start: localIso(stage.startTime, stage.startUtcOffset) ?? "",
        level: STAGE_LEVEL[type] ?? (isStages ? "wake" : "awake"),
        minutes: Number.isFinite(from) && Number.isFinite(to) ? (to - from) / 60_000 : 0,
      };
    }),
  };
}

/** The main sleep, or the longest when none is marked. */
function mainSleep(logs: SleepLog[]): SleepLog | null {
  if (logs.length === 0) return null;
  return logs.find((log) => log.main) ?? [...logs].sort((a, b) => b.timeInBed - a.timeInBed)[0]!;
}

/**
 * Asleep share of time in bed, in percent: Fitbit's efficiency for a stages
 * log. The new API reports no efficiency, so it is derived the same way.
 */
const efficiencyOf = (log: SleepLog | null): number | null =>
  log && log.timeInBed > 0 ? Math.round((log.minutesAsleep / log.timeInBed) * 100) : null;

/** One night from its sessions; a night with no log is zeros, not an error. */
function mapSleep(logs: SleepLog[]): FitbitSleep {
  const main = mainSleep(logs);
  return {
    minutesAsleep: logs.reduce((sum, log) => sum + log.minutesAsleep, 0),
    timeInBed: logs.reduce((sum, log) => sum + log.timeInBed, 0),
    efficiency: efficiencyOf(main),
    startTime: main?.startTime ?? null,
    endTime: main?.endTime ?? null,
    records: logs.length,
    deepMinutes: main?.stages?.deep ?? null,
    lightMinutes: main?.stages?.light ?? null,
    remMinutes: main?.stages?.rem ?? null,
    wakeMinutes: main?.stages?.wake ?? null,
    timeline: [...(main?.timeline ?? [])].sort((a, b) => a.start.localeCompare(b.start)),
  };
}

/**
 * One night per date, oldest first. Every date in `dates` gets a row so a
 * widget can draw the gap; a night without a log is zeros with null stages and
 * times. Naps count toward `minutesAsleep`; times and stages come from the main sleep.
 */
function mapNights(logs: SleepLog[], dates: string[]): FitbitSleepNight[] {
  const byDate = new Map<string, SleepLog[]>();
  for (const log of logs) byDate.set(log.date, [...(byDate.get(log.date) ?? []), log]);
  return dates.map((date) => {
    const { minutesAsleep, timeInBed, efficiency, startTime, endTime, deepMinutes, lightMinutes, remMinutes, wakeMinutes } =
      mapSleep(byDate.get(date) ?? []);
    return { date, minutesAsleep, timeInBed, efficiency, startTime, endTime, deepMinutes, lightMinutes, remMinutes, wakeMinutes };
  });
}

interface SleepArgs {
  /** yyyy-MM-dd; omitted or empty means last night. */
  date?: string;
}

/** A stage's breaths per minute; 0 or less is no reading, not a rate. */
const breathing = (summary: Record<string, unknown>, stats: string): number | null => {
  const rate = maybeNumber(asRecord(summary[stats]).breathsPerMinute);
  return rate !== null && rate > 0 ? rate : null;
};

const isPermissionDenied = (error: unknown): boolean =>
  asRecord(error).kind === "permission-denied";

/**
 * Runs `fetch`; a refusal for a missing scope becomes `fallback` and sets the
 * flag, so one scope the user did not grant does not take the whole query down.
 * Any other failure still throws.
 */
function scopeTolerant() {
  const state = { needsReconnect: false };
  const tolerate = <T>(fetch: Promise<T>, fallback: T): Promise<T> =>
    fetch.catch((error: unknown) => {
      if (!isPermissionDenied(error)) throw error;
      state.needsReconnect = true;
      return fallback;
    });
  return { state, tolerate };
}

/** The four vitals for the night ending on `date`, fetched side by side. */
async function fetchNightVitals(host: ProviderHostContext, date: string): Promise<FitbitNightVitals> {
  const { state, tolerate } = scopeTolerant();
  const next = addDays(date, 1);
  const [hrv, breaths, spo2, resting] = await Promise.all([
    tolerate(listDaily(host, "daily-heart-rate-variability", "dailyHeartRateVariability", date, next), []),
    // Per-stage rates, recorded once per night at wake-up.
    tolerate(listSamples(host, "respiratory-rate-sleep-summary", "respiratoryRateSleepSummary", date, next), []),
    tolerate(listDaily(host, "daily-oxygen-saturation", "dailyOxygenSaturation", date, next), []),
    tolerate(listDaily(host, "daily-resting-heart-rate", "dailyRestingHeartRate", date, next), []),
  ]);
  const hrvDay = hrv[0] ?? {};
  const breathDay = breaths[0] ?? {};
  const spo2Day = spo2[0] ?? {};
  return {
    hrv: maybeNumber(hrvDay.averageHeartRateVariabilityMilliseconds),
    deepHrv: maybeNumber(hrvDay.deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds),
    breathingRate: breathing(breathDay, "fullSleepStats"),
    breathingDeep: breathing(breathDay, "deepSleepStats"),
    breathingLight: breathing(breathDay, "lightSleepStats"),
    breathingRem: breathing(breathDay, "remSleepStats"),
    restingHeartRate: maybeNumber(resting[0]?.beatsPerMinute),
    spo2Avg: maybeNumber(spo2Day.averagePercentage),
    // The daily summary gives the night's bounds, which is what min/max meant.
    spo2Min: maybeNumber(spo2Day.lowerBoundPercentage),
    spo2Max: maybeNumber(spo2Day.upperBoundPercentage),
    needsReconnect: state.needsReconnect,
  };
}

/**
 * SpO2 and HRV samples through the night ending on `date`: noon the day before
 * to noon on `date`, wall clock. Fitbit keyed this by the end date too.
 */
async function fetchNightSeries(host: ProviderHostContext, date: string): Promise<FitbitNightSeries> {
  const { state, tolerate } = scopeTolerant();
  const before = addDays(date, -1);
  const next = addDays(date, 1);
  const [spo2Raw, hrvRaw] = await Promise.all([
    tolerate(listSamples(host, "oxygen-saturation", "oxygenSaturation", before, next), []),
    tolerate(listSamples(host, "heart-rate-variability", "heartRateVariability", before, next), []),
  ]);
  const from = `${before}T12:00`;
  const to = `${date}T12:00`;
  const series = (points: Record<string, unknown>[], value: (point: Record<string, unknown>) => unknown) =>
    points
      .map((point) => ({ time: sampleLocal(point), value: maybeNumber(value(point)) }))
      .filter((p): p is FitbitSeriesPoint => p.time !== null && p.value !== null && p.time >= from && p.time < to)
      .sort((a, b) => a.time.localeCompare(b.time));
  return {
    spo2: series(spo2Raw, (point) => point.percentage),
    hrv: series(hrvRaw, (point) => point.rootMeanSquareOfSuccessiveDifferencesMilliseconds),
    needsReconnect: state.needsReconnect,
  };
}

/** `args.date` checked, or today; the only way a date reaches a filter. */
function nightDate(args: SleepArgs): string {
  const date = args.date?.trim() || localDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("date must be yyyy-MM-dd");
  return date;
}

interface HeartRangeArgs {
  /** A sleep log's startTime / endTime, e.g. "2026-10-08T23:05:30.000". */
  start: string;
  end: string;
}

const LOCAL_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/;

/**
 * Per-minute heart rate between two wall-clock times. The API stores a sample
 * per second, so each minute is the rounded mean of its samples.
 *
 * ponytail: the range is converted to UTC with this computer's time zone,
 * which is the wearer's whenever both sit at the same desk; carry the sleep's
 * UTC offset through if a travelling user ever sees a shifted night.
 */
async function fetchHeartRange(host: ProviderHostContext, args: HeartRangeArgs): Promise<FitbitHeartPoint[]> {
  const from = LOCAL_TIME.exec(args.start ?? "");
  const to = LOCAL_TIME.exec(args.end ?? "");
  if (!from || !to) throw new Error("start and end must be yyyy-MM-ddTHH:mm");
  const start = `${from[1]}T${from[2]}`;
  const end = `${to[1]}T${to[2]}`;
  if (end <= start) throw new Error("end must be after start");
  // Longer than one night is not a night: refuse rather than fetch days of data.
  if (Date.parse(`${to[1]}T12:00:00`) - Date.parse(`${from[1]}T12:00:00`) > 86_400_000) {
    throw new Error("start and end must be at most one night apart");
  }
  // `end` is inclusive to the minute, as Fitbit's intraday window was.
  const utc = (local: string, plusMinutes = 0) => new Date(Date.parse(`${local}:00`) + plusMinutes * 60_000).toISOString();
  const samples = await listPoints(
    host,
    "heart-rate",
    "heartRate",
    `heart_rate.sample_time.physical_time >= "${utc(start)}" AND heart_rate.sample_time.physical_time < "${utc(end, 1)}"`,
    10_000,
  );
  const minutes = new Map<string, number[]>();
  for (const sample of samples) {
    const time = sampleLocal(sample);
    const bpm = maybeNumber(sample.beatsPerMinute);
    if (!time || bpm === null) continue;
    const minute = time.slice(0, 16);
    minutes.set(minute, [...(minutes.get(minute) ?? []), bpm]);
  }
  return [...minutes.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([minute, bpms]) => ({
      time: `${minute}:00`,
      bpm: Math.round(bpms.reduce((sum, bpm) => sum + bpm, 0) / bpms.length),
    }));
}

/** How many nights `sleepWeek` covers, last night included. */
const WEEK_NIGHTS = 7;

/** How many nights the `…History` queries cover: 53 weeks, a year-long calendar grid. */
const HISTORY_NIGHTS = 371;

/** History rows with a date and a reading, oldest first. */
function byDateWithReading<T extends { date: string }>(rows: T[], reading: (row: T) => number | null): T[] {
  return rows
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && reading(row) !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** One daily type over the last HISTORY_NIGHTS dates, in one paged list. */
function listHistory(host: ProviderHostContext, dataType: string, field: string) {
  const dates = lastDates(HISTORY_NIGHTS);
  return listDaily(host, dataType, field, dates[0]!, addDays(dates[dates.length - 1]!, 1));
}

/** Nightly SpO2 averages, oldest first. Only nights with a reading are listed. */
function mapSpo2History(raw: Record<string, unknown>[]): FitbitSpo2Day[] {
  const rows = raw.map((day) => ({
    date: dateOf(day.date),
    avg: maybeNumber(day.averagePercentage),
    min: maybeNumber(day.lowerBoundPercentage),
    max: maybeNumber(day.upperBoundPercentage),
  }));
  return byDateWithReading(rows, (day) => day.avg) as FitbitSpo2Day[];
}

/** Nightly HRV (RMSSD, ms), oldest first. Only nights with a reading are listed. */
function mapHrvHistory(raw: Record<string, unknown>[]): FitbitHrvDay[] {
  const rows = raw.map((day) => ({
    date: dateOf(day.date),
    rmssd: maybeNumber(day.averageHeartRateVariabilityMilliseconds),
    deepRmssd: maybeNumber(day.deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds),
  }));
  return byDateWithReading(rows, (day) => day.rmssd) as FitbitHrvDay[];
}

/** Daily resting heart rate, oldest first. Only days with a reading are listed. */
function mapRestingHeartRateHistory(raw: Record<string, unknown>[]): FitbitRestingHeartRateDay[] {
  const rows = raw.map((day) => ({ date: dateOf(day.date), bpm: maybeNumber(day.beatsPerMinute) }));
  return byDateWithReading(rows, (day) => day.bpm) as FitbitRestingHeartRateDay[];
}

/** The last `count` local dates ending today, oldest first. */
function lastDates(count: number, now = new Date()): string[] {
  return Array.from({ length: count }, (_, i) => {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (count - 1 - i));
    return localDate(day);
  });
}

/** Sleep sessions for the nights in `dates` (a contiguous, oldest-first run). */
async function fetchSleepLogs(host: ProviderHostContext, dates: string[]): Promise<SleepLog[]> {
  const raw = await listSleep(host, dates[0]!, addDays(dates[dates.length - 1]!, 1));
  return raw.map(toSleepLog);
}

const profileSchema = {
  type: "object" as const,
  fields: {
    displayName: { type: "string" as const },
    memberSince: { type: "string" as const },
    avatarUrl: { type: "string" as const },
    averageDailySteps: { type: "number" as const },
  },
};

const activitySchema = {
  type: "object" as const,
  fields: {
    steps: { type: "number" as const },
    caloriesOut: { type: "number" as const },
    distance: { type: "number" as const },
    floors: { type: "number" as const },
    fairlyActiveMinutes: { type: "number" as const },
    lightlyActiveMinutes: { type: "number" as const },
    sedentaryMinutes: { type: "number" as const },
    veryActiveMinutes: { type: "number" as const },
    stepsGoal: { type: "number" as const, nullable: true },
  },
};

const sleepSchema = {
  type: "object" as const,
  fields: {
    minutesAsleep: { type: "number" as const },
    timeInBed: { type: "number" as const },
    efficiency: { type: "number" as const, nullable: true },
    startTime: { type: "string" as const, nullable: true },
    endTime: { type: "string" as const, nullable: true },
    records: { type: "number" as const },
    deepMinutes: { type: "number" as const, nullable: true },
    lightMinutes: { type: "number" as const, nullable: true },
    remMinutes: { type: "number" as const, nullable: true },
    wakeMinutes: { type: "number" as const, nullable: true },
    timeline: {
      type: "list" as const,
      of: {
        type: "object" as const,
        fields: {
          start: { type: "string" as const },
          level: { type: "string" as const },
          minutes: { type: "number" as const },
        },
      },
    },
  },
};

const seriesPointSchema = {
  type: "object" as const,
  fields: { time: { type: "string" as const }, value: { type: "number" as const } },
};

const sleepNightSchema = {
  type: "object" as const,
  fields: {
    date: { type: "string" as const },
    minutesAsleep: { type: "number" as const },
    timeInBed: { type: "number" as const },
    efficiency: { type: "number" as const, nullable: true },
    startTime: { type: "string" as const, nullable: true },
    endTime: { type: "string" as const, nullable: true },
    deepMinutes: { type: "number" as const, nullable: true },
    lightMinutes: { type: "number" as const, nullable: true },
    remMinutes: { type: "number" as const, nullable: true },
    wakeMinutes: { type: "number" as const, nullable: true },
  },
};

export const fitbitProvider = defineProvider({
  name: "fitbit",
  displayName: "Fitbit",
  requiresCredential: true,
  credentialType: "fitbitOAuth2",
  hosts: ["health.googleapis.com"],
  queries: {
    profile: {
      description: "Your Fitbit profile name, member since date and average steps",
      args: {},
      result: profileSchema,
      key: () => [],
      staleTime: 60 * 60 * 1000,
      fetch: async (_args: Record<string, never>, host): Promise<FitbitProfile> =>
        mapProfile(await healthGet(host, `${BASE}/profile`)),
    },
    activityToday: {
      description: "Today's steps, calories, distance and active minutes on Fitbit, or another day's with `date`",
      args: {
        date: { type: "string", label: "Day (yyyy-MM-dd); empty for today", required: false },
      },
      result: activitySchema,
      key: (args: SleepArgs) => [args.date?.trim() ?? ""],
      staleTime: 15 * 60 * 1000,
      fetch: async (args: SleepArgs, host): Promise<FitbitActivity> => fetchActivity(host, nightDate(args)),
    },
    sleepToday: {
      description: "Last night's sleep on Fitbit (or the night ending on `date`): total, time in bed, efficiency, fell-asleep and woke-up time, deep/light/REM/wake minutes, and the stage timeline through the night",
      args: {
        date: { type: "string", label: "Date the night ended on (yyyy-MM-dd); empty for last night", required: false },
      },
      result: sleepSchema,
      key: (args: SleepArgs) => [args.date?.trim() ?? ""],
      staleTime: 30 * 60 * 1000,
      fetch: async (args: SleepArgs, host): Promise<FitbitSleep> =>
        mapSleep(await fetchSleepLogs(host, [nightDate(args)])),
    },
    nightVitals: {
      description: "Overnight vitals on Fitbit for last night (or the night ending on `date`): HRV, breathing rate (overall and per deep/light/REM stage), resting heart rate and SpO2",
      args: {
        date: { type: "string", label: "Date the night ended on (yyyy-MM-dd); empty for last night", required: false },
      },
      result: {
        type: "object" as const,
        fields: {
          hrv: { type: "number" as const, nullable: true },
          deepHrv: { type: "number" as const, nullable: true },
          breathingRate: { type: "number" as const, nullable: true },
          breathingDeep: { type: "number" as const, nullable: true },
          breathingLight: { type: "number" as const, nullable: true },
          breathingRem: { type: "number" as const, nullable: true },
          restingHeartRate: { type: "number" as const, nullable: true },
          spo2Avg: { type: "number" as const, nullable: true },
          spo2Min: { type: "number" as const, nullable: true },
          spo2Max: { type: "number" as const, nullable: true },
          needsReconnect: { type: "boolean" as const },
        },
      },
      key: (args: SleepArgs) => [args.date?.trim() ?? ""],
      staleTime: 60 * 60 * 1000,
      fetch: async (args: SleepArgs, host): Promise<FitbitNightVitals> =>
        fetchNightVitals(host, nightDate(args)),
    },
    nightSeries: {
      description: "SpO2 (per minute) and HRV (per 5 minutes) through last night on Fitbit, or the night ending on `date`",
      args: {
        date: { type: "string", label: "Date the night ended on (yyyy-MM-dd); empty for last night", required: false },
      },
      result: {
        type: "object" as const,
        fields: {
          spo2: { type: "list" as const, of: seriesPointSchema },
          hrv: { type: "list" as const, of: seriesPointSchema },
          needsReconnect: { type: "boolean" as const },
        },
      },
      key: (args: SleepArgs) => [args.date?.trim() ?? ""],
      staleTime: 60 * 60 * 1000,
      fetch: async (args: SleepArgs, host): Promise<FitbitNightSeries> =>
        fetchNightSeries(host, nightDate(args)),
    },
    sleepHeartRate: {
      description: "Per-minute heart rate on Fitbit between a sleep's start and end time (pass startTime and endTime from sleepToday)",
      args: {
        start: { type: "string", label: "Sleep start (startTime from sleepToday)", required: true },
        end: { type: "string", label: "Sleep end (endTime from sleepToday)", required: true },
      },
      result: {
        type: "list" as const,
        of: {
          type: "object" as const,
          fields: { time: { type: "string" as const }, bpm: { type: "number" as const } },
        },
      },
      key: (args: HeartRangeArgs) => [args.start ?? "", args.end ?? ""],
      staleTime: 60 * 60 * 1000,
      fetch: async (args: HeartRangeArgs, host): Promise<FitbitHeartPoint[]> =>
        fetchHeartRange(host, args),
    },
    sleepWeek: {
      description: "Your last 7 nights on Fitbit, oldest first: duration, time in bed, efficiency, bed and wake time, stage minutes",
      args: {},
      result: { type: "list" as const, of: sleepNightSchema },
      key: () => [],
      staleTime: 60 * 60 * 1000,
      fetch: async (_args: Record<string, never>, host): Promise<FitbitSleepNight[]> => {
        const dates = lastDates(WEEK_NIGHTS);
        return mapNights(await fetchSleepLogs(host, dates), dates);
      },
    },
    spo2History: {
      description: "Nightly SpO2 average, minimum and maximum on Fitbit for the last 53 weeks, oldest first; nights without a reading are left out",
      args: {},
      result: {
        type: "list" as const,
        of: {
          type: "object" as const,
          fields: {
            date: { type: "string" as const },
            avg: { type: "number" as const },
            min: { type: "number" as const, nullable: true },
            max: { type: "number" as const, nullable: true },
          },
        },
      },
      key: () => [],
      staleTime: 6 * 60 * 60 * 1000,
      fetch: async (_args: Record<string, never>, host): Promise<FitbitSpo2Day[]> =>
        mapSpo2History(await listHistory(host, "daily-oxygen-saturation", "dailyOxygenSaturation")),
    },
    hrvHistory: {
      description: "Nightly HRV (RMSSD in ms, overall and in deep sleep) on Fitbit for the last 53 weeks, oldest first; nights without a reading are left out",
      args: {},
      result: {
        type: "list" as const,
        of: {
          type: "object" as const,
          fields: {
            date: { type: "string" as const },
            rmssd: { type: "number" as const },
            deepRmssd: { type: "number" as const, nullable: true },
          },
        },
      },
      key: () => [],
      staleTime: 6 * 60 * 60 * 1000,
      fetch: async (_args: Record<string, never>, host): Promise<FitbitHrvDay[]> =>
        mapHrvHistory(await listHistory(host, "daily-heart-rate-variability", "dailyHeartRateVariability")),
    },
    sleepHistory: {
      description: "Your nights on Fitbit for the last 53 weeks, oldest first: duration, time in bed, efficiency, bed and wake time, stage minutes; nights without a log are left out",
      args: {},
      result: { type: "list" as const, of: sleepNightSchema },
      key: () => [],
      staleTime: 6 * 60 * 60 * 1000,
      // Sleep pages hold 25 sessions, so a year is a run of paged requests.
      fetch: async (_args: Record<string, never>, host): Promise<FitbitSleepNight[]> => {
        const dates = lastDates(HISTORY_NIGHTS);
        return mapNights(await fetchSleepLogs(host, dates), dates).filter((night) => night.minutesAsleep > 0);
      },
    },
    restingHeartRateHistory: {
      description: "Daily resting heart rate (bpm) on Fitbit for the last 53 weeks, oldest first; days without a reading are left out",
      args: {},
      result: {
        type: "list" as const,
        of: {
          type: "object" as const,
          fields: {
            date: { type: "string" as const },
            bpm: { type: "number" as const },
          },
        },
      },
      key: () => [],
      staleTime: 6 * 60 * 60 * 1000,
      fetch: async (_args: Record<string, never>, host): Promise<FitbitRestingHeartRateDay[]> =>
        mapRestingHeartRateHistory(await listHistory(host, "daily-resting-heart-rate", "dailyRestingHeartRate")),
    },
  },
  actions: {},
});

export default fitbitProvider;
