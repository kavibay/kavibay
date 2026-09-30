<script setup lang="ts">
// SPDX-License-Identifier: MIT
/**
 * Lucide `calculator`: the display draws on, then the keypad fills in reading
 * order, and the tall key draws down last.
 *
 * Three motions rather than one stagger, because the shapes are not peers — a
 * screen switching on and a key appearing are different events, and running
 * them on one curve flattens that back into a shimmer.
 */
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
    class="lmi-calculator"
    :size="size"
    :stroke-width="strokeWidth"
    :animated="animated"
  >
    <!-- Case stays put: it is the silhouette, and at 16px a moving outline
         stops being a calculator. -->
    <rect x="4" y="2" width="16" height="20" rx="2" />
    <line class="lmi-calculator-screen" x1="8" x2="16" y1="6" y2="6" pathLength="1" />
    <!-- Keys are listed in reading order rather than Lucide's source order, so
         the stagger classes run 1..7 down the file instead of jumping around. -->
    <path class="lmi-calculator-key lmi-calculator-k1" d="M8 10h.01" pathLength="1" />
    <path class="lmi-calculator-key lmi-calculator-k2" d="M12 10h.01" pathLength="1" />
    <path class="lmi-calculator-key lmi-calculator-k3" d="M16 10h.01" pathLength="1" />
    <path class="lmi-calculator-key lmi-calculator-k4" d="M8 14h.01" pathLength="1" />
    <path class="lmi-calculator-key lmi-calculator-k5" d="M12 14h.01" pathLength="1" />
    <path class="lmi-calculator-key lmi-calculator-k6" d="M8 18h.01" pathLength="1" />
    <path class="lmi-calculator-key lmi-calculator-k7" d="M12 18h.01" pathLength="1" />
    <!-- Drawn top-down: the dash grows from the start point, which is y=14. -->
    <line class="lmi-calculator-bar" x1="16" x2="16" y1="14" y2="18" pathLength="1" />
  </IconBase>
</template>

<style>
/* Orange, with the operator column lit. Tile colours — see ListTodoIcon.vue for how the host reads them. */
[data-icon-tile]:has(> .lmi-calculator) {
  --icon-tile-bg: rgba(216, 90, 48, 0.22);
  --icon-tile-fg: #f5c4b3;
  --lmi-calc-op: #ffb38a;
}

html[data-color-mode="light"] [data-icon-tile]:has(> .lmi-calculator) {
  --icon-tile-bg: rgba(216, 90, 48, 0.14);
  --icon-tile-fg: #712b13;
  --lmi-calc-op: #d85a30;
}

.lmi-calculator-k3,
.lmi-calculator-bar {
  stroke: var(--lmi-calc-op, currentColor);
}

/* Resting state is each animation's end state, so the static variant is right
   without the keyframes ever running. */
.lmi-calculator-screen,
.lmi-calculator-bar {
  opacity: 1;
  stroke-dasharray: 1 1;
  stroke-dashoffset: 0;
}

.lmi-calculator-key {
  transform-box: fill-box;
  transform-origin: center;
  transform: scale(1);
  opacity: 1;
  stroke-dasharray: 1 1;
  stroke-dashoffset: 0;
}

/*
 * Inert until a trigger supplies an animation-name. Key 1 carries its own class
 * rather than inheriting a base delay from the trigger block: that block is a
 * more specific selector, so a delay declared there would flatten every key
 * onto the same start time.
 */
.lmi-calculator-k1 {
  animation-delay: 0.15s;
}

.lmi-calculator-k2 {
  animation-delay: 0.21s;
}

.lmi-calculator-k3 {
  animation-delay: 0.27s;
}

.lmi-calculator-k4 {
  animation-delay: 0.33s;
}

.lmi-calculator-k5 {
  animation-delay: 0.39s;
}

.lmi-calculator-k6 {
  animation-delay: 0.45s;
}

.lmi-calculator-k7 {
  animation-delay: 0.51s;
}

.lmi-calculator-bar {
  animation-delay: 0.5s;
}

/* Sweeps along the stroke: dash grows from the shape's start point. */
@keyframes lmi-calculator-draw {
  0% {
    opacity: 0;
    stroke-dasharray: 0 1;
    stroke-dashoffset: 0;
  }
  100% {
    opacity: 1;
    stroke-dasharray: 1 1;
    stroke-dashoffset: 0;
  }
}

/* Lands in place — a key does not sweep, it appears. */
@keyframes lmi-calculator-key {
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

/* Same three ways in as every other animated icon — see ClipboardListIcon.vue
   for why the icon's own :hover is not enough. */
:is(
  .lmi-calculator[data-animated]:hover,
  [data-icon-motion]:hover .lmi-calculator[data-animated],
  [data-icon-motion="on"] .lmi-calculator[data-animated]
)
  :is(.lmi-calculator-screen, .lmi-calculator-bar) {
  animation-name: lmi-calculator-draw;
  animation-duration: 0.34s;
  animation-timing-function: ease-out;
  animation-fill-mode: both;
}

:is(
  .lmi-calculator[data-animated]:hover,
  [data-icon-motion]:hover .lmi-calculator[data-animated],
  [data-icon-motion="on"] .lmi-calculator[data-animated]
)
  .lmi-calculator-key {
  animation-name: lmi-calculator-key;
  animation-duration: 0.3s;
  animation-timing-function: ease-in-out;
  animation-fill-mode: both;
}
</style>
