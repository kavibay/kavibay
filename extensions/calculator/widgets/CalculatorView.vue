<script setup lang="ts">
import { inject, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { WIDGET_FOCUS_EVENT, widgetFocusRequestMatches, type WidgetSurface } from "@sdk";
import type { CalculatorModel } from "./calculator";

const props = defineProps<{ model: CalculatorModel }>();

const instanceId = inject<string>("widgetInstanceId");
if (!instanceId) throw new Error("widgetInstanceId missing");
const boundInstanceId: string = instanceId;
const widgetSurface = inject<WidgetSurface>("widgetSurface", "desk");
const historyEl = ref<HTMLElement | null>(null);
const inputEl = ref<HTMLInputElement | null>(null);

async function scrollHistoryToEnd() {
  await nextTick();
  const element = historyEl.value;
  if (element) element.scrollTop = element.scrollHeight;
}

async function commit() {
  if (!props.model.commit()) return;
  await scrollHistoryToEnd();
}

function setExpression(event: Event) {
  props.model.setExpression((event.target as HTMLInputElement).value);
}

async function focusInput() {
  await nextTick();
  const element = inputEl.value;
  if (!element || document.activeElement === element) return;
  element.focus();
  element.select();
}

function onKavibayFocusWidget(event: Event) {
  if (!widgetFocusRequestMatches(event, boundInstanceId, widgetSurface)) return;
  void focusInput();
}

onMounted(() => {
  window.addEventListener(WIDGET_FOCUS_EVENT, onKavibayFocusWidget);
});

onBeforeUnmount(() => {
  window.removeEventListener(WIDGET_FOCUS_EVENT, onKavibayFocusWidget);
});

void scrollHistoryToEnd();
</script>

<template>
  <div class="calc" @pointerdown.stop>
    <div class="calc-results">
      <button
        v-if="model.history.value.length"
        type="button"
        class="calc-clear"
        v-tip="'Clear history'"
        aria-label="Clear history"
        @click="model.clearAll"
      >
        <svg class="calc-trash" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <g class="calc-trash-lid">
            <path fill="currentColor" d="M19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
          </g>
          <path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12z" />
        </svg>
      </button>

      <div ref="historyEl" class="calc-history" aria-label="Calculation history" @wheel.stop>
        <div v-for="entry in model.history.value" :key="entry.id" class="calc-entry">
          <div class="calc-entry-expr">{{ entry.expression }}</div>
          <div class="calc-entry-result">{{ entry.result }}</div>
        </div>
      </div>
    </div>

    <p v-if="model.live.value !== null" class="calc-live">{{ model.live.value }}</p>
    <input
      ref="inputEl"
      :value="model.expression.value"
      class="calc-input"
      type="text"
      inputmode="decimal"
      autocomplete="off"
      spellcheck="false"
      placeholder="12*7+3"
      aria-label="Expression"
      @input="setExpression"
      @keydown.enter.prevent="commit"
    />
  </div>
</template>

<style scoped>
.calc {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 180px;
  min-height: 0;
  height: 100%;
  box-sizing: border-box;
}

.calc-input {
  width: 100%;
  flex: 0 0 auto;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.25);
  color: rgba(var(--fg-rgb), 0.95);
  font-size: 16px;
  font-variant-numeric: tabular-nums;
  outline: none;
}

.calc-input:focus { border-color: rgba(var(--fg-rgb), 0.28); }
.calc-input::placeholder { color: rgba(var(--fg-rgb), 0.35); }

.calc-live {
  flex: 0 0 auto;
  margin: 0;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  color: rgba(var(--fg-rgb), 0.45);
  text-align: right;
}

.calc-results {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.calc-clear {
  appearance: none;
  position: absolute;
  top: 0;
  left: 0;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 3px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.35);
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease;
}

.calc-results:hover .calc-clear,
.calc-results:focus-within .calc-clear {
  opacity: 1;
  pointer-events: auto;
}

.calc-clear:hover,
.calc-clear:focus-visible {
  color: rgba(var(--fg-rgb), 0.85);
  background: rgba(var(--fg-rgb), 0.08);
}

.calc-trash { overflow: visible; display: block; }
.calc-trash-lid { transform-origin: 5px 5px; transition: transform 0.16s ease; }

.calc-clear:hover .calc-trash-lid,
.calc-clear:focus-visible .calc-trash-lid {
  transform: rotate(-28deg) translate(-0.5px, -1px);
}

.calc-history {
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 4px 2px 2px;
}

.calc-entry {
  align-self: flex-end;
  max-width: 100%;
  text-align: right;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.calc-entry-expr {
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  color: rgba(var(--fg-rgb), 0.5);
  overflow-wrap: anywhere;
}

.calc-entry-result {
  font-size: 18px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: rgba(var(--fg-rgb), 0.92);
  overflow-wrap: anywhere;
}
</style>
