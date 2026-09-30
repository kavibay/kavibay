<script setup lang="ts">
// SPDX-License-Identifier: MIT
/** Lucide `cpu`, with its horizontal and vertical pins pulsing in turn. */
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
  <IconBase class="lmi-cpu" :size="size" :stroke-width="strokeWidth" :animated="animated">
    <rect rx="2" x="4" y="4" width="16" height="16" />
    <rect class="lmi-cpu-core" rx="1" x="9" y="9" width="6" height="6" />
    <path class="lmi-cpu-y" d="M15 2v2" />
    <path class="lmi-cpu-y" d="M15 20v2" />
    <path class="lmi-cpu-x" d="M2 15h2" />
    <path class="lmi-cpu-x" d="M2 9h2" />
    <path class="lmi-cpu-x" d="M20 15h2" />
    <path class="lmi-cpu-x" d="M20 9h2" />
    <path class="lmi-cpu-y" d="M9 2v2" />
    <path class="lmi-cpu-y" d="M9 20v2" />
  </IconBase>
</template>

<style>
/* An indigo chip on gold pins, the die washed in. Tile colours — see ListTodoIcon.vue for how the host reads them. */
[data-icon-tile]:has(> .lmi-cpu) {
  --icon-tile-bg: rgba(99, 102, 241, 0.22);
  --icon-tile-fg: #c7d2fe;
  --lmi-cpu-pin: #fbbf24;
  --lmi-cpu-core: rgba(165, 180, 252, 0.35);
}

html[data-color-mode="light"] [data-icon-tile]:has(> .lmi-cpu) {
  --icon-tile-bg: rgba(99, 102, 241, 0.14);
  --icon-tile-fg: #3730a3;
  --lmi-cpu-pin: #b45309;
  --lmi-cpu-core: rgba(99, 102, 241, 0.25);
}

.lmi-cpu-x,
.lmi-cpu-y {
  stroke: var(--lmi-cpu-pin, currentColor);
}

.lmi-cpu-core {
  fill: var(--lmi-cpu-core, none);
}

.lmi-cpu-x,
.lmi-cpu-y {
  transform-box: fill-box;
  transform-origin: center;
  opacity: 1;
}

.lmi-cpu-x {
  transform: scale(1, 1);
}

.lmi-cpu-y {
  transform: scale(1, 1);
}

@keyframes lmi-cpu-y {
  0% { transform: scale(1, 1); opacity: 1; }
  50% { transform: scale(1, 1.5); opacity: 0.8; }
  100% { transform: scale(1, 1); opacity: 1; }
}

@keyframes lmi-cpu-x {
  0% { transform: scale(1, 1); opacity: 1; }
  50% { transform: scale(1.5, 1); opacity: 0.8; }
  100% { transform: scale(1, 1); opacity: 1; }
}

:is(
  .lmi-cpu[data-animated]:hover,
  [data-icon-motion]:hover .lmi-cpu[data-animated],
  [data-icon-motion="on"] .lmi-cpu[data-animated]
) .lmi-cpu-y {
  animation-name: lmi-cpu-y;
  animation-duration: 0.39s;
  animation-timing-function: ease;
  animation-fill-mode: both;
}

:is(
  .lmi-cpu[data-animated]:hover,
  [data-icon-motion]:hover .lmi-cpu[data-animated],
  [data-icon-motion="on"] .lmi-cpu[data-animated]
) .lmi-cpu-x {
  animation-name: lmi-cpu-x;
  animation-duration: 0.39s;
  animation-timing-function: ease;
  animation-fill-mode: both;
}
</style>
