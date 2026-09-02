<script setup lang="ts">
// SPDX-License-Identifier: MIT
/**
 * Lucide `cloud-sun-rain`. Sun rays flick on, then the two drops fall in.
 *
 * Upstream has no no-JS export for this one; the motion is written here in the
 * same CSS the rest of the set uses rather than pulling in the runtime package
 * (see CalendarDaysIcon.vue and THIRD-PARTY-NOTICES.md).
 *
 * Two motions, not one: rays are light and appear in place, drops have a
 * direction. Giving both the same pop would read as the whole icon flickering.
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
    class="lmi-cloud-sun-rain"
    :size="size"
    :stroke-width="strokeWidth"
    :animated="animated"
  >
    <path class="lmi-cloud-sun-rain-ray" d="M12 2v2" pathLength="1" />
    <path
      class="lmi-cloud-sun-rain-ray lmi-cloud-sun-rain-r2"
      d="m4.93 4.93 1.41 1.41"
      pathLength="1"
    />
    <path class="lmi-cloud-sun-rain-ray lmi-cloud-sun-rain-r3" d="M20 12h2" pathLength="1" />
    <path
      class="lmi-cloud-sun-rain-ray lmi-cloud-sun-rain-r4"
      d="m19.07 4.93-1.41 1.41"
      pathLength="1"
    />
    <!-- Sun disc and cloud stay put: they are the icon's identity, and a
         silhouette that moves stops being recognisable at 16px. -->
    <path d="M15.947 12.65a4 4 0 0 0-5.925-4.128" />
    <path d="M3 20a5 5 0 1 1 8.9-4H13a3 3 0 0 1 2 5.24" />
    <path class="lmi-cloud-sun-rain-drop" d="M7 19v2" />
    <path class="lmi-cloud-sun-rain-drop lmi-cloud-sun-rain-d2" d="M11 20v2" />
  </IconBase>
</template>

<style>
/* Resting state is each animation's end state, so the static variant is
   correct without the keyframes ever running. */
.lmi-cloud-sun-rain-ray {
  transform-box: fill-box;
  transform-origin: center;
  transform: scale(1);
  opacity: 1;
  stroke-dasharray: 1 1;
  stroke-dashoffset: 0;
}

.lmi-cloud-sun-rain-drop {
  transform: translateY(0);
  opacity: 1;
}

/* Inert until a trigger supplies an animation-name. */
.lmi-cloud-sun-rain-r2 {
  animation-delay: 0.07s;
}

.lmi-cloud-sun-rain-r3 {
  animation-delay: 0.14s;
}

.lmi-cloud-sun-rain-r4 {
  animation-delay: 0.21s;
}

.lmi-cloud-sun-rain-drop {
  animation-delay: 0.3s;
}

.lmi-cloud-sun-rain-d2 {
  animation-delay: 0.4s;
}

@keyframes lmi-cloud-sun-rain-ray {
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
 * Distance in user units, not px: a transform on an SVG element works in the
 * local coordinate system, so the fall stays proportional at every size.
 */
@keyframes lmi-cloud-sun-rain-drop {
  0% {
    transform: translateY(-3px);
    opacity: 0;
  }
  60% {
    opacity: 1;
  }
  100% {
    transform: translateY(0);
    opacity: 1;
  }
}

/* Same three ways in as every other animated icon — see ClipboardListIcon.vue
   for why the icon's own :hover is not enough. */
:is(
  .lmi-cloud-sun-rain[data-animated]:hover,
  [data-icon-motion]:hover .lmi-cloud-sun-rain[data-animated],
  [data-icon-motion="on"] .lmi-cloud-sun-rain[data-animated]
)
  .lmi-cloud-sun-rain-ray {
  animation-name: lmi-cloud-sun-rain-ray;
  animation-duration: 0.4s;
  animation-timing-function: ease-in-out;
  animation-fill-mode: both;
}

:is(
  .lmi-cloud-sun-rain[data-animated]:hover,
  [data-icon-motion]:hover .lmi-cloud-sun-rain[data-animated],
  [data-icon-motion="on"] .lmi-cloud-sun-rain[data-animated]
)
  .lmi-cloud-sun-rain-drop {
  animation-name: lmi-cloud-sun-rain-drop;
  animation-duration: 0.45s;
  /* Falling, so it accelerates — the rays' ease-in-out would read as floating. */
  animation-timing-function: cubic-bezier(0.4, 0, 0.7, 1);
  animation-fill-mode: both;
}
</style>
