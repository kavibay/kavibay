<script setup lang="ts">
// SPDX-License-Identifier: MIT
/**
 * Lucide `eye-closed`: the lid draws shut and the lashes drop. Inside a tile a
 * censor bar swipes across first, like ink over a line in a document.
 */
import IconBase from "./IconBase.vue";

withDefaults(defineProps<{ size?: number | string; strokeWidth?: number | string; animated?: boolean }>(), {
  size: 24,
  strokeWidth: 2,
  animated: false,
});
</script>

<template>
  <IconBase class="lmi-eye-closed" :size="size" :stroke-width="strokeWidth" :animated="animated">
    <path class="lmi-eye-closed-lid" d="M2 8a10.645 10.645 0 0 0 20 0" pathLength="1" />
    <!-- Lashes left to right, which is not Lucide's source order, so the
         stagger classes run 1..4 down the file. -->
    <path class="lmi-eye-closed-lash" d="m4 15 1.726-2.05" />
    <path class="lmi-eye-closed-lash lmi-eye-closed-l2" d="m9 18 .722-3.25" />
    <path class="lmi-eye-closed-lash lmi-eye-closed-l3" d="m15 18-.722-3.25" />
    <path class="lmi-eye-closed-lash lmi-eye-closed-l4" d="m20 15-1.726-2.05" />
    <!-- Last, so it covers the eye while it passes. Only painted inside a tile,
         and it rests at zero width, so the static icon never shows it. -->
    <rect class="lmi-eye-closed-bar" x="2" y="10" width="20" height="7" rx="1" />
  </IconBase>
</template>

<style>
/* A redacted document: paper tile, black ink, in either theme. Tile colours —
   see ListTodoIcon.vue for how the host reads them. */
[data-icon-tile]:has(> .lmi-eye-closed) {
  --icon-tile-bg: #e7e5e4;
  --icon-tile-fg: #1c1917;
  --lmi-redacted-bar: #1c1917;
}

/* Resting state is each animation's end state, so the static variant is the
   untouched Lucide mark without the keyframes ever running. */
.lmi-eye-closed-lid {
  stroke-dasharray: 1 1;
  stroke-dashoffset: 0;
}

.lmi-eye-closed-lash {
  transform-box: fill-box;
  transform-origin: top center;
  transform: scale(1);
  opacity: 1;
  /* Inert until a trigger supplies an animation-name. */
  animation-delay: 0.55s;
}

.lmi-eye-closed-l2 {
  animation-delay: 0.6s;
}

.lmi-eye-closed-l3 {
  animation-delay: 0.65s;
}

.lmi-eye-closed-l4 {
  animation-delay: 0.7s;
}

.lmi-eye-closed-lid {
  animation-delay: 0.35s;
}

.lmi-eye-closed-bar {
  fill: var(--lmi-redacted-bar, none);
  stroke: none;
  transform-box: fill-box;
  transform-origin: right center;
  transform: scaleX(0);
}

@keyframes lmi-eye-closed-lid {
  0% {
    stroke-dasharray: 0 1;
    stroke-dashoffset: 0;
  }
  100% {
    stroke-dasharray: 1 1;
    stroke-dashoffset: 0;
  }
}

@keyframes lmi-eye-closed-lash {
  0% {
    transform: scale(0);
    opacity: 0;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

/* In from the left, a beat of black, out to the right. The origin flips while
   the bar is full width, where the switch cannot be seen. */
@keyframes lmi-eye-closed-bar {
  0% {
    transform-origin: left center;
    transform: scaleX(0);
  }
  35% {
    transform-origin: left center;
    transform: scaleX(1);
  }
  55% {
    transform-origin: right center;
    transform: scaleX(1);
  }
  100% {
    transform-origin: right center;
    transform: scaleX(0);
  }
}

/* Same three ways in as every other animated icon — see ClipboardListIcon.vue.
   No animation-delay in here: it would flatten the stagger above. */
:is(
  .lmi-eye-closed[data-animated]:hover,
  [data-icon-motion]:hover .lmi-eye-closed[data-animated],
  [data-icon-motion="on"] .lmi-eye-closed[data-animated]
)
  .lmi-eye-closed-lid {
  animation-name: lmi-eye-closed-lid;
  animation-duration: 0.3s;
  animation-timing-function: ease-out;
  animation-fill-mode: both;
}

:is(
  .lmi-eye-closed[data-animated]:hover,
  [data-icon-motion]:hover .lmi-eye-closed[data-animated],
  [data-icon-motion="on"] .lmi-eye-closed[data-animated]
)
  .lmi-eye-closed-lash {
  animation-name: lmi-eye-closed-lash;
  animation-duration: 0.25s;
  animation-timing-function: cubic-bezier(0.3, 1.6, 0.5, 1);
  animation-fill-mode: both;
}

:is(
  .lmi-eye-closed[data-animated]:hover,
  [data-icon-motion]:hover .lmi-eye-closed[data-animated],
  [data-icon-motion="on"] .lmi-eye-closed[data-animated]
)
  .lmi-eye-closed-bar {
  animation-name: lmi-eye-closed-bar;
  animation-duration: 0.7s;
  animation-timing-function: cubic-bezier(0.6, 0, 0.3, 1);
  animation-fill-mode: both;
}
</style>
