<script setup lang="ts">
// SPDX-License-Identifier: MIT
/**
 * Snake as it was played on a Nokia: square segments on a 4-unit grid and a
 * food pellet. The animation plays two moves of the game — one step, then the
 * step that eats the pellet, grows the tail by one and spawns the next pellet.
 *
 * Not a Lucide icon: Lucide has no snake, and its `worm` read as a worm.
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
  <IconBase class="lmi-snake" :size="size" :stroke-width="strokeWidth" :animated="animated">
    <!-- Tail to head. Each segment rests on its own cell; --ax/--ay and
         --bx/--by are how far back it sat one and two moves earlier. -->
    <rect class="lmi-snake-seg lmi-snake-tail" x="3" y="19" width="3" height="3" />
    <rect class="lmi-snake-seg" style="--ax: -4px; --ay: -4px; --bx: -4px; --by: 0px" x="7" y="19" width="3" height="3" />
    <rect class="lmi-snake-seg" style="--ax: -8px; --ay: 0px; --bx: -4px; --by: 0px" x="11" y="19" width="3" height="3" />
    <rect class="lmi-snake-seg" style="--ax: -4px; --ay: 4px; --bx: 0px; --by: 4px" x="11" y="15" width="3" height="3" />
    <rect class="lmi-snake-seg" style="--ax: 0px; --ay: 8px; --bx: 0px; --by: 4px" x="11" y="11" width="3" height="3" />
    <rect class="lmi-snake-seg" style="--ax: -4px; --ay: 4px; --bx: -4px; --by: 0px" x="15" y="11" width="3" height="3" />
    <rect class="lmi-snake-seg" style="--ax: -8px; --ay: 0px; --bx: -4px; --by: 0px" x="19" y="11" width="3" height="3" />
    <!-- The pellet the head just ate, and the one that spawns after it. -->
    <path class="lmi-snake-food lmi-snake-food-eaten" d="M20.5 11 22 12.5l-1.5 1.5L19 12.5z" />
    <path class="lmi-snake-food lmi-snake-food-next" d="M20.5 3 22 4.5l-1.5 1.5L19 4.5z" />
  </IconBase>
</template>

<style>
/* A Nokia screen is the same green in either theme: it is a display, not UI.
   Tile colours — see ListTodoIcon.vue for how the host reads them. */
[data-icon-tile]:has(> .lmi-snake) {
  --icon-tile-bg: #a7c957;
  --icon-tile-fg: #2b3a17;
}

/* Pixels, not strokes: at 16px an outlined 3-unit square is a blur. */
.lmi-snake-seg,
.lmi-snake-food {
  fill: currentColor;
  stroke: none;
}

/* Resting state is each animation's end state: the snake after it has eaten,
   with the next pellet waiting. */
.lmi-snake-seg {
  transform: translate(0, 0);
}

.lmi-snake-food-eaten {
  opacity: 0;
}

.lmi-snake-food-next {
  transform-box: fill-box;
  transform-origin: center;
  transform: scale(1);
  opacity: 1;
}

/*
 * Held stops, not tweens: the game moves a whole cell per tick. Two moves back,
 * one move back, home. The custom properties resolve per segment, so one set
 * of keyframes serves all six.
 */
@keyframes lmi-snake-move {
  0%,
  32% {
    transform: translate(var(--ax), var(--ay));
  }
  34%,
  65% {
    transform: translate(var(--bx), var(--by));
  }
  67%,
  100% {
    transform: translate(0, 0);
  }
}

/* The tail cell stays put on the eating move — that is the growth. */
@keyframes lmi-snake-grow {
  0%,
  65% {
    opacity: 0;
  }
  67%,
  100% {
    opacity: 1;
  }
}

@keyframes lmi-snake-eaten {
  0%,
  65% {
    opacity: 1;
  }
  67%,
  100% {
    opacity: 0;
  }
}

@keyframes lmi-snake-spawn {
  0%,
  75% {
    transform: scale(0);
    opacity: 0;
  }
  76% {
    opacity: 1;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

/* Same three ways in as every other animated icon — see ClipboardListIcon.vue. */
:is(
  .lmi-snake[data-animated]:hover,
  [data-icon-motion]:hover .lmi-snake[data-animated],
  [data-icon-motion="on"] .lmi-snake[data-animated]
)
  .lmi-snake-seg:not(.lmi-snake-tail) {
  animation: lmi-snake-move 0.8s linear both;
}

:is(
  .lmi-snake[data-animated]:hover,
  [data-icon-motion]:hover .lmi-snake[data-animated],
  [data-icon-motion="on"] .lmi-snake[data-animated]
)
  .lmi-snake-tail {
  animation: lmi-snake-grow 0.8s linear both;
}

:is(
  .lmi-snake[data-animated]:hover,
  [data-icon-motion]:hover .lmi-snake[data-animated],
  [data-icon-motion="on"] .lmi-snake[data-animated]
)
  .lmi-snake-food-eaten {
  animation: lmi-snake-eaten 0.8s linear both;
}

:is(
  .lmi-snake[data-animated]:hover,
  [data-icon-motion]:hover .lmi-snake[data-animated],
  [data-icon-motion="on"] .lmi-snake[data-animated]
)
  .lmi-snake-food-next {
  animation: lmi-snake-spawn 0.8s ease-out both;
}
</style>
