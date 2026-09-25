<script setup lang="ts">
import { computed } from "vue";
import RuntimeExtensionFrame from "../runtime/RuntimeExtensionFrame.vue";
import ContractPackageWidget from "../extension-host/ui/ContractPackageWidget.vue";
import CockpitWidgetSettings from "../extension-host/ui/CockpitWidgetSettings.vue";
import { extensionHost, packageDefinitionId } from "../extension-host/cockpit";
import type { HostExtensionRef } from "../runtime/runtimeTypes";
import type { WidgetInstance, WidgetProps } from "./types";
import { isGalleryWidget } from "./builtinWidgetIds";
import { canEditInWizard } from "./wizardEditable";
import { useWidgetData } from "@sdk/useWidgetData";
import WidgetCard from "./WidgetCard.vue";
import { connectionEpoch } from "../settings/credentials/connections";

const props = defineProps<{
  instance: WidgetInstance;
  /** Builtin Vue component or runtime HostExtensionRef (iframe via RuntimeExtensionFrame). */
  def: HostExtensionRef;
  /** Brief search-result flash highlight from the palette. */
  highlighted?: boolean;
  /** Palette row is selected; card stays in stack and shows a ring. */
  previewed?: boolean;
  /** When true, Remove menu offers scoped vs global delete. */
  multiDeskRemove?: boolean;
}>();

defineEmits<{
  rename: [title: string | undefined];
  "update:hideTitle": [hideTitle: boolean];
  duplicate: [];
  about: [];
  /** Reopen this widget's package in the Wizard; carries the package id. */
  "edit-in-wizard": [packageId: string];
  hide: [];
  "move-to-panel": [];
  remove: [mode: "desk" | "everywhere"];
  "toggle-pin": [];
  "move-pointerdown": [event: PointerEvent];
  resize: [
    payload: {
      width: number;
      height: number;
      deltaOffset: { x: number; y: number };
      contentScale?: number;
      edge?: string;
    },
  ];
  "resize-end": [];
  "update:contentScale": [scale: number];
}>();

const isRuntime = computed(() => props.def.origin === "runtime");

/** Built here, so the Wizard has a draft to reopen. */
const wizardEditable = computed(() => canEditInWizard(props.def));

/**
 * Which frame a package gets, from the manifest's own discriminator.
 *
 * The two speak different protocols and neither answers the other's messages,
 * so this is not a preference: a contract package in `RuntimeExtensionFrame`
 * has its handshake dropped without a word and renders black.
 */
const isContractPackage = computed(
  () => isRuntime.value && props.def.packageFormat === "contract",
);

/**
 * The gear for a contract **package**, which nothing was providing.
 *
 * A bundled contract widget gets `settingsComponent` from `cockpit.ts`, whose
 * comment names the exact failure: "without it the gate's form is a one-way
 * door: asked once, never reachable again." A package takes the
 * `origin === "runtime"` branch instead, where `def` comes from the runtime
 * extensions list — a shape that has never heard of a contract `configuration`.
 * So the gate asked for a WAQI token once, and after it was answered the form
 * was gone for good.
 *
 * Derived from the loaded definition rather than from the manifest on disk: the
 * definition is what the widget actually runs with, and its `configuration` has
 * already been through `widgetPackageManifest`.
 */
const contractSettingsId = computed(() => {
  if (!isContractPackage.value) return undefined;
  const definitionId = packageDefinitionId(props.def.id);
  if (!definitionId) return undefined;
  const fields = extensionHost.registry.widget(definitionId)?.widget.configuration;
  return fields && Object.keys(fields).length > 0 ? definitionId : undefined;
});

const state = useWidgetData(props.def);

/** Keep the generic widget props reactive as backend data changes. */
const widgetProps = computed<WidgetProps>(() => ({
  data: state.data.value,
  loading: state.loading.value,
  error: state.error.value,
  lastUpdated: state.lastUpdated.value,
}));

/** Prefer a custom instance title when set. */
const displayTitle = computed(() => props.instance.title ?? props.def.title);

/** Playground widgets stay square while resizing; keep normal card chrome (border). */
const isPlayground = computed(() => props.def.playground === true);
/** Dock-style: width from host, height hugs the icon row. */
const hugHeight = computed(() => props.def.hugHeight === true);
</script>

<template>
  <WidgetCard
    :title="displayTitle"
    :hide-title="Boolean(instance.hideTitle)"
    :instance-id="instance.instanceId"
    :has-settings="Boolean(def.settingsComponent) || Boolean(contractSettingsId)"
    :has-about="true"
    :can-edit-in-wizard="wizardEditable"
    :flush="Boolean(def.flush)"
    :compact="Boolean(def.compact)"
    :allow-duplicate="def.allowDuplicate !== false"
    :highlighted="Boolean(highlighted)"
    :previewed="Boolean(previewed)"
    :pinned="Boolean(instance.pinned)"
    :resizable="def.resizable !== false"
    :width="instance.width"
    :height="hugHeight ? undefined : instance.height"
    :content-scale="instance.contentScale"
    :lock-square="isPlayground"
    :playground="isPlayground"
    :hug-height="hugHeight"
    :full-drag="Boolean(def.fullDrag)"
    :opaque="Boolean(def.opaque)"
    :multi-desk-remove="Boolean(multiDeskRemove)"
    :coach-targets="!isGalleryWidget(instance.typeId)"
    data-interactive
    @rename="$emit('rename', $event)"
    @update:hide-title="$emit('update:hideTitle', $event)"
    @duplicate="$emit('duplicate')"
    @about="$emit('about')"
    @edit-in-wizard="$emit('edit-in-wizard', def.id)"
    @hide="$emit('hide')"
    @move-to-panel="$emit('move-to-panel')"
    @remove="$emit('remove', $event)"
    @toggle-pin="$emit('toggle-pin')"
    @move-pointerdown="$emit('move-pointerdown', $event)"
    @resize="$emit('resize', $event)"
    @resize-end="$emit('resize-end')"
    @update:content-scale="$emit('update:contentScale', $event)"
  >
    <ContractPackageWidget
      v-if="isContractPackage && def.runtimeEntryUrl"
      :package-id="def.id"
      :entry-url="def.runtimeEntryUrl"
    />
    <RuntimeExtensionFrame
      v-else-if="isRuntime && def.runtimeEntryUrl"
      :key="connectionEpoch"
      :ext-id="def.id"
      :instance-id="instance.instanceId"
      :entry-url="def.runtimeEntryUrl"
      :granted-permissions="def.grantedPermissions ?? []"
    />
    <component v-else-if="def.component" :is="def.component" v-bind="widgetProps" />
    <template v-if="def.menuComponent" #menu>
      <component :is="def.menuComponent" />
    </template>
    <template v-if="def.settingsComponent" #settings>
      <component :is="def.settingsComponent" />
    </template>
    <template v-else-if="contractSettingsId" #settings>
      <CockpitWidgetSettings :definition-id="contractSettingsId!" />
    </template>
  </WidgetCard>
</template>
