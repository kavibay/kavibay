// SPDX-License-Identifier: MIT
import { onScopeDispose, ref, type Ref } from "vue";
import {
  defineWidget,
  type WidgetActionContext,
  type WidgetContext,
} from "@sdk/contract/sdk";
import {
  fetchWeather,
  normalizeWeatherConfig,
  normalizeWeatherState,
  type WeatherConfig,
  type WeatherInfo,
  type WeatherStoredState,
} from "../weatherLogic";

export const WEATHER_STATE_KEY = "state";
const REFRESH_MS = 60_000;

const VIEW_INDEX: Record<string, number> = {
  now: 0,
  details: 1,
  today: 2,
  week: 3,
};

export interface WeatherModel {
  location: string;
  state: Ref<WeatherStoredState>;
  data: Ref<WeatherInfo | null>;
  loading: Ref<boolean>;
  error: Ref<string | null>;
  setViewIndex(index: number): void;
  refresh(): Promise<void>;
}

/** Duplicate settings and the selected carousel slide, but not fetched data. */
export function duplicateWeatherData(key: string, value: unknown): unknown {
  return key === WEATHER_STATE_KEY ? normalizeWeatherState(value) : value;
}

/** Palette action; it also works before the target widget is mounted. */
export async function runShowWeatherAction({
  ctx,
  args,
  setConfig,
}: WidgetActionContext<WeatherConfig>): Promise<void> {
  const city = (args.city ?? "").trim();
  if (!city) throw new Error("a city is required");

  setConfig({ location: city });
  const current = normalizeWeatherState(await ctx.data.get<WeatherStoredState>(WEATHER_STATE_KEY));
  await ctx.data.set(WEATHER_STATE_KEY, {
    viewIndex: args.view ? VIEW_INDEX[args.view] ?? 0 : current.viewIndex,
  });
}

export const weatherWidget = defineWidget<WeatherConfig>({
  name: "weather",
  displayName: "Weather",
  description: "Current weather for a chosen location.",
  defaultSize: { w: 4, h: 3 },
  minSize: { w: 3, h: 2 },
  mode: "both",
  capabilities: {
    http: {
      hosts: ["geocoding-api.open-meteo.com", "api.open-meteo.com"],
      methods: ["GET"],
    },
  },
  configuration: {
    location: {
      type: "string",
      label: "Location",
      required: true,
      default: "Berlin",
    },
  },
  duplicateData: true,
  duplicateDataTransform: duplicateWeatherData,
  actions: { "show-weather": runShowWeatherAction },
  component: {
    async setup(ctx: WidgetContext<WeatherConfig>): Promise<WeatherModel> {
      const config = normalizeWeatherConfig(ctx.config);
      const state = ref<WeatherStoredState>(normalizeWeatherState(undefined));
      const data = ref<WeatherInfo | null>(null);
      const loading = ref(false);
      const error = ref<string | null>(null);
      let hydrated = false;
      let loadSequence = 0;
      let refreshInFlight: Promise<void> | undefined;
      const timerRef: { current?: ReturnType<typeof setInterval> } = {};

      const persist = (): Promise<void> =>
        hydrated ? ctx.data.set(WEATHER_STATE_KEY, state.value) : Promise.resolve();

      const refresh = (): Promise<void> => {
        if (refreshInFlight) return refreshInFlight;
        const sequence = ++loadSequence;
        loading.value = true;
        refreshInFlight = (async () => {
          if (!ctx.http) {
            error.value = "Weather HTTP capability unavailable";
            return;
          }
          const result = await fetchWeather(ctx.http, config.location);
          if (sequence !== loadSequence) return;
          if (result.ok) {
            data.value = result.data;
            error.value = null;
          } else {
            error.value = result.error;
          }
        })().finally(() => {
          if (sequence === loadSequence) loading.value = false;
          refreshInFlight = undefined;
        });
        return refreshInFlight;
      };

      const setViewIndex = (index: number) => {
        state.value = normalizeWeatherState({ viewIndex: index });
        void persist();
      };

      onScopeDispose(() => {
        if (timerRef.current !== undefined) clearInterval(timerRef.current);
        void persist();
      });

      state.value = normalizeWeatherState(
        await ctx.data.get<WeatherStoredState>(WEATHER_STATE_KEY),
      );
      hydrated = true;
      timerRef.current = setInterval(() => void refresh(), REFRESH_MS);
      void refresh();

      return { location: config.location, state, data, loading, error, setViewIndex, refresh };
    },
  },
});
