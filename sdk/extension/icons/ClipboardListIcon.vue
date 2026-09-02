<script setup lang="ts">
// SPDX-License-Identifier: MIT
/** Lucide `clipboard-list`, with the four list strokes drawing on in sequence. */
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
    class="lmi-clipboard-list"
    :size="size"
    :stroke-width="strokeWidth"
    :animated="animated"
  >
    <rect class="lmi-clipboard-list-rect" x="8" y="2" width="8" height="4" rx="1" ry="1" />
    <path
      class="lmi-clipboard-list-path1"
      d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"
    />
    <!-- pathLength normalizes each stroke to 1 unit, so one set of keyframes
         draws a dot and a line at the same rate. Case matters: SVG attribute
         names are not lowercased the way HTML ones are. -->
    <path class="lmi-clipboard-list-line" d="M8 11h.01" pathLength="1" />
    <path class="lmi-clipboard-list-line lmi-clipboard-list-d2" d="M12 11h4" pathLength="1" />
    <path class="lmi-clipboard-list-line lmi-clipboard-list-d3" d="M8 16h.01" pathLength="1" />
    <path class="lmi-clipboard-list-line lmi-clipboard-list-d4" d="M12 16h4" pathLength="1" />
  </IconBase>
</template>

<style>
/*
 * Resting state is deliberately the animation's *end* state. The static variant
 * is therefore correct on its own, and nothing has to be undone when the
 * keyframes never run — which is the normal case.
 */
.lmi-clipboard-list-line {
  transform-box: fill-box;
  transform-origin: center;
  transform: scale(1);
  opacity: 1;
  stroke-dasharray: 1 1;
  stroke-dashoffset: 0;
}

/* Inert until something sets an animation-name, so they can live out here
   instead of being repeated under every trigger. */
.lmi-clipboard-list-d2 {
  animation-delay: 0.26s;
}

.lmi-clipboard-list-d3 {
  animation-delay: 0.65s;
}

.lmi-clipboard-list-d4 {
  animation-delay: 0.91s;
}

@keyframes lmi-clipboard-list-draw {
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

/*
 * Three ways in, because the icon rarely owns the gesture that should play it:
 *   1. the icon itself is hovered      — standalone use, e.g. a toolbar button
 *   2. an ancestor marked [data-icon-motion] is hovered
 *   3. an ancestor carries data-icon-motion="on" — state-driven, which is what
 *      the palette uses: its rows select on mouseenter, so the same attribute
 *      covers arrowing through the list as well as pointing at it
 *
 * Longhands, not the `animation` shorthand: the shorthand would reset the
 * per-stroke delays declared above back to zero.
 */
:is(
  .lmi-clipboard-list[data-animated]:hover,
  [data-icon-motion]:hover .lmi-clipboard-list[data-animated],
  [data-icon-motion="on"] .lmi-clipboard-list[data-animated]
)
  .lmi-clipboard-list-line {
  animation-name: lmi-clipboard-list-draw;
  animation-duration: 0.52s;
  animation-timing-function: ease-in-out;
  animation-fill-mode: both;
}
</style>
