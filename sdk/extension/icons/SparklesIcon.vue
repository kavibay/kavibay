<script setup lang="ts">
// SPDX-License-Identifier: MIT
/** Lucide `sparkles`, with a quick twinkle around the central star. */
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
  <IconBase class="lmi-sparkles" :size="size" :stroke-width="strokeWidth" :animated="animated">
    <g class="lmi-sparkles-g">
      <path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" />
      <path class="lmi-sparkles-twinkle" d="M20 2v4 M22 4h-4" />
      <circle class="lmi-sparkles-twinkle" cx="4" cy="20" r="2" />
    </g>
  </IconBase>
</template>

<style>
/* Resting values are the final animation frame, keeping the static icon exact. */
.lmi-sparkles-twinkle {
  transform-box: fill-box;
  transform-origin: center;
  transform: scale(1);
  opacity: 1;
}

.lmi-sparkles-g {
  transform-box: view-box;
  transform-origin: center;
  transform: scale(1);
}

@keyframes lmi-sparkles-twinkle {
  0% { transform: scale(1); opacity: 1; }
  100% { transform: scale(0); opacity: 0; }
}

@keyframes lmi-sparkles-group {
  0% { transform: scale(1); }
  33.33% { transform: scale(0.9); }
  66.67% { transform: scale(1.1); }
  100% { transform: scale(1); }
}

:is(
  .lmi-sparkles[data-animated]:hover,
  [data-icon-motion]:hover .lmi-sparkles[data-animated],
  [data-icon-motion="on"] .lmi-sparkles[data-animated]
) .lmi-sparkles-twinkle {
  animation-name: lmi-sparkles-twinkle;
  animation-duration: 0.26s;
  animation-timing-function: ease-in-out;
  animation-iteration-count: 2;
  animation-direction: alternate;
  animation-fill-mode: both;
}

:is(
  .lmi-sparkles[data-animated]:hover,
  [data-icon-motion]:hover .lmi-sparkles[data-animated],
  [data-icon-motion="on"] .lmi-sparkles[data-animated]
) .lmi-sparkles-g {
  animation-name: lmi-sparkles-group;
  animation-duration: 0.78s;
  animation-timing-function: ease-in-out;
  animation-fill-mode: both;
}
</style>
