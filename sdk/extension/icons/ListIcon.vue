<script setup lang="ts">
// SPDX-License-Identifier: MIT
/** Lucide `list`, with its bullets and rows drawing on in sequence. */
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
  <IconBase class="lmi-list" :size="size" :stroke-width="strokeWidth" :animated="animated">
    <path class="lmi-list-item" d="M3 5h.01" pathLength="1" />
    <path class="lmi-list-item lmi-list-d2" d="M8 5h13" pathLength="1" />
    <path class="lmi-list-item lmi-list-d3" d="M3 12h.01" pathLength="1" />
    <path class="lmi-list-item lmi-list-d4" d="M8 12h13" pathLength="1" />
    <path class="lmi-list-item lmi-list-d5" d="M3 19h.01" pathLength="1" />
    <path class="lmi-list-item lmi-list-d6" d="M8 19h13" pathLength="1" />
  </IconBase>
</template>

<style>
/* End values match the static Lucide list. Delays stay inert until the trigger
   sets animation-name, so they can be shared without shorthand resets. */
.lmi-list-item {
  transform-box: fill-box;
  transform-origin: center;
  transform: scale(1);
  opacity: 1;
  stroke-dasharray: 1 1;
  stroke-dashoffset: 0;
}

.lmi-list-d2 { animation-delay: 0.26s; }
.lmi-list-d3 { animation-delay: 0.52s; }
.lmi-list-d4 { animation-delay: 0.78s; }
.lmi-list-d5 { animation-delay: 1.04s; }
.lmi-list-d6 { animation-delay: 1.3s; }

@keyframes lmi-list-draw {
  0% {
    transform: scale(1.1);
    opacity: 0;
    stroke-dasharray: 0 1;
    stroke-dashoffset: 0;
  }
  100% {
    transform: scale(1);
    opacity: 1;
    stroke-dasharray: 1 1;
    stroke-dashoffset: 0;
  }
}

:is(
  .lmi-list[data-animated]:hover,
  [data-icon-motion]:hover .lmi-list[data-animated],
  [data-icon-motion="on"] .lmi-list[data-animated]
) .lmi-list-item {
  animation-name: lmi-list-draw;
  animation-duration: 0.52s;
  animation-timing-function: ease-in-out;
  animation-fill-mode: both;
}
</style>
