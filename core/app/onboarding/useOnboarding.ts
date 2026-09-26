import { computed, type ComputedRef } from "vue";
import { kavibayCockpitOpen, type CockpitTrigger } from "../host/cockpitSession";
import { revealGesture } from "../host/revealGesture";
import { isGalleryWidget } from "../host/builtinWidgetIds";
import {
  advanceStep,
  declinedState,
  defaultActiveState,
  stateAfterSetup,
  ONBOARDING_CORE_DONE_STEP,
  ONBOARDING_DONE_STEP,
  ONBOARDING_HOTKEY_STEP,
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
   * The hotkey step, passed by bringing the window back with the keystroke the
   * step just taught.
   *
   * Gated on both facts Rust reports, and on which gesture this machine has.
   * `revealed` alone would count a toggle that only closed the cockpit; the
   * trigger alone would count the tray icon, and on Windows and macOS also
   * Shift+Ctrl+Space — all of which reach Kavibay, none of which is the gesture
   * the card asked for. A machine with no keystroke at all (`revealGesture`
   * null) can never pass this way, which is why the card there offers a plain
   * acknowledgement instead of waiting.
   *
   * There is nothing to check on the closing half. Neither the Windows hook nor
   * the macOS monitor sees keys while our own webview has focus, so the only way
   * to be revealed by a double tap is to have been hidden first.
   */
  function notifyCockpitRevealed(trigger: CockpitTrigger, revealed: boolean) {
    if (!revealed || revealGesture.value == null || trigger !== revealGesture.value) return;
    const s = onboardingState.value;
    if (s?.status !== "active" || s.step !== ONBOARDING_HOTKEY_STEP) return;
    onboardingState.value = advanceStep(s);
    persistOnboardingState();
    // The window was hidden a moment ago; the coach has to measure again before
    // it can place the next bubble.
    bumpCoachReveal();
  }

  /**
   * Give up on the keystroke and move on.
   *
   * Two ways to get here. On Windows and macOS the gesture needs Rust to watch
   * the keyboard, and on Windows there are places the hook is not called: an RDP
   * session, a window running elevated while we are not, some game overlays. On
   * Linux the fallback is an ordinary accelerator that another program may
   * hold. If none is free at all, the card never asks the user to press
   * anything. Holding the tour hostage to a keystroke the machine may never
   * deliver would strand exactly the users who most need the rest of it.
   */
  function skipHotkeyStep() {
    const s = onboardingState.value;
    if (s?.status !== "active" || s.step !== ONBOARDING_HOTKEY_STEP) return;
    onboardingState.value = advanceStep(s);
    persistOnboardingState();
    bumpCoachReveal();
  }

  /**
   * Begin the tour for somebody who has just answered the setup card.
   *
   * Same guard as `startIfNeeded` — a stored record means this profile has
   * toured and must not be dragged through it again — but it starts past the
   * welcome step, which that card has already delivered.
   */
  function startAfterSetup() {
    if (loadStoredRaw() != null) return;
    onboardingState.value = stateAfterSetup();
    lastHiddenWidgetName.value = null;
    persistOnboardingState();
    bumpCoachReveal();
  }

  /**
   * The user answered setup and does not want the tour.
   *
   * Written, not skipped: an unwritten record is what makes the tour start on
   * its own, so leaving it blank would ask this person again tomorrow.
   */
  function declineTour() {
    if (loadStoredRaw() != null) return;
    onboardingState.value = declinedState();
    lastHiddenWidgetName.value = null;
    persistOnboardingState();
  }

  /**
   * Step 3: user typed the demo search term.
   * Advances on typing alone — do not require launching (that dismisses the cockpit).
   * Returns true when the step advanced.
   */
  function notifyPaletteQuery(query: string): boolean {
    const s = onboardingState.value;
    if (s?.status !== "active" || s.step !== 3) return false;
    if (query.trim().toLowerCase() !== "notepad") return false;
    onboardingState.value = advanceStep(s);
    persistOnboardingState();
    return true;
  }

  /** Step 4: widget gallery became visible. */
  function notifyGalleryVisible() {
    advanceIfStep(4);
  }

  /**
   * A widget was added: step 4 when it is the gallery itself appearing, step 5
   * for anything the user then added from it.
   */
  function notifyWidgetAdded(typeId: string) {
    if (isGalleryWidget(typeId)) {
      notifyGalleryVisible();
      return;
    }
    advanceIfStep(5);
  }

  /** A widget became visible again; only the gallery's own return is a step. */
  function notifyWidgetVisible(typeId: string) {
    if (isGalleryWidget(typeId)) notifyGalleryVisible();
  }

  /** Step 7: user dragged a widget. */
  function notifyWidgetMoved(typeId: string) {
    if (isGalleryWidget(typeId)) return;
    advanceIfStep(7);
  }

  /** Step 8: user resized a widget. */
  function notifyWidgetResized(typeId: string) {
    if (isGalleryWidget(typeId)) return;
    advanceIfStep(8);
  }

  /** Step 9: user toggled pin on a widget. */
  function notifyPinToggled(typeId: string) {
    if (isGalleryWidget(typeId)) return;
    advanceIfStep(9);
  }

  /**
   * Step 10: user hid a widget (data kept).
   * `displayName` is remembered for the restore-step copy.
   */
  function notifyWidgetHidden(typeId: string, displayName: string) {
    if (isGalleryWidget(typeId)) return;
    const s = onboardingState.value;
    if (s?.status === "active" && s.step === 10) {
      const trimmed = displayName.trim();
      lastHiddenWidgetName.value = trimmed.length > 0 ? trimmed : null;
      onboardingState.value = advanceStep(s);
      persistOnboardingState();
    }
  }

  /** Step 11: user revealed a soft-hidden widget. */
  function notifyWidgetRestored(typeId: string) {
    if (isGalleryWidget(typeId)) return;
    advanceIfStep(11);
  }

  /** Step 12: user removed a widget (data deleted). */
  function notifyWidgetRemoved(typeId: string | undefined) {
    if (!typeId || isGalleryWidget(typeId)) return;
    advanceIfStep(12);
  }

  /** Leave the welcome intro and start teaching step 1. */
  function acknowledgeIntro() {
    const s = onboardingState.value;
    if (s?.status !== "active" || s.step !== ONBOARDING_INTRO_STEP) return;
    onboardingState.value = advanceStep(s);
    persistOnboardingState();
    bumpCoachReveal();
  }

  /**
   * Take the six optional lessons offered by the core card.
   *
   * Plain `advanceStep`, because step 7 is simply what follows step 6 — the
   * branch is in the card's two buttons, not in the state machine, and keeping
   * it that way means `stepBack` out of the extras lands back on the offer.
   */
  function continueToExtras() {
    const s = onboardingState.value;
    if (s?.status !== "active" || s.step !== ONBOARDING_CORE_DONE_STEP) return;
    onboardingState.value = advanceStep(s);
    persistOnboardingState();
    bumpCoachReveal();
  }

  /**
   * Finish at the core card without taking the extras.
   *
   * `skipTour` under a different name, and the name matters: from here it is
   * somebody who finished the tour, not somebody who abandoned it. The stored
   * step records which of the two happened.
   */
  function finishAtCore() {
    const s = onboardingState.value;
    if (s?.status !== "active" || s.step !== ONBOARDING_CORE_DONE_STEP) return;
    onboardingState.value = skipTour(s);
    lastHiddenWidgetName.value = null;
    persistOnboardingState();
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
    startAfterSetup,
    declineTour,
    notifyCockpitRevealed,
    skipHotkeyStep,
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
    continueToExtras,
    finishAtCore,
    acknowledgeDone,
    stepBack,
    skipTourAction,
    replay,
    continueTour,
  };
}
