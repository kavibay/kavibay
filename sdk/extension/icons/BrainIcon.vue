<script setup lang="ts">
// SPDX-License-Identifier: MIT
/** Lucide `brain`, with a gently pulsing network trace. */
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
  <IconBase class="lmi-brain" :size="size" :stroke-width="strokeWidth" :animated="animated">
    <g class="lmi-brain-g">
      <path class="lmi-brain-stem" d="M12 18V5" pathLength="1" />
      <path class="lmi-brain-side" d="M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4" pathLength="1" />
      <path class="lmi-brain-top-arc" d="M12 5A3 3 0 1 1 17.598 6.5" pathLength="1" />
      <path class="lmi-brain-top-arc" d="M12 5A3 3 0 1 0 6.402 6.5" pathLength="1" />
      <path d="M17.997 5.125a4 4 0 0 1 2.526 5.77" />
      <path class="lmi-brain-lower-arc" d="M18 18a4 4 0 0 0 2-7.464" pathLength="1" />
      <path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517" />
      <path class="lmi-brain-lower-arc" d="M6 18a4 4 0 0 1-2-7.464" pathLength="1" />
      <path d="M6.003 5.125a4 4 0 0 0-2.526 5.77" />
    </g>
  </IconBase>
</template>

<style>
/* Cyan, with the centre line lit as the part that thinks. Tile colours — see ListTodoIcon.vue for how the host reads them. */
[data-icon-tile]:has(> .lmi-brain) {
  --icon-tile-bg: rgba(34, 211, 238, 0.18);
  --icon-tile-fg: #a5f3fc;
  --lmi-brain-core: #67e8f9;
}

html[data-color-mode="light"] [data-icon-tile]:has(> .lmi-brain) {
  --icon-tile-bg: rgba(8, 145, 178, 0.14);
  --icon-tile-fg: #155e75;
  --lmi-brain-core: #0891b2;
}

.lmi-brain-stem,
.lmi-brain-side {
  stroke: var(--lmi-brain-core, currentColor);
}

/* All animated traces rest in their final, fully drawn state. */
.lmi-brain-stem,
.lmi-brain-side,
.lmi-brain-top-arc,
.lmi-brain-lower-arc {
  stroke-dasharray: 1 1;
  stroke-dashoffset: 0;
}

.lmi-brain-g {
  transform-box: view-box;
  transform-origin: center;
  transform: scale(1);
  stroke-width: 2;
}

@keyframes lmi-brain-stem {
  0% { stroke-dasharray: 1 1; stroke-dashoffset: 0; }
  50% { stroke-dasharray: 0.4 1; stroke-dashoffset: 0.25; }
  100% { stroke-dasharray: 1 1; stroke-dashoffset: 0; }
}

@keyframes lmi-brain-side {
  0% { stroke-dasharray: 1 1; stroke-dashoffset: 0; }
  50% { stroke-dasharray: 0.5 1; stroke-dashoffset: 0.25; }
  100% { stroke-dasharray: 1 1; stroke-dashoffset: 0; }
}

@keyframes lmi-brain-top-arc {
  0% { stroke-dasharray: 1 1; stroke-dashoffset: 0; }
  50% { stroke-dasharray: 0.8 1; stroke-dashoffset: 0.07; }
  100% { stroke-dasharray: 1 1; stroke-dashoffset: 0; }
}

@keyframes lmi-brain-lower-arc {
  0% { stroke-dasharray: 1 1; stroke-dashoffset: 0; }
  50% { stroke-dasharray: 0.8 1; stroke-dashoffset: 0.14; }
  100% { stroke-dasharray: 1 1; stroke-dashoffset: 0; }
}

@keyframes lmi-brain-group {
  0% { transform: scale(1); stroke-width: 2; }
  50% { transform: scale(1.08); stroke-width: 2.25; }
  100% { transform: scale(1); stroke-width: 2; }
}

:is(
  .lmi-brain[data-animated]:hover,
  [data-icon-motion]:hover .lmi-brain[data-animated],
  [data-icon-motion="on"] .lmi-brain[data-animated]
) .lmi-brain-stem {
  animation-name: lmi-brain-stem;
  animation-duration: 1.82s;
  animation-timing-function: ease-in-out;
  animation-iteration-count: infinite;
  animation-direction: alternate;
  animation-fill-mode: both;
}

:is(
  .lmi-brain[data-animated]:hover,
  [data-icon-motion]:hover .lmi-brain[data-animated],
  [data-icon-motion="on"] .lmi-brain[data-animated]
) .lmi-brain-side {
  animation-name: lmi-brain-side;
  animation-duration: 1.82s;
  animation-timing-function: ease-in-out;
  animation-iteration-count: infinite;
  animation-direction: alternate;
  animation-fill-mode: both;
}

:is(
  .lmi-brain[data-animated]:hover,
  [data-icon-motion]:hover .lmi-brain[data-animated],
  [data-icon-motion="on"] .lmi-brain[data-animated]
) .lmi-brain-top-arc {
  animation-name: lmi-brain-top-arc;
  animation-duration: 1.82s;
  animation-timing-function: ease-in-out;
  animation-iteration-count: infinite;
  animation-direction: alternate;
  animation-fill-mode: both;
}

:is(
  .lmi-brain[data-animated]:hover,
  [data-icon-motion]:hover .lmi-brain[data-animated],
  [data-icon-motion="on"] .lmi-brain[data-animated]
) .lmi-brain-lower-arc {
  animation-name: lmi-brain-lower-arc;
  animation-duration: 1.82s;
  animation-timing-function: ease-in-out;
  animation-iteration-count: infinite;
  animation-direction: alternate;
  animation-fill-mode: both;
}

:is(
  .lmi-brain[data-animated]:hover,
  [data-icon-motion]:hover .lmi-brain[data-animated],
  [data-icon-motion="on"] .lmi-brain[data-animated]
) .lmi-brain-g {
  animation-name: lmi-brain-group;
  animation-duration: 1.82s;
  animation-timing-function: ease-in-out;
  animation-iteration-count: infinite;
  animation-direction: alternate;
  animation-fill-mode: both;
}
</style>
