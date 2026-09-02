<script setup lang="ts">
// SPDX-License-Identifier: MIT
/** Lucide `git-branch`, with the branch paths drawing in together. */
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
  <IconBase class="lmi-git-branch" :size="size" :stroke-width="strokeWidth" :animated="animated">
    <circle class="lmi-git-branch-node" cx="18" cy="6" r="3" pathLength="1" />
    <line class="lmi-git-branch-branch" x1="6" y1="3" x2="6" y2="15" pathLength="1" />
    <circle class="lmi-git-branch-node" cx="6" cy="18" r="3" pathLength="1" />
    <path class="lmi-git-branch-branch" d="M18 9a9 9 0 0 1-9 9" pathLength="1" />
  </IconBase>
</template>

<style>
/* Static geometry is the end state of both draw-on animations. */
.lmi-git-branch-node,
.lmi-git-branch-branch {
  opacity: 1;
  stroke-dasharray: 1 1;
  stroke-dashoffset: 0;
}

@keyframes lmi-git-branch-node {
  0% {
    opacity: 0;
    stroke-dasharray: 0 1;
    stroke-dashoffset: 0;
  }
  100% {
    opacity: 1;
    stroke-dasharray: 1 1;
    stroke-dashoffset: 0;
  }
}

@keyframes lmi-git-branch-branch {
  0% {
    opacity: 0;
    stroke-dasharray: 0 1;
    stroke-dashoffset: 1;
  }
  100% {
    opacity: 1;
    stroke-dasharray: 1 1;
    stroke-dashoffset: 0;
  }
}

:is(
  .lmi-git-branch[data-animated]:hover,
  [data-icon-motion]:hover .lmi-git-branch[data-animated],
  [data-icon-motion="on"] .lmi-git-branch[data-animated]
) .lmi-git-branch-node {
  animation-name: lmi-git-branch-node;
  animation-duration: 0.39s;
  animation-timing-function: ease;
  animation-fill-mode: both;
}

:is(
  .lmi-git-branch[data-animated]:hover,
  [data-icon-motion]:hover .lmi-git-branch[data-animated],
  [data-icon-motion="on"] .lmi-git-branch[data-animated]
) .lmi-git-branch-branch {
  animation-name: lmi-git-branch-branch;
  animation-duration: 0.39s;
  animation-timing-function: ease;
  animation-fill-mode: both;
}
</style>
