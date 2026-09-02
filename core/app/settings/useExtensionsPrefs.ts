import { computed, type Ref, ref } from "vue";
import {
  listExtensions,
  type RegisteredExtension,
} from "../extensions/registry";
import {
  isExtensionIdEnabled,
  loadExtensionsPrefs,
  saveExtensionsPrefs,
} from "./extensionsPrefsLogic";

const initial = loadExtensionsPrefs();
/** Disabled extension ids (reactive source of truth for host + palette). */
const disabledIds: Ref<string[]> = ref([...initial.disabledIds]);

/** Persist current disabled-id list. */
function persist() {
  saveExtensionsPrefs({ disabledIds: [...disabledIds.value] });
}

/**
 * App-wide extension enable/disable shared by Settings, host, and palette.
 * Discovery still loads all extensions; this only controls catalog visibility.
 */
export function useExtensionsPrefs() {
  /** True when the extension is enabled (default). */
  function isEnabled(typeId: string): boolean {
    return isExtensionIdEnabled(typeId, disabledIds.value);
  }

  /** Enable or disable an extension and persist. */
  function setEnabled(typeId: string, enabled: boolean) {
    const next = new Set(disabledIds.value);
    if (enabled) next.delete(typeId);
    else next.add(typeId);
    disabledIds.value = [...next].sort();
    persist();
  }

  /** Full catalog filtered to currently enabled extensions. */
  const enabledExtensions = computed(() =>
    listExtensions().filter((ext) => ext.isWidget && isEnabled(ext.id)),
  );

  /** All discovered extensions (for the Settings toggles list). */
  function allExtensions(): RegisteredExtension[] {
    return listExtensions();
  }

  return {
    disabledIds,
    enabledExtensions,
    allExtensions,
    isEnabled,
    setEnabled,
  };
}
