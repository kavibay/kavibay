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
import { tadoProvider, type TadoRoom, type TadoRoomState } from "./provider";

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

console.log("provider.assert.ts: ok");
