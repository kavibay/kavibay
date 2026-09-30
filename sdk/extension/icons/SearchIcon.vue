<script setup lang="ts">
// SPDX-License-Identifier: MIT
/** Lucide `search`. */
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
  <IconBase class="lmi-search" :size="size" :stroke-width="strokeWidth" :animated="animated">
    <g class="lmi-search-g">
      <path d="m21 21-4.34-4.34" />
      <circle class="lmi-search-lens" cx="11" cy="11" r="8" />
    </g>
  </IconBase>
</template>

<style>
/* Emerald, with the lens glazed. Tile colours — see ListTodoIcon.vue for how the host reads them. */
[data-icon-tile]:has(> .lmi-search) {
  --icon-tile-bg: rgba(16, 185, 129, 0.2);
  --icon-tile-fg: #a7f3d0;
  --lmi-search-glass: rgba(167, 243, 208, 0.2);
}

html[data-color-mode="light"] [data-icon-tile]:has(> .lmi-search) {
  --icon-tile-bg: rgba(16, 185, 129, 0.13);
  --icon-tile-fg: #065f46;
  --lmi-search-glass: rgba(16, 185, 129, 0.16);
}

.lmi-search-lens {
  fill: var(--lmi-search-glass, none);
}

.lmi-search-g {
  transform: translate(0, 0);
}

/* Left, right, home: a lens scanning a page. */
@keyframes lmi-search-scan {
  0% { transform: translate(0, 0); }
  30% { transform: translate(-1.5px, -1px); }
  65% { transform: translate(1.5px, -1px); }
  100% { transform: translate(0, 0); }
}

/* Same three ways in as every other animated icon — see ClipboardListIcon.vue. */
:is(
  .lmi-search[data-animated]:hover,
  [data-icon-motion]:hover .lmi-search[data-animated],
  [data-icon-motion="on"] .lmi-search[data-animated]
)
  .lmi-search-g {
  animation-name: lmi-search-scan;
  animation-duration: 0.6s;
  animation-timing-function: ease-in-out;
  animation-fill-mode: both;
}
</style>
