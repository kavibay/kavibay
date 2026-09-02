<script setup lang="ts">
import { computed } from "vue";
import { demoRun } from "./demoRun";

/**
 * Transport for one scripted demo: one button and a bar.
 *
 * WHY THIS IS A SEPARATE ELEMENT:
 *
 * A demo spans components that are not in one tree — the palette types, a card
 * converses, another card appears — so the controls cannot hang off any one of
 * them. As an element the page places it where it belongs on that page, which
 * on the landing is a strip under each desktop.
 *
 * WHY IT TAKES A NAME:
 *
 * The page now runs more than one. `run="tour"` and `run="launcher"` are two
 * transports over two independent runs, and neither can pause, replay or
 * mis-report the other. The element still knows nothing about what a step
 * involves — that is what lets the bar be honest: it moves when something has
 * actually happened, never on a timer guessing how long a Wizard will take.
 *
 * A name nobody has claimed is not an error. The run is created idle and
 * stepless, `present` stays false, and this renders nothing — which is also
 * what happens on a page whose script never starts.
 */
const props = defineProps({
  /** Which run to drive. A string, the way custom-element attributes arrive. */
  run: { type: String, default: "tour" },
});

const run = computed(() => demoRun(props.run));

const label = { play: "Play", pause: "Pause", replay: "Replay" } as const;

/** Reactive reads, short enough to keep the template honest about its source. */
const control = computed(() => run.value.control.value);
const phase = computed(() => run.value.phase.value);
const step = computed(() => run.value.step.value);
const steps = computed(() => run.value.steps.value);
const progress = computed(() => run.value.progress.value);
const present = computed(() => run.value.present.value);

function press(): void {
  if (control.value === "pause") run.value.pause();
  else if (control.value === "play") run.value.resume();
  else run.value.replay();
}

/**
 * What the demo is doing, in words, beside the bar.
 *
 * The last milestone reached rather than the next one: a bar that names what
 * it is about to do is making a promise on the Wizard's behalf, and the Wizard
 * is the part that can take an unpredictable amount of time.
 */
const caption = () => {
  if (phase.value === "idle") return "Waiting to start";
  if (phase.value === "stopped") return "You took over";
  if (phase.value === "finished") return "Done";
  return steps.value[Math.max(0, step.value - 1)] ?? steps.value[0] ?? "";
};
</script>

<template>
  <!--
    Nothing at all until a director has claimed this run. The element can be
    dropped into a page whose palette never starts one, and a Replay button for
    a demo that never plays would be a control over nothing.
  -->
  <div v-if="present" class="controls" role="group" aria-label="Demo playback">
    <button
      type="button"
      class="controls-btn"
      :aria-label="label[control]"
      :title="label[control]"
      @click="press"
    >
      <svg v-if="control === 'pause'" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="7" y="5" width="3.5" height="14" rx="1" fill="currentColor" />
        <rect x="13.5" y="5" width="3.5" height="14" rx="1" fill="currentColor" />
      </svg>
      <svg v-else-if="control === 'play'" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 5.5 18.5 12 8 18.5z" fill="currentColor" />
      </svg>
      <svg v-else viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M20 12a8 8 0 1 1-2.34-5.66"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        />
        <path d="M20 4v4.5h-4.5" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>

    <div class="controls-body">
      <!--
        Der feste Teil links sagt, was das hier ist, der wechselnde rechts, wo
        es steht. Ohne den festen Teil sah die Pille aus wie Bedienelemente des
        Produkts — sie liegt auf demselben Wallpaper wie die Karten, und
        "DONE" mit einem Fortschrittsbalken kann alles Mögliche meinen.
      -->
      <p class="controls-head">
        <span class="controls-title">Demo playback</span>
        <span class="controls-caption">{{ caption() }}</span>
      </p>
      <!--
        `aria-valuenow` in steps, not percent: the same reason the bar exists
        in steps at all, and it lets a screen reader say "2 of 5" instead of a
        number nobody can act on.
      -->
      <div
        class="controls-track"
        role="progressbar"
        :aria-valuenow="step"
        aria-valuemin="0"
        :aria-valuemax="steps.length"
        :aria-valuetext="`${step} of ${steps.length}`"
      >
        <i :style="{ width: `${progress * 100}%` }" />
      </div>
    </div>
  </div>
</template>

<style>
:host {
  display: block;
  font-family: inherit;
  color: rgba(var(--fg-rgb, 255, 255, 255), 0.75);
}

.controls {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px 8px 8px;
  border: 1px solid rgba(var(--fg-rgb, 255, 255, 255), 0.12);
  border-radius: 999px;
  background: rgba(var(--surface-bg-rgb, 28, 28, 32), 0.72);
  backdrop-filter: blur(16px);
}

.controls-btn {
  flex: none;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: rgba(var(--fg-rgb, 255, 255, 255), 0.1);
  color: rgba(var(--fg-rgb, 255, 255, 255), 0.92);
  cursor: pointer;
}

.controls-btn:hover {
  background: rgba(var(--fg-rgb, 255, 255, 255), 0.18);
}

.controls-btn svg {
  width: 16px;
  height: 16px;
}

.controls-body {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.controls-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin: 0;
  font-size: 11px;
  line-height: 1;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.controls-title {
  flex: none;
  font-weight: 600;
  color: rgba(var(--fg-rgb, 255, 255, 255), 0.72);
}

.controls-caption {
  min-width: 0;
  color: rgba(var(--fg-rgb, 255, 255, 255), 0.45);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.controls-track {
  height: 4px;
  border-radius: 999px;
  background: rgba(var(--fg-rgb, 255, 255, 255), 0.14);
  overflow: hidden;
}

.controls-track i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: rgba(var(--fg-rgb, 255, 255, 255), 0.72);
  /*
   * The bar moves in five jumps, so it gets a transition — without one a
   * milestone reads as a glitch rather than as progress. Long enough to be
   * seen, short enough not to lag behind the thing it is describing.
   */
  transition: width 420ms cubic-bezier(0.22, 1, 0.36, 1);
}

@media (prefers-reduced-motion: reduce) {
  .controls-track i {
    transition: none;
  }
}
</style>
