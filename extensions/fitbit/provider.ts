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
  records: number;
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

/** Efficiency from the main sleep log, or the first log when none is marked. */
function mainSleepEfficiency(sleep: unknown): number | null {
  if (!Array.isArray(sleep) || sleep.length === 0) return null;
  const main = sleep.find((row) => asRecord(row).isMainSleep === true) ?? sleep[0];
  const value = asRecord(main).efficiency;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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
  return {
    minutesAsleep: asNumber(summary.totalMinutesAsleep),
    timeInBed: asNumber(summary.totalTimeInBed),
    efficiency: mainSleepEfficiency(row.sleep),
    records: asNumber(summary.totalSleepRecords),
  };
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
    records: { type: "number" as const },
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
      description: "Today's steps, calories, distance and active minutes on Fitbit",
      args: {},
      result: activitySchema,
      key: () => [],
      staleTime: 15 * 60 * 1000,
      fetch: async (_args: Record<string, never>, host): Promise<FitbitActivity> => {
        const date = localDate();
        return mapActivity(
          await fitbitGet(host, `/1/user/-/activities/date/${encodeURIComponent(date)}.json`),
        );
      },
    },
    sleepToday: {
      description: "Last night's sleep on Fitbit",
      args: {},
      result: sleepSchema,
      key: () => [],
      staleTime: 30 * 60 * 1000,
      fetch: async (_args: Record<string, never>, host): Promise<FitbitSleep> => {
        const date = localDate();
        return mapSleep(
          await fitbitGet(host, `/1.2/user/-/sleep/date/${encodeURIComponent(date)}.json`),
        );
      },
    },
  },
  actions: {},
});

export default fitbitProvider;
