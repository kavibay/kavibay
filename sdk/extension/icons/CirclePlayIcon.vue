<script setup lang="ts">
// SPDX-License-Identifier: MIT
/**
 * Lucide `circle-play`: the ring draws round from the top, then the triangle
 * pops in — a progress ring completing and handing over to Play.
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
    class="lmi-circle-play"
    :size="size"
    :stroke-width="strokeWidth"
    :animated="animated"
  >
    <circle class="lmi-circle-play-ring" cx="12" cy="12" r="10" pathLength="1" />
    <path
      class="lmi-circle-play-tri"
      d="M9 9.003a1 1 0 0 1 1.517-.859l4.997 2.997a1 1 0 0 1 0 1.718l-4.997 2.997A1 1 0 0 1 9 14.996z"
    />
  </IconBase>
</template>

<style>
/*
 * Resting state is each animation's end state. The ring's quarter-turn is part
 * of that rest: an SVG circle starts its dash at 3 o'clock, and a progress ring
 * that fills from the right reads as broken. Rotating the shape moves where the
 * dash begins without moving the shape — a circle looks identical either way.
 */
.lmi-circle-play-ring {
  transform-box: fill-box;
  transform-origin: center;
  transform: rotate(-90deg);
  opacity: 1;
  stroke-dasharray: 1 1;
  stroke-dashoffset: 0;
}

.lmi-circle-play-tri {
  transform-box: fill-box;
  transform-origin: center;
  transform: scale(1);
  opacity: 1;
  /* Inert until a trigger supplies an animation-name. */
  animation-delay: 0.22s;
}

@keyframes lmi-circle-play-ring {
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

/* Scales up rather than settling down from 1.1: the triangle is the biggest
   mark in the icon, and shrinking into place at that size reads as a wobble. */
@keyframes lmi-circle-play-tri {
  0% {
    transform: scale(0.3);
    opacity: 0;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

/*
 * Same three ways in as every other animated icon — see ClipboardListIcon.vue.
 * No animation-delay in here: this block out-specifies the delay declaration
 * above and would start the triangle with the ring.
 */
:is(
  .lmi-circle-play[data-animated]:hover,
  [data-icon-motion]:hover .lmi-circle-play[data-animated],
  [data-icon-motion="on"] .lmi-circle-play[data-animated]
)
  .lmi-circle-play-ring {
  animation-name: lmi-circle-play-ring;
  animation-duration: 0.5s;
  animation-timing-function: ease-out;
  animation-fill-mode: both;
}

:is(
  .lmi-circle-play[data-animated]:hover,
  [data-icon-motion]:hover .lmi-circle-play[data-animated],
  [data-icon-motion="on"] .lmi-circle-play[data-animated]
)
  .lmi-circle-play-tri {
  animation-name: lmi-circle-play-tri;
  animation-duration: 0.34s;
  /* Overshoots past 1 and settles — what makes it read as a press. */
  animation-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1);
  animation-fill-mode: both;
}
</style>
