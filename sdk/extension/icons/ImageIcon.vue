<script setup lang="ts">
// SPDX-License-Identifier: MIT
/**
 * Lucide `image`: the ridge draws itself over the peak, then the sun pops in.
 *
 * The ridge is drawn rather than moved. Sliding it up into place was the first
 * instinct, but its lower end sits exactly on the frame's bottom edge and there
 * is nothing clipping the icon — any downward offset would hang outside the
 * frame in the first frames.
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
  <IconBase class="lmi-image" :size="size" :stroke-width="strokeWidth" :animated="animated">
    <!-- The frame stays put: it is the silhouette. -->
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <circle class="lmi-image-sun" cx="9" cy="9" r="2" />
    <!-- Starts at the right edge, climbs to the peak, then runs down the long
         slope — so the dash growing from the path's start traces the ridge the
         way it would be sketched. -->
    <path
      class="lmi-image-ridge"
      d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"
      pathLength="1"
    />
  </IconBase>
</template>

<style>
/* A sunset: orange sky into violet, and a solid sun. Tile colours — see ListTodoIcon.vue for how the host reads them. */
[data-icon-tile]:has(> .lmi-image) {
  --icon-tile-bg: linear-gradient(180deg, rgba(251, 146, 60, 0.3), rgba(139, 92, 246, 0.28));
  --icon-tile-fg: #fed7aa;
  --lmi-image-sun: #fcd34d;
}

html[data-color-mode="light"] [data-icon-tile]:has(> .lmi-image) {
  --icon-tile-bg: linear-gradient(180deg, rgba(251, 146, 60, 0.22), rgba(139, 92, 246, 0.18));
  --icon-tile-fg: #7c2d12;
  --lmi-image-sun: #f59e0b;
}

.lmi-image-sun {
  fill: var(--lmi-image-sun, none);
  stroke: var(--lmi-image-sun, currentColor);
}

/* Resting state is each animation's end state, so the static variant is right
   without the keyframes ever running. */
.lmi-image-ridge {
  opacity: 1;
  stroke-dasharray: 1 1;
  stroke-dashoffset: 0;
}

.lmi-image-sun {
  transform-box: fill-box;
  transform-origin: center;
  transform: scale(1);
  opacity: 1;
  /* Inert until a trigger supplies an animation-name. */
  animation-delay: 0.22s;
}

@keyframes lmi-image-ridge {
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
 * Scales up from small rather than settling down from 1.1 like the dot-sized
 * marks elsewhere in the set. A 2-unit circle is big enough to read the growth,
 * and at that size the shrink-into-place move looks like a wobble instead.
 */
@keyframes lmi-image-sun {
  0% {
    transform: scale(0.4);
    opacity: 0;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

/*
 * Same three ways in as every other animated icon — see ClipboardListIcon.vue.
 * No animation-delay in here: this block out-specifies the delay declarations
 * above and would flatten the sequence onto one start time.
 */
:is(
  .lmi-image[data-animated]:hover,
  [data-icon-motion]:hover .lmi-image[data-animated],
  [data-icon-motion="on"] .lmi-image[data-animated]
)
  .lmi-image-ridge {
  animation-name: lmi-image-ridge;
  animation-duration: 0.48s;
  animation-timing-function: ease-out;
  animation-fill-mode: both;
}

:is(
  .lmi-image[data-animated]:hover,
  [data-icon-motion]:hover .lmi-image[data-animated],
  [data-icon-motion="on"] .lmi-image[data-animated]
)
  .lmi-image-sun {
  animation-name: lmi-image-sun;
  animation-duration: 0.32s;
  /* Overshoots past 1 and settles — what makes it read as a pop. */
  animation-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1);
  animation-fill-mode: both;
}
</style>
