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
      sensorDataPoints: {
        insideTemperature: { celsius: 21.5 },
        humidity: { percentage: 44 },
      },
    },
    // A room that is offline: tado° simply omits the sensor block.
    "2": { sensorDataPoints: {} },
  },
}))) as TadoRoomState[];

assert(states.length === 2, "both rooms are reported, including the offline one");
assert(states[0].temperature === 21.5, "the celsius value is lifted out of the nesting");
assert(states[0].humidity === 44, "so is the humidity percentage");
assert(
  states[1].temperature === null && states[1].humidity === null,
  "an offline room yields null rather than a missing field — the widget renders a dash",
);
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

console.log("provider.assert.ts: ok");
