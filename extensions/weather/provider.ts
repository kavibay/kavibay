// SPDX-License-Identifier: MIT
import { defineProvider, type ResultSchema } from "@sdk/contract/sdk";
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
  hosts: ["geocoding-api.open-meteo.com", "api.open-meteo.com"],
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
