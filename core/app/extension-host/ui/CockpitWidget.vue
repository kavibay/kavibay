<script setup lang="ts">
import { computed, inject, onErrorCaptured, provide, reactive, ref, watch } from "vue";
import type { WidgetInstance } from "@sdk/contract/sdk";
import type { JsonBridge } from "../bridge";
import { useSettingsModal } from "../../settings/useSettingsModal";
import {
  extensionHost,
  instanceConfig,
  updateInstanceConfig,
} from "../cockpit";
import WidgetGate from "./WidgetGate.vue";
import WidgetWizardPreviewHost from "./WidgetWizardPreviewHost.vue";
import PermissionRequest from "./PermissionRequest.vue";

/**
 * Adapter between the cockpit's widget host and the extension host.
 *
 * The cockpit renders a widget by mounting a component and providing
 * `widgetInstanceId`; the extension host wants a `WidgetInstance` and a `Host`.
 * This is the translation, and it is the whole integration — no branch was
 * added to `WidgetHost` or `WidgetInstanceView`, because AGENTS.md is right
 * that per-extension behaviour must not turn into host-side switches. From the
 * cockpit's side these are ordinary first-party extensions.
 */
const props = defineProps<{
  definitionId: string;
  /**
   * Present when this widget's code runs in its own document — a package, not a
   * bundled definition. Passed straight through: the four gate states are
   * host-side facts either way, and only the last branch changes.
   */
  sandbox?: { bridge: JsonBridge; entryUrl: string };
}>();

const instanceId = inject<string>("widgetInstanceId");
if (!instanceId) throw new Error("widgetInstanceId missing");
// Narrowed once: the throw does not carry into the computed below.
const boundInstanceId: string = instanceId;

/** Host chrome exposed to the MIT Widget Wizard without a core import. */
provide("kavibay:widget-wizard-preview", WidgetWizardPreviewHost);
provide("kavibay:widget-wizard-permission-request", PermissionRequest);

/**
 * Position and size are the cockpit's business, not the gate's — it only reads
 * `configuration`. They are filled with the definition's defaults so the shape
 * is honest rather than zeroed.
 */
const definition = computed(() => extensionHost.registry.widget(props.definitionId)?.widget);

// Contract config is the only configuration source. Pre-contract widget keys
// are intentionally not read: this host uses a clean-break storage policy.
const configuration = instanceConfig(boundInstanceId);

const instance = reactive({
  id: boundInstanceId,
  definitionId: props.definitionId,
  // The shared object, not a private copy: the settings panel writes to the
  // same one, and the runtime remounts when it changes.
  configuration,
  position: { x: 0, y: 0 },
  size: definition.value?.defaultSize ?? { w: 2, h: 2 },
  mode: "expanded",
}) as WidgetInstance<Record<string, unknown>>;

/** The gate applies config optimistically; persisting it is the host's job. */
function persist(id: string, values: Record<string, unknown>) {
  updateInstanceConfig(id, values);
}


/**
 * Connect opens the app's one Credentials panel rather than a sign-in of its
 * own. AGENTS.md invariant 5 rules out per-integration credential UI, and it is
 * right to: the device-code flow, its storage and its refresh already exist
 * there, and a second entry point would leave the user with two places to
 * manage the same tado° account.
 */
/**
 * The boundary between extension code and the host's own chrome.
 *
 * Without it, anything thrown below this point propagates into whatever mounted
 * the widget. In the palette's inline view that blanked the panel *and* took
 * the back button with it — the user could neither see the widget nor leave it.
 * A widget failing is ordinary; a widget trapping the user is not.
 *
 * Returning false stops propagation. The gate already renders every failure it
 * knows about (finding 11's error panel); this catches the ones it does not,
 * which by definition are the unexpected ones.
 */
const crashed = ref<string | null>(null);
/**
 * Shown in the panel, not just logged. A crash a user can screenshot is worth
 * more than one that needs devtools open at the right moment — and the first
 * frames are what say *where*, which the message alone never does.
 */
const crashedAt = ref<string | null>(null);

onErrorCaptured((error, _instance, info) => {
  crashed.value = error instanceof Error ? error.message : String(error);
  crashedAt.value = [
    info,
    ...String(error instanceof Error ? error.stack : "")
      .split("\n")
      .slice(1, 4)
      .map((line) => line.trim().replace(/^at\s+/, "").replace(/\?t=\d+/g, "")),
  ]
    .filter(Boolean)
    .join("\n");
  console.error(`[extension-host] ${props.definitionId} crashed during ${info}:`, error);
  return false;
});

const settings = useSettingsModal();
const providerId = computed(() => definition.value?.requires?.providers?.[0]);

function connect() {
  settings.showSection("credentials");
}

// Closing the panel is the earliest moment the answer can have changed, and the
// host process is the only one that knows it.
watch(settings.open, (isOpen) => {
  const id = providerId.value;
  if (!isOpen && id) void extensionHost.refreshProviderStatus(id);
});
</script>

<template>
  <div v-if="crashed" class="crashed" role="alert">
    <p class="headline">Widget stopped</p>
    <code class="id">{{ definitionId }}</code>
    <p class="detail">{{ crashed }}</p>
    <pre v-if="crashedAt" class="where">{{ crashedAt }}</pre>
  </div>

  <WidgetGate
    v-else
    :host="extensionHost"
    :instance="instance"
    :sandbox="sandbox"
    @configure="persist"
    @connect="connect"
  />
</template>

<style scoped>
.crashed {
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

.detail {
  margin: 0;
  font-size: 11px;
  line-height: 1.4;
  overflow-wrap: anywhere;
  color: rgba(var(--fg-rgb), 0.5);
}

.where {
  margin: 4px 0 0;
  padding: 6px 8px;
  max-width: 100%;
  font-size: 9px;
  line-height: 1.35;
  text-align: left;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: rgba(var(--fg-rgb), 0.45);
  background: rgba(var(--fg-rgb), 0.05);
  border-radius: 5px;
}
</style>
