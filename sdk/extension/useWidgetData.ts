// SPDX-License-Identifier: MIT
import { onMounted, onUnmounted, ref, shallowRef } from "vue";
import { invoke } from "@tauri-apps/api/core";

/** Minimal def shape for optional backend polling (builtin or runtime stub). */
export type WidgetDataDef = {
  backendCommand?: string;
  refreshInterval?: number;
};

/**
 * Sole place that talks to the backend for extension data polling.
 * Without backendCommand the state stays at initial null (client-owned widgets).
 */
export function useWidgetData<T = unknown>(def: WidgetDataDef) {
  const data = shallowRef<T | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const lastUpdated = ref<Date | null>(null);

  let timer: ReturnType<typeof setInterval> | undefined;

  async function load() {
    if (!def.backendCommand) return;

    if (!("__TAURI_INTERNALS__" in window)) {
      error.value = "Kein Tauri-Kontext — bitte die App nutzen, nicht den Browser-Tab.";
      return;
    }

    loading.value = true;
    try {
      data.value = await invoke<T>(def.backendCommand);
      error.value = null;
      lastUpdated.value = new Date();
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      loading.value = false;
    }
  }

  onMounted(() => {
    if (!def.backendCommand) return;

    void load();
    if (def.refreshInterval) {
      timer = setInterval(() => void load(), def.refreshInterval);
    }
  });

  onUnmounted(() => {
    if (timer) clearInterval(timer);
  });

  return { data, loading, error, lastUpdated };
}
