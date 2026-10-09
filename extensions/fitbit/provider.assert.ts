// SPDX-License-Identifier: MIT
/**
 * Fitbit provider: profile unwrap, activity summary, sleep summary.
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
} from "./provider";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function hostFor(
  response: unknown,
  connected = true,
): ProviderHostContext & { lastUrl?: string } {
  const host: ProviderHostContext & { lastUrl?: string } = {
    credentials: { isConnected: async () => connected },
    http: {
      get: async <T>(url: string): Promise<T> => {
        host.lastUrl = url;
        return response as T;
      },
      post: async () => undefined as never,
      put: async () => undefined as never,
      patch: async () => undefined as never,
    },
  };
  return host;
}

const fetchProfile = fitbitProvider.queries.profile.fetch;
const fetchActivity = fitbitProvider.queries.activityToday.fetch;
const fetchSleep = fitbitProvider.queries.sleepToday.fetch;

const profile = (await fetchProfile(
  {},
  hostFor({
    user: {
      displayName: "Alex",
      memberSince: "2018-04-01",
      avatar: "https://static0.fitbit.com/small.png",
      avatar150: "https://static0.fitbit.com/large.png",
      averageDailySteps: 8000,
    },
  }),
)) as FitbitProfile;
assert(profile.displayName === "Alex", "displayName is unwrapped from user");
assert(profile.avatarUrl.endsWith("large.png"), "avatar150 is preferred over avatar");
assert(profile.averageDailySteps === 8000 && profile.memberSince === "2018-04-01", "profile fields survive");

const activityHost = hostFor({
  goals: { steps: 10_000 },
  summary: {
    steps: 8432,
    caloriesOut: 2100,
    floors: 12,
    fairlyActiveMinutes: 20,
    lightlyActiveMinutes: 180,
    sedentaryMinutes: 700,
    veryActiveMinutes: 30,
    distances: [
      { activity: "tracker", distance: 5.1 },
      { activity: "total", distance: 6.2 },
    ],
  },
});
const activity = (await fetchActivity({}, activityHost)) as FitbitActivity;
assert(activity.steps === 8432 && activity.stepsGoal === 10_000, "summary and goals flatten");
assert(activity.distance === 6.2, "distance is the total, not the first row");
assert(
  /\/1\/user\/-\/activities\/date\/\d{4}-\d{2}-\d{2}\.json$/.test(activityHost.lastUrl ?? ""),
  "activity uses yyyy-MM-dd, not the word today",
);

const sleep = (await fetchSleep(
  {},
  hostFor({
    sleep: [
      { isMainSleep: false, efficiency: 50 },
      {
        isMainSleep: true,
        efficiency: 91,
        startTime: "2026-10-08T23:41:30.000",
        endTime: "2026-10-09T07:02:00.000",
        levels: {
          data: [
            { dateTime: "2026-10-08T23:41:30.000", level: "light", seconds: 1800 },
            { dateTime: "2026-10-09T00:11:30.000", level: "deep", seconds: 2700 },
          ],
          shortData: [{ dateTime: "2026-10-09T00:20:00.000", level: "wake", seconds: 60 }],
        },
      },
    ],
    summary: {
      totalMinutesAsleep: 420,
      totalTimeInBed: 460,
      totalSleepRecords: 2,
      stages: { deep: 80, light: 250, rem: 90, wake: 40 },
    },
  }),
)) as FitbitSleep;
assert(sleep.minutesAsleep === 420 && sleep.timeInBed === 460, "sleep summary flattens");
assert(sleep.efficiency === 91 && sleep.records === 2, "efficiency comes from the main sleep");
assert(
  sleep.deepMinutes === 80 && sleep.lightMinutes === 250 && sleep.remMinutes === 90 && sleep.wakeMinutes === 40,
  "stage minutes flatten out of summary.stages",
);

const emptySleep = (await fetchSleep({}, hostFor({ sleep: [], summary: {} }))) as FitbitSleep;
assert(emptySleep.records === 0 && emptySleep.efficiency === null, "a night with no log is zeros, not an error");
assert(
  sleep.startTime === "2026-10-08T23:41:30.000" && sleep.endTime === "2026-10-09T07:02:00.000",
  "fell-asleep and woke-up come from the main sleep",
);
assert(
  sleep.timeline.length === 2 &&
    sleep.timeline[1]!.level === "deep" &&
    sleep.timeline[1]!.start === "2026-10-09T00:11:30.000" &&
    sleep.timeline[1]!.minutes === 45,
  "timeline is levels.data of the main sleep, in minutes",
);
assert(emptySleep.timeline.length === 0, "no log has an empty timeline");
assert(emptySleep.startTime === null && emptySleep.endTime === null, "no log has no times");
assert(emptySleep.remMinutes === null, "no stage data is null, not zero minutes of REM");

const dayHost = hostFor({ sleep: [], summary: {} });
await fetchSleep({ date: "2026-10-05" }, dayHost);
assert(dayHost.lastUrl?.endsWith("/1.2/user/-/sleep/date/2026-10-05.json"), "a date picks that night");
assert(
  fitbitProvider.queries.sleepToday.key({ date: "2026-10-05" }).join() !== fitbitProvider.queries.sleepToday.key({}).join(),
  "each date caches on its own",
);
let refused = false;
try {
  await fetchSleep({ date: "../profile" }, hostFor({}));
} catch {
  refused = true;
}
assert(refused, "a date that is not yyyy-MM-dd never reaches the url");

const weekHost = hostFor({ sleep: [] });
await fitbitProvider.queries.sleepWeek.fetch({}, weekHost);
const range = /\/1\.2\/user\/-\/sleep\/date\/(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})\.json$/.exec(
  weekHost.lastUrl ?? "",
);
assert(range, "week asks for a yyyy-MM-dd/yyyy-MM-dd range");
const [, from, to] = range;
const lastNight = to!;
const twoNightsAgo = new Date(Date.parse(`${to}T12:00:00`) - 2 * 86_400_000);
const earlier = `${twoNightsAgo.getFullYear()}-${String(twoNightsAgo.getMonth() + 1).padStart(2, "0")}-${String(twoNightsAgo.getDate()).padStart(2, "0")}`;
assert(
  (Date.parse(`${to}T12:00:00`) - Date.parse(`${from}T12:00:00`)) / 86_400_000 === 6,
  "week covers seven dates, today included",
);

const week = (await fitbitProvider.queries.sleepWeek.fetch(
  {},
  hostFor({
    sleep: [
      {
        dateOfSleep: lastNight,
        isMainSleep: true,
        type: "stages",
        minutesAsleep: 400,
        timeInBed: 430,
        efficiency: 93,
        startTime: `${earlier}T23:10:00.000`,
        endTime: `${lastNight}T06:20:00.000`,
        levels: { summary: { deep: { minutes: 70 }, light: { minutes: 220 }, rem: { minutes: 110 }, wake: { minutes: 30 } } },
      },
      { dateOfSleep: lastNight, isMainSleep: false, type: "classic", minutesAsleep: 25, timeInBed: 30 },
      { dateOfSleep: earlier, isMainSleep: true, type: "classic", minutesAsleep: 380, timeInBed: 400 },
    ],
  }),
)) as FitbitSleepNight[];
assert(week.length === 7 && week[6]!.date === lastNight, "seven rows, oldest first, last night last");
assert(week[6]!.minutesAsleep === 425, "a nap counts toward the night's total");
assert(week[6]!.deepMinutes === 70 && week[6]!.remMinutes === 110, "stages come from the main sleep");
assert(week[6]!.startTime === `${earlier}T23:10:00.000`, "times come from the main sleep");
const classic = week.find((night) => night.date === earlier)!;
assert(classic.minutesAsleep === 380 && classic.deepMinutes === null, "a classic log has no stages");
assert(week[0]!.minutesAsleep === 0 && week[0]!.startTime === null, "a night without a log is a gap, not missing");

/** A host answering by path; a `kind` value is thrown as that host error. */
function routedHost(routes: Record<string, unknown>): ProviderHostContext {
  const host = hostFor({});
  host.http.get = async <T>(url: string): Promise<T> => {
    const hit = Object.entries(routes).find(([part]) => url.includes(part));
    const answer = hit?.[1] ?? {};
    if (typeof answer === "object" && answer !== null && "kind" in answer) throw answer;
    return answer as T;
  };
  return host;
}

const fetchVitals = fitbitProvider.queries.nightVitals.fetch;
const vitals = (await fetchVitals(
  { date: "2026-10-05" },
  routedHost({
    "/hrv/date/2026-10-05.json": { hrv: [{ dateTime: "2026-10-05", value: { dailyRmssd: 41.2, deepRmssd: 47.9 } }] },
    "/br/date/2026-10-05/all.json": {
      br: [
        {
          dateTime: "2026-10-05",
          value: {
            fullSleepSummary: { breathingRate: 14.6 },
            deepSleepSummary: { breathingRate: 13.2 },
            lightSleepSummary: { breathingRate: 14.9 },
            remSleepSummary: { breathingRate: -1 },
          },
        },
      ],
    },
    "/spo2/date/2026-10-05.json": { dateTime: "2026-10-05", value: { avg: 96.4, min: 93.1, max: 99.2 } },
    "/activities/heart/date/2026-10-05/1d.json": {
      "activities-heart": [{ dateTime: "2026-10-05", value: { restingHeartRate: 58 } }],
    },
  }),
)) as FitbitNightVitals;
assert(vitals.hrv === 41.2 && vitals.deepHrv === 47.9, "HRV is the night's RMSSD");
assert(vitals.breathingRate === 14.6 && vitals.restingHeartRate === 58, "breathing rate and resting HR unwrap");
assert(vitals.breathingDeep === 13.2 && vitals.breathingLight === 14.9, "breathing rate per stage");
assert(vitals.breathingRem === null, "Fitbit's -1 for a stage without signal is no reading");

const activityDayHost = hostFor({ summary: { steps: 8412 } });
await fetchActivity({ date: "2026-10-04" }, activityDayHost);
assert(
  activityDayHost.lastUrl?.endsWith("/1/user/-/activities/date/2026-10-04.json"),
  "activity takes a date, for the day before a night",
);
let badDay = false;
try {
  await fetchActivity({ date: "../x" }, activityDayHost);
} catch {
  badDay = true;
}
assert(badDay, "an activity date that is not yyyy-MM-dd never reaches the url");
assert(vitals.spo2Avg === 96.4 && vitals.spo2Min === 93.1 && vitals.spo2Max === 99.2, "SpO2 keeps avg, min, max");
assert(vitals.needsReconnect === false, "a full answer needs no reconnect");

const empty = (await fetchVitals({}, routedHost({ "/spo2/": {}, "/hrv/": { hrv: [] } }))) as FitbitNightVitals;
assert(empty.hrv === null && empty.spo2Avg === null && empty.restingHeartRate === null, "no reading is null, not zero");

const oldConnection = (await fetchVitals(
  {},
  routedHost({
    "/hrv/": { kind: "permission-denied", message: "insufficient scope" },
    "/activities/heart/": { "activities-heart": [{ value: { restingHeartRate: 61 } }] },
  }),
)) as FitbitNightVitals;
assert(
  oldConnection.needsReconnect && oldConnection.hrv === null && oldConnection.restingHeartRate === 61,
  "a missing scope nulls that reading, flags reconnect, and keeps the rest",
);

const heartUrls: string[] = [];
const heartHost = routedHost({});
heartHost.http.get = async <T>(url: string): Promise<T> => {
  heartUrls.push(url);
  const date = /date\/(\d{4}-\d{2}-\d{2})\//.exec(url)![1];
  const dataset =
    date === "2026-10-08"
      ? [{ time: "23:05:00", value: 54 }, { time: "23:06:00", value: null }]
      : [{ time: "00:00:00", value: 52 }, { time: "07:06:00", value: 66 }];
  return { "activities-heart-intraday": { dataset } } as T;
};
const heart = (await fitbitProvider.queries.sleepHeartRate.fetch(
  { start: "2026-10-08T23:05:30.000", end: "2026-10-09T07:06:00.000" },
  heartHost,
)) as FitbitHeartPoint[];
assert(
  heartUrls.some((u) => u.endsWith("/activities/heart/date/2026-10-08/1d/1min/time/23:05/23:59.json")) &&
    heartUrls.some((u) => u.endsWith("/activities/heart/date/2026-10-09/1d/1min/time/00:00/07:06.json")),
  "a night across midnight is split into two intraday windows",
);
assert(
  heart.length === 3 && heart[0]!.time === "2026-10-08T23:05:00" && heart[2]!.bpm === 66,
  "readings carry their date, in order, and a gap is dropped rather than zeroed",
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

const series = (await fitbitProvider.queries.nightSeries.fetch(
  { date: "2026-10-09" },
  routedHost({
    "/spo2/date/2026-10-09/all.json": {
      dateTime: "2026-10-09",
      minutes: [
        { minute: "2026-10-09T00:01:00", value: 95.2 },
        { minute: "2026-10-08T23:59:00", value: 96.1 },
        { minute: "2026-10-09T00:02:00", value: null },
      ],
    },
    "/hrv/date/2026-10-09/all.json": {
      hrv: [
        {
          dateTime: "2026-10-09",
          minutes: [{ minute: "2026-10-09T01:05:00.000", value: { rmssd: 38.4, coverage: 0.94, hf: 400, lf: 300 } }],
        },
      ],
    },
  }),
)) as FitbitNightSeries;
assert(
  series.spo2.length === 2 && series.spo2[0]!.time === "2026-10-08T23:59:00" && series.spo2[1]!.value === 95.2,
  "SpO2 minutes come back sorted, gaps dropped",
);
assert(series.hrv.length === 1 && series.hrv[0]!.value === 38.4, "HRV takes rmssd from each 5-minute window");
assert(series.needsReconnect === false, "a full answer needs no reconnect");
const seriesOld = (await fitbitProvider.queries.nightSeries.fetch(
  {},
  routedHost({ "/spo2/": { kind: "permission-denied", message: "scope" } }),
)) as FitbitNightSeries;
assert(seriesOld.needsReconnect && seriesOld.spo2.length === 0, "a missing scope empties that series and flags reconnect");

let rateLimited = false;
try {
  await fetchVitals({}, routedHost({ "/br/": { kind: "rate-limited", message: "slow down" } }));
} catch {
  rateLimited = true;
}
assert(rateLimited, "any other failure still throws");

try {
  await fetchProfile({}, hostFor({ user: {} }, false));
  assert(false, "disconnected must throw");
} catch (error) {
  assert(
    typeof error === "object" && error !== null && (error as { kind?: string }).kind === "disconnected",
    "a missing credential is disconnected, not a generic error",
  );
}

console.log("fitbit provider.assert: ok");
