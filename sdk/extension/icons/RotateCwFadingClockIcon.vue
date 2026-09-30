<script setup lang="ts">
// SPDX-License-Identifier: MIT
/**
 * Lucide `rotate-cw-fading-clock`: the broken ring draws clockwise, the hands
 * sweep in, and the arrowhead lands last.
 *
 * Order matters more here than in the other clock: the arrowhead is what makes
 * this a *restarting* timer rather than a plain dial, so it arrives after the
 * ring it terminates — a head drawn before its arc reads as a stray corner.
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
    class="lmi-rotate-cw-clock"
    :size="size"
    :stroke-width="strokeWidth"
    :animated="animated"
  >
    <!-- Ring segments in clockwise order from 12, which is not Lucide's source
         order — reordered so the stagger classes run 1..6 down the file. -->
    <path class="lmi-rotate-cw-clock-arc" d="M12 3a9.75 9.75 0 0 1 6.74 2.74" pathLength="1" />
    <path
      class="lmi-rotate-cw-clock-arc lmi-rotate-cw-clock-a2"
      d="M21 12a9 9 0 0 1-.228 2"
      pathLength="1"
    />
    <path
      class="lmi-rotate-cw-clock-arc lmi-rotate-cw-clock-a3"
      d="M19 17.656a9 9 0 0 1-1.5 1.456"
      pathLength="1"
    />
    <path
      class="lmi-rotate-cw-clock-arc lmi-rotate-cw-clock-a4"
      d="M14 20.775A9 9 0 0 1 12 21"
      pathLength="1"
    />
    <path
      class="lmi-rotate-cw-clock-arc lmi-rotate-cw-clock-a5"
      d="M7.5 19.794c-6-3.464-6-12.124 0-15.588"
      pathLength="1"
    />
    <path
      class="lmi-rotate-cw-clock-arc lmi-rotate-cw-clock-a6"
      d="M7.5 4.206A9 9 0 0 1 12 3"
      pathLength="1"
    />
    <!-- Arrowhead: the stem out of the ring plus its two barbs, one delay for
         all three. At this size they read as a single corner, not as strokes. -->
    <path class="lmi-rotate-cw-clock-head" d="M18.74 5.74 21 8" pathLength="1" />
    <path class="lmi-rotate-cw-clock-head" d="M21 8V3" pathLength="1" />
    <path class="lmi-rotate-cw-clock-head" d="M21 8h-5" pathLength="1" />
    <path class="lmi-rotate-cw-clock-hands" d="M12 7v5l4 2" />
    <!-- The tomato's calyx. Only painted inside a tile; outside it the Lucide
         mark is unchanged. -->
    <path class="lmi-rotate-cw-clock-calyx" d="M9.8 1.6 12 3l2.2-1.4" />
  </IconBase>
</template>

<style>
/* A tomato: red into orange, with a green calyx on top. Tile colours — see ListTodoIcon.vue for how the host reads them. */
[data-icon-tile]:has(> .lmi-rotate-cw-clock) {
  --icon-tile-bg: linear-gradient(150deg, rgba(248, 113, 113, 0.3), rgba(234, 88, 12, 0.24));
  --icon-tile-fg: #fecaca;
  --lmi-pomodoro-calyx: #86efac;
}

html[data-color-mode="light"] [data-icon-tile]:has(> .lmi-rotate-cw-clock) {
  --icon-tile-bg: linear-gradient(150deg, rgba(239, 68, 68, 0.18), rgba(234, 88, 12, 0.14));
  --icon-tile-fg: #b91c1c;
  --lmi-pomodoro-calyx: #16a34a;
}

.lmi-rotate-cw-clock-calyx {
  stroke: var(--lmi-pomodoro-calyx, none);
  transform-box: fill-box;
  transform-origin: bottom center;
  transform: scale(1);
  /* Inert until a trigger supplies an animation-name: after the ring. */
  animation-delay: 0.4s;
}

@keyframes lmi-rotate-cw-clock-calyx {
  0% { transform: scale(0); }
  100% { transform: scale(1); }
}

:is(
  .lmi-rotate-cw-clock[data-animated]:hover,
  [data-icon-motion]:hover .lmi-rotate-cw-clock[data-animated],
  [data-icon-motion="on"] .lmi-rotate-cw-clock[data-animated]
) .lmi-rotate-cw-clock-calyx {
  animation-name: lmi-rotate-cw-clock-calyx;
  animation-duration: 0.35s;
  animation-timing-function: cubic-bezier(0.3, 1.6, 0.5, 1);
  animation-fill-mode: both;
}

/* Resting state is each animation's end state, so the static variant is right
   without the keyframes ever running. */
.lmi-rotate-cw-clock-arc,
.lmi-rotate-cw-clock-head {
  opacity: 1;
  stroke-dasharray: 1 1;
  stroke-dashoffset: 0;
}

/*
 * `view-box`, not the `fill-box` used for scaled marks elsewhere: both hands
 * are one path whose bounding box centres near (14,10.5), not on the dial.
 * `view-box` puts the origin in viewBox coordinates, so 12,12 is the middle of
 * the clock — see ClockFadingIcon.vue, same problem.
 */
.lmi-rotate-cw-clock-hands {
  transform-box: view-box;
  transform-origin: 12px 12px;
  transform: rotate(0deg);
  opacity: 1;
  animation-delay: 0.22s;
}

/* Inert until a trigger supplies an animation-name. */
.lmi-rotate-cw-clock-a2 {
  animation-delay: 0.06s;
}

.lmi-rotate-cw-clock-a3 {
  animation-delay: 0.12s;
}

.lmi-rotate-cw-clock-a4 {
  animation-delay: 0.18s;
}

.lmi-rotate-cw-clock-a5 {
  animation-delay: 0.24s;
}

.lmi-rotate-cw-clock-a6 {
  animation-delay: 0.3s;
}

.lmi-rotate-cw-clock-head {
  animation-delay: 0.36s;
}

@keyframes lmi-rotate-cw-clock-draw {
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

/* Negative start, so the sweep runs clockwise into rest — the direction the
   arrowhead is pointing. */
@keyframes lmi-rotate-cw-clock-hands {
  0% {
    transform: rotate(-55deg);
    opacity: 0;
  }
  40% {
    opacity: 1;
  }
  100% {
    transform: rotate(0deg);
    opacity: 1;
  }
}

/*
 * Same three ways in as every other animated icon — see ClipboardListIcon.vue.
 * No animation-delay in here: this block out-specifies the delay declarations
 * above and would flatten the sequence onto one start time.
 */
:is(
  .lmi-rotate-cw-clock[data-animated]:hover,
  [data-icon-motion]:hover .lmi-rotate-cw-clock[data-animated],
  [data-icon-motion="on"] .lmi-rotate-cw-clock[data-animated]
)
  :is(.lmi-rotate-cw-clock-arc, .lmi-rotate-cw-clock-head) {
  animation-name: lmi-rotate-cw-clock-draw;
  animation-duration: 0.3s;
  animation-timing-function: ease-out;
  animation-fill-mode: both;
}

:is(
  .lmi-rotate-cw-clock[data-animated]:hover,
  [data-icon-motion]:hover .lmi-rotate-cw-clock[data-animated],
  [data-icon-motion="on"] .lmi-rotate-cw-clock[data-animated]
)
  .lmi-rotate-cw-clock-hands {
  animation-name: lmi-rotate-cw-clock-hands;
  animation-duration: 0.45s;
  /* Coasts to a stop rather than braking — a sweep hand does not snap. */
  animation-timing-function: cubic-bezier(0.25, 0.8, 0.35, 1);
  animation-fill-mode: both;
}
</style>
