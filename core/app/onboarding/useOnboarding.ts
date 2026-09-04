import { computed, type ComputedRef } from "vue";
import { kavibayCockpitOpen } from "../host/cockpitSession";
import { isGalleryWidget } from "../host/builtinWidgetIds";
import {
  advanceStep,
  defaultActiveState,
  ONBOARDING_DONE_STEP,
  ONBOARDING_INTRO_STEP,
  onboardingProgress,
  onboardingStatusLabel,
  replayOnboarding,
  shouldAutoStartOnboarding,
  skipTour,
  retreatStep,
  type OnboardingProgress,
  type OnboardingStep,
} from "./onboardingLogic";
import {
  bumpCoachReveal,
  lastHiddenWidgetName,
  loadStoredRaw,
  onboardingHydrated,
  onboardingReady,
  onboardingState,
  persistOnboardingState,
} from "./onboardingSession";

/** Advance when the active step matches `step`. */
function advanceIfStep(step: OnboardingStep) {
  const s = onboardingState.value;
  if (s?.status === "active" && s.step === step) {
    onboardingState.value = advanceStep(s);
    persistOnboardingState();
  }
}

/**
 * App-wide guided onboarding state and event hooks.
 * Callers pass palette/gallery/widget events in; no DOM here.
 *
 * EVERY WIDGET EVENT CARRIES ITS TYPE ID, AND THE FILTERING HAPPENS HERE.
 *
 * The tour teaches by having the user act on a widget they added *from* the
 * gallery, so the gallery's own move/resize/pin/hide/remove events must not
 * advance it. That used to be `if (typeId !== "gallery")` at nine call sites in
 * the host — the same rule restated once per event, with the widget's name
 * spelled into a file that has no other business knowing it, and nothing
 * connecting the nine to each other. A caller that forgot the guard would have
 * advanced the tour on the wrong action, silently.
 *
 * The host now reports what happened and to which type; which of those count is
 * this module's judgement, made once.
 */
export function useOnboarding() {
  const activeStep: ComputedRef<OnboardingStep | null> = computed(() => {
    const s = onboardingState.value;
    return s?.status === "active" ? s.step : null;
  });

  const statusLabel: ComputedRef<string | null> = computed(() => {
    const s = onboardingState.value;
    return s != null ? onboardingStatusLabel(s) : null;
  });

  /** Arc progress for the palette status control (null when inactive). */
  const progress: ComputedRef<OnboardingProgress | null> = computed(() => {
    const s = onboardingState.value;
    return s != null ? onboardingProgress(s) : null;
  });

  /**
   * Auto-start on true first open when no onboarding key exists yet.
   * Pass the boolean return value of consumeFirstOpen().
   */
  function startIfNeeded(firstOpenConsumed: boolean) {
    // A missing WebView cache is not a new user. Wait for AppData before
    // deciding whether the one-time tour should begin.
    if (!onboardingHydrated.value) {
      void onboardingReady.then(() => startIfNeeded(firstOpenConsumed));
      return;
    }
    const storedRaw = loadStoredRaw();
    if (shouldAutoStartOnboarding({ firstOpenConsumed, storedRaw })) {
      onboardingState.value = defaultActiveState();
      lastHiddenWidgetName.value = null;
      persistOnboardingState();
      bumpCoachReveal();
    }
  }

  /**
   * Step 2: user typed the demo search term.
   * Advances on typing alone — do not require launching (that dismisses the cockpit).
   * Returns true when the step advanced.
   */
  function notifyPaletteQuery(query: string): boolean {
    const s = onboardingState.value;
    if (s?.status !== "active" || s.step !== 2) return false;
    if (query.trim().toLowerCase() !== "notepad") return false;
    onboardingState.value = advanceStep(s);
    persistOnboardingState();
    return true;
  }

  /** Step 3: widget gallery became visible. */
  function notifyGalleryVisible() {
    advanceIfStep(3);
  }

  /**
   * A widget was added: step 3 when it is the gallery itself appearing, step 4
   * for anything the user then added from it.
   */
  function notifyWidgetAdded(typeId: string) {
    if (isGalleryWidget(typeId)) {
      notifyGalleryVisible();
      return;
    }
    advanceIfStep(4);
  }

  /** A widget became visible again; only the gallery's own return is a step. */
  function notifyWidgetVisible(typeId: string) {
    if (isGalleryWidget(typeId)) notifyGalleryVisible();
  }

  /** Step 5: user dragged a widget. */
  function notifyWidgetMoved(typeId: string) {
    if (isGalleryWidget(typeId)) return;
    advanceIfStep(5);
  }

  /** Step 6: user resized a widget. */
  function notifyWidgetResized(typeId: string) {
    if (isGalleryWidget(typeId)) return;
    advanceIfStep(6);
  }

  /** Step 7: user toggled pin on a widget. */
  function notifyPinToggled(typeId: string) {
    if (isGalleryWidget(typeId)) return;
    advanceIfStep(7);
  }

  /**
   * Step 8: user hid a widget (data kept).
   * `displayName` is remembered for the restore-step copy.
   */
  function notifyWidgetHidden(typeId: string, displayName: string) {
    if (isGalleryWidget(typeId)) return;
    const s = onboardingState.value;
    if (s?.status === "active" && s.step === 8) {
      const trimmed = displayName.trim();
      lastHiddenWidgetName.value = trimmed.length > 0 ? trimmed : null;
      onboardingState.value = advanceStep(s);
      persistOnboardingState();
    }
  }

  /** Step 9: user revealed a soft-hidden widget. */
  function notifyWidgetRestored(typeId: string) {
    if (isGalleryWidget(typeId)) return;
    advanceIfStep(9);
  }

  /** Step 10: user removed a widget (data deleted). */
  function notifyWidgetRemoved(typeId: string | undefined) {
    if (!typeId || isGalleryWidget(typeId)) return;
    advanceIfStep(10);
  }

  /** Leave the welcome intro and start teaching step 1. */
  function acknowledgeIntro() {
    const s = onboardingState.value;
    if (s?.status !== "active" || s.step !== ONBOARDING_INTRO_STEP) return;
    onboardingState.value = advanceStep(s);
    persistOnboardingState();
    bumpCoachReveal();
  }

  /** Finish the completion card (Got it). */
  function acknowledgeDone() {
    const s = onboardingState.value;
    if (s?.status !== "active" || s.step !== ONBOARDING_DONE_STEP) return;
    onboardingState.value = advanceStep(s);
    lastHiddenWidgetName.value = null;
    persistOnboardingState();
  }

  /** Go back one step (including from the completion card). */
  function stepBack() {
    const s = onboardingState.value;
    if (s == null) return;
    onboardingState.value = retreatStep(s);
    persistOnboardingState();
    bumpCoachReveal();
  }

  /** Dismiss the whole tour (skips the completion card). */
  function skipTourAction() {
    const s = onboardingState.value;
    if (s == null) return;
    onboardingState.value = skipTour(s);
    lastHiddenWidgetName.value = null;
    persistOnboardingState();
  }

  /** Reset tour to the welcome intro (Settings → Replay Tour). */
  function replay() {
    onboardingState.value = replayOnboarding();
    lastHiddenWidgetName.value = null;
    persistOnboardingState();
    kavibayCockpitOpen.value = true;
    bumpCoachReveal();
  }

  /**
   * Re-open the cockpit so the current-step coach bubble and targets are usable.
   * Palette callers should also emit `palette:show` to focus the search field.
   */
  function continueTour() {
    kavibayCockpitOpen.value = true;
    bumpCoachReveal();
  }

  return {
    /** Same ref as `onboardingSession.onboardingState` — prefer that for overlay UI. */
    state: onboardingState,
    activeStep,
    statusLabel,
    progress,
    lastHiddenWidgetName,
    persist: persistOnboardingState,
    startIfNeeded,
    notifyPaletteQuery,
    notifyGalleryVisible,
    notifyWidgetAdded,
    notifyWidgetVisible,
    notifyWidgetMoved,
    notifyWidgetResized,
    notifyPinToggled,
    notifyWidgetHidden,
    notifyWidgetRestored,
    notifyWidgetRemoved,
    acknowledgeIntro,
    acknowledgeDone,
    stepBack,
    skipTourAction,
    replay,
    continueTour,
  };
}
