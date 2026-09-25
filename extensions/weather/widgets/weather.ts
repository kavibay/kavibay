// SPDX-License-Identifier: MIT
import { computed, onScopeDispose, ref, type Ref } from "vue";
import {
  defineWidget,
  type WidgetActionContext,
  type WidgetContext,
} from "@sdk/contract/sdk";
import { useProviderQuery } from "@sdk/contract/sdk-vue";
import { PROVIDER_ID } from "../provider";
import {
  normalizeWeatherConfig,
  normalizeWeatherState,
  type WeatherConfig,
  type WeatherInfo,
  type WeatherStoredState,
} from "../weatherLogic";

export const WEATHER_STATE_KEY = "state";

const VIEW_INDEX: Record<string, number> = {
  now: 0,
  details: 1,
  today: 2,
  week: 3,
};

export interface WeatherModel {
  location: string;
  state: Ref<WeatherStoredState>;
  data: Readonly<Ref<WeatherInfo | null>>;
  loading: Readonly<Ref<boolean>>;
  error: Readonly<Ref<string | null>>;
  setViewIndex(index: number): void;
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
  /**
   * Read through the provider rather than `ctx.http`, for its cache. The card
   * unmounts every time the cockpit closes, so a widget that fetched for itself
   * started from nothing on every Ctrl double tap. The host cache outlives the
   * mount: an open shows the last forecast at once, and the host refetches only
   * once it is older than the query's `staleTime` — on a timer while the card
   * is on screen, never while it is not.
   */
  requires: { providers: [PROVIDER_ID] },
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
      let hydrated = false;

      const { state: forecast } = useProviderQuery<WeatherInfo>(ctx, PROVIDER_ID, "forecast", {
        location: config.location,
      });
      // A failed refresh keeps the last good forecast beside the error.
      const data = computed(() => forecast.value.data ?? null);
      const loading = computed(() => forecast.value.status === "loading");
      const error = computed(() =>
        forecast.value.status === "error" ? forecast.value.error.message : null,
      );

      const persist = (): Promise<void> =>
        hydrated ? ctx.data.set(WEATHER_STATE_KEY, state.value) : Promise.resolve();

      const setViewIndex = (index: number) => {
        state.value = normalizeWeatherState({ viewIndex: index });
        void persist();
      };

      onScopeDispose(() => void persist());

      state.value = normalizeWeatherState(
        await ctx.data.get<WeatherStoredState>(WEATHER_STATE_KEY),
      );
      hydrated = true;

      return { location: config.location, state, data, loading, error, setViewIndex };
    },
  },
});
