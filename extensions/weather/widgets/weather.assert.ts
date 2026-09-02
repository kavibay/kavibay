import { effectScope } from "vue";
import type { HttpCapability, WidgetContext } from "@sdk/contract/sdk";
import {
  describeWeatherCode,
  normalizeWeatherConfig,
  normalizeWeatherState,
} from "../weatherLogic";
import {
  duplicateWeatherData,
  runShowWeatherAction,
  weatherWidget,
  type WeatherModel,
} from "./weather";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  assert(actual === expected, `${message}: expected ${String(expected)}, got ${String(actual)}`);
}

function deepEqual(actual: unknown, expected: unknown, message: string): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected), message);
}

const cells = new Map<string, unknown>();
const data = {
  get: async <T>(key: string) => cells.get(key) as T | undefined,
  set: async <T>(key: string, value: T) => void cells.set(key, value),
  delete: async (key: string) => void cells.delete(key),
};

const calls: string[] = [];
const http: HttpCapability = {
  get: async <T>(url: string) => {
    calls.push(url);
    if (url.includes("geocoding")) {
      return { results: [{ name: "Berlin", latitude: 52.52, longitude: 13.405 }] } as T;
    }
    return {
      current: {
        temperature_2m: 18.4,
        weather_code: 61,
        relative_humidity_2m: 72,
        wind_speed_10m: 11.2,
        apparent_temperature: 17.1,
        time: "2026-08-19T12:00",
      },
      hourly: {
        time: ["2026-08-19T12:00", "2026-08-19T13:00"],
        temperature_2m: [18.4, 19.1],
        weather_code: [61, 0],
      },
      daily: {
        time: ["2026-08-19"],
        temperature_2m_max: [21],
        temperature_2m_min: [14],
        weather_code: [61],
      },
    } as T;
  },
  post: async <T>() => undefined as T,
};

const config = { location: "Berlin" };
const context = {
  instanceId: "weather-assert",
  config,
  data,
  http,
} satisfies WidgetContext<{ location: string }>;

deepEqual(normalizeWeatherConfig({ location: "  Hamburg " }), { location: "Hamburg" }, "config is normalized");
deepEqual(normalizeWeatherState({ viewIndex: -1 }), { viewIndex: 3 }, "view index wraps");
deepEqual(describeWeatherCode(95), { icon: "thunderstorm", condition: "Thunderstorm" }, "WMO codes map");
deepEqual(duplicateWeatherData("state", { viewIndex: 9 }), { viewIndex: 1 }, "duplicate state normalizes");

const scope = effectScope();
const model = await scope.run(() => weatherWidget.component.setup(context)) as WeatherModel;
await model.refresh();
equal(model.data.value?.location, "Berlin", "the host HTTP capability loads the place");
equal(model.data.value?.hourly.length, 2, "hourly forecast data is normalized");
equal(model.data.value?.daily[0]?.temperature_min_c, 14, "daily forecast data is normalized");
deepEqual(calls, [
  "https://geocoding-api.open-meteo.com/v1/search",
  "https://api.open-meteo.com/v1/forecast",
], "weather uses the declared endpoints");

const configChanges: Record<string, unknown>[] = [];
await runShowWeatherAction({
  ctx: context,
  args: { city: "Hamburg", view: "week" },
  setConfig: (values) => {
    configChanges.push(values);
    Object.assign(config, values);
  },
});
deepEqual(configChanges, [{ location: "Hamburg" }], "the action changes schema config");
deepEqual(cells.get("state"), { viewIndex: 3 }, "the action persists the selected slide");

scope.stop();
console.log("weather.assert.ts: ok");
