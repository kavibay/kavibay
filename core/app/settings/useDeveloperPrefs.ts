import { type Ref, ref } from "vue";
import { loadDeveloperPrefs, saveDeveloperPrefs } from "./developerPrefsLogic";

const initial = loadDeveloperPrefs();
/** Developer Extensions gate (reactive source of truth). */
const developerExtensionsEnabled: Ref<boolean> = ref(initial.developerExtensionsEnabled);
/** Wizard consent bypass — see `DeveloperPrefs.wizardAutoEnable`. */
const wizardAutoEnable: Ref<boolean> = ref(initial.wizardAutoEnable);

/** Persist current developer prefs. */
function persist() {
  saveDeveloperPrefs({
    developerExtensionsEnabled: developerExtensionsEnabled.value,
    wizardAutoEnable: wizardAutoEnable.value,
  });
}

/**
 * App-wide Developer Extensions gate shared by Settings and runtime loader.
 * Default off until explicitly enabled.
 */
export function useDeveloperPrefs() {
  /** Enable or disable developer extensions and persist. */
  function setDeveloperExtensionsEnabled(on: boolean) {
    developerExtensionsEnabled.value = on;
    // Leaving developer mode must not leave a consent bypass armed behind it.
    if (!on) wizardAutoEnable.value = false;
    persist();
  }

  /** Enable or disable the wizard's consent bypass and persist. */
  function setWizardAutoEnable(on: boolean) {
    // Belt and braces: the normalizer enforces this too, but the ref is read
    // directly by the wizard and must never be true on its own.
    wizardAutoEnable.value = on && developerExtensionsEnabled.value;
    persist();
  }

  return {
    developerExtensionsEnabled,
    setDeveloperExtensionsEnabled,
    wizardAutoEnable,
    setWizardAutoEnable,
  };
}
