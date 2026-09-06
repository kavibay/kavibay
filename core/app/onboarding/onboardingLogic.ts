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
 * # Two sections, one branch
 *
 * The tour used to be one run of nine lessons, six of which taught widget
 * chrome — move, resize, pin, hide, restore, delete — to somebody who had owned
 * a widget for about forty seconds. That is a lot of housekeeping before the
 * user has anything they would miss, and it is what made a one-minute tour take
 * four.
 *
 * So it now stops at [`ONBOARDING_CORE_DONE_STEP`], which is a real ending: the
 * user has reached Kavibay with the keyboard, launched something, and put a
 * widget on the desk. That card offers the rest rather than continuing into it.
 * Nothing was deleted — the six lessons are unchanged, they are just no longer
 * charged to everyone.
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

/**
 * The card that ends the core tour and offers the rest.
 *
 * Both an ending and a branch: `skipTour` from here is somebody finishing, not
 * bailing out, and `advanceStep` is them asking for more.
 */
export const ONBOARDING_CORE_DONE_STEP = 6;

/** Completion card after the optional lessons. */
export const ONBOARDING_DONE_STEP = 13;

/**
 * 1 intro · 2 hotkey · 3 app · 4 gallery · 5 add · **6 core done** ·
 * 7 move · 8 resize · 9 pin · 10 hide · 11 restore · 12 delete · 13 done
 */
export type OnboardingStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;

/** Lessons in the core tour: hotkey, app, gallery, add. */
export const ONBOARDING_CORE_STEPS = ONBOARDING_CORE_DONE_STEP - ONBOARDING_INTRO_STEP - 1;

/** Lessons behind the core card: move, resize, pin, hide, restore, delete. */
export const ONBOARDING_EXTRA_STEPS = ONBOARDING_DONE_STEP - ONBOARDING_CORE_DONE_STEP - 1;

/** True for the four lessons everybody is taught. */
export function isCoreStep(step: OnboardingStep): boolean {
  return step > ONBOARDING_INTRO_STEP && step < ONBOARDING_CORE_DONE_STEP;
}

/** True for the six lessons only somebody who asked for them is taught. */
export function isExtraStep(step: OnboardingStep): boolean {
  return step > ONBOARDING_CORE_DONE_STEP && step < ONBOARDING_DONE_STEP;
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
 * The hotkey step joins the welcome and completion cards here for the same
 * reason they are on the list: an arrow needs something on screen to point at,
 * and a key on the user's keyboard is not on screen.
 */
export function isCardStep(step: OnboardingStep): boolean {
  return (
    step === ONBOARDING_INTRO_STEP ||
    step === ONBOARDING_HOTKEY_STEP ||
    step === ONBOARDING_CORE_DONE_STEP ||
    step === ONBOARDING_DONE_STEP
  );
}

/**
 * Position of `step` within its own section, 1-based, plus that section's size.
 *
 * Counted per section rather than across the whole tour, because the two
 * sections are separate promises. "Tour 4/10" on the last core lesson would
 * describe the user as 40% done when they are in fact one card away from a
 * genuine ending — and somebody who then takes the extras is not resuming a
 * count they abandoned, they are starting a second, shorter thing.
 *
 * Null on the three cards: they are punctuation, not lessons.
 */
export function teachingProgress(
  step: OnboardingStep,
): { index: number; total: number; section: "core" | "extra" } | null {
  if (isCoreStep(step)) {
    return {
      index: step - ONBOARDING_INTRO_STEP,
      total: ONBOARDING_CORE_STEPS,
      section: "core",
    };
  }
  if (isExtraStep(step)) {
    return {
      index: step - ONBOARDING_CORE_DONE_STEP,
      total: ONBOARDING_EXTRA_STEPS,
      section: "extra",
    };
  }
  return null;
}

/**
 * 1-based index into the current section, for status UI.
 * Null on the intro, the core card and the completion card.
 */
export function teachingProgressIndex(step: OnboardingStep): number | null {
  return teachingProgress(step)?.index ?? null;
}

/** Status-bar label while the tour is active. */
export function onboardingStatusLabel(state: OnboardingState): string | null {
  if (state.status !== "active") return null;
  if (state.step === ONBOARDING_DONE_STEP) return "Tour complete";
  // The core card has earned the word: everything the tour promised is done,
  // and whatever comes after it the user asked for.
  if (state.step === ONBOARDING_CORE_DONE_STEP) return "Tour done";
  if (state.step === ONBOARDING_INTRO_STEP) return "Tour";
  const progress = teachingProgress(state.step);
  if (progress == null) return "Tour";
  const name = progress.section === "core" ? "Tour" : "More";
  return `${name} ${progress.index}/${progress.total}`;
}

/** Arc + label model for the palette status control. */
export type OnboardingProgress = {
  /** Position within the current section, or 0 / `total` on that section's cards. */
  current: number;
  /** Size of the current section, not of the whole tour. */
  total: number;
  /** 0–1 fraction of the arc to fill. Fills once per section. */
  ratio: number;
  label: string;
};

/** Progress for the status-bar arc; null when the tour is not active. */
export function onboardingProgress(state: OnboardingState): OnboardingProgress | null {
  if (state.status !== "active") return null;
  const label = onboardingStatusLabel(state);
  if (label == null) return null;
  // Each card reads as the boundary it is: the intro as an empty core, the core
  // card as a full one, the completion card as a full set of extras.
  if (state.step === ONBOARDING_INTRO_STEP) {
    return { current: 0, total: ONBOARDING_CORE_STEPS, ratio: 0, label };
  }
  if (state.step === ONBOARDING_CORE_DONE_STEP) {
    return {
      current: ONBOARDING_CORE_STEPS,
      total: ONBOARDING_CORE_STEPS,
      ratio: 1,
      label,
    };
  }
  if (state.step === ONBOARDING_DONE_STEP) {
    return {
      current: ONBOARDING_EXTRA_STEPS,
      total: ONBOARDING_EXTRA_STEPS,
      ratio: 1,
      label,
    };
  }
  const progress = teachingProgress(state.step);
  if (progress == null) return null;
  return {
    current: progress.index,
    total: progress.total,
    ratio: progress.index / progress.total,
    label,
  };
}
