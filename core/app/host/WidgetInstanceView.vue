<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import RuntimeExtensionFrame from "../runtime/RuntimeExtensionFrame.vue";
import ContractPackageWidget from "../extension-host/ui/ContractPackageWidget.vue";
import CockpitWidgetSettings from "../extension-host/ui/CockpitWidgetSettings.vue";
import WidgetPreviewShare from "../extension-host/ui/WidgetPreviewShare.vue";
import { tauriWidgetCapabilityTransport } from "../extension-host/tauriWidgetCapabilityTransport";
import { extensionHost, packageDefinitionId } from "../extension-host/cockpit";
import type { HostExtensionRef } from "../runtime/runtimeTypes";
import type { WidgetInstance, WidgetProps } from "./types";
import { isGalleryWidget } from "./builtinWidgetIds";
import { canEditInWizard } from "./wizardEditable";
import { useWidgetData } from "@sdk/useWidgetData";
import WidgetCard from "./WidgetCard.vue";
import WidgetAppearanceSettings from "./WidgetAppearanceSettings.vue";
import {
  effectiveWidgetAppearance,
  radiusStyle,
  surfaceStyle,
  type WidgetAppearance,
} from "./widgetAppearance";
import { CORNER_SHAPE_SUPPORTED } from "../settings/appearanceLogic";
import { useAppearance } from "../settings/useAppearance";
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

const emit = defineEmits<{
  rename: [title: string | undefined];
  "update:hideTitle": [hideTitle: boolean];
  /** One changed field, or null to drop this instance's own look. */
  "update:appearance": [patch: WidgetAppearance | null];
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

const { cornerShape } = useAppearance();

/** The instance's own look over the manifest's `ui.appearance`. */
const appearance = computed(() =>
  effectiveWidgetAppearance(props.def.appearance, props.instance.appearance),
);
const cardVars = computed(() =>
  radiusStyle(appearance.value, cornerShape.value, CORNER_SHAPE_SUPPORTED),
);
const surfaceVars = computed(() => surfaceStyle(appearance.value));

/** The gear opens for the widget's own settings, the Appearance section, or both. */
const hasSettings = computed(
  () =>
    Boolean(props.def.settingsComponent) ||
    Boolean(contractSettingsId.value) ||
    Boolean(props.def.appearanceEditable),
);

/** Playground widgets stay square while resizing; keep normal card chrome (border). */
const isPlayground = computed(() => props.def.playground === true);
/** Dock-style: width from host, height hugs the icon row. */
const hugHeight = computed(() => props.def.hugHeight === true);

const sharing = ref(false);
const shareBusy = ref(false);
const shareFeedback = ref("");
const shareStage = ref<HTMLElement | null>(null);
const shareCard = ref<HTMLElement | null>(null);
const shareSize = ref({ w: 280, h: 180 });
const shareScale = ref(1);
const shareOffset = ref({ x: 0, y: 0 });
let resizeStartOffset: { x: number; y: number } | undefined;
let stopShareMove: (() => void) | undefined;

/** Reuse the mounted card and its data; presentation sizes stay local to Share. */
function openShare(): void {
  const element = shareCard.value?.firstElementChild;
  const card = element instanceof HTMLElement ? element : null;
  shareSize.value = {
    w: card?.offsetWidth || props.instance.width || props.def.defaultSize?.w || 280,
    h: card?.offsetHeight || props.instance.height || props.def.defaultSize?.h || 180,
  };
  shareScale.value = props.instance.contentScale ?? props.def.defaultScale;
  shareOffset.value = { x: 0, y: 0 };
  shareFeedback.value = "";
  sharing.value = true;
}

/** Pointer pixels must be converted back from the automatically fitted preview. */
function shareRenderedScale(): number {
  const card = shareCard.value;
  return card?.offsetWidth ? card.getBoundingClientRect().width / card.offsetWidth : 1;
}

/** Keep the widget within the canvas after moving or resizing it. */
function clampShareOffset(offset: { x: number; y: number }): { x: number; y: number } {
  const stage = shareStage.value;
  const card = shareCard.value;
  if (!stage || !card) return offset;
  const scale = shareRenderedScale();
  const maxX = Math.max(0, (stage.clientWidth / scale - shareSize.value.w) / 2);
  const maxY = Math.max(0, (stage.clientHeight / scale - (hugHeight.value ? card.offsetHeight : shareSize.value.h)) / 2);
  return {
    x: Math.max(-maxX, Math.min(maxX, offset.x)),
    y: Math.max(-maxY, Math.min(maxY, offset.y)),
  };
}

/** Moving in Share composes the image; moving on the desk belongs to WidgetHost. */
function onMove(event: PointerEvent): void {
  if (!sharing.value) {
    emit("move-pointerdown", event);
    return;
  }
  stopShareMove?.();
  const start = { x: event.clientX, y: event.clientY };
  const from = { ...shareOffset.value };
  const scale = shareRenderedScale();
  const move = (next: PointerEvent) => {
    shareOffset.value = clampShareOffset({
      x: from.x + (next.clientX - start.x) / scale,
      y: from.y + (next.clientY - start.y) / scale,
    });
  };
  const stop = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
    stopShareMove = undefined;
  };
  stopShareMove = stop;
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);
}

/** Share resizing leaves the desk's persisted dimensions and position untouched. */
function onResize(payload: {
  width: number;
  height: number;
  deltaOffset: { x: number; y: number };
  contentScale?: number;
  edge?: string;
}): void {
  if (!sharing.value) {
    emit("resize", payload);
    return;
  }
  resizeStartOffset ??= { ...shareOffset.value };
  shareSize.value = { w: payload.width, h: payload.height };
  shareOffset.value = clampShareOffset({
    x: resizeStartOffset.x + payload.deltaOffset.x,
    y: resizeStartOffset.y + payload.deltaOffset.y,
  });
  if (payload.contentScale !== undefined) shareScale.value = payload.contentScale;
}

/** Only desk resize gestures enter the host's layout history. */
function onResizeEnd(): void {
  if (!sharing.value) emit("resize-end");
  resizeStartOffset = undefined;
}

/** Content zoom follows the active surface, like edge resizing. */
function onContentScale(scale: number): void {
  if (sharing.value) shareScale.value = scale;
  else emit("update:contentScale", scale);
}

/** End any canvas gesture before restoring the desk presentation. */
function closeShare(): void {
  stopShareMove?.();
  resizeStartOffset = undefined;
  sharing.value = false;
}

/** Use the same native save dialog and ZIP export as the Widget Wizard. */
async function exportWidget(): Promise<void> {
  if (!isRuntime.value || shareBusy.value) return;
  shareBusy.value = true;
  shareFeedback.value = "";
  try {
    const report = await tauriWidgetCapabilityTransport.wizardExportPackage(props.def.id);
    if (report) shareFeedback.value = report.source === "draft" ? "Unsaved draft exported." : "Widget exported.";
  } catch (error) {
    shareFeedback.value = `Could not export widget: ${String(error)}`;
  } finally {
    shareBusy.value = false;
  }
}

onBeforeUnmount(() => stopShareMove?.());
</script>

<template>
  <WidgetPreviewShare
    v-slot="{ captureActive }"
    :open="sharing"
    :busy="shareBusy"
    :title="displayTitle"
    :preview-target="shareCard"
    :capture-target="shareStage"
    :feedback="shareFeedback"
    :exportable="isRuntime"
    inline-layout="contents"
    @close="closeShare"
    @export="exportWidget"
  >
  <div ref="shareStage" class="instance-share-stage" :class="{ 'instance-share-stage--open': sharing }">
  <div ref="shareCard" class="instance-share-card" :style="sharing ? { transform: `scale(var(--share-preview-scale, 1)) translate(${shareOffset.x}px, ${shareOffset.y}px)` } : undefined">
  <WidgetCard
    :capture-active="captureActive"
    :title="displayTitle"
    :hide-title="Boolean(instance.hideTitle)"
    :instance-id="instance.instanceId"
    :has-settings="hasSettings"
    :has-about="true"
    :can-share="!sharing"
    :can-edit-in-wizard="wizardEditable"
    :flush="Boolean(def.flush)"
    :padding="def.padding !== false"
    :compact="Boolean(def.compact)"
    :allow-duplicate="def.allowDuplicate !== false"
    :highlighted="!sharing && Boolean(highlighted)"
    :previewed="!sharing && Boolean(previewed)"
    :pinned="Boolean(instance.pinned)"
    :resizable="def.resizable !== false"
    :width="sharing ? shareSize.w : instance.width"
    :height="hugHeight ? undefined : sharing ? shareSize.h : instance.height"
    :content-scale="sharing ? shareScale : instance.contentScale"
    :lock-square="isPlayground"
    :playground="isPlayground"
    :hug-height="hugHeight"
    :full-drag="Boolean(def.fullDrag)"
    :opaque="Boolean(def.opaque)"
    :card-vars="cardVars"
    :surface-vars="surfaceVars"
    :multi-desk-remove="Boolean(multiDeskRemove)"
    :coach-targets="!isGalleryWidget(instance.typeId)"
    data-interactive
    @rename="$emit('rename', $event)"
    @update:hide-title="$emit('update:hideTitle', $event)"
    @duplicate="$emit('duplicate')"
    @about="$emit('about')"
    @share="openShare"
    @edit-in-wizard="$emit('edit-in-wizard', def.id)"
    @hide="$emit('hide')"
    @move-to-panel="$emit('move-to-panel')"
    @remove="$emit('remove', $event)"
    @toggle-pin="$emit('toggle-pin')"
    @move-pointerdown="onMove"
    @resize="onResize"
    @resize-end="onResizeEnd"
    @update:content-scale="onContentScale"
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
    <template v-if="hasSettings" #settings>
      <component v-if="def.settingsComponent" :is="def.settingsComponent" />
      <CockpitWidgetSettings v-else-if="contractSettingsId" :definition-id="contractSettingsId" />
      <WidgetAppearanceSettings
        v-if="def.appearanceEditable"
        :effective="appearance"
        :own="instance.appearance"
        @update="$emit('update:appearance', $event)"
      />
    </template>
  </WidgetCard>
  </div>
  </div>
  </WidgetPreviewShare>
</template>

<style scoped>
.instance-share-stage, .instance-share-card { display: contents; }
.instance-share-stage--open {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 12px;
  background-image: var(--share-canvas-background);
  background-size: cover;
  background-position: center;
}
.instance-share-stage--open > .instance-share-card { display: block; flex-shrink: 0; }
</style>
