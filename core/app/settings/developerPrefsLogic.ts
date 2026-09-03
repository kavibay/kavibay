/** Persistence for the Developer Extensions gate (on out of the box). */

export interface DeveloperPrefs {
  developerExtensionsEnabled: boolean;
  /**
   * Let the Widget Wizard enable what it just built without the consent step.
   *
   * Ships on (see DEFAULT_DEVELOPER_PREFS) for demos and fast iteration, and it
   * is the one setting that hands a package network access and a credential
   * grant without showing anyone what it may reach. Kept as its own flag rather
   * than riding on `developerExtensionsEnabled`, because that one is merely
   * "show me packages" — wizard-built packages are visible without it
   * (`runtimeExtVisible`), so reusing it would have turned the consent step off
   * for everyone.
   */
  wizardAutoEnable: boolean;
}

export const DEVELOPER_PREFS_KEY = "kavibay:developer-v1";

/**
 * What a profile with no stored record starts from — the shipped default.
 *
 * Deliberately not the same as "a record that says nothing":
 * `normalizeDeveloperPrefs` still reads every missing or non-boolean field as
 * off, so a corrupt or hand-truncated record fails closed. Only the absence of
 * a record at all lands here.
 */
export const DEFAULT_DEVELOPER_PREFS: DeveloperPrefs = {
  developerExtensionsEnabled: true,
  wizardAutoEnable: true,
};

/** Normalize persisted prefs; unknown shape → defaults. */
export function normalizeDeveloperPrefs(raw: unknown): DeveloperPrefs {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const enabled = o.developerExtensionsEnabled === true;
  // Skipping consent is meaningless without developer mode and dangerous if it
  // could outlive it, so it is stored *and* read as a conjunction: turning
  // Developer Extensions off takes the bypass with it, in this session and in
  // every later one that reads the same record.
  return {
    developerExtensionsEnabled: enabled,
    wizardAutoEnable: enabled && o.wizardAutoEnable === true,
  };
}

/** Load developer prefs from localStorage. */
export function loadDeveloperPrefs(): DeveloperPrefs {
  try {
    const raw = localStorage.getItem(DEVELOPER_PREFS_KEY);
    if (!raw) return { ...DEFAULT_DEVELOPER_PREFS };
    return normalizeDeveloperPrefs(JSON.parse(raw) as unknown);
  } catch {
    return { ...DEFAULT_DEVELOPER_PREFS };
  }
}

/** Persist normalized developer prefs. */
export function saveDeveloperPrefs(state: DeveloperPrefs): void {
  localStorage.setItem(
    DEVELOPER_PREFS_KEY,
    JSON.stringify(normalizeDeveloperPrefs(state)),
  );
}
