<script setup lang="ts">
import { computed, inject, onMounted, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import ConnectionSelect from "../settings/credentials/ConnectionSelect.vue";
import { widgetConnectionOwner, connectionEpoch } from "../settings/credentials/connections";
import CockpitWidgetSettings from "../extension-host/ui/CockpitWidgetSettings.vue";
import { packageDefinitionId, extensionHost, instanceConfig, updateInstanceConfig } from "../extension-host/cockpit";

const props = defineProps<{ packageId: string }>();
const instanceId = inject<string>("widgetInstanceId");
if (!instanceId) throw new Error("widgetInstanceId missing");
const boundId = instanceId;
const types = ref<string[]>([]);
const error = ref("");
onMounted(async () => {
  try { types.value = await invoke("connections_package_types", { id: props.packageId }); }
  catch (cause) { error.value = String(cause); }
});
const definitionId = computed(() => packageDefinitionId(props.packageId));
function changed() {
  const definition = definitionId.value && extensionHost.registry.widget(definitionId.value);
  if (!definition) return;
  const values = { ...instanceConfig(boundId) };
  for (const [key, field] of Object.entries(definition.widget.configuration ?? {})) {
    if (field.source) values[key] = undefined;
  }
  updateInstanceConfig(boundId, values);
}
</script>
<template>
  <ConnectionSelect :owner="widgetConnectionOwner(boundId)" :type-ids="types" :package-id="packageId" @changed="changed" />
  <p v-if="error" role="alert">{{ error }}</p>
  <CockpitWidgetSettings v-if="definitionId" :key="connectionEpoch" :definition-id="definitionId" />
</template>
