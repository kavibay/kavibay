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
      { isMainSleep: true, efficiency: 91 },
    ],
    summary: { totalMinutesAsleep: 420, totalTimeInBed: 460, totalSleepRecords: 2 },
  }),
)) as FitbitSleep;
assert(sleep.minutesAsleep === 420 && sleep.timeInBed === 460, "sleep summary flattens");
assert(sleep.efficiency === 91 && sleep.records === 2, "efficiency comes from the main sleep");

const emptySleep = (await fetchSleep({}, hostFor({ sleep: [], summary: {} }))) as FitbitSleep;
assert(emptySleep.records === 0 && emptySleep.efficiency === null, "a night with no log is zeros, not an error");

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
