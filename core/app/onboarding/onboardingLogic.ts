/**
 * localStorage key for guided tour progress.
 *
 * v2 added the welcome intro; v3 inserts the Ctrl double tap as step 2, which
 * renumbers everything after it. A stored v2 step would point at the wrong
 * lesson under the new numbering, so the key moves rather than being migrated —
 * the only readers are `shouldAutoStartOnboarding`, which needs a *missing* key
 * to mean "never toured", and the coach itself. An existing install has
 * `first-open-done` set, so a missing v3 key does not restart their tour; see
 * the assertions.
 */
export const ONBOARDING_STORAGE_KEY = "kavibay:onboarding-v3";

/**
 * Keys earlier versions of the tour wrote.
 *
 * Not parsed — the steps they name no longer mean the same lesson. They are
 * only evidence that this install has toured before, which `setupSession` uses
 * to keep an existing user out of the first-run setup card.
 */
export const ONBOARDING_LEGACY_STORAGE_KEYS = ["kavibay:onboarding-v2"] as const;

/**
 * Welcome card before teaching starts.
 *
 * # Four lessons and an ending
 *
 * The tour teaches what makes Kavibay worth keeping — reach it with the
 * keyboard, launch something, put a widget on the desk — and then stops. It
 * used to carry six more lessons on widget chrome (move, resize, pin, hide,
 * restore, delete), offered from the ending card. Hardly anybody takes a second
 * tour, and the few who do learn chrome better at the moment they first reach
 * for it, so those lessons are now one-time tips the host shows in context
 * (`firstTimeTips.ts`).
 */
export const ONBOARDING_INTRO_STEP = 1;

/**
 * The Ctrl double tap.
 *
 * Named because it is the one step the tour cannot teach by pointing at
 * something: there is no control on screen, the gesture makes the whole window
 * go away, and it is passed only when the user brings it back. Everything about
 * how it is presented keys off this constant rather than the number 2.
 */
export const ONBOARDING_HOTKEY_STEP = 2;

/**
 * The lesson that opens the Widget Gallery.
 *
 * Named because the host places the gallery differently while it is the step
 * being taught — palette-width, directly above the palette, so the thing the
 * arrow points at reads as part of the same surface instead of a card that
 * happened to land nearby. See `galleryTourPlacement.ts`.
 */
export const ONBOARDING_GALLERY_STEP = 4;

/** The card that ends the tour. */
export const ONBOARDING_DONE_STEP = 6;

/** 1 intro · 2 hotkey · 3 app · 4 gallery · 5 add · 6 done */
export type OnboardingStep = 1 | 2 | 3 | 4 | 5 | 6;

/** Lessons between the two cards: hotkey, app, gallery, add. */
export const ONBOARDING_LESSONS = ONBOARDING_DONE_STEP - ONBOARDING_INTRO_STEP - 1;

/** True for the four lessons, false for the intro and the ending card. */
export function isLessonStep(step: OnboardingStep): boolean {
  return step > ONBOARDING_INTRO_STEP && step < ONBOARDING_DONE_STEP;
}

export type OnboardingState = {
  status: "active" | "completed";
  /** Meaningful while status === "active"; kept on completed for debugging. */
  step: OnboardingStep;
};

/** Fresh tour at the welcome intro. */
export function defaultActiveState(): OnboardingState {
  return { status: "active", step: ONBOARDING_INTRO_STEP };
}

/**
 * Where the tour starts for somebody who has just answered the setup card.
 *
 * Past the welcome step, because that card *is* the welcome: it carries the
 * same greeting and the same promise of a one-minute tour, and showing the
 * bubble version of it immediately afterwards is the same sentence twice with a
 * click in between. Replay Tour still starts at the intro — there is no card in
 * front of it then, and a refresher with no opening is abrupt.
 */
export function stateAfterSetup(): OnboardingState {
  return { status: "active", step: ONBOARDING_HOTKEY_STEP };
}

/**
 * The tour declined from the setup card.
 *
 * Recorded as completed rather than left unwritten: an absent record means
 * "never toured", which is what makes the tour start by itself, so leaving it
 * absent would ask again on the next start — and this user has just said no.
 */
export function declinedState(): OnboardingState {
  return { status: "completed", step: ONBOARDING_INTRO_STEP };
}

/** True when `n` is a valid onboarding step id. */
function isStep(n: unknown): n is OnboardingStep {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= ONBOARDING_DONE_STEP;
}

/** Parse stored JSON; null if missing/invalid. */
export function parseOnboardingState(raw: string | null): OnboardingState | null {
  if (raw == null || raw === "") return null;
  try {
    const parsed = JSON.parse(raw) as Partial<OnboardingState>;
    if (parsed.status !== "active" && parsed.status !== "completed") return null;
    if (!isStep(parsed.step)) return null;
    return { status: parsed.status, step: parsed.step };
  } catch {
    return null;
  }
}

/** Serialize for localStorage. */
export function serializeOnboardingState(state: OnboardingState): string {
  return JSON.stringify(state);
}

/**
 * Auto-start only on true first open when no onboarding key exists yet.
 * Veterans with first-open-done already set are not forced into the tour.
 */
export function shouldAutoStartOnboarding(opts: {
  firstOpenConsumed: boolean;
  storedRaw: string | null;
}): boolean {
  return opts.firstOpenConsumed && opts.storedRaw == null;
}

/** Advance one step, or finish after the completion card. Idempotent when completed. */
export function advanceStep(state: OnboardingState): OnboardingState {
  if (state.status !== "active") return state;
  if (state.step === ONBOARDING_DONE_STEP) {
    return { status: "completed", step: ONBOARDING_DONE_STEP };
  }
  return { status: "active", step: (state.step + 1) as OnboardingStep };
}

/** Go back one step. No-op on the intro or when already completed. */
export function retreatStep(state: OnboardingState): OnboardingState {
  if (state.status !== "active" || state.step === ONBOARDING_INTRO_STEP) {
    return state;
  }
  return { status: "active", step: (state.step - 1) as OnboardingStep };
}

/** Dismiss the whole tour (skips the completion card). */
export function skipTour(state: OnboardingState): OnboardingState {
  return { status: "completed", step: state.step };
}

/** Reset for Replay Tour. */
export function replayOnboarding(): OnboardingState {
  return defaultActiveState();
}

/**
 * Coach paints while the tour is active.
 * Not gated on cockpitOpen — pinned palette can stay up after the session
 * closes, and the status control can bring the bubble back via continue.
 */
export function isCoachVisible(state: OnboardingState): boolean {
  return state.status === "active";
}

/**
 * True for steps drawn as a centered card with no arrow.
 *
 * The hotkey step joins the welcome and ending cards here for the same
 * reason they are on the list: an arrow needs something on screen to point at,
 * and a key on the user's keyboard is not on screen.
 */
export function isCardStep(step: OnboardingStep): boolean {
  return (
    step === ONBOARDING_INTRO_STEP ||
    step === ONBOARDING_HOTKEY_STEP ||
    step === ONBOARDING_DONE_STEP
  );
}

/** 1-based lesson index for status UI; null on the two cards. */
export function teachingProgressIndex(step: OnboardingStep): number | null {
  return isLessonStep(step) ? step - ONBOARDING_INTRO_STEP : null;
}

/** Status-bar label while the tour is active. */
export function onboardingStatusLabel(state: OnboardingState): string | null {
  if (state.status !== "active") return null;
  if (state.step === ONBOARDING_DONE_STEP) return "Tour done";
  const index = teachingProgressIndex(state.step);
  return index == null ? "Tour" : `Tour ${index}/${ONBOARDING_LESSONS}`;
}

/** Arc + label model for the palette status control. */
export type OnboardingProgress = {
  /** Lessons done: 0 on the intro, all of them on the ending card. */
  current: number;
  total: number;
  /** 0–1 fraction of the arc to fill. */
  ratio: number;
  label: string;
};

/** Progress for the status-bar arc; null when the tour is not active. */
export function onboardingProgress(state: OnboardingState): OnboardingProgress | null {
  const label = onboardingStatusLabel(state);
  if (label == null) return null;
  const current =
    state.step === ONBOARDING_DONE_STEP
      ? ONBOARDING_LESSONS
      : (teachingProgressIndex(state.step) ?? 0);
  return { current, total: ONBOARDING_LESSONS, ratio: current / ONBOARDING_LESSONS, label };
}
