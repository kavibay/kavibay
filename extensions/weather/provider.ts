// SPDX-License-Identifier: MIT
import { defineProvider, type ProviderHostContext, type ResultSchema } from "@sdk/contract/sdk";
import { describeWeatherCode, fetchWeather, type WeatherInfo } from "./weatherLogic";

/**
 * The Open-Meteo provider: outdoor weather as an account you pick, not a URL
 * you type.
 *
 * WHY A PROVIDER FOR A SERVICE THAT NEEDS NO KEY. Invariant 8 says anything
 * requiring a credential *must* be a provider. It does not say only those may
 * be — and the reason to make this one is a different one entirely: the Widget
 * Wizard can only see providers. Its contract mode hands the model query names,
 * argument specs and result schemas, so a person describes a widget in a
 * sentence and never learns that a temperature lives at
 * `/v1/forecast?current=temperature_2m`. A source that is not a provider is a
 * source that mode cannot reach, and the person is sent to the standalone
 * format to hand-write endpoints — which is the technicality the Wizard exists
 * to remove.
 *
 * `requiresCredential: false` is therefore load-bearing rather than paperwork:
 * the host treats such a provider as connected the moment it is installed, so
 * this contributes a pickable data source with no connect step in front of it.
 *
 * NOT AN AUTH BOUNDARY. `hosts` here documents the compiled Rust declaration in
 * `src-tauri/src/extensions/weather/`, as with every provider — but unlike
 * tado° no credential is ever attached, so the list is a CSP and SSRF concern
 * only, never a decision about where a secret may go. Finding 11.
 */

export const PROVIDER_ID = "kavibay.weather/weather";

/** A place the user can choose. `id` is what `current` takes back. */
export interface WeatherPlace {
  id: string;
  name: string;
}

/** Current conditions, already normalized — the widget does not dig. */
export interface WeatherNow {
  place: string;
  temperature: number | null;
  apparentTemperature: number | null;
  humidity: number | null;
  windSpeed: number | null;
  condition: string;
}

interface GeoResult {
  name?: string;
  country?: string;
  admin1?: string;
  latitude?: number;
  longitude?: number;
}

interface ForecastJson {
  current?: {
    temperature_2m?: number;
    apparent_temperature?: number;
    relative_humidity_2m?: number;
    wind_speed_10m?: number;
    weather_code?: number;
  };
}

const GEOCODE = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST = "https://api.open-meteo.com/v1/forecast";
const AIR_QUALITY = "https://air-quality-api.open-meteo.com/v1/air-quality";

export interface AirQuality {
  place: string;
  /** European AQI (EEA): 0 is clean air, above 100 extremely poor. */
  aqi: number | null;
  /** The EEA's band for it: Good, Fair, Moderate, Poor, Very poor, Extremely poor. */
  level: string;
}

/** The EEA's bands for the European AQI, upper bounds inclusive. */
export function aqiLevel(aqi: number | null): string {
  if (aqi === null) return "Unknown";
  if (aqi <= 20) return "Good";
  if (aqi <= 40) return "Fair";
  if (aqi <= 60) return "Moderate";
  if (aqi <= 80) return "Poor";
  if (aqi <= 100) return "Very poor";
  return "Extremely poor";
}

/** Today's sun for a place, in the place's own local time ("2026-10-09T07:41"). */
export interface SunTimes {
  place: string;
  sunrise: string | null;
  sunset: string | null;
  /** Minutes between sunrise and sunset. */
  daylightMinutes: number | null;
  moonrise: string | null;
  moonset: string | null;
  /** 0 and 1 are new moon, 0.25 first quarter, 0.5 full moon, 0.75 last quarter. */
  moonPhase: number | null;
}

/** One hour of outdoor air at a place, in the place's local time. */
export interface AirHour {
  time: string;
  /** European AQI (EEA), as `airQuality` reports it. */
  aqi: number | null;
  /** Fine particles, µg/m³. */
  pm25: number | null;
}

interface AirHoursArgs {
  location: string;
  /** Local times "yyyy-MM-ddTHH:mm"; a sleep log's startTime / endTime fit as they are. */
  start: string;
  end: string;
}

/** Outdoor temperature (°C) and surface pressure (hPa) for one hour, in the place's local time. */
export interface TemperatureHour {
  time: string;
  temperature: number | null;
  pressure: number | null;
}

const LOCAL_HOUR = /^(\d{4}-\d{2}-\d{2}T\d{2}):\d{2}/;

/** Longest window the hourly queries serve: a night, with room either side. */
const HOURS_MAX_MS = 48 * 60 * 60 * 1000;

/**
 * `start`/`end` as Open-Meteo's `start_hour`/`end_hour`: whole hours, the end
 * one included, so a night ending 07:06 keeps 07:00. Refuses anything that is
 * not a local time, runs backwards, or spans more than 48 hours.
 */
function hourWindow(args: { start?: string; end?: string }): { start_hour: string; end_hour: string } {
  const from = LOCAL_HOUR.exec(args.start ?? "");
  const to = LOCAL_HOUR.exec(args.end ?? "");
  if (!from || !to) throw new Error("start and end must be yyyy-MM-ddTHH:mm");
  const span = Date.parse(`${to[1]}:00:00`) - Date.parse(`${from[1]}:00:00`);
  if (!(span >= 0) || span > HOURS_MAX_MS) throw new Error("end must follow start by at most 48 hours");
  return { start_hour: `${from[1]}:00`, end_hour: `${to[1]}:00` };
}

/** The first geocoder hit with coordinates, or null for a place nobody could find. */
async function locate(
  host: ProviderHostContext,
  name: string,
): Promise<{ latitude: number; longitude: number } | null> {
  const geo = await host.http.get<{ results?: GeoResult[] }>(GEOCODE, {
    name,
    count: 1,
    language: "en",
    format: "json",
  });
  const place = geo?.results?.[0];
  return place?.latitude === undefined || place.longitude === undefined
    ? null
    : { latitude: place.latitude, longitude: place.longitude };
}

const numberOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** "Berlin, Berlin, Germany" — what a person recognises in a dropdown. */
const placeLabel = (place: GeoResult): string =>
  [place.name, place.admin1, place.country].filter((part) => !!part).join(", ");

/**
 * Open-Meteo is free and unmetered, so these intervals are about the data
 * rather than a call ceiling: conditions move on the order of ten minutes, and
 * a city does not move at all.
 */
const CURRENT_TTL_MS = 10 * 60 * 1000;
const PLACES_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * Shorter than `current` because this one is on screen: the Weather widget
 * reads it, and a number that is ten minutes behind the window is noticeable.
 */
const FORECAST_TTL_MS = 3 * 60 * 1000;

const hourPoint: ResultSchema = {
  type: "object",
  fields: {
    time: { type: "string" },
    temperature_c: { type: "number" },
    icon: { type: "string" },
    condition: { type: "string" },
  },
};

const dayPoint: ResultSchema = {
  type: "object",
  fields: {
    date: { type: "string" },
    temperature_min_c: { type: "number" },
    temperature_max_c: { type: "number" },
    icon: { type: "string" },
    condition: { type: "string" },
  },
};

export const weatherProvider = defineProvider({
  name: "weather",
  displayName: "Weather (Open-Meteo)",
  requiresCredential: false,
  hosts: ["geocoding-api.open-meteo.com", "api.open-meteo.com", "air-quality-api.open-meteo.com"],
  queries: {
    places: {
      description: "Places matching a name, so a widget can offer a list to pick from",
      args: {
        name: { type: "string", label: "Place name", required: true },
      },
      result: {
        type: "list",
        of: { type: "object", fields: { id: { type: "string" }, name: { type: "string" } } },
      },
      key: (args: { name: string }) => [args.name],
      staleTime: PLACES_TTL_MS,
      fetch: async (args: { name: string }, host): Promise<WeatherPlace[]> => {
        const json = await host.http.get<{ results?: GeoResult[] }>(GEOCODE, {
          name: args.name,
          count: 8,
          language: "en",
          format: "json",
        });
        const results = json?.results;
        // Guarded because a provider response is data, not a promise: an error
        // envelope or a changed API shape must not throw here.
        if (!Array.isArray(results)) return [];
        /**
         * `id` is the label rather than a coordinate pair, so a chosen option
         * feeds straight back into `current`, which takes a place by name. One
         * vocabulary instead of two — a widget that had to carry latitude and
         * longitude between the two queries would be knowing the API's shape
         * again, which is the whole thing this provider exists to stop.
         */
        return results
          .map((place) => placeLabel(place))
          .filter((label) => label.length > 0)
          .map((label) => ({ id: label, name: label }));
      },
    },
    current: {
      description: "The current outdoor temperature and conditions for a place",
      args: {
        /**
         * Enumerable from `places`, so a form draws a real list rather than a
         * free-text box that fails on a typo. `ArgSpec.source` names only the
         * query — the provider is always this one — which is why `places` and
         * `current` speak the same place strings rather than coordinates.
         */
        location: {
          type: "string",
          label: "Place",
          required: true,
          source: { query: "places" },
        },
      },
      result: {
        type: "object",
        fields: {
          place: { type: "string" },
          temperature: { type: "number", nullable: true },
          apparentTemperature: { type: "number", nullable: true },
          humidity: { type: "number", nullable: true },
          windSpeed: { type: "number", nullable: true },
          condition: { type: "string" },
        },
      },
      key: (args: { location: string }) => [args.location],
      // Doubles as the refresh interval for a subscription — a tile updates
      // because the host refetches, never because the widget polls.
      staleTime: CURRENT_TTL_MS,
      fetch: async (args: { location: string }, host): Promise<WeatherNow> => {
        const empty: WeatherNow = {
          place: args.location,
          temperature: null,
          apparentTemperature: null,
          humidity: null,
          windSpeed: null,
          condition: "Unknown",
        };

        const geo = await host.http.get<{ results?: GeoResult[] }>(GEOCODE, {
          name: args.location,
          count: 1,
          language: "en",
          format: "json",
        });
        const place = geo?.results?.[0];
        /**
         * A place nobody could find is data, not a failure. Throwing would put
         * the runtime's error banner over an otherwise working widget — and in
         * a two-source widget that means a typo in the weather half blanks the
         * room temperatures too. The honest answer is a reading that says it
         * has none.
         */
        if (place?.latitude === undefined || place.longitude === undefined) return empty;

        const json = await host.http.get<ForecastJson>(FORECAST, {
          latitude: place.latitude,
          longitude: place.longitude,
          current:
            "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m",
          timezone: "auto",
        });
        const current = json?.current;
        if (!current) return { ...empty, place: placeLabel(place) };

        return {
          place: placeLabel(place),
          temperature: numberOrNull(current.temperature_2m),
          apparentTemperature: numberOrNull(current.apparent_temperature),
          humidity: numberOrNull(current.relative_humidity_2m),
          windSpeed: numberOrNull(current.wind_speed_10m),
          condition: describeWeatherCode(
            typeof current.weather_code === "number" ? current.weather_code : -1,
          ).condition,
        };
      },
    },
    airQuality: {
      description: "The current European air quality index (AQI) for a place",
      args: {
        location: {
          type: "string",
          label: "Place",
          required: true,
          source: { query: "places" },
        },
      },
      result: {
        type: "object",
        fields: {
          place: { type: "string" },
          aqi: { type: "number", nullable: true },
          level: { type: "string" },
        },
      },
      key: (args: { location: string }) => [args.location],
      staleTime: CURRENT_TTL_MS,
      // A place nobody could find is a reading without a value, as in `current`.
      fetch: async (args: { location: string }, host): Promise<AirQuality> => {
        const geo = await host.http.get<{ results?: GeoResult[] }>(GEOCODE, {
          name: args.location,
          count: 1,
          language: "en",
          format: "json",
        });
        const place = geo?.results?.[0];
        if (place?.latitude === undefined || place.longitude === undefined) {
          return { place: args.location, aqi: null, level: aqiLevel(null) };
        }
        const json = await host.http.get<{ current?: { european_aqi?: number } }>(AIR_QUALITY, {
          latitude: place.latitude,
          longitude: place.longitude,
          current: "european_aqi",
          timezone: "auto",
        });
        const aqi = numberOrNull(json?.current?.european_aqi);
        return { place: placeLabel(place), aqi, level: aqiLevel(aqi) };
      },
    },
    sun: {
      description:
        "Today's sunrise, sunset, moonrise and moonset for a place, in that place's local time, plus the daylight length and the moon phase (0 and 1 new moon, 0.5 full moon)",
      args: {
        location: {
          type: "string",
          label: "Place",
          required: true,
          source: { query: "places" },
        },
      },
      result: {
        type: "object",
        fields: {
          place: { type: "string" },
          sunrise: { type: "string", nullable: true },
          sunset: { type: "string", nullable: true },
          daylightMinutes: { type: "number", nullable: true },
          moonrise: { type: "string", nullable: true },
          moonset: { type: "string", nullable: true },
          moonPhase: { type: "number", nullable: true },
        },
      },
      key: (args: { location: string }) => [args.location],
      // The sun moves a minute a day; an hour keeps the date current past midnight.
      staleTime: 60 * 60 * 1000,
      // A place nobody could find is a reading without a value, as in `current`.
      fetch: async (args: { location: string }, host): Promise<SunTimes> => {
        const empty: SunTimes = {
          place: args.location,
          sunrise: null,
          sunset: null,
          daylightMinutes: null,
          moonrise: null,
          moonset: null,
          moonPhase: null,
        };
        const geo = await host.http.get<{ results?: GeoResult[] }>(GEOCODE, {
          name: args.location,
          count: 1,
          language: "en",
          format: "json",
        });
        const place = geo?.results?.[0];
        if (place?.latitude === undefined || place.longitude === undefined) return empty;
        const json = await host.http.get<{
          daily?: {
            sunrise?: unknown[];
            sunset?: unknown[];
            daylight_duration?: unknown[];
            moonrise?: unknown[];
            moonset?: unknown[];
            moon_phase?: unknown[];
          };
        }>(FORECAST, {
          latitude: place.latitude,
          longitude: place.longitude,
          daily: "sunrise,sunset,daylight_duration,moonrise,moonset,moon_phase",
          timezone: "auto",
          forecast_days: 1,
        });
        const first = (list: unknown[] | undefined): string | null =>
          typeof list?.[0] === "string" ? (list[0] as string) : null;
        const seconds = numberOrNull(json?.daily?.daylight_duration?.[0]);
        return {
          place: placeLabel(place),
          sunrise: first(json?.daily?.sunrise),
          sunset: first(json?.daily?.sunset),
          daylightMinutes: seconds === null ? null : Math.round(seconds / 60),
          // A day without a moonrise (it happens) comes back empty, not as an error.
          moonrise: first(json?.daily?.moonrise),
          moonset: first(json?.daily?.moonset),
          moonPhase: numberOrNull(json?.daily?.moon_phase?.[0]),
        };
      },
    },
    airQualityHours: {
      description:
        "Hourly European AQI and PM2.5 for a place between two local times (at most 48 hours; past or present, Europe back to 2013). A sleep's startTime and endTime fit as they are",
      args: {
        location: {
          type: "string",
          label: "Place",
          required: true,
          source: { query: "places" },
        },
        start: { type: "string", label: "From (yyyy-MM-ddTHH:mm, local)", required: true },
        end: { type: "string", label: "To (yyyy-MM-ddTHH:mm, local)", required: true },
      },
      result: {
        type: "list",
        of: {
          type: "object",
          fields: {
            time: { type: "string" },
            aqi: { type: "number", nullable: true },
            pm25: { type: "number", nullable: true },
          },
        },
      },
      key: (args: AirHoursArgs) => [args.location, args.start, args.end],
      // Past hours do not change; the newest one fills in within the hour.
      staleTime: 60 * 60 * 1000,
      fetch: async (args: AirHoursArgs, host): Promise<AirHour[]> => {
        const window = hourWindow(args);
        const place = await locate(host, args.location);
        // An unknown place is no readings, as in `current`.
        if (!place) return [];
        const json = await host.http.get<{
          hourly?: { time?: unknown[]; european_aqi?: unknown[]; pm2_5?: unknown[] };
        }>(AIR_QUALITY, {
          latitude: place.latitude,
          longitude: place.longitude,
          hourly: "european_aqi,pm2_5",
          timezone: "auto",
          ...window,
        });
        const hourly = json?.hourly;
        if (!Array.isArray(hourly?.time)) return [];
        return hourly.time
          .map((time, i) => ({
            time: typeof time === "string" ? time : "",
            aqi: numberOrNull(hourly.european_aqi?.[i]),
            pm25: numberOrNull(hourly.pm2_5?.[i]),
          }))
          .filter((hour) => hour.time !== "" && (hour.aqi !== null || hour.pm25 !== null));
      },
    },
    temperatureHours: {
      description:
        "Hourly outdoor temperature (°C) and surface air pressure (hPa) for a place between two local times (at most 48 hours, within the last 92 days). A sleep's startTime and endTime fit as they are",
      args: {
        location: {
          type: "string",
          label: "Place",
          required: true,
          source: { query: "places" },
        },
        start: { type: "string", label: "From (yyyy-MM-ddTHH:mm, local)", required: true },
        end: { type: "string", label: "To (yyyy-MM-ddTHH:mm, local)", required: true },
      },
      result: {
        type: "list",
        of: {
          type: "object",
          fields: {
            time: { type: "string" },
            temperature: { type: "number", nullable: true },
            pressure: { type: "number", nullable: true },
          },
        },
      },
      key: (args: AirHoursArgs) => [args.location, args.start, args.end],
      staleTime: 60 * 60 * 1000,
      fetch: async (args: AirHoursArgs, host): Promise<TemperatureHour[]> => {
        const window = hourWindow(args);
        const place = await locate(host, args.location);
        if (!place) return [];
        // The forecast endpoint keeps the last 92 days, which covers every
        // night a widget can pick; older hours would need the archive host.
        // Pressure rides along in the same request; it costs nothing extra.
        const json = await host.http.get<{
          hourly?: { time?: unknown[]; temperature_2m?: unknown[]; surface_pressure?: unknown[] };
        }>(FORECAST, {
          latitude: place.latitude,
          longitude: place.longitude,
          hourly: "temperature_2m,surface_pressure",
          timezone: "auto",
          ...window,
        });
        const hourly = json?.hourly;
        if (!Array.isArray(hourly?.time)) return [];
        return hourly.time.flatMap((time, i) => {
          const temperature = numberOrNull(hourly.temperature_2m?.[i]);
          const pressure = numberOrNull(hourly.surface_pressure?.[i]);
          return typeof time === "string" && (temperature !== null || pressure !== null)
            ? [{ time, temperature, pressure }]
            : [];
        });
      },
    },
    forecast: {
      description:
        "Current conditions plus the next hours and days for a place, as the Weather widget shows them",
      args: {
        location: {
          type: "string",
          label: "Place",
          required: true,
          source: { query: "places" },
        },
      },
      result: {
        type: "object",
        fields: {
          location: { type: "string" },
          temperature_c: { type: "number" },
          condition: { type: "string" },
          icon: { type: "string" },
          apparent_c: { type: "number" },
          humidity_pct: { type: "number" },
          wind_kmh: { type: "number" },
          hourly: { type: "list", of: hourPoint },
          daily: { type: "list", of: dayPoint },
        },
      },
      key: (args: { location: string }) => [args.location],
      staleTime: FORECAST_TTL_MS,
      /**
       * Throws where `current` returns an empty reading. The Weather widget has
       * always said "Location not found" in place of the numbers, and a thrown
       * query is how it learns that — the cache keeps the last good forecast
       * beside the error, so a failed refresh does not blank the card.
       */
      fetch: async (args: { location: string }, host): Promise<WeatherInfo> => {
        const result = await fetchWeather(host.http, args.location);
        if (!result.ok) throw new Error(result.error);
        return result.data;
      },
    },
  },
  actions: {},
});
