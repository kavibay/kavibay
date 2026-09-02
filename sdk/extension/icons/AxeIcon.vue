<script setup lang="ts">
// SPDX-License-Identifier: MIT
/** Lucide `axe`, with a short swing on hover. */
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
  <IconBase class="lmi-axe" :size="size" :stroke-width="strokeWidth" :animated="animated">
    <g class="lmi-axe-g">
      <path d="m14 12-8.381 8.38a1 1 0 0 1-3.001-3L11 9" />
      <path d="M15 15.5a.5.5 0 0 0 .5.5A6.5 6.5 0 0 0 22 9.5a.5.5 0 0 0-.5-.5h-1.672a2 2 0 0 1-1.414-.586l-5.062-5.062a1.205 1.205 0 0 0-1.704 0L9.352 5.648a1.205 1.205 0 0 0 0 1.704l5.062 5.062A2 2 0 0 1 15 13.828z" />
    </g>
  </IconBase>
</template>

<style>
.lmi-axe-g {
  transform-box: view-box;
  transform-origin: bottom left;
  transform: rotate(0deg);
}

@keyframes lmi-axe-group {
  0% { transform: rotate(0deg); }
  33.33% { transform: rotate(25deg); }
  66.67% { transform: rotate(-5deg); }
  100% { transform: rotate(0deg); }
}

:is(
  .lmi-axe[data-animated]:hover,
  [data-icon-motion]:hover .lmi-axe[data-animated],
  [data-icon-motion="on"] .lmi-axe[data-animated]
) .lmi-axe-g {
  animation: lmi-axe-group 0.39s ease both;
}
</style>
