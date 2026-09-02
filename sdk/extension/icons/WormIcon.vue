<script setup lang="ts">
// SPDX-License-Identifier: MIT
/** Lucide `worm`, with a compact side-to-side slither. */
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
  <IconBase class="lmi-worm" :size="size" :stroke-width="strokeWidth" :animated="animated">
    <!-- The original paths are a single continuous outline, so move them as a
         group rather than splitting the drawing and changing its silhouette. -->
    <g class="lmi-worm-g">
      <path d="m19 12-1.5 3" />
      <path d="M19.63 18.81 22 20" />
      <path d="M6.47 8.23a1.68 1.68 0 0 1 2.44 1.93l-.64 2.08a6.76 6.76 0 0 0 10.16 7.67l.42-.27a1 1 0 1 0-2.73-4.21l-.42.27a1.76 1.76 0 0 1-2.63-1.99l.64-2.08A6.66 6.66 0 0 0 3.94 3.9l-.7.4a1 1 0 1 0 2.55 4.34z" />
    </g>
  </IconBase>
</template>

<style>
/* The final keyframe is the untouched Lucide geometry, which is also the
   correct rendering whenever animation is disabled. */
.lmi-worm-g {
  transform-box: view-box;
  transform-origin: center;
  transform: translate(0, 0) rotate(0deg);
}

@keyframes lmi-worm-slither {
  0% { transform: translate(0, 0) rotate(0deg); }
  25% { transform: translate(0.6px, -0.35px) rotate(2deg); }
  50% { transform: translate(-0.6px, 0.35px) rotate(-2deg); }
  75% { transform: translate(0.4px, -0.2px) rotate(1deg); }
  100% { transform: translate(0, 0) rotate(0deg); }
}

:is(
  .lmi-worm[data-animated]:hover,
  [data-icon-motion]:hover .lmi-worm[data-animated],
  [data-icon-motion="on"] .lmi-worm[data-animated]
) .lmi-worm-g {
  animation-name: lmi-worm-slither;
  animation-duration: 0.62s;
  animation-timing-function: ease-in-out;
  animation-fill-mode: both;
}
</style>
