<script setup lang="ts">
import { computed, inject, ref, watch } from "vue";
import { extensionHost, instanceConfig, updateInstanceConfig } from "../cockpit";
import ConnectionSelect from "../../settings/credentials/ConnectionSelect.vue";
import { connectionEpoch, widgetConnectionOwner } from "../../settings/credentials/connections";
import { listLlmCatalog } from "../../settings/ai/aiApi";

const props = defineProps<{ definitionId: string }>();
const instanceId = inject<string>("widgetInstanceId");
if (!instanceId) throw new Error("widgetInstanceId missing");
const boundInstanceId = instanceId;
const found = computed(() => extensionHost.registry.widget(props.definitionId));
const widget = computed(() => found.value?.widget);

/**
 * Only for code the user has to approve. A grant is per account, so picking an
 * account the install consent did not cover needs its own approval — without
 * this the picker could choose an account the widget is then refused, with no
 * way on screen to allow it. Bundled widgets need no grant and get no button.
 */
const packageId = computed(() => {
  const ext = found.value?.ext;
  return ext && (ext.trust === "generated" || ext.trust === "untrusted")
    ? ext.manifest.name
    : undefined;
});
const aiTypes = ref<string[]>([]);
watch(() => widget.value?.capabilities, async capabilities => {
  if (capabilities?.llm || capabilities?.wizard) {
    aiTypes.value = [...new Set((await listLlmCatalog()).map(model => model.credentialType))];
  }
}, { immediate: true });
const typeIds = computed(() => [...new Set([
  ...(widget.value?.requires?.providers ?? []).flatMap(id => {
    const type = extensionHost.registry.providers.get(id)?.def.credentialType;
    return type ? [type] : [];
  }),
  ...aiTypes.value,
])]);

function changed() {
  // Workspace-specific IDs must be chosen again in the new connection.
  const values = { ...instanceConfig(boundInstanceId) };
  for (const [key, field] of Object.entries(widget.value?.configuration ?? {})) {
    if (field.source) values[key] = undefined;
  }
  updateInstanceConfig(boundInstanceId, values);
}
</script>

<template>
  <ConnectionSelect
    :owner="widgetConnectionOwner(boundInstanceId)"
    :type-ids="typeIds"
    :package-id="packageId"
    @changed="changed"
  />
  <slot :key="connectionEpoch" />
</template>
