<script setup lang="ts">
// SPDX-License-Identifier: MIT
/** Lucide `server`. */
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
  <IconBase class="lmi-server" :size="size" :stroke-width="strokeWidth" :animated="animated">
    <rect class="lmi-server-unit" width="20" height="8" x="2" y="2" rx="2" ry="2" />
    <rect class="lmi-server-unit" width="20" height="8" x="2" y="14" rx="2" ry="2" />
    <!-- Drive slots. Only painted inside a tile; outside it the Lucide mark is
         unchanged. -->
    <path class="lmi-server-slot" d="M13 6h5" />
    <path class="lmi-server-slot" d="M13 18h5" />
    <path class="lmi-server-led" d="M6 6h.01" />
    <path class="lmi-server-led lmi-server-led2" d="M6 18h.01" />
  </IconBase>
</template>

<style>
/* A rack on a network-blue tile: lit units, drive slots, and one green and one
   amber light. Tile colours — see ListTodoIcon.vue for how the host reads them. */
[data-icon-tile]:has(> .lmi-server) {
  --icon-tile-bg: linear-gradient(150deg, rgba(56, 189, 248, 0.3), rgba(99, 102, 241, 0.3));
  --icon-tile-fg: #e0f2fe;
  --lmi-server-unit: rgba(224, 242, 254, 0.14);
  --lmi-server-slot: rgba(224, 242, 254, 0.5);
  --lmi-server-led-1: #4ade80;
  --lmi-server-led-2: #fbbf24;
  --lmi-server-led-width: 3;
}

html[data-color-mode="light"] [data-icon-tile]:has(> .lmi-server) {
  --icon-tile-bg: linear-gradient(150deg, rgba(56, 189, 248, 0.2), rgba(99, 102, 241, 0.2));
  --icon-tile-fg: #1e3a8a;
  --lmi-server-unit: rgba(30, 58, 138, 0.08);
  --lmi-server-slot: rgba(30, 58, 138, 0.4);
  --lmi-server-led-1: #16a34a;
  --lmi-server-led-2: #d97706;
}

.lmi-server-unit {
  fill: var(--lmi-server-unit, none);
}

.lmi-server-slot {
  stroke: var(--lmi-server-slot, none);
}

/* Fatter inside a tile: at 16px a 2-unit dot is too small to carry a colour. */
.lmi-server-led {
  stroke: var(--lmi-server-led-1, currentColor);
  stroke-width: var(--lmi-server-led-width, inherit);
  opacity: 1;
}

/* Inert until a trigger supplies an animation-name. */
.lmi-server-led2 {
  stroke: var(--lmi-server-led-2, currentColor);
  animation-delay: 0.15s;
}

/* Two quick blinks: traffic. */
@keyframes lmi-server-blink {
  0%, 40%, 100% { opacity: 1; }
  20%, 60% { opacity: 0.15; }
}

/* Same three ways in as every other animated icon — see ClipboardListIcon.vue.
   No animation-delay in the trigger blocks: it would flatten the stagger. */
:is(
  .lmi-server[data-animated]:hover,
  [data-icon-motion]:hover .lmi-server[data-animated],
  [data-icon-motion="on"] .lmi-server[data-animated]
)
  .lmi-server-led {
  animation-name: lmi-server-blink;
  animation-duration: 0.5s;
  animation-timing-function: steps(1, end);
  animation-fill-mode: both;
}
</style>
