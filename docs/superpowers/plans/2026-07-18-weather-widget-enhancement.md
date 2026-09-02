# Weather Widget Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the Weather widget with real Open-Meteo data, per-instance location (inline + settings), manual refresh, and colorful custom SVG condition icons.

**Architecture:** Client-side only — `weatherLogic.ts` owns WMO mapping, localStorage settings, and Open-Meteo geocode/forecast fetch. Vue widget owns UI/lifecycle; Rust mock `widget_weather` is removed. Tauri CSP `connect-src` must allow Open-Meteo hosts.

**Tech Stack:** Vue 3 + TypeScript, Vite, Tauri 2, Open-Meteo (no API key, no new npm deps).

## Global Constraints

- Real weather via Open-Meteo geocoding + current weather (no mock temps)
- Location editable inline and in settings; same per-instance localStorage state
- Empty location normalizes to `Berlin`
- Display: SVG icon + °C + German condition label + location + refresh
- Custom SVGs only (no icon library / emoji)
- No forecast, wind, humidity, geolocation, or multi-city
- German condition labels for V1
- No git repository in this workspace — skip all commit steps
- No test runner — verify with Node assert script + `npx vue-tsc --noEmit` + manual UI checks
- Spec: `docs/superpowers/specs/2026-07-18-weather-widget-enhancement-design.md`

## File Structure

| File | Responsibility |
|------|----------------|
| `src/widgets/weatherLogic.ts` | Types, WMO map, settings persist, `fetchWeather` |
| `src/widgets/useWeatherSettings.ts` | Per-instance reactive settings cache |
| `src/widgets/WeatherSettings.vue` | Settings popover location field |
| `src/widgets/WeatherIcon.vue` | Colored SVG by icon key |
| `src/widgets/WeatherWidget.vue` | UI + load/refresh/inline edit |
| `src/widgets/registry.ts` | Drop backendCommand; add settingsComponent |
| `src/widgets/WidgetHost.vue` | Seed/dispose weather settings on duplicate/remove |
| `src-tauri/tauri.conf.json` | CSP `connect-src` for Open-Meteo |
| `src-tauri/src/commands.rs` | Remove mock weather + `rand` import |
| `src-tauri/src/lib.rs` | Unregister `widget_weather` |
| `src-tauri/Cargo.toml` | Remove `rand` dependency |

---

### Task 1: Weather logic (mapping + settings + fetch)

**Files:**
- Create: `src/widgets/weatherLogic.ts`

**Interfaces:**
- Consumes: `fetch` (browser/global)
- Produces:
  - `export type WeatherIconKey = "clear" | "partly-cloudy" | "cloudy" | "fog" | "drizzle" | "rain" | "snow" | "thunderstorm"`
  - `export interface WeatherSettings { location: string }`
  - `export interface WeatherInfo { location: string; temperature_c: number; condition: string; icon: WeatherIconKey }`
  - `export type WeatherLoadResult = { ok: true; data: WeatherInfo } | { ok: false; error: string }`
  - `export const DEFAULT_WEATHER_SETTINGS: WeatherSettings`
  - `export function weatherStorageKey(instanceId: string): string`
  - `export function normalizeWeatherSettings(raw: unknown): WeatherSettings`
  - `export function loadWeatherSettings(instanceId: string): WeatherSettings`
  - `export function saveWeatherSettings(instanceId: string, settings: WeatherSettings): void`
  - `export function clearWeatherSettings(instanceId: string): void`
  - `export function describeWeatherCode(code: number): { icon: WeatherIconKey; condition: string }`
  - `export async function fetchWeather(locationQuery: string): Promise<WeatherLoadResult>`

- [ ] **Step 1: Create `src/widgets/weatherLogic.ts`**

```ts
/**
 * Weather widget: settings persistence, WMO code → icon/label, Open-Meteo fetch.
 */

export type WeatherIconKey =
  | "clear"
  | "partly-cloudy"
  | "cloudy"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "thunderstorm";

export interface WeatherSettings {
  /** City query; empty normalizes to Berlin. */
  location: string;
}

export interface WeatherInfo {
  /** Resolved place name from geocoding. */
  location: string;
  temperature_c: number;
  /** Short German condition label. */
  condition: string;
  icon: WeatherIconKey;
}

export type WeatherLoadResult =
  | { ok: true; data: WeatherInfo }
  | { ok: false; error: string };

export const DEFAULT_LOCATION = "Berlin";

export const DEFAULT_WEATHER_SETTINGS: WeatherSettings = {
  location: DEFAULT_LOCATION,
};

/** Per-instance weather settings key. */
export function weatherStorageKey(instanceId: string): string {
  return `kavibay:weather:${instanceId}`;
}

/** Normalize raw settings; blank location → Berlin. */
export function normalizeWeatherSettings(raw: unknown): WeatherSettings {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const location =
    typeof o.location === "string" && o.location.trim()
      ? o.location.trim()
      : DEFAULT_LOCATION;
  return { location };
}

/** Load weather settings for an instance, or defaults. */
export function loadWeatherSettings(instanceId: string): WeatherSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(weatherStorageKey(instanceId)) ?? "null");
    return normalizeWeatherSettings(raw);
  } catch {
    return { ...DEFAULT_WEATHER_SETTINGS };
  }
}

/** Persist normalized weather settings. */
export function saveWeatherSettings(instanceId: string, settings: WeatherSettings): void {
  localStorage.setItem(
    weatherStorageKey(instanceId),
    JSON.stringify(normalizeWeatherSettings(settings)),
  );
}

/** Remove persisted weather settings for an instance. */
export function clearWeatherSettings(instanceId: string): void {
  localStorage.removeItem(weatherStorageKey(instanceId));
}

/** Map Open-Meteo WMO weather code to icon key + German label. */
export function describeWeatherCode(code: number): {
  icon: WeatherIconKey;
  condition: string;
} {
  if (code === 0) return { icon: "clear", condition: "Klar" };
  if (code === 1 || code === 2) return { icon: "partly-cloudy", condition: "Leicht bewölkt" };
  if (code === 3) return { icon: "cloudy", condition: "Bewölkt" };
  if (code === 45 || code === 48) return { icon: "fog", condition: "Nebel" };
  if (code >= 51 && code <= 57) return { icon: "drizzle", condition: "Nieselregen" };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) {
    return { icon: "rain", condition: "Regen" };
  }
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) {
    return { icon: "snow", condition: "Schnee" };
  }
  if (code >= 95 && code <= 99) return { icon: "thunderstorm", condition: "Gewitter" };
  return { icon: "cloudy", condition: "Bewölkt" };
}

interface GeoResult {
  name: string;
  latitude: number;
  longitude: number;
}

/**
 * Geocode a city query and load current temperature + weather code from Open-Meteo.
 */
export async function fetchWeather(locationQuery: string): Promise<WeatherLoadResult> {
  const query = locationQuery.trim() || DEFAULT_LOCATION;

  let geoJson: { results?: GeoResult[] };
  try {
    const geoUrl =
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1`;
    const geoRes = await fetch(geoUrl);
    if (!geoRes.ok) return { ok: false, error: "Wetter konnte nicht geladen werden" };
    geoJson = (await geoRes.json()) as { results?: GeoResult[] };
  } catch {
    return { ok: false, error: "Wetter konnte nicht geladen werden" };
  }

  const place = geoJson.results?.[0];
  if (!place) return { ok: false, error: "Ort nicht gefunden" };

  try {
    const wxUrl =
      `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}` +
      `&longitude=${place.longitude}&current=temperature_2m,weather_code`;
    const wxRes = await fetch(wxUrl);
    if (!wxRes.ok) return { ok: false, error: "Wetter konnte nicht geladen werden" };
    const wxJson = (await wxRes.json()) as {
      current?: { temperature_2m?: number; weather_code?: number };
    };
    const temp = wxJson.current?.temperature_2m;
    const code = wxJson.current?.weather_code;
    if (typeof temp !== "number" || typeof code !== "number") {
      return { ok: false, error: "Wetter konnte nicht geladen werden" };
    }
    const { icon, condition } = describeWeatherCode(code);
    return {
      ok: true,
      data: {
        location: place.name,
        temperature_c: temp,
        condition,
        icon,
      },
    };
  } catch {
    return { ok: false, error: "Wetter konnte nicht geladen werden" };
  }
}
```

- [ ] **Step 2: Sanity-check with Node assert script**

Run (PowerShell) — mapping + normalize only (no network):

```powershell
node --input-type=module -e "
import {
  describeWeatherCode,
  normalizeWeatherSettings,
  DEFAULT_LOCATION,
} from './src/widgets/weatherLogic.ts';

function assertEq(a, e, label) {
  if (a !== e) { console.error('FAIL', label, a, e); process.exit(1); }
}

assertEq(describeWeatherCode(0).icon, 'clear', '0 icon');
assertEq(describeWeatherCode(0).condition, 'Klar', '0 label');
assertEq(describeWeatherCode(2).icon, 'partly-cloudy', '2');
assertEq(describeWeatherCode(3).icon, 'cloudy', '3');
assertEq(describeWeatherCode(45).icon, 'fog', '45');
assertEq(describeWeatherCode(53).icon, 'drizzle', '53');
assertEq(describeWeatherCode(61).icon, 'rain', '61');
assertEq(describeWeatherCode(80).icon, 'rain', '80');
assertEq(describeWeatherCode(71).icon, 'snow', '71');
assertEq(describeWeatherCode(95).icon, 'thunderstorm', '95');
assertEq(normalizeWeatherSettings({ location: '  ' }).location, DEFAULT_LOCATION, 'empty');
assertEq(normalizeWeatherSettings({ location: ' Paris ' }).location, 'Paris', 'trim');
assertEq(normalizeWeatherSettings(null).location, DEFAULT_LOCATION, 'null');
console.log('ok');
"
```

Expected: `ok`  
If Node cannot import `.ts`, run via `npx tsx` with the same script body, or temporarily rename checks into a small `.mjs` after building — do not skip verification of the mapping table.

- [ ] **Step 3: Typecheck**

Run: `npx vue-tsc --noEmit`  
Expected: no errors related to `weatherLogic.ts`

- [ ] **Step 4: Skip commit**

---

### Task 2: Settings composable + WidgetHost lifecycle

**Files:**
- Create: `src/widgets/useWeatherSettings.ts`
- Modify: `src/widgets/WidgetHost.vue`

**Interfaces:**
- Consumes: `WeatherSettings`, `loadWeatherSettings`, `normalizeWeatherSettings`, `saveWeatherSettings`, `clearWeatherSettings` from `./weatherLogic`
- Produces:
  - `export function useWeatherSettings(instanceId: string): { settings: Ref<WeatherSettings>; update: (partial: Partial<WeatherSettings>) => void }`
  - `export function disposeWeatherSettings(instanceId: string): void`
  - `export function seedWeatherSettingsFrom(fromId: string, toId: string): void`

- [ ] **Step 1: Create `src/widgets/useWeatherSettings.ts`**

```ts
import { type Ref, ref } from "vue";
import {
  type WeatherSettings,
  loadWeatherSettings,
  normalizeWeatherSettings,
  saveWeatherSettings,
} from "./weatherLogic";

const cache = new Map<string, Ref<WeatherSettings>>();

function ensure(instanceId: string): Ref<WeatherSettings> {
  let existing = cache.get(instanceId);
  if (!existing) {
    existing = ref(loadWeatherSettings(instanceId));
    cache.set(instanceId, existing);
  }
  return existing;
}

/** Per-instance weather settings shared by WeatherWidget + WeatherSettings. */
export function useWeatherSettings(instanceId: string) {
  const settings = ensure(instanceId);

  function update(partial: Partial<WeatherSettings>) {
    settings.value = normalizeWeatherSettings({ ...settings.value, ...partial });
    saveWeatherSettings(instanceId, settings.value);
  }

  return { settings, update };
}

/** Drop in-memory cache entry (after Remove). */
export function disposeWeatherSettings(instanceId: string): void {
  cache.delete(instanceId);
}

/** Ensure target cache matches source after Duplicate. */
export function seedWeatherSettingsFrom(fromId: string, toId: string): void {
  const from = ensure(fromId);
  cache.set(toId, ref(normalizeWeatherSettings({ ...from.value })));
  saveWeatherSettings(toId, cache.get(toId)!.value);
}
```

- [ ] **Step 2: Wire seed/dispose/clear in `WidgetHost.vue`**

Add imports next to the clock/pomodoro ones:

```ts
import { clearWeatherSettings } from "./weatherLogic";
import {
  disposeWeatherSettings,
  seedWeatherSettingsFrom,
} from "./useWeatherSettings";
```

In `onDuplicate`, after the pomodoro/app-launcher blocks:

```ts
  if (source.typeId === "weather") {
    seedWeatherSettingsFrom(source.instanceId, copy.instanceId);
  }
```

In `onRemove`, after the other type checks:

```ts
  if (removed.typeId === "weather") {
    disposeWeatherSettings(removed.instanceId);
    clearWeatherSettings(removed.instanceId);
  }
```

- [ ] **Step 3: Typecheck**

Run: `npx vue-tsc --noEmit`  
Expected: no errors from these files

- [ ] **Step 4: Skip commit**

---

### Task 3: Allow Open-Meteo in Tauri CSP

**Files:**
- Modify: `src-tauri/tauri.conf.json`

**Interfaces:**
- Consumes: existing CSP string
- Produces: `connect-src` that includes Open-Meteo HTTPS origins

- [ ] **Step 1: Update CSP `connect-src`**

In `src-tauri/tauri.conf.json`, change the `csp` value so `connect-src` becomes:

```
connect-src ipc: http://ipc.localhost https://geocoding-api.open-meteo.com https://api.open-meteo.com
```

Full `csp` string (keep other directives unchanged):

```
default-src 'self'; img-src 'self' asset: http://asset.localhost https: http: data: blob:; connect-src ipc: http://ipc.localhost https://geocoding-api.open-meteo.com https://api.open-meteo.com; style-src 'self' 'unsafe-inline'; script-src 'self'
```

Without this, `fetch` to Open-Meteo fails inside the Tauri webview.

- [ ] **Step 2: Skip commit**

---

### Task 4: WeatherSettings + registry (client-only)

**Files:**
- Create: `src/widgets/WeatherSettings.vue`
- Modify: `src/widgets/registry.ts`

**Interfaces:**
- Consumes: `useWeatherSettings`, inject `widgetInstanceId`
- Produces: registry entry without `backendCommand` / `refreshInterval`, with `settingsComponent: WeatherSettings`

- [ ] **Step 1: Create `src/widgets/WeatherSettings.vue`**

```vue
<script setup lang="ts">
import { inject } from "vue";
import { useWeatherSettings } from "./useWeatherSettings";

const instanceId = inject<string>("widgetInstanceId");
if (!instanceId) throw new Error("widgetInstanceId missing");
const { settings, update } = useWeatherSettings(instanceId);

/** Persist location on change (blur / Enter). */
function onLocation(e: Event) {
  const value = (e.target as HTMLInputElement).value;
  update({ location: value });
}
</script>

<template>
  <div class="weather-settings" @pointerdown.stop>
    <label>
      Location
      <input
        type="text"
        :value="settings.location"
        placeholder="Berlin"
        @change="onLocation"
        @keydown.enter="onLocation"
      />
    </label>
  </div>
</template>

<style scoped>
.weather-settings {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 200px;
}

.weather-settings label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.5);
}

.weather-settings input {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.25);
  color: rgba(255, 255, 255, 0.92);
  font-size: 14px;
  outline: none;
}

.weather-settings input:focus {
  border-color: rgba(255, 255, 255, 0.28);
}
</style>
```

- [ ] **Step 2: Update weather entry in `src/widgets/registry.ts`**

Add import:

```ts
import WeatherSettings from "./WeatherSettings.vue";
```

Replace the weather registry object with:

```ts
  {
    id: "weather",
    title: "Weather",
    position: { x: -480, y: -70 },
    component: WeatherWidget,
    settingsComponent: WeatherSettings,
  },
```

Remove `backendCommand` and `refreshInterval` from this entry. Auto-refresh will live inside `WeatherWidget.vue`.

- [ ] **Step 3: Typecheck**

Run: `npx vue-tsc --noEmit`  
Expected: clean for these changes (WeatherWidget still temporary until Task 5, but must still compile — keep a stub that does not rely on `WidgetProps` data from backend, or finish Task 5 next in the same session before claiming done)

Note: After this step alone, old `WeatherWidget.vue` still expects `WidgetProps<WeatherInfo>` from the host — that is fine (`data` will stay `null` because there is no `backendCommand`). Task 5 replaces the widget immediately after.

- [ ] **Step 4: Skip commit**

---

### Task 5: WeatherIcon + WeatherWidget UI

**Files:**
- Create: `src/widgets/WeatherIcon.vue`
- Modify: `src/widgets/WeatherWidget.vue` (full rewrite)

**Interfaces:**
- Consumes: `fetchWeather`, `WeatherInfo`, `WeatherIconKey` from `./weatherLogic`; `useWeatherSettings`; inject `widgetInstanceId`
- Produces: interactive weather card UI (no `backendCommand` / no `useWidgetData`)

- [ ] **Step 1: Create `src/widgets/WeatherIcon.vue`**

```vue
<script setup lang="ts">
import type { WeatherIconKey } from "./weatherLogic";

defineProps<{ icon: WeatherIconKey }>();
</script>

<template>
  <svg
    class="weather-icon"
    viewBox="0 0 64 64"
    width="56"
    height="56"
    aria-hidden="true"
  >
    <!-- clear: sun -->
    <g v-if="icon === 'clear'">
      <circle cx="32" cy="32" r="12" fill="#F5C542" />
      <g stroke="#F5C542" stroke-width="3" stroke-linecap="round">
        <line x1="32" y1="6" x2="32" y2="14" />
        <line x1="32" y1="50" x2="32" y2="58" />
        <line x1="6" y1="32" x2="14" y2="32" />
        <line x1="50" y1="32" x2="58" y2="32" />
        <line x1="12" y1="12" x2="18" y2="18" />
        <line x1="46" y1="46" x2="52" y2="52" />
        <line x1="12" y1="52" x2="18" y2="46" />
        <line x1="46" y1="18" x2="52" y2="12" />
      </g>
    </g>

    <!-- partly-cloudy: sun + cloud -->
    <g v-else-if="icon === 'partly-cloudy'">
      <circle cx="22" cy="22" r="9" fill="#F5C542" />
      <path
        d="M20 44h26a10 10 0 0 0 0-20 12 12 0 0 0-23-3A9 9 0 0 0 20 44z"
        fill="#E8EEF7"
      />
    </g>

    <!-- cloudy -->
    <g v-else-if="icon === 'cloudy'">
      <path
        d="M18 46h30a11 11 0 0 0 0-22 13 13 0 0 0-25-4A10 10 0 0 0 18 46z"
        fill="#C5D0E0"
      />
    </g>

    <!-- fog -->
    <g v-else-if="icon === 'fog'">
      <path
        d="M18 30h30a10 10 0 0 0 0-20 12 12 0 0 0-23-3A9 9 0 0 0 18 30z"
        fill="#B8C4D4"
        opacity="0.85"
      />
      <g stroke="#D0D8E4" stroke-width="3" stroke-linecap="round">
        <line x1="14" y1="40" x2="50" y2="40" />
        <line x1="18" y1="48" x2="46" y2="48" />
        <line x1="16" y1="56" x2="48" y2="56" />
      </g>
    </g>

    <!-- drizzle -->
    <g v-else-if="icon === 'drizzle'">
      <path
        d="M18 34h28a10 10 0 0 0 0-20 12 12 0 0 0-23-3A9 9 0 0 0 18 34z"
        fill="#C5D0E0"
      />
      <g stroke="#6EB6E0" stroke-width="2.5" stroke-linecap="round">
        <line x1="24" y1="42" x2="22" y2="52" />
        <line x1="34" y1="42" x2="32" y2="52" />
        <line x1="44" y1="42" x2="42" y2="52" />
      </g>
    </g>

    <!-- rain -->
    <g v-else-if="icon === 'rain'">
      <path
        d="M18 32h28a10 10 0 0 0 0-20 12 12 0 0 0-23-3A9 9 0 0 0 18 32z"
        fill="#9AA8BC"
      />
      <g stroke="#4A9FE0" stroke-width="3" stroke-linecap="round">
        <line x1="22" y1="40" x2="18" y2="54" />
        <line x1="32" y1="40" x2="28" y2="54" />
        <line x1="42" y1="40" x2="38" y2="54" />
      </g>
    </g>

    <!-- snow -->
    <g v-else-if="icon === 'snow'">
      <path
        d="M18 32h28a10 10 0 0 0 0-20 12 12 0 0 0-23-3A9 9 0 0 0 18 32z"
        fill="#D8E2F0"
      />
      <g fill="#A8D4F0">
        <circle cx="24" cy="46" r="2.5" />
        <circle cx="34" cy="50" r="2.5" />
        <circle cx="44" cy="46" r="2.5" />
        <circle cx="28" cy="56" r="2" />
        <circle cx="40" cy="56" r="2" />
      </g>
    </g>

    <!-- thunderstorm -->
    <g v-else>
      <path
        d="M16 30h28a10 10 0 0 0 0-20 12 12 0 0 0-23-3A9 9 0 0 0 16 30z"
        fill="#6B7A90"
      />
      <polygon points="30,34 22,48 29,48 26,58 40,42 32,42 36,34" fill="#F5C542" />
    </g>
  </svg>
</template>

<style scoped>
.weather-icon {
  flex-shrink: 0;
  display: block;
}
</style>
```

- [ ] **Step 2: Rewrite `src/widgets/WeatherWidget.vue`**

```vue
<script setup lang="ts">
import { inject, onMounted, onUnmounted, ref, watch } from "vue";
import type { WidgetProps } from "./types";
import {
  fetchWeather,
  type WeatherInfo,
} from "./weatherLogic";
import { useWeatherSettings } from "./useWeatherSettings";
import WeatherIcon from "./WeatherIcon.vue";

// Props kept for host compatibility; data loading is owned here.
defineProps<WidgetProps>();

const instanceId = inject<string>("widgetInstanceId");
if (!instanceId) throw new Error("widgetInstanceId missing");
const { settings, update } = useWeatherSettings(instanceId);

const data = ref<WeatherInfo | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const editing = ref(false);
const draft = ref("");

let timer: ReturnType<typeof setInterval> | undefined;
let loadSeq = 0;

/** Load weather for the current settings location. */
async function load() {
  const seq = ++loadSeq;
  loading.value = true;
  const result = await fetchWeather(settings.value.location);
  if (seq !== loadSeq) return;
  loading.value = false;
  if (result.ok) {
    data.value = result.data;
    error.value = null;
  } else {
    error.value = result.error;
  }
}

/** Manual refresh. */
function onRefresh() {
  if (loading.value) return;
  void load();
}

/** Start inline location edit. */
function startEdit() {
  draft.value = settings.value.location;
  editing.value = true;
}

/** Commit inline location (Enter). */
function commitEdit() {
  editing.value = false;
  update({ location: draft.value });
}

/** Cancel inline edit (Escape). */
function cancelEdit() {
  editing.value = false;
}

watch(
  () => settings.value.location,
  () => {
    void load();
  },
);

onMounted(() => {
  void load();
  timer = setInterval(() => void load(), 60_000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <div class="weather">
    <p v-if="loading && !data" class="weather-status">Loading…</p>
    <p v-else-if="error && !data" class="weather-status weather-status--error">
      {{ error }}
    </p>
    <template v-else-if="data">
      <div class="weather-main">
        <WeatherIcon :icon="data.icon" />
        <div class="weather-text">
          <p class="weather-temp">{{ Math.round(data.temperature_c) }}°C</p>
          <p class="weather-condition">{{ data.condition }}</p>
        </div>
      </div>

      <div class="weather-footer">
        <form v-if="editing" class="weather-edit" @submit.prevent="commitEdit">
          <input
            v-model="draft"
            class="weather-edit-input"
            type="text"
            aria-label="Location"
            autofocus
            @keydown.escape.prevent="cancelEdit"
          />
        </form>
        <button
          v-else
          type="button"
          class="weather-location"
          @click="startEdit"
        >
          {{ data.location }}
        </button>

        <button
          type="button"
          class="weather-refresh"
          :class="{ 'weather-refresh--spin': loading }"
          :disabled="loading"
          aria-label="Refresh"
          title="Aktualisieren"
          @click="onRefresh"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              fill="currentColor"
              d="M17.65 6.35A7.95 7.95 0 0 0 12 4V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 13.65-6.65z"
            />
          </svg>
        </button>
      </div>

      <p v-if="error" class="weather-status weather-status--error weather-status--inline">
        {{ error }}
      </p>
    </template>
  </div>
</template>

<style scoped>
.weather-status {
  margin: 0;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.6);
}

.weather-status--error {
  color: #ff8080;
}

.weather-status--inline {
  margin-top: 6px;
}

.weather-main {
  display: flex;
  align-items: center;
  gap: 12px;
}

.weather-text {
  min-width: 0;
}

.weather-temp {
  margin: 0;
  font-size: 28px;
  font-weight: 600;
  line-height: 1.1;
}

.weather-condition {
  margin: 4px 0 0;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.65);
}

.weather-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}

.weather-location {
  flex: 1;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.6);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: text;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.weather-location:hover {
  color: rgba(255, 255, 255, 0.85);
}

.weather-edit {
  flex: 1;
  min-width: 0;
}

.weather-edit-input {
  width: 100%;
  box-sizing: border-box;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(0, 0, 0, 0.3);
  color: rgba(255, 255, 255, 0.92);
  font-size: 13px;
  outline: none;
}

.weather-refresh {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: rgba(255, 255, 255, 0.55);
  cursor: pointer;
}

.weather-refresh:hover:not(:disabled) {
  color: rgba(255, 255, 255, 0.9);
  background: rgba(255, 255, 255, 0.08);
}

.weather-refresh:disabled {
  cursor: default;
  opacity: 0.7;
}

.weather-refresh--spin svg {
  animation: weather-spin 0.8s linear infinite;
}

@keyframes weather-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
```

Important: settings changes already trigger `watch` → `load()`. After settings popover `@change`, weather reloads automatically. Inline Enter calls `update` which also triggers the watch.

- [ ] **Step 3: Typecheck**

Run: `npx vue-tsc --noEmit`  
Expected: no errors

- [ ] **Step 4: Manual UI check**

Run: `npm run tauri dev` (or project’s usual Tauri launch)

Verify:
1. Widget shows icon + temp + German condition for Berlin (or last saved city)
2. Click location → edit → Enter with e.g. `Paris` → updates
3. Settings popover location field syncs with widget and reloads
4. Refresh icon spins briefly and updates data
5. Invalid city (e.g. `zzzzzzqx`) shows “Ort nicht gefunden” without wiping last good data if one existed (second load after a good city)
6. Escape cancels inline edit

- [ ] **Step 5: Skip commit**

---

### Task 6: Remove Rust weather mock + `rand`

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`

**Interfaces:**
- Consumes: nothing
- Produces: no `widget_weather` IPC; no `rand` dependency

- [ ] **Step 1: Remove weather mock from `commands.rs`**

Delete the entire `WeatherInfo` struct and `widget_weather` function (from the `#[derive(Serialize)] pub struct WeatherInfo` through the end of `widget_weather`).

Also remove these imports if unused afterward:

```rs
use rand::RngExt;
```

and any leftover comment about rand 0.10.

Keep `Serialize` / other imports that `SystemInfo` etc. still need.

- [ ] **Step 2: Unregister in `lib.rs`**

In `tauri::generate_handler![...]`, remove the line:

```rs
            commands::widget_weather,
```

- [ ] **Step 3: Remove `rand` from `Cargo.toml`**

Delete:

```toml
rand = "0.10.2"
```

- [ ] **Step 4: Verify Rust build**

Run (from `src-tauri` or repo root as usual):

```powershell
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: success, no references to `widget_weather` / `rand`

- [ ] **Step 5: Skip commit**

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Real Open-Meteo data | 1, 5 |
| Inline location edit | 5 |
| Settings location field | 4 |
| Shared persisted per-instance location | 1, 2 |
| Empty → Berlin | 1 |
| Refresh control | 5 |
| ~60s auto-refresh | 5 |
| Custom colorful SVGs for conditions | 5 |
| Icon + °C + condition text + location | 5 |
| German labels | 1 |
| Error messages + keep last data | 1, 5 |
| CSP allows API | 3 |
| Remove Rust mock / rand | 6 |
| WidgetHost seed/dispose | 2 |

## Self-review notes

- No placeholders left in steps
- Types consistent: `WeatherIconKey`, `WeatherInfo`, `WeatherSettings`, `fetchWeather` → `WeatherLoadResult`
- CSP task is mandatory before claiming Tauri UI works
- Commits skipped (no git repo), matching calculator plan convention
