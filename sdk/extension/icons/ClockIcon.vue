<script setup lang="ts">
// SPDX-License-Identifier: MIT
/** Lucide `clock`, with hands that briefly mark the passing time. */
import IconBase from "./IconBase.vue";

withDefaults(
  defineProps<{
    size?: number | string;
    strokeWidth?: number | string;
    animated?: boolean;
  }>(),
  { size: 24, strokeWidth: 2, animated: false },
);
</script>

<template>
  <IconBase class="lmi-clock" :size="size" :stroke-width="strokeWidth" :animated="animated">
    <circle cx="12" cy="12" r="10" />
    <line class="lmi-clock-line1" x1="12" y1="12" x2="16" y2="14" />
    <line class="lmi-clock-line2" x1="12" y1="6" x2="12" y2="12" />
    <!-- Only painted inside a tile; outside it the Lucide mark is unchanged. -->
    <circle class="lmi-clock-pin" cx="12" cy="12" r="1.3" />
  </IconBase>
</template>

<style>
/* A station clock: silver, with the sweeping hand in signal red. Tile colours — see ListTodoIcon.vue for how the host reads them. */
[data-icon-tile]:has(> .lmi-clock) {
  --icon-tile-bg: rgba(148, 163, 184, 0.22);
  --icon-tile-fg: #e2e8f0;
  --lmi-clock-hand: #f09595;
}

html[data-color-mode="light"] [data-icon-tile]:has(> .lmi-clock) {
  --icon-tile-bg: rgba(100, 116, 139, 0.16);
  --icon-tile-fg: #334155;
  --lmi-clock-hand: #e24b4a;
}

.lmi-clock-line2 {
  stroke: var(--lmi-clock-hand, currentColor);
}

.lmi-clock-pin {
  fill: var(--lmi-clock-hand, none);
  stroke: none;
}

.lmi-clock-line1 {
  transform-box: fill-box;
  transform-origin: top left;
  transform: rotate(0deg);
}

.lmi-clock-line2 {
  transform-box: fill-box;
  transform-origin: bottom left;
  transform: rotate(0deg);
}

@keyframes lmi-clock-line1 {
  0% { transform: rotate(0deg); }
  50% { transform: rotate(20deg); }
  100% { transform: rotate(0deg); }
}

@keyframes lmi-clock-line2 {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

:is(
  .lmi-clock[data-animated]:hover,
  [data-icon-motion]:hover .lmi-clock[data-animated],
  [data-icon-motion="on"] .lmi-clock[data-animated]
) .lmi-clock-line1 {
  animation-name: lmi-clock-line1;
  animation-duration: 0.78s;
  animation-timing-function: ease-in-out;
  animation-fill-mode: both;
}

:is(
  .lmi-clock[data-animated]:hover,
  [data-icon-motion]:hover .lmi-clock[data-animated],
  [data-icon-motion="on"] .lmi-clock[data-animated]
) .lmi-clock-line2 {
  animation-name: lmi-clock-line2;
  animation-duration: 0.78s;
  animation-timing-function: ease-in-out;
  animation-fill-mode: both;
}
</style>
