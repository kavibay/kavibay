<script setup lang="ts">
import { ref } from "vue";
import { parseCustomDuration, presetDurationMs } from "./timerLogic";
import type { TimerModel } from "./widgets/timer";

const props = defineProps<{ model: TimerModel }>();
const model = props.model;

const customInput = ref("");
const lockedHint = "Pause or reset the timer to change the duration";

function applyCustom() {
  const parsed = parseCustomDuration(customInput.value);
  if (parsed == null) return;
  model.setCustomDuration(parsed);
  customInput.value = "";
}

function isPresetActive(minutes: number): boolean {
  return model.chosenDurationMs.value === presetDurationMs(minutes);
}
</script>

<template>
  <div class="timer" :class="{ 'timer--ringing': model.ringing.value }">
    <p class="timer-time">{{ model.displayTime.value }}</p>
    <p class="timer-status">{{ model.statusText.value }}</p>

    <!-- Duration controls stay mounted while running so the card keeps its layout. -->
    <div class="timer-presets" :class="{ 'timer-presets--locked': !model.canEditDuration.value }" @pointerdown.stop>
      <button
        v-for="minutes in model.presets"
        :key="minutes"
        type="button"
        class="timer-chip"
        :class="{ 'timer-chip--active': isPresetActive(minutes) }"
        :disabled="!model.canEditDuration.value"
        :title="model.canEditDuration.value ? undefined : lockedHint"
        @click="model.selectPreset(minutes)"
      >
        {{ minutes }}m
      </button>
    </div>

    <div class="timer-custom" :class="{ 'timer-custom--locked': !model.canEditDuration.value }" @pointerdown.stop>
      <input
        v-model="customInput"
        type="text"
        class="timer-custom-input"
        placeholder="Custom (min or m:ss)"
        :disabled="!model.canEditDuration.value"
        :title="model.canEditDuration.value ? undefined : lockedHint"
        @keydown.enter.prevent="applyCustom"
      />
      <button
        type="button"
        class="timer-btn timer-btn--ghost timer-btn--compact"
        :disabled="!model.canEditDuration.value"
        @click="applyCustom"
      >
        Set
      </button>
    </div>

    <div class="timer-actions" @pointerdown.stop>
      <button
        v-if="model.ringing.value"
        type="button"
        class="timer-btn timer-btn--primary"
        @click="model.dismiss"
      >
        Dismiss
      </button>
      <template v-else>
        <button type="button" class="timer-btn timer-btn--primary" @click="model.toggleRun">
          {{ model.running.value ? "Pause" : "Start" }}
        </button>
        <button type="button" class="timer-btn timer-btn--ghost" @click="model.reset">Reset</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.timer {
  width: 100%;
  color: rgba(var(--fg-rgb), 0.92);
}

.timer--ringing .timer-time {
  color: #e07a5f;
}

.timer-time {
  margin: 0;
  font-size: 32px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.04em;
  line-height: 1.1;
  transition: color 0.2s ease;
}

.timer-status {
  margin: 6px 0 12px;
  font-size: 12px;
  color: rgba(var(--fg-rgb), 0.5);
}

.timer-presets {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(64px, 1fr));
  gap: 6px;
  margin-bottom: 10px;
}

.timer-chip {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  border-radius: 999px;
  background: rgba(var(--fg-rgb), 0.06);
  color: rgba(var(--fg-rgb), 0.75);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.timer-chip--active {
  border-color: rgba(224, 122, 95, 0.55);
  background: rgba(224, 122, 95, 0.22);
  color: #fff;
}

/* While running/ringing the controls stay visible but read as inert. */
.timer-presets--locked,
.timer-custom--locked {
  opacity: 0.45;
}

.timer-chip:disabled,
.timer-custom-input:disabled,
.timer-btn:disabled {
  cursor: not-allowed;
}

.timer-custom {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 6px;
  margin-bottom: 12px;
}

.timer-custom-input {
  flex: 1;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.2);
  color: rgba(var(--fg-rgb), 0.9);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.timer-custom-input::placeholder {
  color: rgba(var(--fg-rgb), 0.35);
}

.timer-custom-input:focus {
  outline: none;
  border-color: rgba(var(--fg-rgb), 0.28);
}

.timer-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.timer-btn {
  width: 100%;
  padding: 10px 14px;
  border: none;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.timer-btn--compact {
  padding: 8px 12px;
}

.timer-btn--primary {
  background: #e07a5f;
  color: #fff;
}

.timer-btn--ghost {
  background: transparent;
  color: rgba(var(--fg-rgb), 0.55);
}

.timer-btn--ghost:hover {
  color: rgba(var(--fg-rgb), 0.9);
}
</style>
