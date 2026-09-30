<script setup lang="ts">
// SPDX-License-Identifier: MIT
/** Lucide `mouse-pointer-click`. */
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
    class="lmi-mouse-pointer-click"
    :size="size"
    :stroke-width="strokeWidth"
    :animated="animated"
  >
    <path class="lmi-mpc-ray" d="M14 4.1 12 6" />
    <path class="lmi-mpc-ray" d="m5.1 8-2.9-.8" />
    <path class="lmi-mpc-ray" d="m6 12-1.9 2" />
    <path class="lmi-mpc-ray" d="M7.2 2.2 8 5.1" />
    <path
      class="lmi-mpc-pointer"
      d="M9.037 9.69a.498.498 0 0 1 .653-.653l11 4.5a.5.5 0 0 1-.074.949l-4.349 1.041a1 1 0 0 0-.74.739l-1.04 4.35a.5.5 0 0 1-.95.074z"
    />
  </IconBase>
</template>

<style>
/* Rose, a solid pointer and a yellow click burst. Tile colours — see ListTodoIcon.vue for how the host reads them. */
[data-icon-tile]:has(> .lmi-mouse-pointer-click) {
  --icon-tile-bg: rgba(244, 63, 94, 0.2);
  --icon-tile-fg: #fecdd3;
  --lmi-behavior-pointer: #fecdd3;
  --lmi-behavior-ray: #fde047;
}

html[data-color-mode="light"] [data-icon-tile]:has(> .lmi-mouse-pointer-click) {
  --icon-tile-bg: rgba(244, 63, 94, 0.13);
  --icon-tile-fg: #9f1239;
  --lmi-behavior-pointer: #fb7185;
  --lmi-behavior-ray: #ca8a04;
}

.lmi-mpc-pointer {
  fill: var(--lmi-behavior-pointer, none);
  transform: translate(0, 0);
}

.lmi-mpc-ray {
  stroke: var(--lmi-behavior-ray, currentColor);
  transform-box: fill-box;
  transform-origin: center;
  transform: scale(1);
  opacity: 1;
  /* Inert until a trigger supplies an animation-name: fires on the press. */
  animation-delay: 0.14s;
}

/* Into the corner and back — a press, not a drift. */
@keyframes lmi-mpc-press {
  0% { transform: translate(0, 0); }
  35% { transform: translate(-1.4px, -1.4px); }
  100% { transform: translate(0, 0); }
}

@keyframes lmi-mpc-burst {
  0% { transform: scale(0); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}

/* Same three ways in as every other animated icon — see ClipboardListIcon.vue.
   No animation-delay in the trigger blocks: it would flatten the stagger. */
:is(
  .lmi-mouse-pointer-click[data-animated]:hover,
  [data-icon-motion]:hover .lmi-mouse-pointer-click[data-animated],
  [data-icon-motion="on"] .lmi-mouse-pointer-click[data-animated]
)
  .lmi-mpc-pointer {
  animation-name: lmi-mpc-press;
  animation-duration: 0.34s;
  animation-timing-function: ease-out;
  animation-fill-mode: both;
}

:is(
  .lmi-mouse-pointer-click[data-animated]:hover,
  [data-icon-motion]:hover .lmi-mouse-pointer-click[data-animated],
  [data-icon-motion="on"] .lmi-mouse-pointer-click[data-animated]
)
  .lmi-mpc-ray {
  animation-name: lmi-mpc-burst;
  animation-duration: 0.3s;
  animation-timing-function: cubic-bezier(0.3, 1.6, 0.5, 1);
  animation-fill-mode: both;
}
</style>
