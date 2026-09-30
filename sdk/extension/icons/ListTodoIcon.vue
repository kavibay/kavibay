<script setup lang="ts">
// SPDX-License-Identifier: MIT
/**
 * Lucide `list-todo`: the three rows draw in, then the ticked box springs in.
 *
 * The tick comes last on purpose. It is the only mark in the icon that stands
 * for an event rather than for a thing, so leading with it would spend the
 * payoff before the list it belongs to exists.
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
    class="lmi-list-todo"
    :size="size"
    :stroke-width="strokeWidth"
    :animated="animated"
  >
    <!-- The empty box stays put: it is the item still waiting, and something
         has to hold still for the tick below it to read as a change. -->
    <rect x="3" y="4" width="6" height="6" rx="1" />
    <path class="lmi-list-todo-line" d="M13 5h8" pathLength="1" />
    <path class="lmi-list-todo-line lmi-list-todo-l2" d="M13 12h8" pathLength="1" />
    <!-- The done row's line is quieter: that task is out of the way. -->
    <path class="lmi-list-todo-line lmi-list-todo-l3" d="M13 19h8" pathLength="1" />
    <g class="lmi-list-todo-check">
      <rect x="3" y="14" width="6" height="6" rx="1" />
      <path d="m4.5 17 1.3 1.3 2.2-2.4" />
    </g>
  </IconBase>
</template>

<style>
/* Resting state is the animation's end state, so the static variant is right
   without the keyframes ever running. */
.lmi-list-todo-line {
  opacity: 1;
  stroke-dasharray: 1 1;
  stroke-dashoffset: 0;
}

.lmi-list-todo-l3 {
  stroke-opacity: 0.5;
}

/* Outside a tile the box is an outline and the tick is ink, as in Lucide; a
   tile fills the box and knocks the tick out of it. */
.lmi-list-todo-check {
  transform-box: fill-box;
  transform-origin: center;
}

.lmi-list-todo-check rect {
  fill: var(--lmi-todo-box, none);
  stroke: var(--lmi-todo-box, currentColor);
}

.lmi-list-todo-check path {
  stroke: var(--lmi-todo-tick, currentColor);
}

/*
 * The host's icon tile (`[data-icon-tile]`) paints itself from these, so the
 * colour lives with the icon instead of in every host that shows it.
 */
[data-icon-tile]:has(> .lmi-list-todo) {
  --icon-tile-bg: rgba(29, 158, 117, 0.2);
  --icon-tile-fg: #9fe1cb;
  --lmi-todo-box: #5dcaa5;
  --lmi-todo-tick: #04342c;
}

html[data-color-mode="light"] [data-icon-tile]:has(> .lmi-list-todo) {
  --icon-tile-bg: rgba(29, 158, 117, 0.14);
  --icon-tile-fg: #0f6e56;
  --lmi-todo-box: #1d9e75;
  --lmi-todo-tick: #ffffff;
}

/* Inert until a trigger supplies an animation-name. */
.lmi-list-todo-l2 {
  animation-delay: 0.07s;
}

.lmi-list-todo-l3 {
  animation-delay: 0.14s;
}

.lmi-list-todo-check {
  animation-delay: 0.22s;
}

@keyframes lmi-list-todo-draw {
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

@keyframes lmi-list-todo-pop {
  0% {
    opacity: 0;
    transform: scale(0.4);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}

/*
 * Same three ways in as every other animated icon — see ClipboardListIcon.vue.
 * No animation-delay in here: this block out-specifies the delay declarations
 * above and would flatten the sequence onto one start time.
 */
:is(
  .lmi-list-todo[data-animated]:hover,
  [data-icon-motion]:hover .lmi-list-todo[data-animated],
  [data-icon-motion="on"] .lmi-list-todo[data-animated]
)
  .lmi-list-todo-line {
  animation-name: lmi-list-todo-draw;
  animation-duration: 0.3s;
  animation-timing-function: ease-out;
  animation-fill-mode: both;
}

:is(
  .lmi-list-todo[data-animated]:hover,
  [data-icon-motion]:hover .lmi-list-todo[data-animated],
  [data-icon-motion="on"] .lmi-list-todo[data-animated]
)
  .lmi-list-todo-check {
  animation-name: lmi-list-todo-pop;
  animation-duration: 0.4s;
  /* Overshoots a touch and settles — the box is ticked, not faded in. */
  animation-timing-function: cubic-bezier(0.3, 1.6, 0.5, 1);
  animation-fill-mode: both;
}
</style>
