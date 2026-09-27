import { readonly, ref } from "vue";
import { loadPaletteWidgets, movePaletteWidget, savePaletteWidgets } from "./paletteWidgetPrefsLogic";

const selectedIds = ref(loadPaletteWidgets());

function update(ids: string[]) {
  savePaletteWidgets(ids);
  selectedIds.value = ids;
}

export function usePaletteWidgetPrefs() {
  function setEnabled(id: string, enabled: boolean) {
    const others = selectedIds.value.filter((selected) => selected !== id);
    if (!enabled) update(others);
    else if (!selectedIds.value.includes(id)) update([...others, id]);
  }
  function move(id: string, direction: -1 | 1) {
    update(movePaletteWidget(selectedIds.value, id, direction));
  }
  return { selectedIds: readonly(selectedIds), setEnabled, move };
}
