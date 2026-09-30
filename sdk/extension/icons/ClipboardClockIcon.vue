<script setup lang="ts">
// SPDX-License-Identifier: MIT
/** Lucide `clipboard-clock`: the clock lands on the board and its hand winds up. */
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
    class="lmi-clipboard-clock"
    :size="size"
    :stroke-width="strokeWidth"
    :animated="animated"
  >
    <!-- Board first and hand last: inside a tile the face is filled, and would
         cover anything drawn before it. -->
    <path d="M16 4h2a2 2 0 0 1 2 2v.832" />
    <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h2" />
    <rect x="8" y="2" width="8" height="4" rx="1" />
    <circle class="lmi-clipboard-clock-face" cx="16" cy="16" r="6" />
    <path class="lmi-clipboard-clock-hand" d="M16 14v2.2l1.6 1" />
  </IconBase>
</template>

<style>
/* A cardboard clipboard with a blue stopwatch face on it. Tile colours — see
   ListTodoIcon.vue for how the host reads them. */
[data-icon-tile]:has(> .lmi-clipboard-clock) {
  --icon-tile-bg: rgba(146, 64, 14, 0.28);
  --icon-tile-fg: #e7c9a0;
  --lmi-tracker-face: #7dd3fc;
  --lmi-tracker-hand: #0c4a6e;
}

html[data-color-mode="light"] [data-icon-tile]:has(> .lmi-clipboard-clock) {
  --icon-tile-bg: rgba(146, 64, 14, 0.14);
  --icon-tile-fg: #78350f;
  --lmi-tracker-face: #38bdf8;
}

.lmi-clipboard-clock-face {
  fill: var(--lmi-tracker-face, none);
  stroke: var(--lmi-tracker-face, currentColor);
}

.lmi-clipboard-clock-hand {
  stroke: var(--lmi-tracker-hand, currentColor);
}

/* Resting state is each animation's end state, so the static variant is the
   untouched Lucide mark without the keyframes ever running. */
.lmi-clipboard-clock-face {
  transform-box: fill-box;
  transform-origin: center;
  transform: scale(1);
}

/* `view-box` so 16,16 is the face's centre, not the hand's own bounding box —
   see ClockFadingIcon.vue, same problem. */
.lmi-clipboard-clock-hand {
  transform-box: view-box;
  transform-origin: 16px 16px;
  transform: rotate(0deg);
  /* Inert until a trigger supplies an animation-name. */
  animation-delay: 0.12s;
}

@keyframes lmi-clipboard-clock-face {
  0% {
    transform: scale(0.6);
    opacity: 0;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

/* Most of a turn clockwise into rest: the clock has started. */
@keyframes lmi-clipboard-clock-hand {
  0% {
    transform: rotate(-300deg);
  }
  100% {
    transform: rotate(0deg);
  }
}

/* Same three ways in as every other animated icon — see ClipboardListIcon.vue.
   No animation-delay in here: it would start the hand with the face. */
:is(
  .lmi-clipboard-clock[data-animated]:hover,
  [data-icon-motion]:hover .lmi-clipboard-clock[data-animated],
  [data-icon-motion="on"] .lmi-clipboard-clock[data-animated]
)
  .lmi-clipboard-clock-face {
  animation-name: lmi-clipboard-clock-face;
  animation-duration: 0.35s;
  animation-timing-function: cubic-bezier(0.3, 1.6, 0.5, 1);
  animation-fill-mode: both;
}

:is(
  .lmi-clipboard-clock[data-animated]:hover,
  [data-icon-motion]:hover .lmi-clipboard-clock[data-animated],
  [data-icon-motion="on"] .lmi-clipboard-clock[data-animated]
)
  .lmi-clipboard-clock-hand {
  animation-name: lmi-clipboard-clock-hand;
  animation-duration: 0.7s;
  animation-timing-function: cubic-bezier(0.25, 0.8, 0.35, 1);
  animation-fill-mode: both;
}
</style>
