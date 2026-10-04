<script setup lang="ts">
import { computed, type ComputedRef } from "vue";

/**
 * The tado° tile: target and humidity above, temperature large in the middle,
 * zone name below between the − / + that move the target.
 *
 * Absent by design, compared with the old component: the connect panel, the
 * room picker and the "update failed" line. All three are gate or error states
 * the runtime now owns, and duplicating them here is exactly what Phase 3
 * forbids. What is left is the part that only this widget can draw.
 */
const props = defineProps<{
  model: {
    temperature: ComputedRef<number | null>;
    humidity: ComputedRef<number | null>;
    zoneName: ComputedRef<string>;
    target: ComputedRef<number | null>;
    adjust(direction: number): void;
  };
}>();

const target = computed(() => {
  const value = props.model.target.value;
  return value == null ? "Off" : `${value.toFixed(1)}°`;
});

/**
 * Split so the fraction can be rendered smaller, as the old tile did — the
 * whole number is what you read across a room, the decimal is detail.
 */
const parts = computed(() => {
  const value = props.model.temperature.value;
  if (value == null) return { whole: "—", fraction: "" };
  const fixed = value.toFixed(1);
  const [whole = "—", fraction = ""] = fixed.split(".");
  return { whole, fraction };
});

const humidity = computed(() => {
  const value = props.model.humidity.value;
  return value == null ? "—%" : `${Math.round(value)}%`;
});
</script>

<template>
  <div class="tile">
    <div class="top">
      <div class="target" title="Target temperature">{{ target }}</div>
      <div class="humidity" aria-hidden="true">
        <svg width="10" height="12" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C12 2 5 10.5 5 15a7 7 0 0 0 14 0c0-4.5-7-13-7-13z" />
        </svg>
        <span>{{ humidity }}</span>
      </div>
    </div>

    <div class="temp">
      <span class="whole">{{ parts.whole }}</span>
      <span class="tail">
        <span class="deg">°</span>
        <span class="frac">{{ parts.fraction }}</span>
      </span>
    </div>

    <div class="bottom">
      <button type="button" class="step" aria-label="Lower target temperature" @click="model.adjust(-1)">−</button>
      <p class="zone">{{ model.zoneName.value }}</p>
      <button type="button" class="step" aria-label="Raise target temperature" @click="model.adjust(1)">+</button>
    </div>
  </div>
</template>

<style scoped>
.tile {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  width: 100%;
  height: 100%;
  padding: 8px 10px;
  box-sizing: border-box;
}

.top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.target {
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: rgba(var(--fg-rgb), 0.75);
}

.humidity {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  color: rgba(var(--fg-rgb), 0.55);
}

.temp {
  display: flex;
  align-items: baseline;
  justify-content: center;
  flex: 1 1 auto;
  min-height: 0;
}

.whole {
  font-size: 34px;
  font-weight: 600;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.tail {
  display: flex;
  align-items: baseline;
}

.deg {
  font-size: 16px;
  font-weight: 600;
  line-height: 1;
}

.frac {
  font-size: 16px;
  font-weight: 600;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.bottom {
  display: flex;
  align-items: center;
  gap: 4px;
}

.step {
  flex: none;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: rgba(var(--fg-rgb), 0.08);
  color: inherit;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}

.step:hover {
  background: rgba(var(--fg-rgb), 0.16);
}

.zone {
  flex: 1 1 auto;
  min-width: 0;
  text-align: center;
  margin: 0;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgba(var(--fg-rgb), 0.6);
}
</style>
