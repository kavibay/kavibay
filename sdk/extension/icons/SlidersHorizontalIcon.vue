<script setup lang="ts">
// SPDX-License-Identifier: MIT
/**
 * Lucide `sliders-horizontal`: the tracks draw in, then each knob slides to its
 * setting.
 *
 * Upstream calls this one un-reproducible in CSS, and for their version it is:
 * sliding a knob means the two track segments around it have to grow and shrink,
 * which is path geometry, not a transform.
 *
 * It works here because of a detail of how Lucide draws the icon. Every row has
 * a four-unit gap of bare track, with the knob sitting against one end of it —
 * left in row two, right in rows one and three. So each knob can be started at
 * the far side of its own gap and translated the four units home: the travel is
 * exactly the empty stretch, the knob never crosses a drawn segment, and the
 * geometry is never touched.
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
    class="lmi-sliders-h"
    :size="size"
    :stroke-width="strokeWidth"
    :animated="animated"
  >
    <!-- Grouped by row rather than in Lucide's source order, so each row's two
         segments and its knob sit together. -->
    <path class="lmi-sliders-h-track" d="M10 5H3" pathLength="1" />
    <path class="lmi-sliders-h-track" d="M21 5h-7" pathLength="1" />
    <path class="lmi-sliders-h-track lmi-sliders-h-t2" d="M8 12H3" pathLength="1" />
    <path class="lmi-sliders-h-track lmi-sliders-h-t2" d="M21 12h-9" pathLength="1" />
    <path class="lmi-sliders-h-track lmi-sliders-h-t3" d="M12 19H3" pathLength="1" />
    <path class="lmi-sliders-h-track lmi-sliders-h-t3" d="M21 19h-5" pathLength="1" />
    <path class="lmi-sliders-h-knob" d="M14 3v4" />
    <path class="lmi-sliders-h-knob lmi-sliders-h-k2" d="M8 10v4" />
    <path class="lmi-sliders-h-knob lmi-sliders-h-k3" d="M16 17v4" />
  </IconBase>
</template>

<style>
/* Resting state is each animation's end state, so the static variant is right
   without the keyframes ever running. */
.lmi-sliders-h-track {
  opacity: 1;
  stroke-dasharray: 1 1;
  stroke-dashoffset: 0;
}

/*
 * `--from` is where the knob starts, and it is per-knob because the gap is not
 * always on the same side. Rows one and three have their bare track to the
 * left, row two to the right.
 */
.lmi-sliders-h-knob {
  --lmi-from: -4px;
  transform: translateX(0);
  opacity: 1;
  animation-delay: 0.18s;
}

/* Inert until a trigger supplies an animation-name. */
.lmi-sliders-h-t2 {
  animation-delay: 0.07s;
}

.lmi-sliders-h-t3 {
  animation-delay: 0.14s;
}

.lmi-sliders-h-k2 {
  --lmi-from: 4px;
  animation-delay: 0.25s;
}

.lmi-sliders-h-k3 {
  animation-delay: 0.32s;
}

@keyframes lmi-sliders-h-track {
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

/*
 * The offset is read from a custom property, which lets one keyframe serve
 * knobs travelling in opposite directions. It never changes mid-animation, so
 * there is nothing here that needs interpolating.
 */
@keyframes lmi-sliders-h-knob {
  0% {
    transform: translateX(var(--lmi-from));
    opacity: 0;
  }
  35% {
    opacity: 1;
  }
  100% {
    transform: translateX(0);
    opacity: 1;
  }
}

/*
 * Same three ways in as every other animated icon — see ClipboardListIcon.vue.
 * No animation-delay in here: this block out-specifies the delay declarations
 * above and would flatten the sequence onto one start time.
 */
:is(
  .lmi-sliders-h[data-animated]:hover,
  [data-icon-motion]:hover .lmi-sliders-h[data-animated],
  [data-icon-motion="on"] .lmi-sliders-h[data-animated]
)
  .lmi-sliders-h-track {
  animation-name: lmi-sliders-h-track;
  animation-duration: 0.28s;
  animation-timing-function: ease-out;
  animation-fill-mode: both;
}

:is(
  .lmi-sliders-h[data-animated]:hover,
  [data-icon-motion]:hover .lmi-sliders-h[data-animated],
  [data-icon-motion="on"] .lmi-sliders-h[data-animated]
)
  .lmi-sliders-h-knob {
  animation-name: lmi-sliders-h-knob;
  animation-duration: 0.4s;
  /* Settles into the detent rather than stopping dead. */
  animation-timing-function: cubic-bezier(0.22, 0.9, 0.3, 1);
  animation-fill-mode: both;
}
</style>
