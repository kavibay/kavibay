<script setup lang="ts">
/**
 * The one-time chrome tips from `firstTimeTips.ts`.
 *
 * Not interactive on purpose: it times out by itself, so it never has to claim
 * pixels from the click-through layer, and it never sits between the user and
 * the widget they were reaching for.
 */
import { activeTip } from "./firstTimeTips";
</script>

<template>
  <Transition name="tip">
    <div v-if="activeTip" :key="activeTip.id" class="first-tip" role="status">
      <p class="first-tip-title">{{ activeTip.title }}</p>
      <p class="first-tip-body">{{ activeTip.body }}</p>
    </div>
  </Transition>
</template>

<style scoped>
.first-tip {
  position: fixed;
  left: 50%;
  bottom: 48px;
  z-index: 390;
  width: min(380px, calc(100vw - 32px));
  padding: 12px 16px;
  color: rgba(var(--fg-rgb), 0.92);
  background: rgb(var(--surface-bg-rgb));
  border-radius: var(--surface-radius, 16px);
  corner-shape: var(--surface-corner-shape, round);
  box-shadow: var(--surface-box-shadow);
  transform: translateX(-50%);
  pointer-events: none;
}

.first-tip-title {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
}

.first-tip-body {
  margin: 4px 0 0;
  font-size: 12.5px;
  line-height: 1.45;
  color: rgba(var(--fg-rgb), 0.72);
}

.tip-enter-active,
.tip-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.tip-enter-from,
.tip-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}
</style>
