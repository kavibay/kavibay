<script setup lang="ts">
// SPDX-License-Identifier: MIT
/** Lucide `face-slightly-smiling`, with a small, friendly blink. */
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
    class="lmi-face-slightly-smiling"
    :size="size"
    :stroke-width="strokeWidth"
    :animated="animated"
  >
    <!-- Face first: inside a tile it is filled, and would cover anything drawn
         before it. -->
    <circle class="lmi-face-slightly-smiling-face" cx="12" cy="12" r="10" />
    <!-- Cheeks are only painted inside a tile; outside it the Lucide mark is
         unchanged. -->
    <circle class="lmi-face-slightly-smiling-cheek" cx="7" cy="13.5" r="1.3" />
    <circle class="lmi-face-slightly-smiling-cheek" cx="17" cy="13.5" r="1.3" />
    <path class="lmi-face-slightly-smiling-eye" d="M15 10V9" />
    <path d="M16.472 15a6 6 0 0 1-8.943 0" />
    <path class="lmi-face-slightly-smiling-eye" d="M9 10V9" />
  </IconBase>
</template>

<style>
/* An emoji is the same yellow in either theme. Tile colours — see ListTodoIcon.vue for how the host reads them. */
[data-icon-tile]:has(> .lmi-face-slightly-smiling) {
  --icon-tile-bg: rgba(251, 191, 36, 0.2);
  --icon-tile-fg: #5b3a06;
  --lmi-emoji-face: #fcd34d;
  --lmi-emoji-cheek: rgba(244, 114, 182, 0.6);
}

.lmi-face-slightly-smiling-face {
  fill: var(--lmi-emoji-face, none);
  stroke: var(--lmi-emoji-face, currentColor);
}

.lmi-face-slightly-smiling-cheek {
  fill: var(--lmi-emoji-cheek, none);
  stroke: none;
}

/* End state is the original Lucide face, so static callers need no reset. */
.lmi-face-slightly-smiling-eye {
  transform-box: fill-box;
  transform-origin: center;
  transform: scaleY(1);
}

@keyframes lmi-face-slightly-smiling-blink {
  0%,
  42%,
  58%,
  100% { transform: scaleY(1); }
  50% { transform: scaleY(0.08); }
}

:is(
  .lmi-face-slightly-smiling[data-animated]:hover,
  [data-icon-motion]:hover .lmi-face-slightly-smiling[data-animated],
  [data-icon-motion="on"] .lmi-face-slightly-smiling[data-animated]
) .lmi-face-slightly-smiling-eye {
  animation-name: lmi-face-slightly-smiling-blink;
  animation-duration: 0.52s;
  animation-timing-function: ease-in-out;
  animation-fill-mode: both;
}
</style>
