// SPDX-License-Identifier: MIT
/**
 * Fitbit provider over the Google Health API: rollups, sleep sessions, daily
 * summaries and samples mapped back to the Fitbit shapes widgets read.
 * Run: npx tsx extensions/fitbit/provider.assert.ts
 */
import type { ProviderHostContext } from "@sdk/contract/sdk";
import {
  fitbitProvider,
  type FitbitActivity,
  type FitbitProfile,
  type FitbitSleep,
  type FitbitHeartPoint,
  type FitbitNightSeries,
  type FitbitNightVitals,
  type FitbitSleepNight,
  type FitbitSpo2Day,
  type FitbitHrvDay,
  type FitbitRestingHeartRateDay,
} from "./provider";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

interface Call {
  method: "get" | "post";
  url: string;
  params?: Record<string, string | number | boolean>;
  body?: unknown;
}

/**
 * A host answering by data type (the path segment after `dataTypes/`, or
 * `profile`). An answer that is a function gets the call; a `kind` value is
 * thrown as that host error.
 */
function routedHost(
  routes: Record<string, unknown>,
  connected = true,
): ProviderHostContext & { calls: Call[] } {
  const calls: Call[] = [];
  const answer = <T>(call: Call): T => {
    calls.push(call);
    const type = /dataTypes\/([^/]+)\//.exec(call.url)?.[1] ?? (call.url.endsWith("/profile") ? "profile" : "");
    const route = routes[type];
    const value = typeof route === "function" ? (route as (call: Call) => unknown)(call) : route ?? {};
    if (typeof value === "object" && value !== null && "kind" in value) throw value;
    return value as T;
  };
  return {
    calls,
    credentials: { isConnected: async () => connected },
    http: {
      get: async <T>(url: string, params?: Record<string, string | number | boolean>) => answer<T>({ method: "get", url, params }),
      post: async <T>(url: string, body?: unknown) => answer<T>({ method: "post", url, body }),
      put: async () => undefined as never,
      patch: async () => undefined as never,
    },
  };
}

const points = (field: string, rows: unknown[]) => ({ dataPoints: rows.map((row) => ({ [field]: row })) });
const date = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
};
const filterOf = (call: Call) => String(call.params?.filter ?? "");

// ── profile ────────────────────────────────────────────────────────────────
const profile = (await fitbitProvider.queries.profile.fetch(
  {},
  routedHost({ profile: { name: "users/me/profile", membershipStartDate: date("2018-04-01") } }),
)) as FitbitProfile;
assert(profile.memberSince === "2018-04-01", "member since comes from membershipStartDate");
assert(profile.displayName === "" && profile.avatarUrl === "", "Google Health has no name or avatar; empty, not invented");

// ── activity ───────────────────────────────────────────────────────────────
const rollup = (field: string, value: unknown) => ({ rollupDataPoints: [{ [field]: value }] });
const activityHost = routedHost({
  steps: rollup("steps", { countSum: "8432" }),
  distance: rollup("distance", { millimetersSum: "6200000" }),
  floors: rollup("floors", { countSum: "12" }),
  "total-calories": rollup("totalCalories", { kcalSum: 2100.5 }),
  "active-minutes": rollup("activeMinutes", {
    activeMinutesRollupByActivityLevel: [
      { activityLevel: "LIGHT", activeMinutesSum: "180" },
      { activityLevel: "MODERATE", activeMinutesSum: "20" },
      { activityLevel: "VIGOROUS", activeMinutesSum: "30" },
    ],
  }),
  "sedentary-period": rollup("sedentaryPeriod", { durationSum: "42000s" }),
});
const activity = (await fitbitProvider.queries.activityToday.fetch({ date: "2026-10-04" }, activityHost)) as FitbitActivity;
assert(activity.steps === 8432 && activity.floors === 12, "int64 strings become numbers");
assert(activity.distance === 6.2, "distance is kilometres, from millimetres");
assert(activity.caloriesOut === 2100.5, "calories are the day's total");
assert(
  activity.lightlyActiveMinutes === 180 && activity.fairlyActiveMinutes === 20 && activity.veryActiveMinutes === 30,
  "light/moderate/vigorous map to Fitbit's lightly/fairly/very active",
);
assert(activity.sedentaryMinutes === 700, "sedentary duration becomes minutes");
assert(activity.stepsGoal === null, "no goal in the data API is null, not zero");
const stepsCall = activityHost.calls.find((call) => call.url.includes("/steps/"))!;
assert(
  stepsCall.method === "post" && stepsCall.url.endsWith("/dataTypes/steps/dataPoints:dailyRollUp"),
  "activity is a daily rollup",
);
assert(
  JSON.stringify(stepsCall.body) ===
    JSON.stringify({ range: { start: { date: date("2026-10-04") }, end: { date: date("2026-10-05") } } }),
  "the rollup range is that one civil day",
);
let badDay = false;
try {
  await fitbitProvider.queries.activityToday.fetch({ date: "../x" }, activityHost);
} catch {
  badDay = true;
}
assert(badDay, "an activity date that is not yyyy-MM-dd never reaches a request");

// ── sleep ──────────────────────────────────────────────────────────────────
/** A session from 23:41:30 to 07:02 wall clock in UTC+2, ending on 2026-10-09. */
const night = {
  type: "STAGES",
  interval: {
    startTime: "2026-10-08T21:41:30Z",
    startUtcOffset: "7200s",
    endTime: "2026-10-09T05:01:30Z",
    endUtcOffset: "7200s",
    civilEndTime: { date: date("2026-10-09") },
  },
  metadata: { mainSleep: true },
  summary: {
    minutesAsleep: "400",
    stagesSummary: [
      { type: "DEEP", minutes: "80" },
      { type: "LIGHT", minutes: "230" },
      { type: "REM", minutes: "90" },
      { type: "AWAKE", minutes: "40" },
    ],
  },
  stages: [
    { type: "DEEP", startTime: "2026-10-08T22:11:30Z", startUtcOffset: "7200s", endTime: "2026-10-08T22:56:30Z" },
    { type: "LIGHT", startTime: "2026-10-08T21:41:30Z", startUtcOffset: "7200s", endTime: "2026-10-08T22:11:30Z" },
    { type: "AWAKE", startTime: "2026-10-08T22:56:30Z", startUtcOffset: "7200s", endTime: "2026-10-08T22:58:30Z" },
  ],
};
const nap = {
  type: "CLASSIC",
  interval: {
    startTime: "2026-10-09T12:00:00Z",
    startUtcOffset: "7200s",
    endTime: "2026-10-09T12:30:00Z",
    endUtcOffset: "7200s",
    civilEndTime: { date: date("2026-10-09") },
  },
  metadata: { mainSleep: false, nap: true },
  summary: { minutesAsleep: "25" },
};
const sleepHost = routedHost({ sleep: points("sleep", [nap, night]) });
const sleep = (await fitbitProvider.queries.sleepToday.fetch({ date: "2026-10-09" }, sleepHost)) as FitbitSleep;
assert(
  filterOf(sleepHost.calls[0]!) ===
    'sleep.interval.civil_end_time >= "2026-10-09" AND sleep.interval.civil_end_time < "2026-10-10"',
  "a night is the sessions that ended on its date",
);
assert(sleep.minutesAsleep === 425 && sleep.records === 2, "a nap counts toward the night's total");
assert(sleep.timeInBed === 440 + 30, "time in bed is each session's length");
assert(sleep.startTime === "2026-10-08T23:41:30.000" && sleep.endTime === "2026-10-09T07:01:30.000", "times are wall clock, Fitbit's format");
assert(sleep.efficiency === Math.round((400 / 440) * 100), "efficiency is the main sleep's asleep share of time in bed");
assert(
  sleep.deepMinutes === 80 && sleep.lightMinutes === 230 && sleep.remMinutes === 90 && sleep.wakeMinutes === 40,
  "stage minutes come from the main sleep's summary",
);
assert(
  sleep.timeline.length === 3 &&
    sleep.timeline[0]!.level === "light" &&
    sleep.timeline[1]!.level === "deep" &&
    sleep.timeline[1]!.start === "2026-10-09T00:11:30.000" &&
    sleep.timeline[1]!.minutes === 45 &&
    sleep.timeline[2]!.level === "wake",
  "timeline is the main sleep's stages in order, Fitbit's level names, in minutes",
);

const emptySleep = (await fitbitProvider.queries.sleepToday.fetch({}, routedHost({ sleep: {} }))) as FitbitSleep;
assert(emptySleep.records === 0 && emptySleep.efficiency === null, "a night with no log is zeros, not an error");
assert(emptySleep.startTime === null && emptySleep.remMinutes === null, "no log has no times and no stages");
assert(emptySleep.timeline.length === 0, "no log has an empty timeline");
assert(
  fitbitProvider.queries.sleepToday.key({ date: "2026-10-05" }).join() !== fitbitProvider.queries.sleepToday.key({}).join(),
  "each date caches on its own",
);
let refused = false;
try {
  await fitbitProvider.queries.sleepToday.fetch({ date: '2026-10-05" OR x' }, routedHost({}));
} catch {
  refused = true;
}
assert(refused, "a date that is not yyyy-MM-dd never reaches a filter");

let pages = 0;
const pagedHost = routedHost({
  sleep: (call: Call) => {
    pages++;
    return call.params?.pageToken === "p2"
      ? points("sleep", [nap])
      : { ...points("sleep", [night]), nextPageToken: "p2" };
  },
});
const paged = (await fitbitProvider.queries.sleepToday.fetch({ date: "2026-10-09" }, pagedHost)) as FitbitSleep;
assert(pages === 2 && paged.records === 2, "pages are followed until nextPageToken is empty");
assert(pagedHost.calls.every((call) => call.params?.pageSize === 25), "sleep asks for its 25-session maximum");

const week = (await fitbitProvider.queries.sleepWeek.fetch({}, routedHost({ sleep: points("sleep", []) }))) as FitbitSleepNight[];
assert(week.length === 7 && week.every((n) => n.minutesAsleep === 0 && n.startTime === null), "seven rows, gaps included");

const classicNight = { ...nap, type: "CLASSIC", metadata: { mainSleep: true }, summary: { minutesAsleep: "380" } };
const classic = (await fitbitProvider.queries.sleepToday.fetch(
  { date: "2026-10-09" },
  routedHost({ sleep: points("sleep", [classicNight]) }),
)) as FitbitSleep;
assert(classic.deepMinutes === null && classic.minutesAsleep === 380, "a classic log has no stages");

// ── night vitals ───────────────────────────────────────────────────────────
const vitalsHost = routedHost({
  "daily-heart-rate-variability": points("dailyHeartRateVariability", [
    { date: date("2026-10-05"), averageHeartRateVariabilityMilliseconds: 41.2, deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds: 47.9 },
  ]),
  "respiratory-rate-sleep-summary": points("respiratoryRateSleepSummary", [
    {
      fullSleepStats: { breathsPerMinute: 14.6 },
      deepSleepStats: { breathsPerMinute: 13.2 },
      lightSleepStats: { breathsPerMinute: 14.9 },
      remSleepStats: { breathsPerMinute: 0 },
    },
  ]),
  "daily-oxygen-saturation": points("dailyOxygenSaturation", [
    { date: date("2026-10-05"), averagePercentage: 96.4, lowerBoundPercentage: 93.1, upperBoundPercentage: 99.2 },
  ]),
  "daily-resting-heart-rate": points("dailyRestingHeartRate", [{ date: date("2026-10-05"), beatsPerMinute: "58" }]),
});
const vitals = (await fitbitProvider.queries.nightVitals.fetch({ date: "2026-10-05" }, vitalsHost)) as FitbitNightVitals;
assert(vitals.hrv === 41.2 && vitals.deepHrv === 47.9, "HRV is the night's average and deep-sleep RMSSD");
assert(vitals.breathingRate === 14.6 && vitals.restingHeartRate === 58, "breathing rate and resting HR unwrap");
assert(vitals.breathingDeep === 13.2 && vitals.breathingLight === 14.9, "breathing rate per stage");
assert(vitals.breathingRem === null, "a stage without signal is no reading");
assert(vitals.spo2Avg === 96.4 && vitals.spo2Min === 93.1 && vitals.spo2Max === 99.2, "SpO2 keeps avg and its bounds");
assert(vitals.needsReconnect === false, "a full answer needs no reconnect");
assert(
  filterOf(vitalsHost.calls.find((call) => call.url.includes("daily-resting-heart-rate"))!) ===
    'daily_resting_heart_rate.date >= "2026-10-05" AND daily_resting_heart_rate.date < "2026-10-06"',
  "daily types filter on their snake_case name and date",
);

const empty = (await fitbitProvider.queries.nightVitals.fetch({}, routedHost({}))) as FitbitNightVitals;
assert(empty.hrv === null && empty.spo2Avg === null && empty.restingHeartRate === null, "no reading is null, not zero");

const unticked = (await fitbitProvider.queries.nightVitals.fetch(
  {},
  routedHost({
    "daily-heart-rate-variability": { kind: "permission-denied", message: "insufficient scope" },
    "daily-resting-heart-rate": points("dailyRestingHeartRate", [{ beatsPerMinute: "61" }]),
  }),
)) as FitbitNightVitals;
assert(
  unticked.needsReconnect && unticked.hrv === null && unticked.restingHeartRate === 61,
  "a missing scope nulls that reading, flags reconnect, and keeps the rest",
);
let rateLimited = false;
try {
  await fitbitProvider.queries.nightVitals.fetch({}, routedHost({ "daily-oxygen-saturation": { kind: "rate-limited", message: "slow down" } }));
} catch {
  rateLimited = true;
}
assert(rateLimited, "any other failure still throws");

// ── night series ───────────────────────────────────────────────────────────
const at = (utc: string, extra: Record<string, unknown>) => ({ sampleTime: { physicalTime: utc, utcOffset: "7200s" }, ...extra });
const series = (await fitbitProvider.queries.nightSeries.fetch(
  { date: "2026-10-09" },
  routedHost({
    "oxygen-saturation": points("oxygenSaturation", [
      at("2026-10-08T22:01:00Z", { percentage: 95.2 }),
      at("2026-10-08T21:59:00Z", { percentage: 96.1 }),
      at("2026-10-08T08:00:00Z", { percentage: 90 }),
    ]),
    "heart-rate-variability": points("heartRateVariability", [
      at("2026-10-08T23:05:00Z", { rootMeanSquareOfSuccessiveDifferencesMilliseconds: 38.4 }),
    ]),
  }),
)) as FitbitNightSeries;
assert(
  series.spo2.length === 2 && series.spo2[0]!.time === "2026-10-08T23:59:00.000" && series.spo2[1]!.value === 95.2,
  "SpO2 is sorted, wall clock, and only the night (noon to noon)",
);
assert(series.hrv.length === 1 && series.hrv[0]!.value === 38.4, "HRV takes RMSSD from each sample");
const seriesOld = (await fitbitProvider.queries.nightSeries.fetch(
  {},
  routedHost({ "oxygen-saturation": { kind: "permission-denied", message: "scope" } }),
)) as FitbitNightSeries;
assert(seriesOld.needsReconnect && seriesOld.spo2.length === 0, "a missing scope empties that series and flags reconnect");

// ── sleep heart rate ───────────────────────────────────────────────────────
const heartHost = routedHost({
  "heart-rate": points("heartRate", [
    at("2026-10-08T21:05:10Z", { beatsPerMinute: "54" }),
    at("2026-10-08T21:05:40Z", { beatsPerMinute: "57" }),
    at("2026-10-09T05:06:00Z", { beatsPerMinute: "66" }),
  ]),
});
const heart = (await fitbitProvider.queries.sleepHeartRate.fetch(
  { start: "2026-10-08T23:05:30.000", end: "2026-10-09T07:06:00.000" },
  heartHost,
)) as FitbitHeartPoint[];
assert(heartHost.calls.length === 1 && filterOf(heartHost.calls[0]!).startsWith("heart_rate.sample_time.physical_time >= "), "one physical-time window");
assert(
  heart.length === 2 && heart[0]!.time === "2026-10-08T23:05:00" && heart[0]!.bpm === 56 && heart[1]!.bpm === 66,
  "per-second samples become per-minute means, wall clock, in order",
);
for (const bad of [
  { start: "23:05", end: "07:06" },
  { start: "2026-10-09T07:00:00", end: "2026-10-08T23:00:00" },
  { start: "2026-10-01T23:00:00", end: "2026-10-09T07:00:00" },
]) {
  let threw = false;
  try {
    await fitbitProvider.queries.sleepHeartRate.fetch(bad, heartHost);
  } catch {
    threw = true;
  }
  assert(threw, `refuses ${JSON.stringify(bad)}`);
}

// ── history ────────────────────────────────────────────────────────────────
const spo2Host = routedHost({
  "daily-oxygen-saturation": points("dailyOxygenSaturation", [
    { date: date("2026-10-02"), averagePercentage: 94.1, lowerBoundPercentage: 91, upperBoundPercentage: 97 },
    { date: date("2026-10-03") },
    { date: date("2026-10-01"), averagePercentage: 96.5 },
  ]),
});
const spo2Year = (await fitbitProvider.queries.spo2History.fetch({}, spo2Host)) as FitbitSpo2Day[];
assert(spo2Host.calls.length === 1, "a year of daily summaries is one paged list");
const window = /date >= "(\d{4}-\d{2}-\d{2})" AND .*date < "(\d{4}-\d{2}-\d{2})"/.exec(filterOf(spo2Host.calls[0]!));
assert(window, "history filters on a date window");
assert(
  (Date.parse(`${window[2]}T12:00:00`) - Date.parse(`${window[1]}T12:00:00`)) / 86_400_000 === 371,
  "history covers 53 weeks, today included",
);
assert(spo2Year.length === 2 && spo2Year[0]!.date === "2026-10-01", "oldest first, nights without an average left out");
assert(spo2Year[1]!.min === 91 && spo2Year[1]!.max === 97 && spo2Year[0]!.min === null, "bounds kept when present");

const hrvYear = (await fitbitProvider.queries.hrvHistory.fetch(
  {},
  routedHost({
    "daily-heart-rate-variability": points("dailyHeartRateVariability", [
      { date: date("2026-10-02"), averageHeartRateVariabilityMilliseconds: 31.4, deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds: 40.1 },
      { date: date("2026-10-01"), averageHeartRateVariabilityMilliseconds: 28 },
      { date: date("2026-10-03"), entropy: 1.2 },
    ]),
  }),
)) as FitbitHrvDay[];
assert(hrvYear.length === 2 && hrvYear[0]!.date === "2026-10-01", "hrv: oldest first, nights without a reading left out");
assert(hrvYear[0]!.deepRmssd === null && hrvYear[1]!.deepRmssd === 40.1, "hrv keeps overall and deep RMSSD");

const rhrYear = (await fitbitProvider.queries.restingHeartRateHistory.fetch(
  {},
  routedHost({
    "daily-resting-heart-rate": points("dailyRestingHeartRate", [
      { date: date("2026-10-02"), beatsPerMinute: "61" },
      { date: date("2026-10-03") },
    ]),
  }),
)) as FitbitRestingHeartRateDay[];
assert(rhrYear.length === 1 && rhrYear[0]!.bpm === 61 && rhrYear[0]!.date === "2026-10-02", "a day without a resting HR is left out");

const sleepYear = (await fitbitProvider.queries.sleepHistory.fetch({}, routedHost({ sleep: points("sleep", []) }))) as FitbitSleepNight[];
assert(sleepYear.length === 0, "nights without a log are left out of the history");

try {
  await fitbitProvider.queries.profile.fetch({}, routedHost({}, false));
  assert(false, "disconnected must throw");
} catch (error) {
  assert(
    typeof error === "object" && error !== null && (error as { kind?: string }).kind === "disconnected",
    "a missing credential is disconnected, not a generic error",
  );
}

console.log("fitbit provider.assert: ok");
