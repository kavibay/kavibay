# Weather Widget Carousel Views — Design

**Date:** 2026-07-22  
**Status:** Approved for implementation planning  
**Approach:** Single Open-Meteo fetch; four slides with overlay carousel chrome (approach 1, layout A)

## Goal

Extend the existing Weather widget with a carousel of four views (Now, Details, Hourly, Daily), navigable via overlay ‹ ›, clickable dots, and keyboard ←/→ when the widget is focused.

## Requirements

### Views (index 0–3, wrap)

| Index | Name | Content |
|-------|------|---------|
| 0 | Jetzt | Current SVG icon, °C, German condition (existing) |
| 1 | Details | Felt temperature, humidity %, wind km/h, condition label |
| 2 | Stunden | Next ~12 hours: hour label, icon, temp (horizontal row) |
| 3 | Tage | Next 5 days: weekday, icon, min/max °C |

### Navigation

- Overlay ‹ left / › right on slide edges (layout A)
- Four clickable dots under the slide (active filled)
- Keyboard ← / → when widget root is focused; wrap around
- `viewIndex` is session-only (not persisted) in V1

### Shared chrome

- Location + refresh row under every view
- Location editable as today (inline + settings)
- Refresh visible **only on widget hover**; still works on click when visible
- Auto-refresh ~60s remains; one payload feeds all slides

### Data (Open-Meteo, one request)

Extend current fetch to request:

- `current`: `temperature_2m`, `weather_code`, `relative_humidity_2m`, `wind_speed_10m`, `apparent_temperature`
- `hourly`: `temperature_2m`, `weather_code` (slice next 12 hours from “now”)
- `daily`: `weather_code`, `temperature_2m_max`, `temperature_2m_min` (5 days)

Reuse `describeWeatherCode` for all codes. German labels unchanged for V1.

## Architecture

### Data shape (conceptual)

```ts
interface WeatherInfo {
  location: string;
  temperature_c: number;
  condition: string;
  icon: WeatherIconKey;
  apparent_c: number;
  humidity_pct: number;
  wind_kmh: number;
  hourly: { time: string; temperature_c: number; icon: WeatherIconKey; condition: string }[];
  daily: { date: string; temperature_min_c: number; temperature_max_c: number; icon: WeatherIconKey; condition: string }[];
}
```

### Frontend

| File | Role |
|------|------|
| `src/extensions/weather/weatherLogic.ts` | Expand fetch + types; keep settings helpers |
| `src/extensions/weather/WeatherWidget.vue` | Carousel chrome, focus/keyboard, shared footer |
| Optional slide components | e.g. `WeatherNowSlide.vue`, `WeatherDetailsSlide.vue`, … if widget file grows |
| `WeatherIcon.vue` | Reuse as-is |
| Settings / host wiring | Unchanged except if types need export only |

No CSP change (same Open-Meteo hosts). No Rust changes.

### Interaction details

- Widget root: `tabindex="0"` (or focusable container) so ←/→ work after click/focus
- Nav buttons and dots: `@pointerdown.stop` so they don’t drag the card
- Hover scope: `.weather:hover .weather-refresh { opacity: 1 }` (hidden otherwise, still focusable via keyboard if desired — V1: mouse hover only is enough)

### Errors / loading

Unchanged contract: initial Loading…; on error keep last good data and show inline error; refresh spins while loading.

## Out of scope

- Persist last view index
- More than 12 hours / 5 days
- Radar, AQI, precipitation charts
- Swipe/gesture carousel
- English labels

## Testing

- Unit: parse/slice hourly/daily from sample JSON; wrap index helper
- Manual: all four views, dots, overlay arrows, keyboard when focused, hover refresh, location still works

## Success criteria

- User can switch all four views with ‹ ›, dots, and ←/→
- Details/hourly/daily show real Open-Meteo fields
- Location always visible; refresh only on hover
- Existing location settings and icon set still work
