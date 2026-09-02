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
    <path class="lmi-chart-line-path" d="m19 9-5 5-4-4-3 3" pathLength="1" />
  </IconBase>
</template>

<style>
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
