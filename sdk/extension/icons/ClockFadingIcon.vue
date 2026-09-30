<script setup lang="ts">
// SPDX-License-Identifier: MIT
/**
 * Lucide `clock-fading`: the broken ring draws itself clockwise while the hands
 * sweep round into place.
 *
 * The five arc segments happen to be listed in clockwise order already, so the
 * stagger only has to follow the source. Their own draw directions vary, but a
 * segment that short reads as "appearing" rather than as being traced.
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
    class="lmi-clock-fading"
    :size="size"
    :stroke-width="strokeWidth"
    :animated="animated"
  >
    <path class="lmi-clock-fading-arc" d="M12 2a10 10 0 0 1 7.38 16.75" pathLength="1" />
    <path
      class="lmi-clock-fading-arc lmi-clock-fading-a2"
      d="M8.644 21.42a10 10 0 0 0 7.631-.38"
      pathLength="1"
    />
    <path
      class="lmi-clock-fading-arc lmi-clock-fading-a3"
      d="M2.83 16a10 10 0 0 0 2.43 3.4"
      pathLength="1"
    />
    <path
      class="lmi-clock-fading-arc lmi-clock-fading-a4"
      d="M2.5 8.875a10 10 0 0 0-.5 3"
      pathLength="1"
    />
    <path
      class="lmi-clock-fading-arc lmi-clock-fading-a5"
      d="M4.636 5.235a10 10 0 0 1 .891-.857"
      pathLength="1"
    />
    <path class="lmi-clock-fading-hands" d="M12 6v6l4 2" />
  </IconBase>
</template>

<style>
/* Fuchsia, with the ring trailing off behind the leading arc like a speed blur. Tile colours — see ListTodoIcon.vue for how the host reads them. */
[data-icon-tile]:has(> .lmi-clock-fading) {
  --icon-tile-bg: rgba(217, 70, 239, 0.2);
  --icon-tile-fg: #f5d0fe;
  --lmi-stopwatch-lead: #f0abfc;
  --lmi-stopwatch-trail: 0.55;
}

html[data-color-mode="light"] [data-icon-tile]:has(> .lmi-clock-fading) {
  --icon-tile-bg: rgba(192, 38, 211, 0.13);
  --icon-tile-fg: #86198f;
  --lmi-stopwatch-lead: #c026d3;
  --lmi-stopwatch-trail: 0.55;
}

.lmi-clock-fading-arc:first-child,
.lmi-clock-fading-hands {
  stroke: var(--lmi-stopwatch-lead, currentColor);
}

.lmi-clock-fading-a4,
.lmi-clock-fading-a5 {
  stroke-opacity: var(--lmi-stopwatch-trail, 1);
}

/* Resting state is each animation's end state, so the static variant is right
   without the keyframes ever running. */
.lmi-clock-fading-arc {
  opacity: 1;
  stroke-dasharray: 1 1;
  stroke-dashoffset: 0;
}

/*
 * `view-box`, not the `fill-box` used everywhere else in this set: both hands
 * live on one path, whose bounding box is centred near (14,10) rather than on
 * the dial. Rotating about that would swing the hands around a point off to one
 * side. `view-box` puts the origin in the viewBox coordinate system, so 12,12
 * means the middle of the clock.
 */
.lmi-clock-fading-hands {
  transform-box: view-box;
  transform-origin: 12px 12px;
  transform: rotate(0deg);
  opacity: 1;
  animation-delay: 0.2s;
}

/* Inert until a trigger supplies an animation-name. */
.lmi-clock-fading-a2 {
  animation-delay: 0.07s;
}

.lmi-clock-fading-a3 {
  animation-delay: 0.13s;
}

.lmi-clock-fading-a4 {
  animation-delay: 0.19s;
}

.lmi-clock-fading-a5 {
  animation-delay: 0.25s;
}

@keyframes lmi-clock-fading-arc {
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

/* Negative start, so the sweep runs clockwise into rest — the direction a clock
   actually moves. */
@keyframes lmi-clock-fading-hands {
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
  .lmi-clock-fading[data-animated]:hover,
  [data-icon-motion]:hover .lmi-clock-fading[data-animated],
  [data-icon-motion="on"] .lmi-clock-fading[data-animated]
)
  .lmi-clock-fading-arc {
  animation-name: lmi-clock-fading-arc;
  animation-duration: 0.32s;
  animation-timing-function: ease-out;
  animation-fill-mode: both;
}

:is(
  .lmi-clock-fading[data-animated]:hover,
  [data-icon-motion]:hover .lmi-clock-fading[data-animated],
  [data-icon-motion="on"] .lmi-clock-fading[data-animated]
)
  .lmi-clock-fading-hands {
  animation-name: lmi-clock-fading-hands;
  animation-duration: 0.45s;
  /* Coasts to a stop rather than braking — a sweep hand does not snap. */
  animation-timing-function: cubic-bezier(0.25, 0.8, 0.35, 1);
  animation-fill-mode: both;
}
</style>
