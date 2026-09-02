<script setup lang="ts">
/**
 * The first generation gets a little visual rhythm while the preview is still
 * empty: thinking, building, then brushing up the result until it arrives.
 * The timers live here so the parent only has to say whether generation is
 * active; unmounting the status also cancels the sequence cleanly.
 */
import { onMounted, onUnmounted, ref } from "vue";
import { BrainIcon } from "@sdk/icons";

type GenerationPhase = "brain" | "hammer" | "brush";

const phase = ref<GenerationPhase>("brain");
let hammerTimer: number | undefined;
let brushTimer: number | undefined;

onMounted(() => {
  hammerTimer = window.setTimeout(() => {
    phase.value = "hammer";
  }, 3000);
  brushTimer = window.setTimeout(() => {
    phase.value = "brush";
  }, 6000);
});

onUnmounted(() => {
  if (hammerTimer !== undefined) window.clearTimeout(hammerTimer);
  if (brushTimer !== undefined) window.clearTimeout(brushTimer);
});
</script>

<template>
  <div class="wiz-generation-status" data-icon-motion="on" role="status" aria-label="Creating widget">
    <BrainIcon
      v-if="phase === 'brain'"
      class="wiz-generation-icon"
      :size="64"
      :stroke-width="1.7"
      animated
    />

    <svg
      v-else-if="phase === 'hammer'"
      class="wiz-generation-icon wiz-generation-hammer"
      width="64"
      height="64"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <g class="wiz-generation-hammer-g">
        <path d="m15 12-8.373 8.373a1 1 0 1 1-3-3L12 9" />
        <path d="m18 15 4-4" />
        <path
          d="m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172V7l-2.26-2.26a6 6 0 0 0-4.202-1.756L9 2.96l.92.82A6.18 6.18 0 0 1 12 8.4V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5"
        />
      </g>
    </svg>

    <svg
      v-else
      class="wiz-generation-icon wiz-generation-brush"
      width="64"
      height="64"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <g class="wiz-generation-brush-g">
        <path d="m16 22-1-4" />
        <path d="M19 13.99a1 1 0 0 0 1-1V12a2 2 0 0 0-2-2h-3a1 1 0 0 1-1-1V4a2 2 0 0 0-4 0v5a1 1 0 0 1-1 1H6a2 2 0 0 0-2 2v.99a1 1 0 0 0 1 1" />
        <path d="M5 14h14l1.973 6.767A1 1 0 0 1 20 22H4a1 1 0 0 1-.973-1.233z" />
        <path d="m8 22 1-4" />
      </g>
    </svg>
  </div>
</template>

<style scoped>
.wiz-generation-status {
  display: grid;
  width: 100%;
  height: 100%;
  place-items: center;
  overflow: visible;
  color: rgba(var(--fg-rgb), 0.72);
}

.wiz-generation-icon {
  display: block;
  width: 64px;
  height: 64px;
  overflow: visible;
}

.wiz-generation-hammer-g {
  transform-box: view-box;
  transform-origin: bottom left;
  animation: wiz-generation-hammer 0.78s ease-in-out infinite;
}

.wiz-generation-brush-g {
  transform-box: view-box;
  transform-origin: top center;
  animation: wiz-generation-brush 0.78s ease-in-out infinite;
}

@keyframes wiz-generation-hammer {
  0% { transform: rotate(0deg); }
  33.33% { transform: rotate(30deg); }
  66.67% { transform: rotate(-5deg); }
  100% { transform: rotate(0deg); }
}

@keyframes wiz-generation-brush {
  0% { transform: rotate(0deg); }
  33.33% { transform: rotate(-10deg); }
  66.67% { transform: rotate(10deg); }
  100% { transform: rotate(0deg); }
}

@media (prefers-reduced-motion: reduce) {
  .wiz-generation-hammer-g,
  .wiz-generation-brush-g {
    animation: none;
  }
}
</style>
