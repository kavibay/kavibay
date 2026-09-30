<script setup lang="ts">
// SPDX-License-Identifier: MIT
/** Lucide `layout-grid`, with its four cells briefly meeting in the middle. */
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
  <IconBase class="lmi-layout-grid" :size="size" :stroke-width="strokeWidth" :animated="animated">
    <rect class="lmi-layout-grid-cell-1" rx="1" x="3" y="3" width="7" height="7" />
    <rect class="lmi-layout-grid-cell-2" rx="1" x="14" y="3" width="7" height="7" />
    <rect class="lmi-layout-grid-cell-3" rx="1" x="14" y="14" width="7" height="7" />
    <rect class="lmi-layout-grid-cell-4" rx="1" x="3" y="14" width="7" height="7" />
  </IconBase>
</template>

<style>
/* A home screen: four solid app icons, one colour each. Tile colours — see ListTodoIcon.vue for how the host reads them. */
[data-icon-tile]:has(> .lmi-layout-grid) {
  --icon-tile-bg: rgba(var(--fg-rgb), 0.1);
  --lmi-launcher-1: #38bdf8;
  --lmi-launcher-2: #fb7185;
  --lmi-launcher-3: #a3e635;
  --lmi-launcher-4: #a78bfa;
}

html[data-color-mode="light"] [data-icon-tile]:has(> .lmi-layout-grid) {
  --lmi-launcher-1: #0284c7;
  --lmi-launcher-2: #e11d48;
  --lmi-launcher-3: #65a30d;
  --lmi-launcher-4: #7c3aed;
}

.lmi-layout-grid-cell-1 {
  --lmi-launcher: var(--lmi-launcher-1);
}

.lmi-layout-grid-cell-2 {
  --lmi-launcher: var(--lmi-launcher-2);
}

.lmi-layout-grid-cell-3 {
  --lmi-launcher: var(--lmi-launcher-3);
}

.lmi-layout-grid-cell-4 {
  --lmi-launcher: var(--lmi-launcher-4);
}

.lmi-layout-grid rect {
  fill: var(--lmi-launcher, none);
  stroke: var(--lmi-launcher, currentColor);
}

/* The untouched grid is the final frame and therefore the static rendering. */
.lmi-layout-grid-cell-1,
.lmi-layout-grid-cell-2,
.lmi-layout-grid-cell-3,
.lmi-layout-grid-cell-4 {
  transform: translate(0px, 0px);
}

@keyframes lmi-layout-grid-cell-1 {
  0% { transform: translate(0px, 0px); }
  40%, 60% { transform: translate(11px, 0px); }
  100% { transform: translate(0px, 0px); }
}

@keyframes lmi-layout-grid-cell-2 {
  0% { transform: translate(0px, 0px); }
  40%, 60% { transform: translate(0px, 11px); }
  100% { transform: translate(0px, 0px); }
}

@keyframes lmi-layout-grid-cell-3 {
  0% { transform: translate(0px, 0px); }
  40%, 60% { transform: translate(-11px, 0px); }
  100% { transform: translate(0px, 0px); }
}

@keyframes lmi-layout-grid-cell-4 {
  0% { transform: translate(0px, 0px); }
  40%, 60% { transform: translate(0px, -11px); }
  100% { transform: translate(0px, 0px); }
}

:is(
  .lmi-layout-grid[data-animated]:hover,
  [data-icon-motion]:hover .lmi-layout-grid[data-animated],
  [data-icon-motion="on"] .lmi-layout-grid[data-animated]
) .lmi-layout-grid-cell-1 {
  animation-name: lmi-layout-grid-cell-1;
  animation-duration: 1.04s;
  animation-timing-function: ease-in-out;
  animation-fill-mode: both;
}

:is(
  .lmi-layout-grid[data-animated]:hover,
  [data-icon-motion]:hover .lmi-layout-grid[data-animated],
  [data-icon-motion="on"] .lmi-layout-grid[data-animated]
) .lmi-layout-grid-cell-2 {
  animation-name: lmi-layout-grid-cell-2;
  animation-duration: 1.04s;
  animation-timing-function: ease-in-out;
  animation-fill-mode: both;
}

:is(
  .lmi-layout-grid[data-animated]:hover,
  [data-icon-motion]:hover .lmi-layout-grid[data-animated],
  [data-icon-motion="on"] .lmi-layout-grid[data-animated]
) .lmi-layout-grid-cell-3 {
  animation-name: lmi-layout-grid-cell-3;
  animation-duration: 1.04s;
  animation-timing-function: ease-in-out;
  animation-fill-mode: both;
}

:is(
  .lmi-layout-grid[data-animated]:hover,
  [data-icon-motion]:hover .lmi-layout-grid[data-animated],
  [data-icon-motion="on"] .lmi-layout-grid[data-animated]
) .lmi-layout-grid-cell-4 {
  animation-name: lmi-layout-grid-cell-4;
  animation-duration: 1.04s;
  animation-timing-function: ease-in-out;
  animation-fill-mode: both;
}
</style>
