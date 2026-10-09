// SPDX-License-Identifier: MIT
import { defineProvider, type ProviderHostContext } from "@sdk/contract/sdk";

/**
 * Fitbit: profile, today's activity and last night's sleep.
 *
 * Auth is attached host-side as Bearer. Vendor nesting (`user`, `summary`,
 * `distances`, sleep `stages`) stops here so a widget sees a flat object.
 * Activity summary does not accept the word "today" — the date is local yyyy-MM-dd.
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
   * True when Fitbit refused a reading for a missing scope: the connection
   * predates heartrate / respiratory_rate / oxygen_saturation and has to be
   * connected again. The other readings still come through.
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

const asNumber = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

/** Local calendar date; Fitbit's activity summary rejects the literal "today". */
function localDate(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Distance for `activity: "total"`, else the first row. */
function totalDistance(summary: Record<string, unknown>): number {
  const distances = summary.distances;
  if (!Array.isArray(distances)) return 0;
  const total = distances.find((row) => asRecord(row).activity === "total");
  return asNumber(asRecord(total ?? distances[0]).distance);
}

/** The main sleep log, or the first log when none is marked. */
function mainSleep(sleep: unknown): Record<string, unknown> | null {
  if (!Array.isArray(sleep) || sleep.length === 0) return null;
  return asRecord(sleep.find((row) => asRecord(row).isMainSleep === true) ?? sleep[0]);
}

/** Maps `/profile.json`; `user` nesting stops here. */
function mapProfile(raw: unknown): FitbitProfile {
  const user = asRecord(asRecord(raw).user);
  const avatar150 = asString(user.avatar150);
  return {
    displayName: asString(user.displayName),
    memberSince: asString(user.memberSince),
    avatarUrl: avatar150.length > 0 ? avatar150 : asString(user.avatar),
    averageDailySteps: asNumber(user.averageDailySteps),
  };
}

/** Maps the daily activity summary; `distances` collapses to the total. */
function mapActivity(raw: unknown): FitbitActivity {
  const row = asRecord(raw);
  const summary = asRecord(row.summary);
  const goals = asRecord(row.goals);
  const stepsGoal = goals.steps;
  return {
    steps: asNumber(summary.steps),
    caloriesOut: asNumber(summary.caloriesOut),
    distance: totalDistance(summary),
    floors: asNumber(summary.floors),
    fairlyActiveMinutes: asNumber(summary.fairlyActiveMinutes),
    lightlyActiveMinutes: asNumber(summary.lightlyActiveMinutes),
    sedentaryMinutes: asNumber(summary.sedentaryMinutes),
    veryActiveMinutes: asNumber(summary.veryActiveMinutes),
    stepsGoal: typeof stepsGoal === "number" && Number.isFinite(stepsGoal) ? stepsGoal : null,
  };
}

/** Maps sleep v1.2; a night with no log is zeros, not an error. */
function mapSleep(raw: unknown): FitbitSleep {
  const row = asRecord(raw);
  const summary = asRecord(row.summary);
  const stages = "stages" in summary ? asRecord(summary.stages) : null;
  const stage = (key: string): number | null => (stages ? asNumber(stages[key]) : null);
  const main = mainSleep(row.sleep);
  const efficiency = main?.efficiency;
  const time = (key: string): string | null => asString(main?.[key]) || null;
  return {
    minutesAsleep: asNumber(summary.totalMinutesAsleep),
    timeInBed: asNumber(summary.totalTimeInBed),
    efficiency: typeof efficiency === "number" && Number.isFinite(efficiency) ? efficiency : null,
    startTime: time("startTime"),
    endTime: time("endTime"),
    records: asNumber(summary.totalSleepRecords),
    deepMinutes: stage("deep"),
    lightMinutes: stage("light"),
    remMinutes: stage("rem"),
    wakeMinutes: stage("wake"),
    timeline: sleepTimeline(main),
  };
}

interface SleepArgs {
  /** yyyy-MM-dd; omitted or empty means last night. */
  date?: string;
}

/** A finite number, else null: a vital Fitbit did not measure is not zero. */
const maybeNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** First row of a Fitbit `{ <key>: [{ value: {...} }] }` daily series. */
const firstValue = (raw: unknown, key: string): Record<string, unknown> => {
  const rows = asRecord(raw)[key];
  return Array.isArray(rows) && rows.length ? asRecord(asRecord(rows[0]).value) : {};
};

/**
 * One stage's breaths per minute from the breathing-rate intraday summary.
 * Fitbit answers -1 (or 0) for a stage it had too little signal in; that is
 * no reading, not a rate.
 */
const breathing = (value: Record<string, unknown>, stage: string): number | null => {
  const rate = maybeNumber(asRecord(value[stage]).breathingRate);
  return rate !== null && rate > 0 ? rate : null;
};

const isPermissionDenied = (error: unknown): boolean =>
  asRecord(error).kind === "permission-denied";

/**
 * The four vitals for one date, fetched side by side. A reading refused for a
 * missing scope becomes null plus `needsReconnect`, so one old connection does
 * not take the whole query down; any other failure still throws.
 */
async function fetchNightVitals(host: ProviderHostContext, date: string): Promise<FitbitNightVitals> {
  let needsReconnect = false;
  const get = (path: string) =>
    fitbitGet<unknown>(host, path).catch((error: unknown) => {
      if (!isPermissionDenied(error)) throw error;
      needsReconnect = true;
      return {};
    });
  const day = encodeURIComponent(date);
  const [hrv, br, spo2, heart] = await Promise.all([
    get(`/1/user/-/hrv/date/${day}.json`),
    // The intraday form: same one call, but split by sleep stage.
    get(`/1/user/-/br/date/${day}/all.json`),
    get(`/1/user/-/spo2/date/${day}.json`),
    get(`/1/user/-/activities/heart/date/${day}/1d.json`),
  ]);
  const hrvValue = firstValue(hrv, "hrv");
  const brValue = firstValue(br, "br");
  const spo2Value = asRecord(asRecord(spo2).value);
  return {
    hrv: maybeNumber(hrvValue.dailyRmssd),
    deepHrv: maybeNumber(hrvValue.deepRmssd),
    breathingRate: breathing(brValue, "fullSleepSummary"),
    breathingDeep: breathing(brValue, "deepSleepSummary"),
    breathingLight: breathing(brValue, "lightSleepSummary"),
    breathingRem: breathing(brValue, "remSleepSummary"),
    restingHeartRate: maybeNumber(firstValue(heart, "activities-heart").restingHeartRate),
    spo2Avg: maybeNumber(spo2Value.avg),
    spo2Min: maybeNumber(spo2Value.min),
    spo2Max: maybeNumber(spo2Value.max),
    needsReconnect,
  };
}

/**
 * SpO2 and HRV intraday for the night ending on `date`. Both endpoints key the
 * night by its end date, like `dateOfSleep`. A series refused for a missing
 * scope is empty plus `needsReconnect`; any other failure throws.
 */
async function fetchNightSeries(host: ProviderHostContext, date: string): Promise<FitbitNightSeries> {
  let needsReconnect = false;
  const get = (path: string) =>
    fitbitGet<unknown>(host, path).catch((error: unknown) => {
      if (!isPermissionDenied(error)) throw error;
      needsReconnect = true;
      return {};
    });
  const day = encodeURIComponent(date);
  const [spo2Raw, hrvRaw] = await Promise.all([
    get(`/1/user/-/spo2/date/${day}/all.json`),
    get(`/1/user/-/hrv/date/${day}/all.json`),
  ]);

  const point = (time: unknown, value: unknown): FitbitSeriesPoint | null => {
    const v = maybeNumber(value);
    return typeof time === "string" && v !== null ? { time, value: v } : null;
  };
  const spo2Minutes = asRecord(spo2Raw).minutes;
  const spo2 = (Array.isArray(spo2Minutes) ? spo2Minutes : [])
    .map((row) => point(asRecord(row).minute, asRecord(row).value))
    .filter((p): p is FitbitSeriesPoint => p !== null);
  const hrvDays = asRecord(hrvRaw).hrv;
  const hrv = (Array.isArray(hrvDays) ? hrvDays : [])
    .flatMap((dayRow) => {
      const minutes = asRecord(dayRow).minutes;
      return Array.isArray(minutes) ? minutes : [];
    })
    .map((row) => point(asRecord(row).minute, asRecord(asRecord(row).value).rmssd))
    .filter((p): p is FitbitSeriesPoint => p !== null);

  const byTime = (a: FitbitSeriesPoint, b: FitbitSeriesPoint) => a.time.localeCompare(b.time);
  return { spo2: spo2.sort(byTime), hrv: hrv.sort(byTime), needsReconnect };
}

/** `args.date` checked, or today; the only way a date reaches a Fitbit path. */
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
 * Per-minute heart rate between two device-local times. Fitbit's intraday
 * window lives inside one date, so a night across midnight is two requests:
 * start to 23:59 on the first date, 00:00 to end on the second.
 */
async function fetchHeartRange(host: ProviderHostContext, args: HeartRangeArgs): Promise<FitbitHeartPoint[]> {
  const from = LOCAL_TIME.exec(args.start ?? "");
  const to = LOCAL_TIME.exec(args.end ?? "");
  if (!from || !to) throw new Error("start and end must be yyyy-MM-ddTHH:mm");
  const [, fromDate, fromTime] = from;
  const [, toDate, toTime] = to;
  if (`${toDate}T${toTime}` <= `${fromDate}T${fromTime}`) throw new Error("end must be after start");
  const windows: [string, string, string][] =
    fromDate === toDate
      ? [[fromDate!, fromTime!, toTime!]]
      : [
          [fromDate!, fromTime!, "23:59"],
          [toDate!, "00:00", toTime!],
        ];
  // Longer than one night is not a night: refuse rather than fetch days of data.
  if (Date.parse(`${toDate}T12:00:00`) - Date.parse(`${fromDate}T12:00:00`) > 86_400_000) {
    throw new Error("start and end must be at most one night apart");
  }
  const parts = await Promise.all(
    windows.map(async ([date, startTime, endTime]) => {
      const raw = await fitbitGet<unknown>(
        host,
        `/1/user/-/activities/heart/date/${date}/1d/1min/time/${startTime}/${endTime}.json`,
      );
      const dataset = asRecord(asRecord(raw)["activities-heart-intraday"]).dataset;
      if (!Array.isArray(dataset)) return [];
      return dataset
        .map((row) => asRecord(row))
        .filter((row) => typeof row.time === "string" && maybeNumber(row.value) !== null)
        .map((row) => ({ time: `${date}T${row.time as string}`, bpm: row.value as number }));
    }),
  );
  return parts.flat();
}

/** How many nights `sleepWeek` covers, last night included. */
const WEEK_NIGHTS = 7;

/**
 * One night per date, oldest first, from a date-range response. Every date in
 * `dates` gets a row so a widget can draw the gap; a night without a log is
 * zeros with null stages and times. Naps count toward `minutesAsleep`; times and
 * stages come from that night's main sleep.
 */
function mapSleepWeek(raw: unknown, dates: string[]): FitbitSleepNight[] {
  const logs = asRecord(raw).sleep;
  const byDate = new Map<string, Record<string, unknown>[]>();
  for (const log of Array.isArray(logs) ? logs : []) {
    const row = asRecord(log);
    const date = asString(row.dateOfSleep);
    byDate.set(date, [...(byDate.get(date) ?? []), row]);
  }
  return dates.map((date) => {
    const night = byDate.get(date) ?? [];
    const main = mainSleep(night);
    // Range logs carry stage totals per log, under levels.summary.<stage>.minutes.
    const stages = main?.type === "stages" ? asRecord(asRecord(main.levels).summary) : null;
    const stage = (key: string): number | null =>
      stages ? asNumber(asRecord(stages[key]).minutes) : null;
    const efficiency = main?.efficiency;
    return {
      date,
      minutesAsleep: night.reduce((sum, log) => sum + asNumber(log.minutesAsleep), 0),
      timeInBed: night.reduce((sum, log) => sum + asNumber(log.timeInBed), 0),
      efficiency: typeof efficiency === "number" && Number.isFinite(efficiency) ? efficiency : null,
      startTime: asString(main?.startTime) || null,
      endTime: asString(main?.endTime) || null,
      deepMinutes: stage("deep"),
      lightMinutes: stage("light"),
      remMinutes: stage("rem"),
      wakeMinutes: stage("wake"),
    };
  });
}

/** The last `count` local dates ending today, oldest first. */
function lastDates(count: number, now = new Date()): string[] {
  return Array.from({ length: count }, (_, i) => {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (count - 1 - i));
    return localDate(day);
  });
}

/** `levels.data` of one sleep log; `shortData` (sub-3-minute wakes) is left out. */
function sleepTimeline(main: Record<string, unknown> | null): FitbitSleepSegment[] {
  const data = asRecord(main?.levels).data;
  if (!Array.isArray(data)) return [];
  return data.map((raw) => {
    const row = asRecord(raw);
    return {
      start: asString(row.dateTime),
      level: asString(row.level),
      minutes: asNumber(row.seconds) / 60,
    };
  });
}

/** GET after confirming a Fitbit credential exists; auth is attached host-side. */
async function fitbitGet<T>(host: ProviderHostContext, path: string): Promise<T> {
  if (!(await host.credentials.isConnected())) {
    throw { kind: "disconnected", message: "Fitbit is not connected" };
  }
  return host.http.get<T>(`https://api.fitbit.com${path}`);
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
  hosts: ["api.fitbit.com"],
  queries: {
    profile: {
      description: "Your Fitbit profile name, member since date and average steps",
      args: {},
      result: profileSchema,
      key: () => [],
      staleTime: 60 * 60 * 1000,
      fetch: async (_args: Record<string, never>, host): Promise<FitbitProfile> => {
        return mapProfile(await fitbitGet(host, "/1/user/-/profile.json"));
      },
    },
    activityToday: {
      description: "Today's steps, calories, distance and active minutes on Fitbit, or another day's with `date`",
      args: {
        date: { type: "string", label: "Day (yyyy-MM-dd); empty for today", required: false },
      },
      result: activitySchema,
      key: (args: SleepArgs) => [args.date?.trim() ?? ""],
      staleTime: 15 * 60 * 1000,
      fetch: async (args: SleepArgs, host): Promise<FitbitActivity> => {
        const date = nightDate(args);
        return mapActivity(
          await fitbitGet(host, `/1/user/-/activities/date/${encodeURIComponent(date)}.json`),
        );
      },
    },
    sleepToday: {
      description: "Last night's sleep on Fitbit (or the night ending on `date`): total, time in bed, efficiency, fell-asleep and woke-up time, deep/light/REM/wake minutes, and the stage timeline through the night",
      args: {
        date: { type: "string", label: "Date the night ended on (yyyy-MM-dd); empty for last night", required: false },
      },
      result: sleepSchema,
      key: (args: SleepArgs) => [args.date?.trim() ?? ""],
      staleTime: 30 * 60 * 1000,
      fetch: async (args: SleepArgs, host): Promise<FitbitSleep> => {
        const date = nightDate(args);
        return mapSleep(
          await fitbitGet(host, `/1.2/user/-/sleep/date/${encodeURIComponent(date)}.json`),
        );
      },
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
        const range = `${dates[0]}/${dates[dates.length - 1]}`;
        return mapSleepWeek(await fitbitGet(host, `/1.2/user/-/sleep/date/${range}.json`), dates);
      },
    },
  },
  actions: {},
});

export default fitbitProvider;
