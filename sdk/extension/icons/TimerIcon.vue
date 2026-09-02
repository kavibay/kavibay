<script setup lang="ts">
// SPDX-License-Identifier: MIT
/** Lucide `timer`, with the hand spinning after the top button presses. */
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
  <IconBase class="lmi-timer" :size="size" :stroke-width="strokeWidth" :animated="animated">
    <circle cx="12" cy="14" r="8" />
    <line class="lmi-timer-line1" x1="12" y1="14" x2="15" y2="11" />
    <line class="lmi-timer-line2" x1="10" y1="2" x2="14" y2="2" />
  </IconBase>
</template>

<style>
.lmi-timer-line1 {
  transform-box: fill-box;
  transform-origin: bottom left;
  transform: rotate(0deg);
  /* Inert until animation-name is set by the trigger below. */
  animation-delay: 0.195s;
}

.lmi-timer-line2 {
  transform: translate(0, 0px);
}

@keyframes lmi-timer-line1 {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

@keyframes lmi-timer-line2 {
  0% { transform: translate(0, 0px); }
  50% { transform: translate(0, 1.5px); }
  100% { transform: translate(0, 0px); }
}

:is(
  .lmi-timer[data-animated]:hover,
  [data-icon-motion]:hover .lmi-timer[data-animated],
  [data-icon-motion="on"] .lmi-timer[data-animated]
) .lmi-timer-line1 {
  animation-name: lmi-timer-line1;
  animation-duration: 0.78s;
  animation-timing-function: ease-in-out;
  animation-fill-mode: both;
}

:is(
  .lmi-timer[data-animated]:hover,
  [data-icon-motion]:hover .lmi-timer[data-animated],
  [data-icon-motion="on"] .lmi-timer[data-animated]
) .lmi-timer-line2 {
  animation-name: lmi-timer-line2;
  animation-duration: 0.39s;
  animation-timing-function: ease-in-out;
  animation-fill-mode: both;
}
</style>
