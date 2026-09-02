# Weather Carousel Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a four-view weather carousel (Jetzt / Details / Stunden / Tage) with overlay ‹ ›, clickable dots, and keyboard ←/→, fed by one expanded Open-Meteo fetch.

**Architecture:** Extend `weatherLogic.ts` to return current details + 12 hourly + 5 daily points. `WeatherWidget.vue` owns `viewIndex` (0–3, wrap), overlay chrome, focus/keyboard, hover-only refresh; slides render from the same `WeatherInfo` payload.

**Tech Stack:** Vue 3 + TypeScript, existing Open-Meteo CSP, no new dependencies.

## Global Constraints

- Four views: Jetzt (0), Details (1), Stunden (2), Tage (3) — wrap navigation
- Overlay arrows (layout A); clickable dots; ←/→ when widget focused
- Location always visible; refresh only on `.weather:hover`
- One Open-Meteo request: current (+ humidity, wind, apparent) + hourly + daily
- ~12 hours / 5 days; German labels; `viewIndex` not persisted
- Paths under `src/extensions/weather/`
- No git repository — skip all commit steps
- No test runner — Node/tsx assert scripts + `npx vue-tsc --noEmit` + manual UI
- Spec: `docs/superpowers/specs/2026-07-22-weather-carousel-views-design.md`

## File Structure

| File | Responsibility |
|------|----------------|
| `src/extensions/weather/weatherLogic.ts` | Types, `wrapViewIndex`, expand `fetchWeather` |
| `src/extensions/weather/WeatherWidget.vue` | Carousel + four slides + shared footer |
| `WeatherIcon.vue` | Unchanged (reuse) |
| Settings / host | Unchanged |

---

### Task 1: Expand weatherLogic (types + fetch + wrap)

**Files:**
- Modify: `src/extensions/weather/weatherLogic.ts`

**Interfaces:**
- Consumes: existing `describeWeatherCode`, geocoding flow
- Produces:
  - `export const WEATHER_VIEW_COUNT = 4`
  - `export function wrapViewIndex(index: number): number`
  - Extended `WeatherInfo` with `apparent_c`, `humidity_pct`, `wind_kmh`, `hourly`, `daily`
  - `export interface WeatherHourPoint { time: string; temperature_c: number; icon: WeatherIconKey; condition: string }`
  - `export interface WeatherDayPoint { date: string; temperature_min_c: number; temperature_max_c: number; icon: WeatherIconKey; condition: string }`
  - `fetchWeather` returns the expanded shape

- [ ] **Step 1: Replace / extend types and helpers in `weatherLogic.ts`**

Keep existing icon key, settings, `describeWeatherCode`, storage helpers. Update `WeatherInfo` and add:

```ts
export const WEATHER_VIEW_COUNT = 4;

/** Wrap carousel index into 0 .. WEATHER_VIEW_COUNT-1. */
export function wrapViewIndex(index: number): number {
  const n = WEATHER_VIEW_COUNT;
  return ((index % n) + n) % n;
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
  location: string;
  temperature_c: number;
  condition: string;
  icon: WeatherIconKey;
  apparent_c: number;
  humidity_pct: number;
  wind_kmh: number;
  hourly: WeatherHourPoint[];
  daily: WeatherDayPoint[];
}
```

Replace the forecast URL and parsing inside `fetchWeather` (after geocode succeeds):

```ts
    const wxUrl =
      `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}` +
      `&longitude=${place.longitude}` +
      `&current=temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m,apparent_temperature` +
      `&hourly=temperature_2m,weather_code` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min` +
      `&forecast_days=5&timezone=auto`;

    const wxRes = await fetch(wxUrl);
    if (!wxRes.ok) return { ok: false, error: "Wetter konnte nicht geladen werden" };
    const wxJson = (await wxRes.json()) as {
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
    };

    const cur = wxJson.current;
    if (
      typeof cur?.temperature_2m !== "number" ||
      typeof cur.weather_code !== "number" ||
      typeof cur.relative_humidity_2m !== "number" ||
      typeof cur.wind_speed_10m !== "number" ||
      typeof cur.apparent_temperature !== "number"
    ) {
      return { ok: false, error: "Wetter konnte nicht geladen werden" };
    }

    const { icon, condition } = describeWeatherCode(cur.weather_code);

    const hourlyTimes = wxJson.hourly?.time ?? [];
    const hourlyTemps = wxJson.hourly?.temperature_2m ?? [];
    const hourlyCodes = wxJson.hourly?.weather_code ?? [];
    const nowIso = cur.time ?? "";
    let start = hourlyTimes.findIndex((t) => t >= nowIso);
    if (start < 0) start = 0;
    const hourly: WeatherHourPoint[] = [];
    for (let i = start; i < hourlyTimes.length && hourly.length < 12; i++) {
      const temp = hourlyTemps[i];
      const code = hourlyCodes[i];
      if (typeof temp !== "number" || typeof code !== "number") continue;
      const d = describeWeatherCode(code);
      hourly.push({
        time: hourlyTimes[i]!,
        temperature_c: temp,
        icon: d.icon,
        condition: d.condition,
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
      const d = describeWeatherCode(code);
      daily.push({
        date: dailyTimes[i]!,
        temperature_max_c: max,
        temperature_min_c: min,
        icon: d.icon,
        condition: d.condition,
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
```

Keep the outer try/catch and geocode error paths as they are today.

- [ ] **Step 2: Assert wrap + mapping (no network)**

```powershell
npx --yes tsx -e "
import { wrapViewIndex, describeWeatherCode, WEATHER_VIEW_COUNT } from './src/extensions/weather/weatherLogic.ts';
function assertEq(a,e,l){ if(a!==e){ console.error('FAIL',l,a,e); process.exit(1);} }
assertEq(WEATHER_VIEW_COUNT, 4, 'count');
assertEq(wrapViewIndex(0), 0, '0');
assertEq(wrapViewIndex(3), 3, '3');
assertEq(wrapViewIndex(4), 0, '4');
assertEq(wrapViewIndex(-1), 3, '-1');
assertEq(describeWeatherCode(61).condition, 'Regen', 'rain');
console.log('ok');
"
```

Expected: `ok`

- [ ] **Step 3: Typecheck**

Run: `npx vue-tsc --noEmit`  
Expected: errors only if `WeatherWidget.vue` still expects old `WeatherInfo` — acceptable until Task 2; prefer fixing types so the widget still compiles by making new fields optional temporarily **or** proceed immediately to Task 2 in the same session. Prefer completing Task 2 right after so `vue-tsc` is clean.

- [ ] **Step 4: Skip commit**

---

### Task 2: WeatherWidget carousel UI (all four slides)

**Files:**
- Modify: `src/extensions/weather/WeatherWidget.vue` (full update)

**Interfaces:**
- Consumes: `fetchWeather`, `WeatherInfo`, `wrapViewIndex`, `WEATHER_VIEW_COUNT` from `./weatherLogic`; `WeatherIcon`; `useWeatherSettings`
- Produces: interactive 4-view carousel matching the spec

- [ ] **Step 1: Rewrite `WeatherWidget.vue`**

Keep existing load/settings/edit/refresh lifecycle. Add:

```ts
import { wrapViewIndex } from "./weatherLogic";

const viewIndex = ref(0);
const rootEl = ref<HTMLElement | null>(null);

function prevView() {
  viewIndex.value = wrapViewIndex(viewIndex.value - 1);
}
function nextView() {
  viewIndex.value = wrapViewIndex(viewIndex.value + 1);
}
function goView(i: number) {
  viewIndex.value = wrapViewIndex(i);
}

/** Arrow keys when the weather root (or a child) is focused. */
function onKeydown(e: KeyboardEvent) {
  if (editing.value) return;
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    prevView();
  } else if (e.key === "ArrowRight") {
    e.preventDefault();
    nextView();
  }
}

/** Format hour label from Open-Meteo time (local string). */
function hourLabel(iso: string): string {
  const m = iso.match(/T(\d{2})/);
  return m ? `${m[1]}h` : iso;
}

/** Short German weekday from YYYY-MM-DD. */
function dayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return new Intl.DateTimeFormat("de-DE", { weekday: "short" }).format(d);
}
```

Template structure (replace the `v-else-if="data"` block):

```vue
    <template v-else-if="data">
      <div
        ref="rootEl"
        class="weather-carousel"
        tabindex="0"
        @keydown="onKeydown"
        @pointerdown.stop
      >
        <button
          type="button"
          class="weather-nav weather-nav--prev"
          aria-label="Vorherige Ansicht"
          @click="prevView"
        >
          ‹
        </button>
        <button
          type="button"
          class="weather-nav weather-nav--next"
          aria-label="Nächste Ansicht"
          @click="nextView"
        >
          ›
        </button>

        <div class="weather-slide">
          <!-- 0 Jetzt -->
          <div v-if="viewIndex === 0" class="weather-main">
            <WeatherIcon :icon="data.icon" />
            <div class="weather-text">
              <p class="weather-temp">{{ Math.round(data.temperature_c) }}°C</p>
              <p class="weather-condition">{{ data.condition }}</p>
            </div>
          </div>

          <!-- 1 Details -->
          <div v-else-if="viewIndex === 1" class="weather-details">
            <p class="weather-slide-title">Details</p>
            <div class="weather-details-grid">
              <div>
                <div class="weather-metric-label">Gefühlt</div>
                <div>{{ Math.round(data.apparent_c) }}°C</div>
              </div>
              <div>
                <div class="weather-metric-label">Luftfeuchtigkeit</div>
                <div>{{ Math.round(data.humidity_pct) }}%</div>
              </div>
              <div>
                <div class="weather-metric-label">Wind</div>
                <div>{{ Math.round(data.wind_kmh) }} km/h</div>
              </div>
              <div>
                <div class="weather-metric-label">Zustand</div>
                <div>{{ data.condition }}</div>
              </div>
            </div>
          </div>

          <!-- 2 Stunden -->
          <div v-else-if="viewIndex === 2" class="weather-hourly">
            <p class="weather-slide-title">Nächste Stunden</p>
            <div class="weather-hourly-row">
              <div
                v-for="h in data.hourly"
                :key="h.time"
                class="weather-hour"
              >
                <div class="weather-hour-time">{{ hourLabel(h.time) }}</div>
                <WeatherIcon :icon="h.icon" class="weather-hour-icon" />
                <div>{{ Math.round(h.temperature_c) }}°</div>
              </div>
            </div>
          </div>

          <!-- 3 Tage -->
          <div v-else class="weather-daily">
            <p class="weather-slide-title">5 Tage</p>
            <div
              v-for="d in data.daily"
              :key="d.date"
              class="weather-day-row"
            >
              <span class="weather-day-name">{{ dayLabel(d.date) }}</span>
              <WeatherIcon :icon="d.icon" class="weather-day-icon" />
              <span class="weather-day-temps">
                {{ Math.round(d.temperature_min_c) }}° /
                {{ Math.round(d.temperature_max_c) }}°
              </span>
            </div>
          </div>
        </div>

        <div class="weather-dots" role="tablist" aria-label="Ansichten">
          <button
            v-for="i in 4"
            :key="i"
            type="button"
            class="weather-dot"
            :class="{ 'weather-dot--active': viewIndex === i - 1 }"
            :aria-label="'Ansicht ' + i"
            :aria-selected="viewIndex === i - 1"
            role="tab"
            @click="goView(i - 1)"
          />
        </div>
      </div>

      <!-- existing footer: location + refresh; refresh CSS hover-only -->
      <div class="weather-footer" @pointerdown.stop>
        <!-- same edit/location/refresh markup as today -->
      </div>
      <!-- inline error as today -->
    </template>
```

Preserve the existing footer markup (location edit + refresh button). Add CSS:

```css
.weather-carousel {
  position: relative;
  outline: none;
  min-height: 88px;
  padding: 0 22px;
}

.weather-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 2;
  width: 22px;
  height: 36px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.4);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}

.weather-nav:hover {
  color: rgba(var(--fg-rgb), 0.9);
  background: rgba(var(--fg-rgb), 0.08);
}

.weather-nav--prev { left: 0; }
.weather-nav--next { right: 0; }

.weather-dots {
  display: flex;
  justify-content: center;
  gap: 6px;
  margin-top: 10px;
}

.weather-dot {
  width: 6px;
  height: 6px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: rgba(var(--fg-rgb), 0.28);
  cursor: pointer;
}

.weather-dot--active {
  background: rgba(var(--fg-rgb), 0.9);
}

.weather-slide-title {
  margin: 0 0 8px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(var(--fg-rgb), 0.45);
}

.weather-details-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 12px;
  font-size: 13px;
}

.weather-metric-label {
  font-size: 11px;
  color: rgba(var(--fg-rgb), 0.5);
  margin-bottom: 2px;
}

.weather-hourly-row {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.weather-hour {
  flex: 0 0 auto;
  text-align: center;
  font-size: 12px;
  min-width: 40px;
}

.weather-hour-time {
  color: rgba(var(--fg-rgb), 0.5);
  margin-bottom: 4px;
}

.weather-hour :deep(.weather-icon),
.weather-hour-icon {
  width: 28px !important;
  height: 28px !important;
  margin: 0 auto;
}

.weather-day-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  margin-bottom: 6px;
}

.weather-day-name {
  width: 36px;
  color: rgba(var(--fg-rgb), 0.7);
}

.weather-day-temps {
  margin-left: auto;
}

.weather-day-row :deep(.weather-icon),
.weather-day-icon {
  width: 22px !important;
  height: 22px !important;
}

.weather-refresh {
  opacity: 0;
  transition: opacity 0.15s ease;
}

.weather:hover .weather-refresh,
.weather-refresh:focus-visible {
  opacity: 1;
}
```

Note: `WeatherIcon` uses fixed width/height attributes — override via CSS `:deep(svg)` / class if needed so small icons work in hourly/daily rows.

Clicking the carousel should focus it for keyboard: add `@click="rootEl?.focus()"` on `.weather-carousel` if focus doesn’t move automatically.

Keep loading/error branches unchanged.

- [ ] **Step 2: Typecheck**

Run: `npx vue-tsc --noEmit`  
Expected: no errors in weather extension files

- [ ] **Step 3: Manual UI (Tauri)**

Run: `npm run tauri dev`

Verify:
1. Jetzt still shows icon/temp/condition
2. › / ‹ and dots cycle all four views; wrap works
3. Focus widget, press ←/→ — views change; while editing location, arrows do not steal
4. Details shows felt / humidity / wind
5. Stunden shows ~12 entries; Tage shows 5 rows
6. Refresh hidden until hover; location always visible
7. Location edit + settings still reload all data

- [ ] **Step 4: Skip commit**

---

## Spec coverage checklist

| Spec item | Task |
|-----------|------|
| Expanded Open-Meteo fields | 1 |
| wrapViewIndex / 4 views | 1–2 |
| Overlay ‹ › | 2 |
| Clickable dots | 2 |
| Keyboard ←/→ + wrap | 2 |
| Location always; refresh hover-only | 2 |
| Details / hourly / daily UI | 2 |
| No CSP / Rust changes | — |

## Self-review notes

- No placeholders; signatures match between tasks
- `WeatherIcon` size overrides may need a small prop later — CSS override is enough for V1
- Commits skipped (no git)
