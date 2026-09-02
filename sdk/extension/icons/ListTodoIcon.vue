<script setup lang="ts">
// SPDX-License-Identifier: MIT
/**
 * Lucide `list-todo`: the three rows draw in, then the tick is struck.
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
    <path class="lmi-list-todo-line lmi-list-todo-l3" d="M13 19h8" pathLength="1" />
    <!-- Down into the corner, then up: the dash grows from the path's start, so
         the stroke is drawn in the order a tick is actually written. -->
    <path class="lmi-list-todo-check" d="m3 17 2 2 4-4" pathLength="1" />
  </IconBase>
</template>

<style>
/* Resting state is the animation's end state, so the static variant is right
   without the keyframes ever running. */
.lmi-list-todo-line,
.lmi-list-todo-check {
  opacity: 1;
  stroke-dasharray: 1 1;
  stroke-dashoffset: 0;
}

/* Inert until a trigger supplies an animation-name. */
.lmi-list-todo-l2 {
  animation-delay: 0.07s;
}

.lmi-list-todo-l3 {
  animation-delay: 0.14s;
}

.lmi-list-todo-check {
  animation-delay: 0.24s;
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
  animation-name: lmi-list-todo-draw;
  animation-duration: 0.34s;
  /* Quick out of the gate, then settles — a tick is struck, not traced. */
  animation-timing-function: cubic-bezier(0.15, 0.75, 0.35, 1);
  animation-fill-mode: both;
}
</style>
