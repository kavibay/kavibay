import { effectScope } from "vue";
import type {
  HttpCapability,
  QueryState,
  WidgetContext,
  WidgetProviderApi,
} from "@sdk/contract/sdk";
import { PROVIDER_ID, weatherProvider } from "../provider";
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
  get: async <T>(url: string, params?: Record<string, string | number | boolean>) => {
    calls.push(url);
    if (url.includes("geocoding")) {
      if (params?.name === "Atlantis") return { results: [] } as T;
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

/**
 * The host side of `ctx.providers`, reduced to what the widget touches: one
 * subscription, fed by the real provider query. Caching and the refresh timer
 * are the host's `QueryCache`, asserted in `query-cache.assert.ts`.
 */
const subscriptions: Array<{ name: string; args: unknown }> = [];
const providerHost = {
  http: { ...http, put: async <T>() => undefined as T },
  credentials: { isConnected: async () => true },
};
const providerApi = {
  subscribe: async <T>(
    name: string,
    args: Record<string, unknown> | undefined,
    onState: (state: QueryState<T>) => void,
  ) => {
    subscriptions.push({ name, args });
    onState({ status: "loading" });
    try {
      const result = await weatherProvider.queries.forecast.fetch(
        args as { location: string },
        providerHost,
      );
      onState({ status: "success", data: result as T, isStale: false, updatedAt: 0 });
    } catch (err) {
      onState({ status: "error", error: { kind: "provider-error", message: (err as Error).message } });
    }
    return { unsubscribe() {} };
  },
} as unknown as WidgetProviderApi;

const config = { location: "Berlin" };
const context = {
  instanceId: "weather-assert",
  config,
  data,
  providers: { [PROVIDER_ID]: providerApi },
} satisfies WidgetContext<{ location: string }>;

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

deepEqual(normalizeWeatherConfig({ location: "  Hamburg " }), { location: "Hamburg" }, "config is normalized");
deepEqual(normalizeWeatherState({ viewIndex: -1 }), { viewIndex: 3 }, "view index wraps");
deepEqual(describeWeatherCode(95), { icon: "thunderstorm", condition: "Thunderstorm" }, "WMO codes map");
deepEqual(duplicateWeatherData("state", { viewIndex: 9 }), { viewIndex: 1 }, "duplicate state normalizes");

const scope = effectScope();
const model = await scope.run(() => weatherWidget.component.setup(context)) as WeatherModel;
await settle();
deepEqual(
  subscriptions,
  [{ name: "forecast", args: { location: "Berlin" } }],
  "the widget reads the provider's cached forecast instead of fetching itself",
);
equal(model.loading.value, false, "the forecast arrived");
equal(model.data.value?.location, "Berlin", "the provider loads the place");
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

// A place nobody can find is an error the card shows, not an empty forecast.
{
  const lost = effectScope();
  const lostModel = await lost.run(() =>
    weatherWidget.component.setup({ ...context, config: { location: "Atlantis" } }),
  ) as WeatherModel;
  await settle();
  equal(lostModel.error.value, "Location not found", "an unknown place surfaces as the widget's error");
  equal(lostModel.data.value, null, "and brings no data with it");
  lost.stop();
}

console.log("weather.assert.ts: ok");
