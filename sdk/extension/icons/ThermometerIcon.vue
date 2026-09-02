<script setup lang="ts">
// SPDX-License-Identifier: MIT
/** Lucide `thermometer`, with a brief temperature-reading wobble. */
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
  <IconBase class="lmi-thermometer" :size="size" :stroke-width="strokeWidth" :animated="animated">
    <path class="lmi-thermometer-path" d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z" />
  </IconBase>
</template>

<style>
.lmi-thermometer-path {
  transform-box: fill-box;
  transform-origin: center;
  transform: rotate(0deg);
}

@keyframes lmi-thermometer-path {
  0% { transform: rotate(0deg); }
  20% { transform: rotate(-5deg); }
  40% { transform: rotate(5deg); }
  60% { transform: rotate(-5deg); }
  80% { transform: rotate(5deg); }
  100% { transform: rotate(0deg); }
}

:is(
  .lmi-thermometer[data-animated]:hover,
  [data-icon-motion]:hover .lmi-thermometer[data-animated],
  [data-icon-motion="on"] .lmi-thermometer[data-animated]
) .lmi-thermometer-path {
  animation-name: lmi-thermometer-path;
  animation-duration: 0.52s;
  animation-timing-function: ease;
  animation-fill-mode: both;
}
</style>
