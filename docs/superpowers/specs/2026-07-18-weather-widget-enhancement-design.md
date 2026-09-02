# Weather Widget Enhancement — Design

**Date:** 2026-07-18  
**Status:** Approved for implementation planning  
**Approach:** Client-side Open-Meteo fetch with per-instance location settings (approach 1)

## Goal

Upgrade the existing Weather widget so users can set a location (inline and in settings), manually refresh, and see a colorful SVG icon that matches the current condition — backed by real weather data instead of the Rust mock.

## Requirements

### Behavior

- Show current weather for a user-chosen city: temperature (°C), short condition label, and matching icon
- Location editable **inline** in the widget (click place name → input; Enter saves & reloads; Escape cancels)
- Location also editable in the **settings popover** (same persisted state as inline)
- **Refresh** control reloads weather for the current location
- Optional auto-refresh ~every 60s while the widget is mounted (same cadence as today’s registry interval)
- Empty location falls back to default **Berlin**
- Location persists per widget instance in `localStorage` (Clock/Pomodoro pattern)

### Display (option B)

- Large colored SVG weather icon
- Temperature in °C (rounded)
- Short condition text (e.g. “Regen”, “Sonnig”)
- Location name + refresh affordance
- No forecast, humidity, wind, or multi-city support in this scope

### Icons (custom SVGs)

Map Open-Meteo WMO weather codes to a small set of icon keys:

| Icon key | Examples (WMO) |
|----------|----------------|
| `clear` | 0 |
| `partly-cloudy` | 1–2 |
| `cloudy` | 3 |
| `fog` | 45, 48 |
| `drizzle` | 51–57 |
| `rain` | 61–67, 80–82 |
| `snow` | 71–77, 85–86 |
| `thunderstorm` | 95–99 |

SVGs are inline/custom (no icon library). Colors must read clearly on the dark glass `WidgetCard` background.

## Architecture

### Approach

Weather loading moves **entirely to the frontend**. Open-Meteo needs no API key; AppLauncher/ColorPicker already own their own network/`invoke` flows. Drop `backendCommand: "widget_weather"` from the registry and remove the Rust mock command so it does not linger as dead code.

### Data flow

1. Resolve `location` from per-instance settings (default Berlin)
2. Geocode via Open-Meteo Geocoding API → lat/lon + display name
3. Fetch current weather (`temperature_2m`, `weather_code`)
4. Map `weather_code` → icon key + German short label
5. Render; refresh / location change / 60s timer repeats 2–4

### Frontend files

| File | Role |
|------|------|
| `src/widgets/weatherLogic.ts` | Types, WMO mapping, geocode + fetch helpers, localStorage load/save/normalize |
| `src/widgets/useWeatherSettings.ts` | Per-instance reactive settings (mirror `useClockSettings`) |
| `src/widgets/WeatherSettings.vue` | Settings popover: location field |
| `src/widgets/WeatherWidget.vue` | UI: icon, temp, condition, inline edit, refresh, load lifecycle |
| `src/widgets/registry.ts` | Attach `settingsComponent`; remove `backendCommand` / `refreshInterval` |

Optional: small pure helpers or inline SVG components for each icon key living next to the widget (keep in `weatherLogic` or a thin `weatherIcons.ts` if the Vue file would get too large).

### Backend cleanup

| Change | Why |
|--------|-----|
| Remove `widget_weather` + `WeatherInfo` from `commands.rs` | Mock no longer used |
| Unregister from `lib.rs` invoke handler | Avoid dead IPC surface |
| Drop `rand` dependency **only if** nothing else uses it | Keep Cargo lean |

### Settings contract

```ts
interface WeatherSettings {
  location: string; // user query / city name; empty → "Berlin"
}
```

Storage key pattern: same style as clock (`kavibay.weather.<instanceId>` or project convention). Wire `seedWeatherSettingsFrom` / `disposeWeatherSettings` in `WidgetHost.vue` on duplicate/remove, matching Clock and Pomodoro.

### API contract (Open-Meteo)

- Geocoding: `https://geocoding-api.open-meteo.com/v1/search?name=…&count=1`
- Forecast/current: `https://api.open-meteo.com/v1/forecast?latitude=…&longitude=…&current=temperature_2m,weather_code`
- First geocoding result wins; zero results → “Ort nicht gefunden”
- Network/HTTP failures → “Wetter konnte nicht geladen werden”
- On error, keep last successful display (no blank flash)

### Loading UX

- Initial load with no data: short “Loading…” (or equivalent)
- Subsequent reloads: spin/disable refresh icon; keep temp/icon visible

## Out of scope

- Multi-day or hourly forecast
- System geolocation
- Multiple locations in one card
- English/other locale switching for condition labels (German labels for V1)
- Keeping a Rust weather proxy for future API keys

## Testing

- Unit: WMO code → icon key + label; settings normalize (empty → Berlin) and persist round-trip
- Manual: inline edit, settings edit, refresh, invalid city, offline / failed fetch

## Success criteria

- User can change location inline and via settings; both stay in sync and survive reload
- Refresh updates temperature/condition/icon for the current location
- Icon visually matches condition (sun/clouds/rain/thunder/etc.)
- No Rust `widget_weather` mock remains
- Widget fits existing dark glass card without new chrome patterns
