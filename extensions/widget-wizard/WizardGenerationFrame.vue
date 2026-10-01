<script setup lang="ts">
/**
 * The first build, shown as the card it is about to become.
 *
 * An outline draws itself at the size the preview card opens at, fills in, and
 * grows a title and placeholder rows that shimmer until the real widget is
 * ready; the parent then swaps this out for the preview. The caption keeps the
 * old status's rhythm — thinking, building, polishing — on the same timers,
 * because the turn reports no progress of its own to pace it by.
 *
 * Drawn here rather than with the host's WidgetCard: an extension cannot import
 * host components (CLAUDE.md invariant 7), so the surface variables are what
 * keeps the two looking alike.
 */
import { onMounted, onUnmounted, ref } from "vue";

const captions = ["Sketching the frame…", "Building it…", "Polishing the details…"];
const step = ref(0);
const timers: number[] = [];

onMounted(() => {
  timers.push(window.setTimeout(() => (step.value = 1), 3000));
  timers.push(window.setTimeout(() => (step.value = 2), 6000));
});

onUnmounted(() => timers.forEach((timer) => window.clearTimeout(timer)));
</script>

<template>
  <div class="wiz-frame-stage" role="status" aria-label="Creating widget">
    <div class="wiz-frame">
      <svg class="wiz-frame-outline" aria-hidden="true">
        <rect x="0.5" y="0.5" rx="15.5" pathLength="1" />
      </svg>
      <div class="wiz-frame-title" />
      <div class="wiz-frame-rows">
        <span class="wiz-frame-row" style="--i: 0; width: 46%" />
        <span class="wiz-frame-row wiz-frame-row--big" style="--i: 1; width: 64%" />
        <span class="wiz-frame-row" style="--i: 2; width: 82%" />
        <span class="wiz-frame-row" style="--i: 3; width: 58%" />
      </div>
    </div>
    <Transition name="wiz-frame-caption" mode="out-in">
      <p :key="step" class="wiz-frame-caption">{{ captions[step] }}</p>
    </Transition>
  </div>
</template>

<style scoped>
.wiz-frame-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  width: 100%;
  height: 100%;
}

/* The size WidgetWizardPreviewHost opens a fresh preview at. */
.wiz-frame {
  position: relative;
  box-sizing: border-box;
  width: 280px;
  height: 200px;
  padding: 14px 16px;
  border-radius: 16px;
  background: rgba(var(--surface-bg-rgb, 36, 36, 40), var(--surface-alpha, 0.72));
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.25);
  animation: wiz-frame-fill 500ms ease-out 900ms both;
}

.wiz-frame-outline {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
}

.wiz-frame-outline rect {
  width: calc(100% - 1px);
  height: calc(100% - 1px);
  fill: none;
  stroke: rgba(var(--fg-rgb), 0.35);
  stroke-width: 1;
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  animation: wiz-frame-draw 1.1s cubic-bezier(0.6, 0, 0.3, 1) forwards;
}

.wiz-frame-title {
  width: 38%;
  height: 9px;
  margin: 2px 0 18px;
  border-radius: 4px;
  background: rgba(var(--fg-rgb), 0.16);
  animation: wiz-frame-appear 400ms ease-out 1.2s both;
}

.wiz-frame-rows {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.wiz-frame-row {
  display: block;
  height: 10px;
  border-radius: 5px;
  background: linear-gradient(
    90deg,
    rgba(var(--fg-rgb), 0.07) 0%,
    rgba(var(--fg-rgb), 0.16) 50%,
    rgba(var(--fg-rgb), 0.07) 100%
  );
  background-size: 200% 100%;
  animation:
    wiz-frame-appear 400ms ease-out calc(1.4s + var(--i) * 120ms) both,
    wiz-frame-shimmer 1.6s linear calc(1.8s + var(--i) * 120ms) infinite;
}

.wiz-frame-row--big {
  height: 26px;
  border-radius: 7px;
}

.wiz-frame-caption {
  margin: 0;
  font-size: 12px;
  color: rgba(var(--fg-rgb), 0.55);
}

.wiz-frame-caption-enter-active,
.wiz-frame-caption-leave-active {
  transition: opacity 200ms ease, transform 200ms ease;
}

.wiz-frame-caption-enter-from {
  opacity: 0;
  transform: translateY(4px);
}

.wiz-frame-caption-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@keyframes wiz-frame-draw {
  to { stroke-dashoffset: 0; }
}

@keyframes wiz-frame-fill {
  from {
    background-color: transparent;
    box-shadow: none;
  }
}

@keyframes wiz-frame-appear {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
}

@keyframes wiz-frame-shimmer {
  from { background-position: 100% 0; }
  to { background-position: -100% 0; }
}

@media (prefers-reduced-motion: reduce) {
  .wiz-frame,
  .wiz-frame-outline rect,
  .wiz-frame-title,
  .wiz-frame-row {
    animation: none;
  }

  .wiz-frame-outline rect {
    stroke-dashoffset: 0;
  }
}
</style>
