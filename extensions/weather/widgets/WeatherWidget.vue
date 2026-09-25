<script setup lang="ts">
import { computed, ref } from "vue";
import type { WeatherModel } from "./weather";
import WeatherIcon from "./WeatherIcon.vue";

const props = defineProps<{ model: WeatherModel }>();
const model = props.model;
const state = model.state;
const data = model.data;
const loading = model.loading;
const error = model.error;
const rootEl = ref<HTMLElement | null>(null);

/** The main view's forecast row: the next four days, today is the big number. */
const upcomingDays = computed(() => data.value?.daily.slice(1, 5) ?? []);

function prevView() {
  model.setViewIndex(state.value.viewIndex - 1);
}

function nextView() {
  model.setViewIndex(state.value.viewIndex + 1);
}

function goView(index: number) {
  model.setViewIndex(index);
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    prevView();
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    nextView();
  }
}

function focusCarousel() {
  rootEl.value?.focus();
}

function hourLabel(iso: string): string {
  const match = iso.match(/T(\d{2})/);
  return match ? `${match[1]}h` : iso;
}

function dayLabel(dateString: string): string {
  const date = new Date(`${dateString}T12:00:00`);
  return new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(date);
}
</script>

<template>
  <div class="weather">
    <p v-if="loading && !data" class="weather-status">Loading…</p>
    <p v-else-if="error && !data" class="weather-status weather-status--error">
      {{ error }}
    </p>
    <template v-else-if="data">
      <div
        ref="rootEl"
        class="weather-carousel"
        tabindex="0"
        @keydown="onKeydown"
        @pointerdown.stop
        @click="focusCarousel"
      >
        <div v-if="state.viewIndex === 0" class="weather-now">
          <div class="weather-now-head">
            <p class="weather-now-temp">{{ Math.round(data.temperature_c) }}°</p>
            <WeatherIcon :icon="data.icon" class="weather-now-icon" />
          </div>
          <p class="weather-now-place" :title="model.location">
            <span class="weather-now-city">{{ data.location }}</span>
            · {{ data.condition }}
          </p>
          <div v-if="upcomingDays.length" class="weather-now-days">
            <div v-for="day in upcomingDays" :key="day.date" class="weather-now-day">
              <span class="weather-now-day-name">{{ dayLabel(day.date) }}</span>
              <span class="weather-now-day-temp">{{ Math.round(day.temperature_max_c) }}°</span>
            </div>
          </div>
        </div>

        <div v-else-if="state.viewIndex === 1" class="weather-details">
          <p class="weather-slide-title">Details</p>
          <div class="weather-details-grid">
            <div>
              <div class="weather-metric-label">Feels like</div>
              <div>{{ Math.round(data.apparent_c) }}°C</div>
            </div>
            <div>
              <div class="weather-metric-label">Humidity</div>
              <div>{{ Math.round(data.humidity_pct) }}%</div>
            </div>
            <div>
              <div class="weather-metric-label">Wind</div>
              <div>{{ Math.round(data.wind_kmh) }} km/h</div>
            </div>
            <div>
              <div class="weather-metric-label">Condition</div>
              <div>{{ data.condition }}</div>
            </div>
          </div>
        </div>

        <div v-else-if="state.viewIndex === 2" class="weather-hourly">
          <p class="weather-slide-title">Next hours</p>
          <p v-if="data.hourly.length === 0" class="weather-empty">No hourly data</p>
          <div v-else class="weather-hourly-row">
            <div v-for="hour in data.hourly" :key="hour.time" class="weather-hour">
              <div class="weather-hour-time">{{ hourLabel(hour.time) }}</div>
              <WeatherIcon :icon="hour.icon" class="weather-hour-icon" />
              <div>{{ Math.round(hour.temperature_c) }}°</div>
            </div>
          </div>
        </div>

        <div v-else class="weather-daily">
          <p class="weather-slide-title">5 days</p>
          <p v-if="data.daily.length === 0" class="weather-empty">No daily data</p>
          <template v-else>
            <div v-for="day in data.daily" :key="day.date" class="weather-day-row">
              <span class="weather-day-name">{{ dayLabel(day.date) }}</span>
              <WeatherIcon :icon="day.icon" class="weather-day-icon" />
              <span class="weather-day-temps">
                {{ Math.round(day.temperature_min_c) }}° /
                {{ Math.round(day.temperature_max_c) }}°
              </span>
            </div>
          </template>
        </div>
      </div>

      <div class="weather-controls" @pointerdown.stop>
        <div class="weather-dots" role="tablist" aria-label="Views">
          <button
            v-for="index in 4"
            :key="index"
            type="button"
            class="weather-dot"
            :class="{ 'weather-dot--active': state.viewIndex === index - 1 }"
            :aria-label="'View ' + index"
            :aria-selected="state.viewIndex === index - 1"
            role="tab"
            @click.stop="goView(index - 1)"
          />
        </div>
      </div>

      <p v-if="error" class="weather-status weather-status--error weather-status--inline">
        {{ error }}
      </p>
    </template>
  </div>
</template>

<style scoped>
.weather {
  display: flex;
  flex-direction: column;
  justify-content: center;
  width: 100%;
  min-height: 0;
  height: 100%;
  /* The card insets its content already; the big number lines up with the title. */
  padding: 2px 0 0;
  overflow: hidden;
  box-sizing: border-box;
  container-type: inline-size;
}

.weather-status {
  margin: 0;
  font-size: 13px;
  color: rgba(var(--fg-rgb), 0.6);
}

.weather-status--error {
  color: #ff8080;
}

.weather-status--inline {
  margin-top: 6px;
}

.weather-carousel {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  justify-content: center;
  min-height: 0;
  outline: none;
}

.weather-slide-title {
  margin: 0 0 8px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(var(--fg-rgb), 0.45);
}

.weather-empty {
  margin: 0;
  font-size: 12px;
  color: rgba(var(--fg-rgb), 0.5);
}

.weather-now {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
}

/* Nothing in the main view may shrink: a squeezed flex item with overflow
   hidden collapses to zero height. Short cards lose the free space instead. */
.weather-now-head,
.weather-now-place,
.weather-now-days {
  flex-shrink: 0;
}

.weather-now-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.weather-now-temp {
  margin: 0;
  font-size: clamp(40px, 30cqw, 84px);
  font-weight: 700;
  line-height: 0.95;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
  color: rgba(var(--fg-rgb), 0.95);
}

.weather-now-icon {
  width: clamp(48px, 30cqw, 84px);
  height: clamp(48px, 30cqw, 84px);
  /* Tight enough to fade out inside the icon box: the widget clips at its edge. */
  filter: drop-shadow(0 0 7px rgba(255, 184, 40, 0.5));
}

.weather-now-place {
  margin: 6px 0 0;
  overflow: hidden;
  font-size: clamp(13px, 5.6cqw, 18px);
  line-height: 1.25;
  color: rgba(var(--fg-rgb), 0.55);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.weather-now-city {
  font-weight: 700;
  color: rgba(var(--fg-rgb), 0.95);
}

.weather-now-days {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: auto;
  padding-top: 10px;
}

.weather-now-day {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.weather-now-day-name {
  font-size: clamp(11px, 4.6cqw, 15px);
  color: rgba(var(--fg-rgb), 0.55);
}

.weather-now-day-temp {
  font-size: clamp(13px, 5.6cqw, 18px);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: rgba(var(--fg-rgb), 0.95);
}

.weather-details-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 12px;
  font-size: 13px;
}

.weather-metric-label {
  margin-bottom: 2px;
  font-size: 11px;
  color: rgba(var(--fg-rgb), 0.5);
}

.weather-hourly-row {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 2px;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.weather-hourly-row::-webkit-scrollbar { display: none; }
.weather-hour {
  flex: 0 0 auto;
  min-width: 40px;
  text-align: center;
  font-size: 12px;
}

.weather-hour-time {
  margin-bottom: 4px;
  color: rgba(var(--fg-rgb), 0.5);
}

.weather-hour :deep(.weather-icon) {
  width: 28px;
  height: 28px;
  margin: 0 auto;
}

.weather-day-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 12px;
}

.weather-day-name {
  width: 36px;
  color: rgba(var(--fg-rgb), 0.7);
}

.weather-day-temps { margin-left: auto; }
.weather-day-row :deep(.weather-icon) {
  width: 22px;
  height: 22px;
}

@container (min-width: 500px) {
  .weather-daily {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 5px 16px;
  }

  .weather-daily .weather-slide-title,
  .weather-daily .weather-empty {
    grid-column: 1 / -1;
  }

  .weather-day-row {
    min-width: 0;
    margin: 0;
  }
}

/* Quiet until the card is touched, so the resting widget is just the weather. */
.weather-controls {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  height: 16px;
  margin-top: 2px;
  opacity: 0;
  transition: opacity 0.12s ease;
}

.weather:hover .weather-controls,
.weather-controls:focus-within {
  opacity: 1;
}

.weather-dots {
  display: flex;
  gap: 6px;
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

.weather-dot--active { background: rgba(var(--fg-rgb), 0.9); }
</style>
