<script setup lang="ts">
import { computed, inject } from "vue";
import type { ConfigField } from "@sdk/contract/sdk";
import { extensionHost, instanceConfig, updateInstanceConfig } from "../cockpit";
import { loadConfigOptions } from "../configOptions";
import ConfigForm from "./ConfigForm.vue";

/**
 * The widget's settings panel — the same generated form the gate shows when a
 * required field is missing, reachable again afterwards.
 *
 * Without it, `configuration` was a one-way door: the gate asked once and there
 * was no path back, so a Tado tile was stuck on whichever room it was first
 * given. The old widget had a gear for this, and the schema that describes the
 * field is the same one either way — there is no second form to write.
 */
const props = defineProps<{ definitionId: string }>();

const instanceId = inject<string>("widgetInstanceId");
if (!instanceId) throw new Error("widgetInstanceId missing");
const boundInstanceId: string = instanceId;

const definition = computed(() => extensionHost.registry.widget(props.definitionId)?.widget);
const schema = computed(() => definition.value?.configuration ?? {});
const values = computed(() => instanceConfig(boundInstanceId));

/**
 * Nothing is "missing" here — the widget is already running. The gate passes
 * this to mark required fields the user has not filled; in the settings panel
 * every field already has a value.
 */
const missing = computed<string[]>(() => []);

const loadOptions = (field: ConfigField) => loadConfigOptions(extensionHost, field);

/**
 * Writes to the shared reactive config, which the mounted widget is watching —
 * so changing the room remounts it rather than leaving the panel and the tile
 * disagreeing.
 */
function save(next: Record<string, unknown>) {
  updateInstanceConfig(boundInstanceId, next);
}
</script>

<template>
  <ConfigForm
    v-if="Object.keys(schema).length > 0"
    :schema="schema"
    :missing="missing"
    :values="values"
    :load-options="loadOptions"
    @save="save"
  />
  <p v-else class="none">This widget has no settings.</p>
</template>

<style scoped>
.none {
  margin: 0;
  padding: 12px;
  font-size: 12px;
  color: rgba(var(--fg-rgb), 0.55);
}
</style>
