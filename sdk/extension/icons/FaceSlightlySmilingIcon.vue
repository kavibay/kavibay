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
    <path class="lmi-face-slightly-smiling-eye" d="M15 10V9" />
    <path d="M16.472 15a6 6 0 0 1-8.943 0" />
    <path class="lmi-face-slightly-smiling-eye" d="M9 10V9" />
    <circle cx="12" cy="12" r="10" />
  </IconBase>
</template>

<style>
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
