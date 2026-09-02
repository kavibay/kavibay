import { computed, ref, type ComputedRef, type Ref } from "vue";
import {
  addCustomFolder,
  isBuiltinFolderEnabled,
  loadFolderPrefs,
  removeCustomFolder,
  renameCustomFolder,
  saveFolderPrefs,
  setBuiltinFolderEnabled,
  setCustomFolderAliases,
  type CustomFolder,
  type FolderPrefs,
} from "./folderPrefsLogic";

/** Reactive source of truth for the palette folder catalog (Settings + palette). */
const prefs: Ref<FolderPrefs> = ref(loadFolderPrefs());

/** Apply an immutable prefs update and persist it. */
function update(next: FolderPrefs) {
  prefs.value = next;
  saveFolderPrefs(next);
}

/**
 * Which folders the palette can jump to: the built-ins the user kept on, plus
 * folders they added themselves.
 */
export function useFolderPrefs() {
  const customFolders: ComputedRef<CustomFolder[]> = computed(() => prefs.value.custom);

  /** True when this built-in folder is searchable (default). */
  function isBuiltinEnabled(id: string): boolean {
    return isBuiltinFolderEnabled(prefs.value, id);
  }

  /** Switch a built-in folder on or off. */
  function setBuiltinEnabled(id: string, enabled: boolean) {
    update(setBuiltinFolderEnabled(prefs.value, id, enabled));
  }

  /** Add a folder the user picked; an already-listed path changes nothing. */
  function addFolder(path: string, title?: string) {
    update(addCustomFolder(prefs.value, path, title));
  }

  /** Remove one of the user's own folders. */
  function removeFolder(id: string) {
    update(removeCustomFolder(prefs.value, id));
  }

  /** Rename one of the user's own folders. */
  function renameFolder(id: string, title: string) {
    update(renameCustomFolder(prefs.value, id, title));
  }

  /** Replace the extra search terms of one of the user's own folders. */
  function setFolderAliases(id: string, aliases: readonly string[]) {
    update(setCustomFolderAliases(prefs.value, id, aliases));
  }

  return {
    prefs,
    customFolders,
    isBuiltinEnabled,
    setBuiltinEnabled,
    addFolder,
    removeFolder,
    renameFolder,
    setFolderAliases,
  };
}
