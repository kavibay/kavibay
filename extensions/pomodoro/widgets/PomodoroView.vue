<script setup lang="ts">
import { RING_C, RING_R, type PomodoroModel } from "./pomodoro";

defineProps<{ model: PomodoroModel }>();
</script>

<template>
  <div class="pomodoro" :style="{ '--accent': model.accent.value }">
    <div class="pomodoro-layout">
      <div class="pomodoro-timer">
        <div class="pomodoro-ring-wrap">
          <svg class="pomodoro-ring" viewBox="0 0 120 120" aria-hidden="true">
            <circle class="pomodoro-ring-track" cx="60" cy="60" :r="RING_R" />
            <circle
              class="pomodoro-ring-progress"
              cx="60"
              cy="60"
              :r="RING_R"
              :stroke-dasharray="RING_C"
              :stroke-dashoffset="model.ringOffset.value"
            />
            <g class="pomodoro-ticks">
              <line
                v-for="i in 60"
                :key="i"
                :x1="60"
                :y1="i % 5 === 0 ? 12 : 14"
                :x2="60"
                :y2="i % 5 === 0 ? 18 : 16"
                :transform="`rotate(${(i - 1) * 6} 60 60)`"
              />
            </g>
          </svg>
          <div class="pomodoro-center">
            <p class="pomodoro-phase">{{ model.label.value }}</p>
            <p class="pomodoro-time">{{ model.displayTime.value }}</p>
            <p class="pomodoro-status">{{ model.statusText.value }}</p>
          </div>
        </div>
      </div>

      <aside class="pomodoro-sidebar">
        <div class="pomodoro-sessions">
          <p class="pomodoro-sidebar-label">Focus sessions</p>
          <p class="pomodoro-session-count">{{ model.completedFocusSessions.value }} <span>/ 4</span></p>
          <div class="pomodoro-dots" aria-label="Focus sessions">
            <span
              v-for="i in 4"
              :key="i"
              class="pomodoro-dot"
              :class="{ 'pomodoro-dot--on': i <= model.completedFocusSessions.value }"
            />
          </div>
        </div>

        <div class="pomodoro-actions" @pointerdown.stop>
          <button type="button" class="pomodoro-btn pomodoro-btn--accent" @click="model.toggleRun">
            {{ model.running.value ? "Stop" : "Start" }}
          </button>
          <button type="button" class="pomodoro-btn pomodoro-btn--ghost" @click="model.reset">
            Reset
          </button>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.pomodoro { position: relative; width: 100%; height: 100%; min-width: 0; min-height: 0; color: rgba(var(--fg-rgb), 0.92); container-type: inline-size; }
.pomodoro-layout { display: flex; flex-direction: column; width: 100%; height: 100%; min-width: 0; min-height: 0; }
.pomodoro-timer { display: flex; justify-content: center; }
.pomodoro-ring-wrap { position: relative; width: 180px; height: 180px; margin: 8px auto 0; }
.pomodoro-ring { width: 100%; height: 100%; transform: rotate(-90deg); }
.pomodoro-ring-track { fill: none; stroke: rgba(var(--fg-rgb), 0.08); stroke-width: 8; }
.pomodoro-ring-progress { fill: none; stroke: var(--accent, #e07a5f); stroke-width: 8; stroke-linecap: round; transition: stroke-dashoffset 0.25s linear; }
.pomodoro-ticks { transform: rotate(90deg); transform-origin: 60px 60px; }
.pomodoro-ticks line { stroke: rgba(var(--fg-rgb), 0.22); stroke-width: 1; }
.pomodoro-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; pointer-events: none; }
.pomodoro-phase { margin: 0; font-size: 14px; font-weight: 700; letter-spacing: 0.02em; }
.pomodoro-time { margin: 4px 0 0; font-size: 32px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: 0.04em; line-height: 1.1; }
.pomodoro-status { margin: 6px 0 0; font-size: 12px; color: rgba(var(--fg-rgb), 0.5); }
.pomodoro-sidebar { display: flex; flex-direction: column; }
.pomodoro-sidebar-label { margin: 0; color: rgba(var(--fg-rgb), 0.48); font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }
.pomodoro-session-count { margin: 6px 0 0; font-size: 30px; font-weight: 700; font-variant-numeric: tabular-nums; }
.pomodoro-session-count span { color: rgba(var(--fg-rgb), 0.42); font-size: 16px; font-weight: 500; }
.pomodoro-dots { display: flex; justify-content: center; gap: 8px; margin: 12px 0 14px; }
.pomodoro-dot { width: 8px; height: 8px; border-radius: 50%; background: rgba(var(--fg-rgb), 0.15); }
.pomodoro-dot--on { background: var(--accent, #e07a5f); }
.pomodoro-actions { display: flex; flex-direction: column; gap: 8px; }
.pomodoro-btn { width: 100%; padding: 10px 14px; border: none; border-radius: 999px; font-size: 14px; font-weight: 600; cursor: pointer; }
.pomodoro-btn--accent { background: var(--accent, #e07a5f); color: #fff; }
.pomodoro-btn--ghost { background: transparent; color: rgba(var(--fg-rgb), 0.55); }
.pomodoro-btn--ghost:hover { color: rgba(var(--fg-rgb), 0.9); }
@container (min-width: 500px) {
  .pomodoro-layout { display: grid; grid-template-columns: minmax(260px, 3fr) minmax(190px, 2fr); align-items: stretch; }
  .pomodoro-timer { min-height: 0; padding-right: 18px; border-right: 1px solid rgba(var(--fg-rgb), 0.09); }
  .pomodoro-ring-wrap { width: min(100%, 240px); height: auto; aspect-ratio: 1; margin: auto; }
  .pomodoro-sidebar { min-width: 0; padding-left: 18px; }
  .pomodoro-dots { justify-content: flex-start; }
  .pomodoro-actions { margin-top: auto; }
}
</style>
