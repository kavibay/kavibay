// SPDX-License-Identifier: MIT
/**
 * Weather domain logic: WMO code mapping, normalization, and the two
 * Open-Meteo requests made through the contract host's HTTP capability.
 */

import type { HttpCapability } from "@sdk/contract/sdk";

export type WeatherIconKey =
  | "clear"
  | "partly-cloudy"
  | "cloudy"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "thunderstorm";

export interface WeatherConfig {
  /** City query; empty values normalize to Berlin. */
  location: string;
}

export interface WeatherStoredState {
  /** Active carousel slide (0 .. WEATHER_VIEW_COUNT-1). */
  viewIndex: number;
}

export const WEATHER_VIEW_COUNT = 4;
export const DEFAULT_LOCATION = "Berlin";

export const DEFAULT_WEATHER_CONFIG: WeatherConfig = {
  location: DEFAULT_LOCATION,
};

export const DEFAULT_WEATHER_STATE: WeatherStoredState = {
  viewIndex: 0,
};

/** Wrap carousel index into 0 .. WEATHER_VIEW_COUNT-1. */
export function wrapViewIndex(index: number): number {
  const n = WEATHER_VIEW_COUNT;
  return ((index % n) + n) % n;
}

/** Normalize the schema-driven configuration handed to setup. */
export function normalizeWeatherConfig(raw: unknown): WeatherConfig {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const location =
    typeof value.location === "string" && value.location.trim()
      ? value.location.trim()
      : DEFAULT_LOCATION;
  return { location };
}

/** Normalize persisted per-instance view state. */
export function normalizeWeatherState(raw: unknown): WeatherStoredState {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rawView = value.viewIndex;
  const asNumber =
    typeof rawView === "number"
      ? rawView
      : typeof rawView === "string"
        ? Number(rawView)
        : NaN;
  return {
    viewIndex: Number.isFinite(asNumber) ? wrapViewIndex(Math.trunc(asNumber)) : 0,
  };
}

/** Map Open-Meteo WMO weather code to icon key + English label. */
export function describeWeatherCode(code: number): {
  icon: WeatherIconKey;
  condition: string;
} {
  if (code === 0) return { icon: "clear", condition: "Clear" };
  if (code === 1 || code === 2) return { icon: "partly-cloudy", condition: "Partly cloudy" };
  if (code === 3) return { icon: "cloudy", condition: "Cloudy" };
  if (code === 45 || code === 48) return { icon: "fog", condition: "Fog" };
  if (code >= 51 && code <= 57) return { icon: "drizzle", condition: "Drizzle" };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) {
    return { icon: "rain", condition: "Rain" };
  }
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) {
    return { icon: "snow", condition: "Snow" };
  }
  if (code >= 95 && code <= 99) return { icon: "thunderstorm", condition: "Thunderstorm" };
  return { icon: "cloudy", condition: "Cloudy" };
}

export interface WeatherHourPoint {
  /** ISO-like time string from Open-Meteo (use for hour label). */
  time: string;
  temperature_c: number;
  icon: WeatherIconKey;
  condition: string;
}

export interface WeatherDayPoint {
  date: string;
  temperature_min_c: number;
  temperature_max_c: number;
  icon: WeatherIconKey;
  condition: string;
}

export interface WeatherInfo {
  /** Resolved place name from geocoding. */
  location: string;
  temperature_c: number;
  /** Short English condition label. */
  condition: string;
  icon: WeatherIconKey;
  apparent_c: number;
  humidity_pct: number;
  wind_kmh: number;
  hourly: WeatherHourPoint[];
  daily: WeatherDayPoint[];
}

export type WeatherLoadResult =
  | { ok: true; data: WeatherInfo }
  | { ok: false; error: string };

interface GeoResult {
  name: string;
  latitude: number;
  longitude: number;
}

interface ForecastJson {
  current?: {
    temperature_2m?: number;
    weather_code?: number;
    relative_humidity_2m?: number;
    wind_speed_10m?: number;
    apparent_temperature?: number;
    time?: string;
  };
  hourly?: {
    time?: string[];
    temperature_2m?: number[];
    weather_code?: number[];
  };
  daily?: {
    time?: string[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    weather_code?: number[];
  };
}

/**
 * Geocode a city query and load current + hourly + daily weather.
 *
 * The extension contributes only the host names and GET method declaration;
 * the host owns the actual network boundary and rate limiting.
 */
export async function fetchWeather(
  http: HttpCapability,
  locationQuery: string,
): Promise<WeatherLoadResult> {
  const query = locationQuery.trim() || DEFAULT_LOCATION;

  let geoJson: { results?: GeoResult[] };
  try {
    geoJson = await http.get<{ results?: GeoResult[] }>(
      "https://geocoding-api.open-meteo.com/v1/search",
      { name: query, count: 1, language: "en", format: "json" },
    );
  } catch {
    return { ok: false, error: "Could not load weather" };
  }

  const place = geoJson.results?.[0];
  if (!place) return { ok: false, error: "Location not found" };

  try {
    const wxJson = await http.get<ForecastJson>(
      "https://api.open-meteo.com/v1/forecast",
      {
        latitude: place.latitude,
        longitude: place.longitude,
        current: "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m",
        hourly: "temperature_2m,weather_code",
        daily: "weather_code,temperature_2m_max,temperature_2m_min",
        forecast_days: 5,
        timezone: "auto",
      },
    );

    const cur = wxJson.current;
    if (
      typeof cur?.temperature_2m !== "number" ||
      typeof cur.weather_code !== "number" ||
      typeof cur.relative_humidity_2m !== "number" ||
      typeof cur.wind_speed_10m !== "number" ||
      typeof cur.apparent_temperature !== "number"
    ) {
      return { ok: false, error: "Could not load weather" };
    }

    const { icon, condition } = describeWeatherCode(cur.weather_code);

    const hourlyTimes = wxJson.hourly?.time ?? [];
    const hourlyTemps = wxJson.hourly?.temperature_2m ?? [];
    const hourlyCodes = wxJson.hourly?.weather_code ?? [];
    const nowIso = cur.time ?? "";
    let start = hourlyTimes.findIndex((time) => time >= nowIso);
    if (start < 0) start = 0;
    const hourly: WeatherHourPoint[] = [];
    for (let i = start; i < hourlyTimes.length && hourly.length < 12; i++) {
      const temp = hourlyTemps[i];
      const code = hourlyCodes[i];
      if (typeof temp !== "number" || typeof code !== "number") continue;
      const current = describeWeatherCode(code);
      hourly.push({
        time: hourlyTimes[i]!,
        temperature_c: temp,
        icon: current.icon,
        condition: current.condition,
      });
    }

    const dailyTimes = wxJson.daily?.time ?? [];
    const dailyMax = wxJson.daily?.temperature_2m_max ?? [];
    const dailyMin = wxJson.daily?.temperature_2m_min ?? [];
    const dailyCodes = wxJson.daily?.weather_code ?? [];
    const daily: WeatherDayPoint[] = [];
    for (let i = 0; i < dailyTimes.length && daily.length < 5; i++) {
      const max = dailyMax[i];
      const min = dailyMin[i];
      const code = dailyCodes[i];
      if (typeof max !== "number" || typeof min !== "number" || typeof code !== "number") continue;
      const current = describeWeatherCode(code);
      daily.push({
        date: dailyTimes[i]!,
        temperature_max_c: max,
        temperature_min_c: min,
        icon: current.icon,
        condition: current.condition,
      });
    }

    return {
      ok: true,
      data: {
        location: place.name,
        temperature_c: cur.temperature_2m,
        condition,
        icon,
        apparent_c: cur.apparent_temperature,
        humidity_pct: cur.relative_humidity_2m,
        wind_kmh: cur.wind_speed_10m,
        hourly,
        daily,
      },
    };
  } catch {
    return { ok: false, error: "Could not load weather" };
  }
}
