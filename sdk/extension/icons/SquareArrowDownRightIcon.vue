<script setup lang="ts">
// SPDX-License-Identifier: MIT
/** Lucide `square-arrow-down-right`, with the arrow moving into the box on hover. */
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
  <IconBase
    class="lmi-square-arrow-down-right"
    :size="size"
    :stroke-width="strokeWidth"
    :animated="animated"
  >
    <g class="lmi-square-arrow-down-right-arrow">
      <path d="M15 15 9 9" />
      <path d="M9 15h6V9" />
    </g>
    <rect x="3" y="3" width="18" height="18" rx="2" />
  </IconBase>
</template>

<style>
/* Counterpart to the pop-out icon: there the arrow leaves, here it arrives. */
.lmi-square-arrow-down-right-arrow {
  transform-box: fill-box;
  transform: translate(0, 0);
}

@keyframes lmi-square-arrow-down-right-arrow {
  0% { transform: translate(-1.5px, -1.5px); }
  55% { transform: translate(1px, 1px); }
  100% { transform: translate(0, 0); }
}

:is(
  .lmi-square-arrow-down-right[data-animated]:hover,
  [data-icon-motion]:hover .lmi-square-arrow-down-right[data-animated],
  [data-icon-motion="on"] .lmi-square-arrow-down-right[data-animated]
) .lmi-square-arrow-down-right-arrow {
  animation-name: lmi-square-arrow-down-right-arrow;
  animation-duration: 0.5s;
  animation-timing-function: ease-in-out;
  animation-fill-mode: both;
}
</style>
