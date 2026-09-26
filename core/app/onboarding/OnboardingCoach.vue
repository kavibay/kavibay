<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  watch,
} from "vue";
import { kavibayCockpitOpen } from "../host/cockpitSession";
import { revealGesture, revealGestureKnown } from "../host/revealGesture";
import { keyPlatform } from "../host/shortcutHints";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { syncInteractiveRegions } from "../system/clickThrough";
import {
  arrowPath,
  bubbleAnchorForTarget,
  type BubblePlacement,
  type Point,
  type Rect,
} from "./onboardingArrow";
import { onboardingCopyForStep, onboardingHotkeyFallbackCopy } from "./onboardingCopy";
import {
  isCardStep,
  isCoachVisible,
  ONBOARDING_CORE_DONE_STEP,
  ONBOARDING_DONE_STEP,
  ONBOARDING_HOTKEY_STEP,
  ONBOARDING_INTRO_STEP,
} from "./onboardingLogic";
import {
  bumpCoachReveal,
  coachRevealEpoch,
  lastHiddenWidgetName,
  onboardingState,
} from "./onboardingSession";
import { useOnboarding } from "./useOnboarding";

// Read tour state from the session module (not destructured useOnboarding return)
// so Vite HMR of the composable cannot leave the coach on a stale ref while the
// palette status bar updates a newer one.
const state = onboardingState;
const {
  notifyGalleryVisible,
  acknowledgeIntro,
  acknowledgeDone,
  stepBack,
  skipTourAction,
  skipHotkeyStep,
  continueToExtras,
  finishAtCore,
} = useOnboarding();

/**
 * True once the tour has shown itself again because the double tap never came.
 *
 * Session-only, deliberately: it describes this attempt at the step, not the
 * user's progress, and a stored copy would still claim the machine was broken
 * after they fixed whatever was eating the keystroke. Stepping back into the
 * step, or replaying the tour, starts the attempt over.
 */
const hotkeyRescued = ref(false);

const visible = computed(
  () => state.value != null && isCoachVisible(state.value),
);
const platform = keyPlatform();
const copy = computed(() => {
  if (state.value?.status !== "active") return null;
  if (state.value.step === ONBOARDING_HOTKEY_STEP && hotkeyRescued.value) {
    return onboardingHotkeyFallbackCopy(revealGesture.value, platform);
  }
  return onboardingCopyForStep(state.value.step, platform, {
    hiddenWidgetName: lastHiddenWidgetName.value,
    revealGesture: revealGesture.value,
  });
});

/**
 * True when this machine has no keystroke to teach at all.
 *
 * The card then states the tray route and offers the way on immediately: there
 * is nothing to press, so there is nothing to wait for, and making the user sit
 * out the rescue timer to be told the same thing would be a seven-second pause
 * for no reason. Gated on the host having answered, so the "no gesture" branch
 * cannot flash up before Rust replies.
 */
const hotkeyStepHasNothingToPress = computed(
  () => revealGestureKnown.value && revealGesture.value === null,
);
const isHotkeyStep = computed(() => state.value?.step === ONBOARDING_HOTKEY_STEP);
const isCoreDoneStep = computed(() => state.value?.step === ONBOARDING_CORE_DONE_STEP);
const isIntroStep = computed(() => state.value?.step === ONBOARDING_INTRO_STEP);
const isDoneStep = computed(() => state.value?.step === ONBOARDING_DONE_STEP);
const isCenteredCard = computed(
  () => state.value != null && isCardStep(state.value.step),
);
const canStepBack = computed(
  () => state.value?.status === "active" && state.value.step > 1,
);

const bubbleEl = ref<HTMLElement | null>(null);
/** Fallback origin so a missed layout pass still leaves a readable card on screen. */
const bubbleStyle = ref<Record<string, string>>({ left: "24px", top: "24px" });
const pathD = ref("");
const tipD = ref("");
let resizeObserver: ResizeObserver | null = null;
let movementObserver: MutationObserver | null = null;

/** Preferred bubble placement for the active teaching step. */
function preferredPlacement(step: number | undefined): BubblePlacement {
  // Resize: sit below the SE corner so the bubble does not cover the card.
  if (step === 8) return "below-left";
  // Gallery / move: sit beside the card.
  if (step === 5 || step === 7) return "left-of";
  // Pin / hide / delete prefer above (layout falls back to left-of if tight).
  return "above-left";
}

/** True for steps that teach widget chrome (pin / hide / delete). */
function isChromeCoachStep(step: number | undefined): boolean {
  return step === 9 || step === 10 || step === 12;
}

/** Resolve the element highlighted by the current onboarding step. */
function resolveTarget(): Element | null {
  const step = state.value?.step;
  if (step == null || isCardStep(step)) return null;
  if (step === 3 || step === 4 || step === 11) {
    return document.querySelector('[data-onboarding-target="palette-search"]');
  }
  if (step === 5) {
    return (
      document.querySelector('[data-onboarding-target="widget-gallery"]') ??
      document.querySelector('[data-onboarding-target="widgets-button"]')
    );
  }
  if (step === 7) {
    return document.querySelector('[data-onboarding-target="widget-drag"]');
  }
  if (step === 8) {
    return (
      document.querySelector('[data-onboarding-target="widget-resize-se"]') ??
      document.querySelector('[data-onboarding-target="widget-drag"]')
    );
  }
  if (step === 9) {
    return (
      document.querySelector(
        '.widget-card-chrome--coach [data-onboarding-target="widget-pin"]',
      ) ?? document.querySelector('[data-onboarding-target="widget-pin"]')
    );
  }
  if (step === 10 || step === 12) {
    return (
      document.querySelector(
        '.widget-card-chrome--coach [data-onboarding-target="widget-hide"]',
      ) ??
      document.querySelector(
        '.widget-card-chrome-btn--coach-hide[data-onboarding-target="widget-hide"]',
      ) ??
      document.querySelector('[data-onboarding-target="widget-hide"]')
    );
  }
  return null;
}

/** Convert a DOMRect to the small geometry contract used by arrow helpers. */
function targetRect(target: Element): Rect {
  const rect = target.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * Rect used to park the bubble. Chrome steps use the whole card so the bubble
 * sits above/beside the widget while the arrow still tips at the control.
 */
function placementRectFor(target: Element, step: number | undefined): Rect {
  if (isChromeCoachStep(step)) {
    const card =
      target.closest(".widget-card") ?? target.closest(".widget-anchor");
    if (card) return targetRect(card);
  }
  return targetRect(target);
}

/** True when the bubble fits between the viewport top and the card. */
function fitsAboveCard(placeBox: Rect, bubbleHeight: number, gap = 20): boolean {
  return placeBox.top - gap - 12 >= bubbleHeight;
}

/** Clamp a bubble origin so coach controls remain inside the viewport. */
function clampBubble(point: Point, width: number, height: number): Point {
  const inset = 12;
  return {
    x: Math.min(Math.max(point.x, inset), Math.max(inset, window.innerWidth - width - inset)),
    y: Math.min(Math.max(point.y, inset), Math.max(inset, window.innerHeight - height - inset)),
  };
}

/** True when two axis-aligned boxes overlap (inclusive of a small pad). */
function rectsOverlap(a: Rect, b: Rect, pad = 8): boolean {
  return !(
    a.left + a.width + pad <= b.left ||
    b.left + b.width + pad <= a.left ||
    a.top + a.height + pad <= b.top ||
    b.top + b.height + pad <= a.top
  );
}

/** Place the completion card near the viewport center (no arrow target). */
function layoutDoneCard(bubble: HTMLElement) {
  const bubbleBox = bubble.getBoundingClientRect();
  const origin = clampBubble(
    {
      x: (window.innerWidth - bubbleBox.width) / 2,
      y: Math.max(48, window.innerHeight * 0.28 - bubbleBox.height / 2),
    },
    bubbleBox.width,
    bubbleBox.height,
  );
  bubbleStyle.value = {
    left: `${origin.x}px`,
    top: `${origin.y}px`,
  };
  pathD.value = "";
  tipD.value = "";
  void nextTick().then(syncInteractiveRegions);
}

/** Measure target and bubble, then draw a dashed arrow between their edges. */
function layout() {
  if (!visible.value || !copy.value) return;
  const bubble = bubbleEl.value;
  if (!bubble) return;

  if (isCenteredCard.value) {
    layoutDoneCard(bubble);
    return;
  }

  const target = resolveTarget();
  if (!target) {
    bubbleStyle.value = { left: "24px", top: "24px" };
    pathD.value = "";
    tipD.value = "";
    void nextTick().then(syncInteractiveRegions);
    return;
  }

  const tipBox = targetRect(target);
  const placeBox = placementRectFor(target, state.value?.step);
  const bubbleBox = bubble.getBoundingClientRect();
  const step = state.value?.step;
  let preferred = preferredPlacement(step);

  // Pin / hide / delete: park above the card when there is room, else left.
  if (isChromeCoachStep(step)) {
    preferred = fitsAboveCard(placeBox, bubbleBox.height)
      ? "above-left"
      : "left-of";
  }

  let anchor = bubbleAnchorForTarget(placeBox, preferred);

  let desired =
    preferred === "left-of"
      ? { x: anchor.x - bubbleBox.width, y: anchor.y - bubbleBox.height / 2 }
      : preferred === "below-left"
        ? { x: anchor.x - bubbleBox.width, y: anchor.y }
        : preferred === "above-left" && isChromeCoachStep(step)
          ? // Center the chrome tip card above the widget.
            {
              x: placeBox.left + (placeBox.width - bubbleBox.width) / 2,
              y: placeBox.top - 20 - bubbleBox.height,
            }
          : { x: anchor.x - bubbleBox.width, y: anchor.y - bubbleBox.height };

  let origin = clampBubble(desired, bubbleBox.width, bubbleBox.height);

  // If above was chosen but clamping shoved us onto the card, sit left instead.
  if (isChromeCoachStep(step) && preferred === "above-left") {
    const placed: Rect = {
      left: origin.x,
      top: origin.y,
      width: bubbleBox.width,
      height: bubbleBox.height,
    };
    if (rectsOverlap(placed, placeBox)) {
      preferred = "left-of";
      anchor = bubbleAnchorForTarget(placeBox, preferred);
      origin = clampBubble(
        {
          x: anchor.x - bubbleBox.width,
          y: anchor.y - bubbleBox.height / 2,
        },
        bubbleBox.width,
        bubbleBox.height,
      );
    }
  }

  bubbleStyle.value = {
    left: `${origin.x}px`,
    top: `${origin.y}px`,
  };

  const from =
    preferred === "left-of"
      ? { x: origin.x + bubbleBox.width, y: origin.y + bubbleBox.height / 2 }
      : preferred === "below-left"
        ? { x: origin.x + bubbleBox.width, y: origin.y }
        : isChromeCoachStep(step)
          ? // Centered above the card — shoot the arrow from the bottom middle.
            {
              x: origin.x + bubbleBox.width / 2,
              y: origin.y + bubbleBox.height,
            }
          : { x: origin.x + bubbleBox.width, y: origin.y + bubbleBox.height };
  // Tip always aims at the chrome control (or other resolved target), not the card.
  const to =
    preferred === "below-left"
      ? {
          x: tipBox.left + tipBox.width / 2,
          y: tipBox.top + tipBox.height,
        }
      : preferred === "above-left"
        ? {
            x: tipBox.left + tipBox.width / 2,
            y: tipBox.top,
          }
        : {
            x: tipBox.left,
            y: tipBox.top + tipBox.height / 2,
          };
  const path = arrowPath(from, to);
  pathD.value = path.d;
  tipD.value = path.tip;
  void nextTick().then(syncInteractiveRegions);
}

/** Reconnect geometry observers when the coach target can change. */
function reconnectResizeObserver() {
  resizeObserver?.disconnect();
  movementObserver?.disconnect();
  if (!visible.value) return;

  resizeObserver ??= new ResizeObserver(layout);
  movementObserver ??= new MutationObserver(layout);
  const target = resolveTarget();
  const palette = document.querySelector(".palette-anchor");
  const widgetAnchor = target?.closest(".widget-anchor") ?? null;
  if (target) {
    resizeObserver.observe(target);
    movementObserver.observe(target, { attributes: true, attributeFilter: ["style", "class"] });
  }
  if (palette && palette !== target) {
    resizeObserver.observe(palette);
    // Palette movement uses a transform, which ResizeObserver does not report.
    movementObserver.observe(palette, { attributes: true, attributeFilter: ["style"] });
  }
  if (widgetAnchor && widgetAnchor !== target && widgetAnchor !== palette) {
    resizeObserver.observe(widgetAnchor);
    movementObserver.observe(widgetAnchor, { attributes: true, attributeFilter: ["style"] });
  }
}

watch(
  [visible, () => state.value?.step, kavibayCockpitOpen, coachRevealEpoch],
  async () => {
    // Post-flush so v-if has mounted the bubble before we measure it.
    await nextTick();
    // A pre-existing Gallery does not emit a fresh mount event when step 4 starts.
    if (
      state.value?.status === "active" &&
      state.value.step === 4 &&
      document.querySelector('[data-onboarding-target="widget-gallery"]')
    ) {
      notifyGalleryVisible();
      await nextTick();
    }
    // Chrome for pin/hide mounts with the step change — wait a frame if needed.
    const step = state.value?.step;
    if (step === 9 || step === 10 || step === 12) {
      for (let i = 0; i < 4 && !resolveTarget(); i += 1) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
    }
    // One more frame so palette-search exists after replay → palette:show.
    if (!resolveTarget() && (step === 3 || step === 4 || step === 11)) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    reconnectResizeObserver();
    layout();
  },
  { flush: "post" },
);

/**
 * How long the tour waits, after the user has hidden it, before assuming the
 * double tap will not bring it back.
 *
 * Long enough for a second, slower attempt — the first tap of a pair often
 * misses while the gesture is still new — and short enough that somebody whose
 * machine swallows the keystroke is not left staring at a desktop with no
 * Kavibay on it, wondering what they broke. This is the one step that can strand
 * a user, so it is also the one that comes looking for them.
 */
const HOTKEY_RESCUE_MS = 7000;

let rescueTimer: ReturnType<typeof setTimeout> | undefined;

function clearRescueTimer() {
  if (rescueTimer !== undefined) {
    clearTimeout(rescueTimer);
    rescueTimer = undefined;
  }
}

/** Show the window again and tell the user what else reaches Kavibay. */
async function rescueHotkeyStep() {
  rescueTimer = undefined;
  if (state.value?.status !== "active" || state.value.step !== ONBOARDING_HOTKEY_STEP) return;
  hotkeyRescued.value = true;
  kavibayCockpitOpen.value = true;
  try {
    await getCurrentWindow().show();
    await getCurrentWindow().setFocus();
  } catch {
    // No Tauri (or a refused show): the card is still correct for whenever the
    // window does come back.
  }
  bumpCoachReveal();
}

/**
 * Arm the rescue while the hotkey step is waiting behind a hidden window.
 *
 * The closing half of the double tap runs in the webview and always works, so
 * `kavibayCockpitOpen` going false during this step means the user did their
 * part. Everything after that depends on a keyboard hook that may never be
 * called — which is what the timer is for.
 */
watch(
  [() => state.value?.step, kavibayCockpitOpen],
  ([step, open]) => {
    if (step !== ONBOARDING_HOTKEY_STEP) {
      clearRescueTimer();
      hotkeyRescued.value = false;
      return;
    }
    // Nothing to press means nothing to wait for; the card already says so and
    // its "Carry on" is showing.
    if (open || hotkeyRescued.value || hotkeyStepHasNothingToPress.value) {
      clearRescueTimer();
      return;
    }
    if (rescueTimer === undefined) {
      rescueTimer = setTimeout(() => void rescueHotkeyStep(), HOTKEY_RESCUE_MS);
    }
  },
  { immediate: true },
);

onMounted(() => {
  resizeObserver = new ResizeObserver(layout);
  movementObserver = new MutationObserver(layout);
  window.addEventListener("resize", layout);
  void nextTick().then(() => {
    reconnectResizeObserver();
    layout();
  });
});
onUnmounted(() => {
  resizeObserver?.disconnect();
  movementObserver?.disconnect();
  window.removeEventListener("resize", layout);
  clearRescueTimer();
});
</script>

<template>
  <div
    v-if="visible && copy"
    class="onboarding-coach"
    aria-live="polite"
  >
    <svg v-if="!isCenteredCard" class="onboarding-arrow" aria-hidden="true">
      <path :d="pathD" class="onboarding-arrow-stroke" />
      <path :d="tipD" class="onboarding-arrow-stroke" />
    </svg>
    <div
      ref="bubbleEl"
      class="onboarding-bubble"
      data-interactive
      :style="bubbleStyle"
    >
      <p class="onboarding-bubble-title">{{ copy.title }}</p>
      <p class="onboarding-bubble-body">
        <template v-for="(seg, i) in copy.segments" :key="i">
          <kbd v-if="seg.typed" class="onboarding-typed">{{ seg.text }}</kbd>
          <template v-else>{{ seg.text }}</template>
        </template>
      </p>
      <div v-if="isCoreDoneStep" class="onboarding-bubble-actions">
        <button type="button" class="onboarding-link" @click="continueToExtras">
          Show me the rest
        </button>
        <div class="onboarding-bubble-actions-end">
          <button type="button" class="onboarding-link" @click="finishAtCore">
            I'm good
          </button>
        </div>
      </div>
      <div v-else class="onboarding-bubble-actions">
        <button
          v-if="canStepBack"
          type="button"
          class="onboarding-link"
          @click="stepBack"
        >
          Step back
        </button>
        <div class="onboarding-bubble-actions-end">
          <button
            v-if="isIntroStep"
            type="button"
            class="onboarding-link"
            @click="acknowledgeIntro"
          >
            Let's go
          </button>
          <button
            v-if="isDoneStep"
            type="button"
            class="onboarding-link"
            @click="acknowledgeDone"
          >
            Got it
          </button>
          <!-- Only offered once the tour has come back on its own: before that
               the way past this step is to perform it, and a visible way out
               would be taken instead of the gesture. -->
          <button
            v-if="isHotkeyStep && (hotkeyRescued || hotkeyStepHasNothingToPress)"
            type="button"
            class="onboarding-link"
            @click="skipHotkeyStep"
          >
            Carry on
          </button>
          <button
            v-if="!isDoneStep"
            type="button"
            class="onboarding-link"
            @click="skipTourAction"
          >
            Skip tour
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.onboarding-coach {
  position: fixed;
  inset: 0;
  z-index: 400;
  pointer-events: none;
}

.onboarding-arrow {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
  /* Softer than the original halo — still helps orange read on light wallpaper. */
  filter: drop-shadow(0 0 1px rgba(255, 255, 255, 0.35));
}

.onboarding-arrow-stroke {
  fill: none;
  stroke: #000;
  stroke-width: 2.4;
  stroke-dasharray: 4 5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.onboarding-bubble {
  --onboarding-ring: #000;
  --onboarding-ring-width: 3px;
  --onboarding-ring-offset: 3px;
  position: absolute;
  max-width: 300px;
  padding: 14px 16px;
  color: rgba(var(--fg-rgb), 0.92);
  /* Same glass language as the palette, slightly more opaque so copy stays clear. */
  background: rgba(var(--surface-bg-rgb), 0.9);
  border: 0;
  border-radius: var(--surface-radius, 16px);
  box-shadow: var(--surface-box-shadow);
  backdrop-filter: var(--surface-backdrop-filter, blur(16px));
  pointer-events: auto;
}

/* Tailwind-style ring: dashed accent outside the fill with a small offset gap. */
.onboarding-bubble::before {
  content: "";
  position: absolute;
  inset: calc(-1 * var(--onboarding-ring-offset) - var(--onboarding-ring-width));
  border: var(--onboarding-ring-width) dashed var(--onboarding-ring);
  border-radius: calc(
    var(--surface-radius, 16px) + var(--onboarding-ring-offset) +
      var(--onboarding-ring-width)
  );
  pointer-events: none;
}

.onboarding-bubble-title,
.onboarding-bubble-body {
  margin: 0;
}

.onboarding-bubble-title {
  font-size: 16px;
  font-weight: 700;
  line-height: 1.25;
}

.onboarding-bubble-body {
  margin-top: 8px;
  font-size: 14px;
  line-height: 1.45;
  color: rgba(var(--fg-rgb), 0.72);
}

.onboarding-typed {
  display: inline;
  padding: 1px 6px;
  font: inherit;
  font-weight: 700;
  font-family: ui-monospace, "Cascadia Code", "Segoe UI Mono", Consolas, monospace;
  color: rgba(var(--fg-rgb), 0.95);
  background: rgba(var(--fg-rgb), 0.12);
  border: 1px solid rgba(var(--fg-rgb), 0.22);
  border-radius: 5px;
}

.onboarding-bubble-actions {
  display: flex;
  gap: 14px;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
}

.onboarding-bubble-actions-end {
  display: flex;
  gap: 14px;
  margin-left: auto;
}

.onboarding-link {
  padding: 0;
  font: inherit;
  font-size: 12px;
  color: rgba(var(--fg-rgb), 0.5);
  cursor: pointer;
  background: none;
  border: 0;
}

.onboarding-link:hover {
  color: rgba(var(--fg-rgb), 0.9);
}
</style>
