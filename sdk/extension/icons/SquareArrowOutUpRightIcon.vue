<script setup lang="ts">
// SPDX-License-Identifier: MIT
/** Lucide `square-arrow-out-up-right`, with the arrow leaving the box on hover. */
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
    class="lmi-square-arrow-out-up-right"
    :size="size"
    :stroke-width="strokeWidth"
    :animated="animated"
  >
    <path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6" />
    <g class="lmi-square-arrow-out-up-right-arrow">
      <path d="m21 3-9 9" />
      <path d="M15 3h6v6" />
    </g>
  </IconBase>
</template>

<style>
/* The whole point of the glyph is leaving the frame, so the motion is that. */
.lmi-square-arrow-out-up-right-arrow {
  transform-box: fill-box;
  transform: translate(0, 0);
}

@keyframes lmi-square-arrow-out-up-right-arrow {
  0% { transform: translate(0, 0); }
  55% { transform: translate(1.5px, -1.5px); }
  100% { transform: translate(0, 0); }
}

:is(
  .lmi-square-arrow-out-up-right[data-animated]:hover,
  [data-icon-motion]:hover .lmi-square-arrow-out-up-right[data-animated],
  [data-icon-motion="on"] .lmi-square-arrow-out-up-right[data-animated]
) .lmi-square-arrow-out-up-right-arrow {
  animation-name: lmi-square-arrow-out-up-right-arrow;
  animation-duration: 0.5s;
  animation-timing-function: ease-in-out;
  animation-fill-mode: both;
}
</style>
