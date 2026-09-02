import { invoke } from "@tauri-apps/api/core";
import { ref, type Ref } from "vue";
import {
  ONBOARDING_STORAGE_KEY,
  parseOnboardingState,
  serializeOnboardingState,
  type OnboardingState,
} from "./onboardingLogic";

const hasTauri = () => "__TAURI_INTERNALS__" in window;

/** Read raw onboarding JSON from localStorage (null on missing or blocked storage). */
export function loadStoredRaw(): string | null {
  try {
    return localStorage.getItem(ONBOARDING_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Persist onboarding state to localStorage. */
export function writeState(next: OnboardingState): void {
  const serialized = serializeOnboardingState(next);
  try {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, serialized);
  } catch {
    // quota / private mode — in-memory state still updates
  }
  if (hasTauri()) {
    void invoke("onboarding_preferences_save", { value: serialized }).catch(() => {});
  }
}

/**
 * Shared tour progress (palette status + coach overlay).
 * Kept in its own module so HMR of useOnboarding / coach does not split the ref
 * the way a module-local `const state = ref(...)` inside useOnboarding would.
 */
export const onboardingState: Ref<OnboardingState | null> = ref(
  parseOnboardingState(loadStoredRaw()),
);

/** Becomes true once AppData has won over the WebView cache. */
export const onboardingHydrated = ref(!hasTauri());

/** Migrate an existing WebView value once; later starts read the durable copy. */
export const onboardingReady: Promise<void> = hasTauri()
  ? invoke<string | null>("onboarding_preferences_load")
      .then((raw) => {
        if (raw) {
          const loaded = parseOnboardingState(raw);
          if (loaded) {
            onboardingState.value = loaded;
            try {
              localStorage.setItem(ONBOARDING_STORAGE_KEY, raw);
            } catch {
              // The AppData value remains authoritative.
            }
          }
        } else if (onboardingState.value) {
          writeState(onboardingState.value);
        }
      })
      .catch(() => {})
      .finally(() => {
        onboardingHydrated.value = true;
      })
  : Promise.resolve();

/** Display name of the widget hidden during step 7 (used in step 8 copy). */
export const lastHiddenWidgetName: Ref<string | null> = ref(null);

/**
 * Bumped on replay / continue so the coach re-layouts even when step is unchanged.
 */
export const coachRevealEpoch = ref(0);

/** Persist current in-memory state when present. */
export function persistOnboardingState() {
  const current = onboardingState.value;
  if (current != null) {
    writeState(current);
  }
}

/** Ask the coach overlay to measure targets and paint again. */
export function bumpCoachReveal() {
  coachRevealEpoch.value += 1;
}
