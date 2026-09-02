/** localStorage key for guided tour progress (v2 adds the welcome intro). */
export const ONBOARDING_STORAGE_KEY = "kavibay:onboarding-v2";

/** Number of teaching steps (excludes welcome intro and the final “you're set” card). */
export const ONBOARDING_TEACHING_STEPS = 9;

/** Welcome card before teaching starts. */
export const ONBOARDING_INTRO_STEP = 1;

/** Completion card after the last teaching step. */
export const ONBOARDING_DONE_STEP = 11;

/**
 * 1 intro · 2 app · 3 gallery · 4 add · 5 move · 6 resize · 7 pin ·
 * 8 hide · 9 restore · 10 delete · 11 done
 */
export type OnboardingStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

export type OnboardingState = {
  status: "active" | "completed";
  /** Meaningful while status === "active"; kept on completed for debugging. */
  step: OnboardingStep;
};

/** Fresh tour at the welcome intro. */
export function defaultActiveState(): OnboardingState {
  return { status: "active", step: ONBOARDING_INTRO_STEP };
}

/** True when `n` is a valid onboarding step id. */
function isStep(n: unknown): n is OnboardingStep {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 11;
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

/** True for the centered welcome / completion cards (no arrow target). */
export function isCardStep(step: OnboardingStep): boolean {
  return step === ONBOARDING_INTRO_STEP || step === ONBOARDING_DONE_STEP;
}

/**
 * 1–9 index into the teaching sequence for status UI.
 * Null on the intro and completion cards.
 */
export function teachingProgressIndex(step: OnboardingStep): number | null {
  if (isCardStep(step)) return null;
  return step - 1;
}

/** Status-bar label while the tour is active. */
export function onboardingStatusLabel(state: OnboardingState): string | null {
  if (state.status !== "active") return null;
  if (state.step === ONBOARDING_DONE_STEP) return "Tour complete";
  if (state.step === ONBOARDING_INTRO_STEP) return "Tour";
  const index = teachingProgressIndex(state.step);
  if (index == null) return "Tour";
  return `Tour ${index}/${ONBOARDING_TEACHING_STEPS}`;
}

/** Arc + label model for the palette status control. */
export type OnboardingProgress = {
  /** Current teaching index (1–9), or 0 on intro / `total` on the completion card. */
  current: number;
  total: number;
  /** 0–1 fraction of the arc to fill. */
  ratio: number;
  label: string;
};

/** Progress for the status-bar arc; null when the tour is not active. */
export function onboardingProgress(state: OnboardingState): OnboardingProgress | null {
  if (state.status !== "active") return null;
  const total = ONBOARDING_TEACHING_STEPS;
  const label = onboardingStatusLabel(state);
  if (label == null) return null;
  if (state.step === ONBOARDING_DONE_STEP) {
    return { current: total, total, ratio: 1, label };
  }
  if (state.step === ONBOARDING_INTRO_STEP) {
    return { current: 0, total, ratio: 0, label };
  }
  const index = teachingProgressIndex(state.step) ?? 0;
  return {
    current: index,
    total,
    ratio: index / total,
    label,
  };
}
