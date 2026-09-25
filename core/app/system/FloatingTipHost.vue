<script setup lang="ts">
import { floatingTip } from "./floatingTip";
</script>

<template>
  <!-- Body-level host: escapes palette/card overflow and stacking contexts. -->
  <Teleport to="body">
    <div
      v-if="floatingTip.open"
      class="kavibay-floating-tip"
      :class="{ 'kavibay-floating-tip--visible': floatingTip.visible }"
      :style="floatingTip.style"
      aria-hidden="true"
    >
      {{ floatingTip.text }}
    </div>
  </Teleport>
</template>

<style>
.kavibay-floating-tip {
  position: fixed;
  z-index: 100000;
  padding: 4px 8px;
  border-radius: 6px;
  background: rgba(20, 22, 28, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.14);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
  color: rgba(255, 255, 255, 0.92);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.01em;
  line-height: 1.2;
  white-space: pre-line;
  pointer-events: none;
  opacity: 0;
  transform: translateY(2px);
  transition:
    opacity 0.12s ease,
    transform 0.12s ease;
}

.kavibay-floating-tip--visible {
  opacity: 1;
  transform: translateY(0);
}
</style>
