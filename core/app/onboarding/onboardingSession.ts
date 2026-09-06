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

/**
 * Migrate an existing WebView value once; later starts read the durable copy.
 *
 * `onboarding.json` predates the general durable mirror and predates the step
 * renumbering, and those two facts fight each other: the file holds a step
 * number written under an older numbering, and writing it into today's key
 * unchanged is exactly what moving the key to v3 was meant to prevent. A stored
 * `active` step from back then would resume on whichever lesson now happens to
 * carry that number — silently, and only for someone mid-tour across an update.
 *
 * So only the part that survives renumbering is taken: whether the tour is
 * done. A half-finished older run is recorded as finished rather than resumed
 * on the wrong lesson, which is the lesser of the two wrongs — the alternative
 * is teaching somebody `resize` while the arrow points at the pin button.
 */
export const onboardingReady: Promise<void> = hasTauri()
  ? invoke<string | null>("onboarding_preferences_load")
      .then((raw) => {
        if (raw) {
          const loaded = parseOnboardingState(raw);
          if (loaded) {
            const migrated: OnboardingState =
              loaded.status === "completed" ? loaded : { status: "completed", step: loaded.step };
            onboardingState.value = migrated;
            writeState(migrated);
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
