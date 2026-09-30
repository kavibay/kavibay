<script setup lang="ts">
// SPDX-License-Identifier: MIT
/** Lucide `chart-line`, with the market trace drawing from left to right. */
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
  <IconBase class="lmi-chart-line" :size="size" :stroke-width="strokeWidth" :animated="animated">
    <path d="M3 3v16a2 2 0 0 0 2 2h16" />
    <!-- Only painted inside a tile; outside it the Lucide mark is unchanged. -->
    <path class="lmi-chart-line-area" d="M7 13l3-3 4 4 5-5v10H7z" />
    <path class="lmi-chart-line-path" d="m19 9-5 5-4-4-3 3" pathLength="1" />
  </IconBase>
</template>

<style>
/* Market green, with the gain filled in under the line. Tile colours — see ListTodoIcon.vue for how the host reads them. */
[data-icon-tile]:has(> .lmi-chart-line) {
  --icon-tile-bg: rgba(99, 153, 34, 0.24);
  --icon-tile-fg: #c0dd97;
  --lmi-chart-line: #b5e46a;
  --lmi-chart-area: rgba(151, 196, 89, 0.3);
}

html[data-color-mode="light"] [data-icon-tile]:has(> .lmi-chart-line) {
  --icon-tile-bg: rgba(99, 153, 34, 0.16);
  --icon-tile-fg: #3b6d11;
  --lmi-chart-line: #4d8a12;
  --lmi-chart-area: rgba(99, 153, 34, 0.22);
}

.lmi-chart-line-path {
  stroke: var(--lmi-chart-line, currentColor);
}

.lmi-chart-line-area {
  fill: var(--lmi-chart-area, none);
  stroke: none;
  opacity: 1;
  /* Inert until a trigger supplies an animation-name: after the line. */
  animation-delay: 0.8s;
}

@keyframes lmi-chart-line-area {
  0% { opacity: 0; }
  100% { opacity: 1; }
}

:is(
  .lmi-chart-line[data-animated]:hover,
  [data-icon-motion]:hover .lmi-chart-line[data-animated],
  [data-icon-motion="on"] .lmi-chart-line[data-animated]
) .lmi-chart-line-area {
  animation-name: lmi-chart-line-area;
  animation-duration: 0.3s;
  animation-timing-function: ease-out;
  animation-fill-mode: both;
}

.lmi-chart-line-path {
  opacity: 1;
  stroke-dasharray: 1 1;
  stroke-dashoffset: 0;
}

@keyframes lmi-chart-line-draw {
  0% {
    opacity: 0;
    stroke-dasharray: 0 1;
    stroke-dashoffset: 1;
  }
  2% { opacity: 1; }
  100% {
    stroke-dasharray: 1 1;
    stroke-dashoffset: 0;
  }
}

:is(
  .lmi-chart-line[data-animated]:hover,
  [data-icon-motion]:hover .lmi-chart-line[data-animated],
  [data-icon-motion="on"] .lmi-chart-line[data-animated]
) .lmi-chart-line-path {
  animation-name: lmi-chart-line-draw;
  animation-duration: 1.04s;
  animation-timing-function: ease-in-out;
  animation-fill-mode: both;
}
</style>
