<script setup lang="ts">
// SPDX-License-Identifier: MIT
/** Lucide `key-round`. */
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
  <IconBase class="lmi-key-round" :size="size" :stroke-width="strokeWidth" :animated="animated">
    <g class="lmi-key-round-g">
      <path
        class="lmi-key-round-body"
        d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"
      />
      <circle cx="16.5" cy="7.5" r=".5" fill="currentColor" />
    </g>
  </IconBase>
</template>

<style>
/* A brass key. Tile colours — see ListTodoIcon.vue for how the host reads them. */
[data-icon-tile]:has(> .lmi-key-round) {
  --icon-tile-bg: rgba(234, 179, 8, 0.2);
  --icon-tile-fg: #fde047;
  --lmi-key-fill: rgba(253, 224, 71, 0.28);
}

html[data-color-mode="light"] [data-icon-tile]:has(> .lmi-key-round) {
  --icon-tile-bg: rgba(234, 179, 8, 0.16);
  --icon-tile-fg: #854d0e;
  --lmi-key-fill: rgba(234, 179, 8, 0.3);
}

.lmi-key-round-body {
  fill: var(--lmi-key-fill, none);
}

/* Pivots on the bow, where a hand holds a key. */
.lmi-key-round-g {
  transform-box: view-box;
  transform-origin: 15.5px 8.5px;
  transform: rotate(0deg);
}

/* A turn in the lock and back. */
@keyframes lmi-key-round-turn {
  0% { transform: rotate(0deg); }
  40% { transform: rotate(-22deg); }
  75% { transform: rotate(6deg); }
  100% { transform: rotate(0deg); }
}

/* Same three ways in as every other animated icon — see ClipboardListIcon.vue. */
:is(
  .lmi-key-round[data-animated]:hover,
  [data-icon-motion]:hover .lmi-key-round[data-animated],
  [data-icon-motion="on"] .lmi-key-round[data-animated]
)
  .lmi-key-round-g {
  animation-name: lmi-key-round-turn;
  animation-duration: 0.6s;
  animation-timing-function: ease-in-out;
  animation-fill-mode: both;
}
</style>
