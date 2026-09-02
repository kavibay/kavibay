<script setup lang="ts">
// SPDX-License-Identifier: MIT
/**
 * Lucide `calendar-days`, with the six day marks sweeping in left to right.
 *
 * Upstream has no no-JS export for this one — its motion variant is generated
 * at runtime and would pull in `@respeak/lucide-motion-vue` plus `motion-v` and
 * `flubber`. The motion here is written against the same geometry in the CSS
 * the rest of the set uses, which keeps the dependency count and the licence
 * situation unchanged (see THIRD-PARTY-NOTICES.md).
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
    class="lmi-calendar-days"
    :size="size"
    :stroke-width="strokeWidth"
    :animated="animated"
  >
    <path d="M8 2v4" />
    <path d="M16 2v4" />
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M3 10h18" />
    <!-- pathLength normalizes every mark to 1 unit so one keyframe drives them
         all. Case matters: SVG attribute names are not lowercased. -->
    <path class="lmi-calendar-days-dot" d="M8 14h.01" pathLength="1" />
    <path class="lmi-calendar-days-dot lmi-calendar-days-d2" d="M12 14h.01" pathLength="1" />
    <path class="lmi-calendar-days-dot lmi-calendar-days-d3" d="M16 14h.01" pathLength="1" />
    <path class="lmi-calendar-days-dot lmi-calendar-days-d4" d="M8 18h.01" pathLength="1" />
    <path class="lmi-calendar-days-dot lmi-calendar-days-d5" d="M12 18h.01" pathLength="1" />
    <path class="lmi-calendar-days-dot lmi-calendar-days-d6" d="M16 18h.01" pathLength="1" />
  </IconBase>
</template>

<style>
/* Resting state is the animation's end state, so the static variant needs no
   undoing when the keyframes never run. */
.lmi-calendar-days-dot {
  transform-box: fill-box;
  transform-origin: center;
  transform: scale(1);
  opacity: 1;
  stroke-dasharray: 1 1;
  stroke-dashoffset: 0;
}

/*
 * Reading order, not source order: across the top row, then across the bottom.
 * Tighter than the four-stroke icons — six marks at that spacing would drag.
 * Inert until a trigger supplies an animation-name.
 */
.lmi-calendar-days-d2 {
  animation-delay: 0.08s;
}

.lmi-calendar-days-d3 {
  animation-delay: 0.16s;
}

.lmi-calendar-days-d4 {
  animation-delay: 0.24s;
}

.lmi-calendar-days-d5 {
  animation-delay: 0.32s;
}

.lmi-calendar-days-d6 {
  animation-delay: 0.4s;
}

@keyframes lmi-calendar-days-draw {
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

/* Same three ways in as every other animated icon in the set — see
   ClipboardListIcon.vue for why the icon's own :hover is not enough. */
:is(
  .lmi-calendar-days[data-animated]:hover,
  [data-icon-motion]:hover .lmi-calendar-days[data-animated],
  [data-icon-motion="on"] .lmi-calendar-days[data-animated]
)
  .lmi-calendar-days-dot {
  animation-name: lmi-calendar-days-draw;
  animation-duration: 0.4s;
  animation-timing-function: ease-in-out;
  animation-fill-mode: both;
}
</style>
