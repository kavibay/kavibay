<script setup lang="ts">
import type { WidgetDefinitionId } from "@sdk/contract/sdk";

/**
 * The placeholder for a widget that cannot render. Two causes, kept distinct
 * because they point at different bugs:
 *
 *  - `unloaded` is gate state `missing-definition` — the extension failed to
 *    link and was unloaded while a saved layout still references its widget.
 *  - `no-view` is a registered definition with no entry in `widgetViews`. The
 *    contract half exists and the model was built; only the Vue half is
 *    missing. Saying "not loaded" here would send someone to the registry to
 *    look for a problem that is not there.
 *
 * Both show the id on purpose. A blank card is indistinguishable from a widget
 * that renders nothing, and the id is what makes the cause searchable.
 */
withDefaults(
  defineProps<{ definitionId: WidgetDefinitionId; reason?: "unloaded" | "no-view" }>(),
  { reason: "unloaded" },
);
</script>

<template>
  <div class="broken" role="alert">
    <p class="headline">Widget unavailable</p>
    <code class="id">{{ definitionId }}</code>
    <p class="hint">
      {{ reason === "no-view" ? "No view is registered for it." : "Its extension is not loaded." }}
    </p>
  </div>
</template>

<style scoped>
.broken {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  height: 100%;
  padding: 12px;
  box-sizing: border-box;
  text-align: center;
  border: 1px dashed rgba(var(--fg-rgb), 0.25);
  border-radius: 8px;
}

.headline {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.id {
  font-size: 11px;
  overflow-wrap: anywhere;
  color: rgba(var(--fg-rgb), 0.7);
}

.hint {
  margin: 0;
  font-size: 11px;
  color: rgba(var(--fg-rgb), 0.5);
}
</style>
