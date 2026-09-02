<script setup lang="ts">
import { ref } from "vue";
import type { WeatherModel } from "./weather";
import WeatherIcon from "./WeatherIcon.vue";

const props = defineProps<{ model: WeatherModel }>();
const model = props.model;
const state = model.state;
const data = model.data;
const loading = model.loading;
const error = model.error;
const rootEl = ref<HTMLElement | null>(null);

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
        <button
          type="button"
          class="weather-nav weather-nav--prev"
          aria-label="Previous view"
          @click.stop="prevView"
        >
          ‹
        </button>
        <button
          type="button"
          class="weather-nav weather-nav--next"
          aria-label="Next view"
          @click.stop="nextView"
        >
          ›
        </button>

        <div class="weather-slide">
          <div v-if="state.viewIndex === 0" class="weather-main">
            <WeatherIcon :icon="data.icon" />
            <div class="weather-text">
              <p class="weather-temp">{{ Math.round(data.temperature_c) }}°C</p>
              <p class="weather-condition">{{ data.condition }}</p>
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

      <div class="weather-footer" @pointerdown.stop>
        <span class="weather-location" :title="model.location">{{ data.location }}</span>
        <button
          type="button"
          class="weather-refresh"
          :class="{ 'weather-refresh--spin': loading }"
          :disabled="loading"
          aria-label="Refresh"
          v-tip="'Refresh'"
          @click="model.refresh"
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
.weather {
  display: flex;
  flex-direction: column;
  justify-content: center;
  width: 100%;
  min-height: 0;
  height: 100%;
  padding: 12px;
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
  position: relative;
  box-sizing: border-box;
  width: 100%;
  flex: 0 0 auto;
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
  opacity: 0;
  transition: opacity 0.15s ease;
}

.weather:hover .weather-nav,
.weather-nav:focus-visible {
  opacity: 1;
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

.weather-dot--active { background: rgba(var(--fg-rgb), 0.9); }

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

.weather-main {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.weather-text { min-width: 0; }
.weather-temp {
  margin: 0;
  font-size: 28px;
  font-weight: 600;
  line-height: 1.1;
}

.weather-condition {
  margin: 4px 0 0;
  font-size: 13px;
  color: rgba(var(--fg-rgb), 0.65);
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

.weather-footer {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 10px;
}

.weather-location {
  flex: 0 1 auto;
  max-width: calc(100% - 36px);
  min-width: 0;
  overflow: hidden;
  color: rgba(var(--fg-rgb), 0.6);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.weather-refresh {
  position: absolute;
  right: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.55);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.weather:hover .weather-refresh,
.weather-refresh:focus-visible {
  opacity: 1;
}

.weather-refresh:hover:not(:disabled) {
  color: rgba(var(--fg-rgb), 0.9);
  background: rgba(var(--fg-rgb), 0.08);
}

.weather-refresh:disabled { cursor: default; }
.weather-refresh--spin svg { animation: weather-spin 0.8s linear infinite; }

@keyframes weather-spin {
  to { transform: rotate(360deg); }
}
</style>
