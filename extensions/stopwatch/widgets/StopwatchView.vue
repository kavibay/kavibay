<script setup lang="ts">
import type { StopwatchModel } from "./stopwatch";

defineProps<{ model: StopwatchModel }>();
</script>

<template>
  <div class="stopwatch">
    <div class="stopwatch-layout">
      <section class="stopwatch-main">
        <div class="stopwatch-readout">
          <p class="stopwatch-time">{{ model.displayTime.value }}</p>
          <p class="stopwatch-status">{{ model.statusText.value }}</p>
        </div>

        <div class="stopwatch-actions" @pointerdown.stop>
          <button type="button" class="stopwatch-btn stopwatch-btn--primary" @click="model.toggleRun">
            {{ model.running.value ? "Pause" : "Start" }}
          </button>
          <div class="stopwatch-secondary-actions">
            <button
              type="button"
              class="stopwatch-btn stopwatch-btn--ghost"
              :disabled="!model.running.value"
              @click="model.lap"
            >
              Lap
            </button>
            <button type="button" class="stopwatch-btn stopwatch-btn--ghost" @click="model.reset">
              Reset
            </button>
          </div>
        </div>
      </section>

      <aside class="stopwatch-lap-panel">
        <p class="stopwatch-lap-heading">Laps</p>
        <p v-if="model.displayLaps.value.length === 0" class="stopwatch-empty">
          Record a lap while running.
        </p>
        <ul v-else class="stopwatch-laps" aria-label="Lap times">
          <li v-for="entry in model.displayLaps.value" :key="entry.id" class="stopwatch-lap">
            <span class="stopwatch-lap-label">Lap {{ entry.lapNumber }}</span>
            <span class="stopwatch-lap-split">{{ entry.split }}</span>
            <span class="stopwatch-lap-total">{{ entry.total }}</span>
          </li>
        </ul>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.stopwatch { width: 100%; height: 100%; min-width: 0; min-height: 0; color: rgba(var(--fg-rgb), 0.92); container-type: inline-size; }
.stopwatch-layout { display: flex; flex-direction: column; height: 100%; min-height: 0; padding: 16px; box-sizing: border-box; }
.stopwatch-main { display: flex; flex-direction: column; }
.stopwatch-readout { text-align: center; }
.stopwatch-time { margin: 0; font-size: 32px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: 0.04em; line-height: 1.1; }
.stopwatch-status { margin: 6px 0 14px; font-size: 12px; color: rgba(var(--fg-rgb), 0.5); }
.stopwatch-actions { display: flex; flex-direction: column; gap: 8px; }
.stopwatch-secondary-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.stopwatch-btn { width: 100%; padding: 10px 14px; border: none; border-radius: 999px; font-size: 14px; font-weight: 600; cursor: pointer; }
.stopwatch-btn--primary { background: #6b8cae; color: #fff; }
.stopwatch-btn--ghost { background: transparent; color: rgba(var(--fg-rgb), 0.55); }
.stopwatch-btn--ghost:hover:not(:disabled) { color: rgba(var(--fg-rgb), 0.9); }
.stopwatch-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.stopwatch-lap-panel { min-height: 0; margin-top: 14px; }
.stopwatch-lap-heading { margin: 0; color: rgba(var(--fg-rgb), 0.48); font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }
.stopwatch-empty { margin: 10px 0 0; color: rgba(var(--fg-rgb), 0.42); font-size: 12px; line-height: 1.4; }
.stopwatch-laps { list-style: none; margin: 10px 0 0; padding: 0; max-height: 140px; overflow-y: auto; overscroll-behavior: contain; border-top: 1px solid rgba(var(--fg-rgb), 0.08); }
.stopwatch-lap { display: grid; grid-template-columns: 1fr auto auto; gap: 8px; align-items: center; padding: 8px 0; font-size: 12px; font-variant-numeric: tabular-nums; border-bottom: 1px solid rgba(var(--fg-rgb), 0.06); }
.stopwatch-lap-label { color: rgba(var(--fg-rgb), 0.55); }
.stopwatch-lap-split { font-weight: 600; }
.stopwatch-lap-total { min-width: 4.5rem; color: rgba(var(--fg-rgb), 0.45); text-align: right; }

@container (min-width: 500px) {
  .stopwatch-layout { display: grid; grid-template-columns: minmax(240px, 3fr) minmax(190px, 2fr); }
  .stopwatch-main { min-width: 0; padding-right: 20px; border-right: 1px solid rgba(var(--fg-rgb), 0.09); }
  .stopwatch-readout { margin: 24px 0 20px; }
  .stopwatch-lap-panel { display: flex; flex-direction: column; min-width: 0; min-height: 0; margin: 0; padding-left: 20px; }
  .stopwatch-laps { flex: 1 1 auto; max-height: none; }
}
</style>

