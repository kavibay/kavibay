<script setup lang="ts">
import { computed } from "vue";
import type { ConfigField, ProviderId, WidgetInstance } from "@sdk/contract/sdk";
import type { Host } from "../runtime";
import type { JsonBridge } from "../bridge";
import { useWidgetRuntime } from "../useWidgetRuntime";
import { widgetViews } from "../widgetViews";
import { loadConfigOptions } from "../configOptions";
import BrokenWidget from "./BrokenWidget.vue";
import ConnectPrompt from "./ConnectPrompt.vue";
import ConfigForm from "./ConfigForm.vue";
import WidgetSkeleton from "./WidgetSkeleton.vue";
import WidgetError from "./WidgetError.vue";
import SandboxedWidgetFrame from "./SandboxedWidgetFrame.vue";

/**
 * PHASE 3 — the single entry point for rendering a widget instance.
 *
 * This component is the whole reason a widget contains no lifecycle code: it
 * resolves the gate, mounts through `buildWidgetContext`, and renders exactly
 * one of six things. The widget's own view is the last branch and the only one
 * that can see data.
 *
 * The ordering is `Host.widgetGate`'s, not this file's — connect before
 * configure, because a provider-backed config field has nothing to offer until
 * the provider is live.
 */
const props = defineProps<{
  host: Host;
  instance: WidgetInstance<any>;
  /**
   * Present when this widget runs in a sandboxed frame instead of in this
   * document. Only the last branch changes: the four gate states are host-side
   * facts and are answered here either way, so a sandboxed widget gets the same
   * connect prompt and the same settings form as any other.
   */
  sandbox?: { bridge: JsonBridge; entryUrl: string };
}>();

const emit = defineEmits<{
  /** Phase 4 owns the actual OAuth flow; the gate only asks for it. */
  connect: [provider: ProviderId];
  /** The owner persists the layout; the gate applies it optimistically. */
  configure: [instanceId: string, values: Record<string, unknown>];
}>();

// The sandboxed frame does its own mounting, in its own document. This runtime
// still resolves the gate; it just does not call setup.
const runtime = useWidgetRuntime(props.host, props.instance, { mount: !props.sandbox });

const definition = computed(() => props.host.registry.widget(props.instance.definitionId));
const schema = computed(() => definition.value?.widget.configuration ?? {});

/** Manifest display name, so the connect prompt says "Tado" and not an id. */
const providerName = computed(() => {
  const id = runtime.provider.value?.id;
  return id ? props.host.registry.providers.get(id)?.def.displayName : undefined;
});

const view = computed(() => widgetViews[props.instance.definitionId]);

/** Provider-backed `select` options, resolved against this gate's own host. */
const loadOptions = (field: ConfigField) => loadConfigOptions(props.host, field);

function save(values: Record<string, unknown>) {
  Object.assign(props.instance.configuration as object, values);
  emit("configure", props.instance.id, values);
  runtime.refresh();
}
</script>

<template>
  <BrokenWidget
    v-if="runtime.phase.value === 'missing-definition'"
    :definition-id="instance.definitionId"
  />

  <ConnectPrompt
    v-else-if="runtime.phase.value === 'provider' && runtime.provider.value"
    :provider="runtime.provider.value.id"
    :status="runtime.provider.value.status"
    :display-name="providerName"
    @connect="emit('connect', runtime.provider.value!.id)"
  />

  <ConfigForm
    v-else-if="runtime.phase.value === 'unconfigured'"
    :schema="schema"
    :missing="runtime.missingConfig.value"
    :values="instance.configuration"
    :load-options="loadOptions"
    @save="save"
  />

  <WidgetSkeleton v-else-if="runtime.phase.value === 'loading'" />

  <WidgetError
    v-else-if="runtime.phase.value === 'error' && runtime.error.value"
    :error="runtime.error.value"
    @retry="runtime.retry()"
  />

  <!--
    Ready, and the widget runs elsewhere. The frame owns the rest of the gate
    from here — skeleton and error, by the same rules and with the same
    components, because `setup` and its queries are on the far side of the
    channel and only it knows when they have settled.
  -->
  <SandboxedWidgetFrame
    v-else-if="sandbox"
    :bridge="sandbox.bridge"
    :instance="instance"
    :entry-url="sandbox.entryUrl"
  />

  <!-- The only branch that renders extension markup, and only on success. -->
  <component
    :is="view"
    v-else-if="view && runtime.model.value"
    :model="runtime.model.value"
  />

  <!--
    Reached when the gate says ready but no Vue view is registered for the
    definition. The model exists; only the presentation half is missing.
  -->
  <BrokenWidget v-else :definition-id="instance.definitionId" reason="no-view" />
</template>
