<script setup lang="ts">
// SPDX-License-Identifier: MIT
/** Lucide `info`: the dot drops onto the stem, which grows up to meet it. */
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
  <IconBase class="lmi-info" :size="size" :stroke-width="strokeWidth" :animated="animated">
    <!-- Circle first: inside a tile it is filled, and would cover the "i". -->
    <circle class="lmi-info-disc" cx="12" cy="12" r="10" />
    <!-- Drawn bottom-up, so the dash grows from the baseline. -->
    <path class="lmi-info-stem" d="M12 16v-4" pathLength="1" />
    <path class="lmi-info-dot" d="M12 8h.01" />
  </IconBase>
</template>

<style>
/* A solid teal disc with a dark "i". Tile colours — see ListTodoIcon.vue for
   how the host reads them. */
[data-icon-tile]:has(> .lmi-info) {
  --icon-tile-bg: rgba(20, 184, 166, 0.2);
  --icon-tile-fg: #042f2e;
  --lmi-info-disc: #2dd4bf;
}

html[data-color-mode="light"] [data-icon-tile]:has(> .lmi-info) {
  --icon-tile-bg: rgba(20, 184, 166, 0.14);
  --icon-tile-fg: #ffffff;
  --lmi-info-disc: #0d9488;
}

.lmi-info-disc {
  fill: var(--lmi-info-disc, none);
  stroke: var(--lmi-info-disc, currentColor);
}

/* Resting state is each animation's end state, so the static icon is exact. */
.lmi-info-stem {
  stroke-dasharray: 1 1;
  stroke-dashoffset: 0;
}

.lmi-info-dot {
  transform: translateY(0);
  opacity: 1;
  /* Inert until a trigger supplies an animation-name. */
  animation-delay: 0.12s;
}

@keyframes lmi-info-stem {
  0% {
    stroke-dasharray: 0 1;
    stroke-dashoffset: 0;
  }
  100% {
    stroke-dasharray: 1 1;
    stroke-dashoffset: 0;
  }
}

@keyframes lmi-info-dot {
  0% {
    transform: translateY(-4px);
    opacity: 0;
  }
  40% {
    opacity: 1;
  }
  100% {
    transform: translateY(0);
    opacity: 1;
  }
}

/* Same three ways in as every other animated icon — see ClipboardListIcon.vue.
   No animation-delay in the trigger blocks: it would drop the dot with the stem. */
:is(
  .lmi-info[data-animated]:hover,
  [data-icon-motion]:hover .lmi-info[data-animated],
  [data-icon-motion="on"] .lmi-info[data-animated]
)
  .lmi-info-stem {
  animation-name: lmi-info-stem;
  animation-duration: 0.25s;
  animation-timing-function: ease-out;
  animation-fill-mode: both;
}

:is(
  .lmi-info[data-animated]:hover,
  [data-icon-motion]:hover .lmi-info[data-animated],
  [data-icon-motion="on"] .lmi-info[data-animated]
)
  .lmi-info-dot {
  animation-name: lmi-info-dot;
  animation-duration: 0.4s;
  /* Lands with a small bounce. */
  animation-timing-function: cubic-bezier(0.3, 1.6, 0.5, 1);
  animation-fill-mode: both;
}
</style>
