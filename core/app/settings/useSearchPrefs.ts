import { computed, readonly, ref } from "vue";
import type { SearchActionId } from "../palette/searchActions";
import { loadSearchPrefs, moveSearchAction, saveSearchPrefs, type SearchActionPreference } from "./searchPrefsLogic";

const prefs = ref(loadSearchPrefs());
const enabledActions = computed(() => prefs.value.filter((row) => row.enabled).map((row) => row.id));

function update(next: SearchActionPreference[]) {
  saveSearchPrefs(next);
  prefs.value = next;
}

/** Shared order and visibility for Settings and the palette, persisted by the durable mirror. */
export function useSearchPrefs() {
  function setEnabled(id: SearchActionId, enabled: boolean) {
    update(prefs.value.map((row) => row.id === id ? { ...row, enabled } : row));
  }
  function move(id: SearchActionId, direction: -1 | 1) {
    update(moveSearchAction(prefs.value, id, direction));
  }
  return { prefs: readonly(prefs), enabledActions, setEnabled, move };
}
