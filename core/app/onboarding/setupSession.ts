import { ref, type Ref } from "vue";
import {
  completedSetupState,
  parseSetupState,
  pendingSetupState,
  serializeSetupState,
  SETUP_STORAGE_KEY,
  shouldShowSetup,
  type SetupState,
} from "./setupLogic";
import { ONBOARDING_LEGACY_STORAGE_KEYS, ONBOARDING_STORAGE_KEY } from "./onboardingLogic";

/**
 * Whether the setup card is open, and the one write that closes it.
 *
 * No hydration dance here, unlike `onboardingSession`: that module predates the
 * durable mirror and still fetches its own copy from AppData, while
 * `hydrateDurableStorage()` now fills localStorage from disk before `App.vue` is
 * even imported (see `core/app/main.ts`). By the time anything reads this
 * module, `kavibay:setup-v1` is either there or has genuinely never been
 * written.
 *
 * The key is not listed in `settingsSections.ts` on purpose. "Has answered the
 * setup card" is state, not a setting — nobody would hand-edit it, and putting
 * it in `settings.json` would invite exactly that.
 */

/** Raw stored JSON, or null when the key has never been written. */
function loadStoredRaw(): string | null {
  try {
    return localStorage.getItem(SETUP_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Any sign that the tour has run, read only to tell a new install from an
 * existing one.
 *
 * Both keys, because the tour's key moves when its steps are renumbered — a
 * user who toured under v2 has a v2 value and no v3 one, and asking them to
 * configure startup after an update would read as the app having forgotten
 * them. `firstOpenConsumed` normally covers that on its own; this is the belt
 * to its braces, and the reason the durable mirror exists at all is that the
 * WebView has been caught losing a key it swore it had written.
 */
function loadTourStoredRaw(): string | null {
  for (const key of [ONBOARDING_STORAGE_KEY, ...ONBOARDING_LEGACY_STORAGE_KEYS]) {
    try {
      const raw = localStorage.getItem(key);
      if (raw != null && raw !== "") return raw;
    } catch {
      return null;
    }
  }
  return null;
}

function write(next: SetupState): void {
  try {
    localStorage.setItem(SETUP_STORAGE_KEY, serializeSetupState(next));
  } catch {
    // Quota or private mode — in-memory state still closes the card for this
    // session, and the mirror has nothing to carry.
  }
}

/** Shared card state: null until a start decides to open it. */
export const setupState: Ref<SetupState | null> = ref(parseSetupState(loadStoredRaw()));

/**
 * Open the card on a true first open, and record that it was opened.
 *
 * Written as `pending` immediately rather than on the way out: a user who quits
 * during setup has still been asked, and a second prompt on the next start
 * would read as the app not having listened. Pass the return value of
 * `consumeFirstOpen()`.
 */
export function startSetupIfNeeded(firstOpenConsumed: boolean): boolean {
  const storedRaw = loadStoredRaw();
  if (!shouldShowSetup({ firstOpenConsumed, storedRaw, tourStoredRaw: loadTourStoredRaw() })) {
    return false;
  }
  const next = pendingSetupState();
  setupState.value = next;
  write(next);
  return true;
}

/** Close the card for good. */
export function finishSetup(): void {
  const next = completedSetupState();
  setupState.value = next;
  write(next);
}
