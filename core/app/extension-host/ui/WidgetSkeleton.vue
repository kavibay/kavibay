<script setup lang="ts">
/**
 * The one loading state in the system. Widgets never render their own — five
 * widgets inventing five spinners reads as breakage in a transparent overlay,
 * and a widget that renders while its query is still in flight is showing
 * data it does not have.
 */
</script>

<template>
  <div class="skeleton" role="status" aria-busy="true" aria-label="Loading">
    <div class="bar bar-wide" />
    <div class="bar bar-mid" />
    <div class="bar bar-narrow" />
  </div>
</template>

<style scoped>
.skeleton {
  display: flex;
  flex-direction: column;
  gap: 8px;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 12px;
  box-sizing: border-box;
}

.bar {
  height: 10px;
  border-radius: 5px;
  background: rgba(var(--fg-rgb), 0.12);
  animation: pulse 1.4s ease-in-out infinite;
}

.bar-wide { width: 100%; }
.bar-mid { width: 72%; animation-delay: 0.15s; }
.bar-narrow { width: 45%; animation-delay: 0.3s; }

@keyframes pulse {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .bar { animation: none; }
}
</style>
