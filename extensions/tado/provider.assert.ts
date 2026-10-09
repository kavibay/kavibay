/**
 * Run: npx tsx extensions/tado/provider.assert.ts
 *
 * WHY THIS FILE EXISTS. The dev board exercises `fixtures/tado`, and the real
 * provider only runs against a connected account — so its normalization was the
 * one piece of this change that nothing could execute. The fetches are pure
 * apart from `host.http`, so a fake http is enough to run them for real.
 *
 * The last two assertions are the ones worth keeping: they check each query's
 * actual output against the `result` that same query declares. That is the pair
 * findings 4 and 7 are about — two statements of one fact — and here they are
 * compared rather than trusted.
 */
import type { ProviderHostContext } from "@sdk/contract/sdk";
import { resultSchemaProblems } from "@sdk/contract/resultSchema";
import { tadoProvider, type TadoRoom, type TadoRoomHistory, type TadoRoomState } from "./provider";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/** Only `http.get` is reached; the rest of the context is not touched. */
const hostWith = (payload: unknown): ProviderHostContext =>
  ({
    http: { get: async () => payload },
    credentials: { isConnected: async () => true },
  }) as unknown as ProviderHostContext;

const zones = tadoProvider.queries.zones;
const zoneStates = tadoProvider.queries.zoneStates;

// --- zones -----------------------------------------------------------------

const rooms = (await zones.fetch({}, hostWith([
  { id: 1, name: "Wohnzimmer" },
  { id: 2, name: "Küche" },
]))) as TadoRoom[];

assert(rooms.length === 2, "every zone survives normalization");
assert(rooms[0].id === "1", "the numeric zone id becomes a string, so it joins with zoneStates keys");
assert(rooms[0].name === "Wohnzimmer", "the name is carried through");
assert(
  (await zones.fetch({}, hostWith({ error: "nope" }))).length === 0,
  "an error envelope is data, not a crash — a changed API shape must not take the tile down",
);
assert(
  ((await zones.fetch({}, hostWith([{ name: "no id" }]))) as TadoRoom[]).length === 0,
  "a zone without an id cannot be joined and is dropped rather than half-mapped",
);

// --- zoneStates ------------------------------------------------------------

const states = (await zoneStates.fetch({}, hostWith({
  zoneStates: {
    "1": {
      setting: { power: "ON", temperature: { celsius: 20 } },
      sensorDataPoints: {
        insideTemperature: { celsius: 21.5 },
        humidity: { percentage: 44 },
      },
    },
    // A room that is offline: tado° simply omits the sensor block.
    "2": { setting: { power: "OFF", temperature: null }, sensorDataPoints: {} },
  },
}))) as TadoRoomState[];

assert(states.length === 2, "both rooms are reported, including the offline one");
assert(states[0].temperature === 21.5, "the celsius value is lifted out of the nesting");
assert(states[0].humidity === 44, "so is the humidity percentage");
assert(
  states[1].temperature === null && states[1].humidity === null,
  "an offline room yields null rather than a missing field — the widget renders a dash",
);
assert(states[0].target === 20, "a heating zone reports its setpoint");
assert(states[1].target === null, "a zone with heating off has no setpoint");
assert(
  (await zoneStates.fetch({}, hostWith({}))).length === 0,
  "a response without zoneStates is empty, not a throw",
);

// --- the declaration is checked against the real output --------------------

assert(
  resultSchemaProblems(zones.result!, rooms).length === 0,
  "zones matches the result it declares",
);
assert(
  resultSchemaProblems(zoneStates.result!, states).length === 0,
  "zoneStates matches the result it declares, offline room included",
);

// --- setTemperature --------------------------------------------------------

const setTemperature = tadoProvider.actions.setTemperature;
const puts: Array<{ url: string; body: unknown }> = [];
const writer = {
  http: { put: async (url: string, body: unknown) => void puts.push({ url, body }) },
} as unknown as ProviderHostContext;

await setTemperature.execute({ zoneId: "3", celsius: 21.5 }, writer);
assert(puts.length === 1, "one write per call");
assert(
  puts[0].url === "https://my.tado.com/api/v2/homes/{{homeId}}/zones/3/overlay",
  "the overlay of the named zone, with homeId left for the host to fill",
);
assert(
  JSON.stringify(puts[0].body) === JSON.stringify({
    setting: { type: "HEATING", power: "ON", temperature: { celsius: 21.5 } },
    termination: { typeSkillBasedApp: "NEXT_TIME_BLOCK" },
  }),
  "the overlay heats to the value until the next scheduled change",
);

const refused = async (args: { zoneId: string; celsius: number }) =>
  setTemperature.execute(args, writer).then(() => false, () => true);
assert(await refused({ zoneId: "../me", celsius: 21 }), "a zone id that is not a number never reaches the path");
assert(await refused({ zoneId: "3", celsius: 30 }), "a value above tado°'s range is refused");
assert(await refused({ zoneId: "3", celsius: Number.NaN }), "so is a value that is not a number");
assert(puts.length === 1, "refused calls send nothing");

// --- roomHistory -----------------------------------------------------------

const roomHistory = tadoProvider.queries.roomHistory;
// tado° answers in UTC; built from local times so the test holds in any time zone.
const utc = (day: number, hour: number, minute: number) => new Date(2026, 9, day, hour, minute).toISOString();
const reportUrls: Array<{ url: string; params: unknown }> = [];
const reporter = {
  http: {
    get: async (url: string, params?: { date?: string }) => {
      reportUrls.push({ url, params });
      return params?.date === "2026-10-08"
        ? {
            measuredData: {
              insideTemperature: {
                dataPoints: [
                  { timestamp: utc(8, 22, 0), value: { celsius: 21.9 } },
                  { timestamp: utc(8, 23, 45), value: { celsius: 21.2 } },
                ],
              },
              humidity: { dataPoints: [{ timestamp: utc(8, 23, 45), value: 0.512 }] },
            },
            callForHeat: {
              dataIntervals: [
                { from: utc(8, 21, 0), to: utc(8, 23, 0), value: "HIGH" },
                { from: utc(8, 23, 0), to: utc(9, 0, 30), value: "LOW" },
              ],
            },
            stripes: {
              dataIntervals: [
                { from: utc(8, 23, 50), to: utc(9, 0, 5), value: { stripeType: "OPEN_WINDOW" } },
                { from: utc(8, 0, 0), to: utc(8, 23, 50), value: { stripeType: "HOME" } },
              ],
            },
          }
        : {
            measuredData: {
              insideTemperature: { dataPoints: [{ timestamp: utc(9, 6, 0), value: { celsius: 19.4 } }] },
              humidity: { dataPoints: [{ timestamp: utc(9, 6, 0), value: 0.55 }] },
            },
          };
    },
  },
} as unknown as ProviderHostContext;

const history = (await roomHistory.fetch(
  { zoneId: "1", start: "2026-10-08T23:41:30.000", end: "2026-10-09T07:06:00.000" },
  reporter,
)) as TadoRoomHistory;
const night = history.readings;
assert(
  reportUrls.length === 2 &&
    reportUrls.every((r) => r.url === "https://my.tado.com/api/v2/homes/{{homeId}}/zones/1/dayReport"),
  "a night across midnight is one dayReport per date, homeId left for the host",
);
assert(night.length === 2, "readings outside the night are dropped (22:00 is before bedtime)");
assert(
  night[0].time === "2026-10-08T23:45:00" && night[0].temperature === 21.2 && night[0].humidity === 51.2,
  "UTC becomes local time, temperature and humidity join on the minute, humidity is a percentage",
);
assert(night[1].temperature === 19.4 && night[1].humidity === 55, "the second date's readings follow");
assert(
  history.heating.length === 1 &&
    history.heating[0].level === 1 &&
    history.heating[0].from === "2026-10-08T23:41:00" &&
    history.heating[0].to === "2026-10-09T00:30:00",
  "heating before bedtime is dropped, the rest is clipped to the night, and LOW is level 1",
);
assert(
  history.windowOpen.length === 1 &&
    history.windowOpen[0].from === "2026-10-08T23:50:00" &&
    history.windowOpen[0].to === "2026-10-09T00:05:00",
  "only OPEN_WINDOW stripes become open-window spans",
);
assert(
  resultSchemaProblems(roomHistory.result!, history).length === 0,
  "roomHistory matches the result it declares",
);

const historyRefused = async (args: { zoneId: string; start: string; end: string }) =>
  roomHistory.fetch(args, reporter).then(() => false, () => true);
const callsBefore = reportUrls.length;
assert(
  await historyRefused({ zoneId: "../me", start: "2026-10-08T23:00", end: "2026-10-09T07:00" }),
  "a zone id that is not a number never reaches the path",
);
assert(
  await historyRefused({ zoneId: "1", start: "2026-10-09T07:00", end: "2026-10-08T23:00" }),
  "a window that runs backwards is refused",
);
assert(
  await historyRefused({ zoneId: "1", start: "2026-10-01T23:00", end: "2026-10-09T07:00" }),
  "a window longer than 48 hours is refused rather than spending a week of calls",
);
assert(reportUrls.length === callsBefore, "refused windows cost no calls");

console.log("provider.assert.ts: ok");
