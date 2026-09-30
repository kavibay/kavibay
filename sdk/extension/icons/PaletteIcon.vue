<script setup lang="ts">
// SPDX-License-Identifier: MIT
/** Lucide `palette`. */
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
  <IconBase class="lmi-palette" :size="size" :stroke-width="strokeWidth" :animated="animated">
    <path
      d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"
    />
    <!-- Lucide draws the wells as filled dots, not stroked rings. -->
    <!-- Listed clockwise from the left, so the stagger runs 1..4 down the file. -->
    <circle class="lmi-palette-dot lmi-palette-d1" cx="6.5" cy="12.5" r=".5" fill="currentColor" />
    <circle class="lmi-palette-dot lmi-palette-d2" cx="8.5" cy="7.5" r=".5" fill="currentColor" />
    <circle class="lmi-palette-dot lmi-palette-d3" cx="13.5" cy="6.5" r=".5" fill="currentColor" />
    <circle class="lmi-palette-dot lmi-palette-d4" cx="17.5" cy="10.5" r=".5" fill="currentColor" />
  </IconBase>
</template>

<style>
/* A painter's palette with four real paints on it. Tile colours — see ListTodoIcon.vue for how the host reads them. */
[data-icon-tile]:has(> .lmi-palette) {
  --icon-tile-bg: rgba(236, 72, 153, 0.16);
  --icon-tile-fg: #fbcfe8;
  --lmi-paint-1: #f87171;
  --lmi-paint-2: #facc15;
  --lmi-paint-3: #60a5fa;
  --lmi-paint-4: #4ade80;
}

html[data-color-mode="light"] [data-icon-tile]:has(> .lmi-palette) {
  --icon-tile-bg: rgba(236, 72, 153, 0.12);
  --icon-tile-fg: #9d174d;
  --lmi-paint-1: #dc2626;
  --lmi-paint-2: #ca8a04;
  --lmi-paint-3: #2563eb;
  --lmi-paint-4: #16a34a;
}

.lmi-palette-d1 {
  --lmi-paint: var(--lmi-paint-1);
}

.lmi-palette-d2 {
  --lmi-paint: var(--lmi-paint-2);
  animation-delay: 0.06s;
}

.lmi-palette-d3 {
  --lmi-paint: var(--lmi-paint-3);
  animation-delay: 0.12s;
}

.lmi-palette-d4 {
  --lmi-paint: var(--lmi-paint-4);
  animation-delay: 0.18s;
}

/* Resting state is the animation's end state, so the static icon is exact. */
.lmi-palette-dot {
  fill: var(--lmi-paint, currentColor);
  stroke: var(--lmi-paint, currentColor);
  transform-box: fill-box;
  transform-origin: center;
  transform: scale(1);
}

/* A dab of paint lands on each well. */
@keyframes lmi-palette-dab {
  0% { transform: scale(0); }
  100% { transform: scale(1); }
}

/* Same three ways in as every other animated icon — see ClipboardListIcon.vue.
   No animation-delay in the trigger blocks: it would flatten the stagger. */
:is(
  .lmi-palette[data-animated]:hover,
  [data-icon-motion]:hover .lmi-palette[data-animated],
  [data-icon-motion="on"] .lmi-palette[data-animated]
)
  .lmi-palette-dot {
  animation-name: lmi-palette-dab;
  animation-duration: 0.3s;
  animation-timing-function: cubic-bezier(0.3, 1.6, 0.5, 1);
  animation-fill-mode: both;
}
</style>
