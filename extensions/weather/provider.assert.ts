// SPDX-License-Identifier: MIT
/**
 * Weather provider: today's sunrise and sunset.
 * Run: npx tsx extensions/weather/provider.assert.ts
 */
import type { ProviderHostContext } from "@sdk/contract/sdk";
import { weatherProvider, type AirHour, type SunTimes, type TemperatureHour } from "./provider";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Answers the geocoder and the forecast by host; records the forecast params. */
function hostFor(geo: unknown, forecast: unknown): ProviderHostContext & { params?: Record<string, unknown> } {
  const host: ProviderHostContext & { params?: Record<string, unknown> } = {
    credentials: { isConnected: async () => true },
    http: {
      get: async <T>(url: string, params?: Record<string, unknown>): Promise<T> => {
        if (url.includes("geocoding-api")) return geo as T;
        host.params = params;
        return forecast as T;
      },
      post: async () => undefined as never,
      put: async () => undefined as never,
      patch: async () => undefined as never,
    },
  };
  return host;
}

const fetchSun = weatherProvider.queries.sun.fetch;

const host = hostFor(
  { results: [{ name: "Berlin", admin1: "Land Berlin", country: "Germany", latitude: 52.52, longitude: 13.41 }] },
  {
    daily: {
      sunrise: ["2026-10-09T07:21"],
      sunset: ["2026-10-09T18:28"],
      daylight_duration: [40020.4],
      moonrise: ["2026-10-09T05:50"],
      moonset: [null],
      moon_phase: [0.958],
    },
  },
);
const sun = (await fetchSun({ location: "Berlin" }, host)) as SunTimes;
assert(sun.sunrise === "2026-10-09T07:21" && sun.sunset === "2026-10-09T18:28", "sunrise and sunset pass through");
assert(sun.daylightMinutes === 667, "daylight is whole minutes");
assert(sun.moonPhase === 0.958 && sun.moonrise === "2026-10-09T05:50", "moon phase and moonrise pass through");
assert(sun.moonset === null, "a day without a moonset is null, not an error");
assert(
  String(host.params?.daily).includes("moon_phase"),
  "the moon comes from the same daily request as the sun",
);
assert(sun.place === "Berlin, Land Berlin, Germany", "the place is named the way places lists it");
assert(
  host.params?.timezone === "auto",
  "times come back in the place's own time zone",
);

const nowhere = (await fetchSun({ location: "Atlantis" }, hostFor({ results: [] }, {}))) as SunTimes;
assert(nowhere.sunrise === null && nowhere.place === "Atlantis", "an unknown place is a reading without a value");

const fetchAir = weatherProvider.queries.airQualityHours.fetch;
const berlin = { results: [{ name: "Berlin", latitude: 52.52, longitude: 13.41 }] };
const airHost = hostFor(berlin, {
  hourly: {
    time: ["2026-10-08T23:00", "2026-10-09T00:00", "2026-10-09T01:00"],
    european_aqi: [31, null, 24],
    pm2_5: [8.4, null, 5.1],
  },
});
const air = (await fetchAir(
  { location: "Berlin", start: "2026-10-08T23:41:30.000", end: "2026-10-09T07:06:00.000" },
  airHost,
)) as AirHour[];
assert(
  airHost.params?.start_hour === "2026-10-08T23:00" && airHost.params?.end_hour === "2026-10-09T07:00",
  "a sleep's start and end become whole hours, the last one included",
);
assert(airHost.params?.hourly === "european_aqi,pm2_5", "asks for the European AQI and PM2.5 only");
assert(
  air.length === 2 && air[0]!.aqi === 31 && air[0]!.pm25 === 8.4 && air[1]!.time === "2026-10-09T01:00",
  "an hour with no reading is dropped, not zeroed",
);
for (const bad of [
  { location: "Berlin", start: "23:00", end: "07:00" },
  { location: "Berlin", start: "2026-10-09T07:00", end: "2026-10-08T23:00" },
  { location: "Berlin", start: "2026-10-01T00:00", end: "2026-10-09T00:00" },
]) {
  let threw = false;
  try {
    await fetchAir(bad, airHost);
  } catch {
    threw = true;
  }
  assert(threw, `refuses ${JSON.stringify(bad)}`);
}
const nowhereAir = (await fetchAir(
  { location: "Atlantis", start: "2026-10-08T23:00", end: "2026-10-09T07:00" },
  hostFor({ results: [] }, {}),
)) as AirHour[];
assert(nowhereAir.length === 0, "an unknown place has no readings");

const tempHost = hostFor(berlin, {
  hourly: {
    time: ["2026-10-09T00:00", "2026-10-09T01:00", "2026-10-09T02:00", "2026-10-09T03:00"],
    temperature_2m: [9.4, null, 8.1, null],
    surface_pressure: [1013.2, null, 1011.8, 1011.1],
  },
});
const temps = (await weatherProvider.queries.temperatureHours.fetch(
  { location: "Berlin", start: "2026-10-08T23:41:30.000", end: "2026-10-09T07:06:00.000" },
  tempHost,
)) as TemperatureHour[];
assert(
  tempHost.params?.hourly === "temperature_2m,surface_pressure" && tempHost.params?.end_hour === "2026-10-09T07:00",
  "temperature and pressure share one request and the whole-hour window",
);
assert(
  temps.length === 3 && temps[1]!.temperature === 8.1 && temps[0]!.pressure === 1013.2,
  "an hour with neither reading is dropped",
);
assert(temps[2]!.temperature === null && temps[2]!.pressure === 1011.1, "an hour with only pressure keeps it");
let tempRefused = false;
try {
  await weatherProvider.queries.temperatureHours.fetch({ location: "Berlin", start: "x", end: "y" }, tempHost);
} catch {
  tempRefused = true;
}
assert(tempRefused, "temperature refuses a window that is not local times");

console.log("weather provider.assert: ok");
