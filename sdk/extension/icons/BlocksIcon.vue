<script setup lang="ts">
// SPDX-License-Identifier: MIT
/** Lucide `blocks`. */
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
  <IconBase class="lmi-blocks" :size="size" :stroke-width="strokeWidth" :animated="animated">
    <path
      d="M10 22V7a1 1 0 0 0-1-1H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5a1 1 0 0 0-1-1H2"
    />
    <rect class="lmi-blocks-piece" x="14" y="2" width="8" height="8" rx="1" />
  </IconBase>
</template>

<style>
/* Orange building blocks; the loose piece is solid. Tile colours — see ListTodoIcon.vue for how the host reads them. */
[data-icon-tile]:has(> .lmi-blocks) {
  --icon-tile-bg: rgba(249, 115, 22, 0.2);
  --icon-tile-fg: #fed7aa;
  --lmi-blocks-piece: #fb923c;
}

html[data-color-mode="light"] [data-icon-tile]:has(> .lmi-blocks) {
  --icon-tile-bg: rgba(249, 115, 22, 0.13);
  --icon-tile-fg: #9a3412;
  --lmi-blocks-piece: #f97316;
}

.lmi-blocks-piece {
  fill: var(--lmi-blocks-piece, none);
  stroke: var(--lmi-blocks-piece, currentColor);
  transform: translate(0, 0);
  opacity: 1;
}

/* Drops in from the corner and snaps into its slot. */
@keyframes lmi-blocks-snap {
  0% { transform: translate(3px, -3px); opacity: 0; }
  100% { transform: translate(0, 0); opacity: 1; }
}

/* Same three ways in as every other animated icon — see ClipboardListIcon.vue. */
:is(
  .lmi-blocks[data-animated]:hover,
  [data-icon-motion]:hover .lmi-blocks[data-animated],
  [data-icon-motion="on"] .lmi-blocks[data-animated]
)
  .lmi-blocks-piece {
  animation-name: lmi-blocks-snap;
  animation-duration: 0.4s;
  animation-timing-function: cubic-bezier(0.3, 1.6, 0.5, 1);
  animation-fill-mode: both;
}
</style>
