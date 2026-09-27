<script setup lang="ts">
/**
 * A widget's content without card chrome, for hosts that own the frame around
 * it themselves — today the palette's inline widget view.
 *
 * It re-provides the same injection keys `WidgetCard` does. That set is the
 * contract extension components code against, so an inline mount that skipped
 * it would break every widget that reads its own instance id. It deliberately
 * does *not* render the menu or settings slots: those belong to a card's
 * chrome, and the panel has none.
 *
 * Mounting an instance here while its desk card is also mounted is fine and
 * intended — extension state lives in per-instance stores (`createInstanceStore`),
 * so both views are the same widget and stay in sync.
 */
import { installContentZoom } from "./contentZoom";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  provide,
  ref,
} from "vue";
import RuntimeExtensionFrame from "../runtime/RuntimeExtensionFrame.vue";
import { connectionEpoch } from "../settings/credentials/connections";
import ContractPackageWidget from "../extension-host/ui/ContractPackageWidget.vue";
import type { HostExtensionRef } from "../runtime/runtimeTypes";
import {
  clampContentScale,
  DEFAULT_CONTENT_SCALE,
} from "./resizeLogic";
import type { WidgetInstance, WidgetProps } from "./types";
import { useWidgetData } from "@sdk/useWidgetData";
import { WIDGET_FOCUS_EVENT, type WidgetSurface } from "@sdk";

const props = defineProps<{
  instance: WidgetInstance;
  /** Builtin Vue component or runtime HostExtensionRef (iframe via RuntimeExtensionFrame). */
  def: HostExtensionRef;
  /**
   * Body zoom for this surface. Host-owned like a card's, because the panel is a
   * different box from the card and remembers its own value.
   */
  contentScale?: number;
  /**
   * Whether the widget's own menu is open. The button lives in the panel header,
   * one DOM subtree up, but the popover has to render *here* — the extension's
   * menu component reads `widgetInstanceId` and friends from this component's
   * provide tree, and a popover mounted in the header would inject nothing.
   */
  menuOpen?: boolean;
  /** Shortcut previews keep focus on the icon until Enter moves into the widget. */
  autoFocus?: boolean;
}>();

const emit = defineEmits<{
  "update:contentScale": [scale: number];
  "update:menuOpen": [open: boolean];
}>();

/** True when the widget contributes anything to a menu at all. */
const hasMenu = computed(() =>
  Boolean(props.def.menuComponent || props.def.settingsComponent)
);

const isRuntime = computed(() => props.def.origin === "runtime");

/** Same fork as the desk card's: the two frames do not answer each other. */
const isContractPackage = computed(
  () => isRuntime.value && props.def.packageFormat === "contract",
);

const state = useWidgetData(props.def);

/** Keep the generic widget props reactive as backend data changes. */
const widgetProps = computed<WidgetProps>(() => ({
  data: state.data.value,
  loading: state.loading.value,
  error: state.error.value,
  lastUpdated: state.lastUpdated.value,
}));

/** Resolved body zoom (missing → 1), same contract as a card's. */
const resolvedContentScale = computed(() =>
  clampContentScale(
    typeof props.contentScale === "number"
      ? props.contentScale
      : DEFAULT_CONTENT_SCALE
  )
);

let stopContentZoom: (() => void) | undefined;

const bodyStyle = computed(() => ({
  "--widget-content-scale": String(resolvedContentScale.value),
}));

// The panel hands the widget a fixed box, which is exactly what a host-sized
// card does — so content that can fill should fill.
const hostSized = computed(() => true);

const rootEl = ref<HTMLElement | null>(null);

provide("widgetInstanceId", props.instance.instanceId);
// Widgets answer focus requests for the surface they are on, so the card of the
// same instance sitting on the desk does not take the caret instead.
provide("widgetSurface", "inline" satisfies WidgetSurface);
provide("widgetHostSized", hostSized);
provide("widgetContentScale", resolvedContentScale);
// Null on purpose: the box is CSS-driven here, so there is no pixel size to
// hand out. Widgets read `widgetHostSized` for the layout decision.
provide(
  "widgetHostSize",
  computed(() => null)
);
// A menu item that closes the menu after acting (most of them do) has to reach
// the state that owns it, which is the panel header's.
provide("closeWidgetMenu", () => emit("update:menuOpen", false));
provide("closeWidgetSettings", () => emit("update:menuOpen", false));

/**
 * Ask the widget to focus its entry point — Notes puts the caret in the editor,
 * Calculator in its input, Todo on the first empty row. What that means is the
 * widget's call; the host only asks, which is why there is no per-type knowledge
 * here.
 *
 * Retried once because a widget may still be building the thing it wants to
 * focus on the first tick (TipTap does), the same reason the desk flow retries.
 */
function requestEntryFocus() {
  window.dispatchEvent(
    new CustomEvent(WIDGET_FOCUS_EVENT, {
      detail: {
        instanceId: props.instance.instanceId,
        surface: "inline" satisfies WidgetSurface,
      },
    })
  );
}

/**
 * Sandboxed packages cannot be reached by a DOM event, so the frame itself takes
 * focus and the package decides where the caret goes inside it.
 */
function focusRuntimeFrame() {
  rootEl.value?.querySelector("iframe")?.focus();
}

let retryTimer: ReturnType<typeof setTimeout> | undefined;

function focusEntry(fallbackToBody = true) {
  if (retryTimer !== undefined) clearTimeout(retryTimer);
  if (isRuntime.value && !isContractPackage.value) {
    focusRuntimeFrame();
    return;
  }
  if (fallbackToBody) rootEl.value?.focus();
  requestEntryFocus();
  retryTimer = setTimeout(requestEntryFocus, 60);
}
defineExpose({ focusEntry });

onMounted(() => {
  void nextTick().then(() => {
    if (rootEl.value) {
      stopContentZoom = installContentZoom(
        rootEl.value,
        () => resolvedContentScale.value,
        (scale) => emit("update:contentScale", scale),
      );
    }
    // A widget without an entry point ignores this and focus stays in the
    // search field, which is the right place to keep typing from.
    if (props.autoFocus !== false) focusEntry(false);
  });
});

onBeforeUnmount(() => {
  if (retryTimer !== undefined) clearTimeout(retryTimer);
  stopContentZoom?.();
});
</script>

<template>
  <!-- Shell carries no zoom: the menu is a sibling of the scaled body, not a
       child of it. `zoom` multiplies through descendants and a `zoom: 1` on the
       popover would only mean "no further scaling", so a zoomed-in widget used
       to render its menu at the same multiple. Cards solve it the same way, by
       keeping title and chrome outside `.widget-card-body`. -->
  <div ref="rootEl" class="inline-widget-shell" tabindex="-1">
    <div
      class="inline-widget-body"
      :class="{
        'inline-widget-body--flush': Boolean(def.flush),
        'inline-widget-body--hug': Boolean(def.hugHeight),
      }"
      :style="bodyStyle"
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
      <component
        v-else-if="def.component"
        :is="def.component"
        v-bind="widgetProps"
      />
    </div>
    <!-- The widget's own menu items (Notes' "Show formatting", Todo's sorting…),
         opened from the header button and anchored just below it. -->
    <div
      v-if="menuOpen && hasMenu"
      class="inline-widget-menu"
      data-inline-widget-menu
      data-interactive
      role="menu"
      @pointerdown.stop
    >
      <component
        v-if="def.menuComponent"
        :is="def.menuComponent"
      />
      <component
        v-if="def.settingsComponent"
        :is="def.settingsComponent"
      />
    </div>
  </div>
</template>

<style scoped>
/* Unscaled frame: fills the panel and positions the menu popover. */
.inline-widget-shell {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
}

/* Mirrors `.widget-card--sized .widget-card-body`: the extension root fills the
   box it was given, and the zoom rides on the same CSS variable. */
.inline-widget-body {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  padding: 4px 4px 4px;
  box-sizing: border-box;
  color: rgba(var(--fg-rgb), 0.92);
  font-size: 14px;
  zoom: var(--widget-content-scale, 1);
}

.inline-widget-body > * {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
}

/* Anchored under the header's ⋯ button, at the size a card's menu renders at —
   the widget's zoom does not reach it from out here. */
.inline-widget-menu {
  position: absolute;
  top: 2px;
  right: 8px;
  z-index: 6;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 148px;
  padding: 6px;
  border-radius: 10px;
  corner-shape: var(--surface-corner-shape, round);
  background: rgba(var(--surface-bg-rgb), 0.98);
  border: 1px solid var(--surface-border, var(--border));
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
  font-size: 13px;
}

/* Edge-to-edge widgets (image, covers) keep their own bleed. */
.inline-widget-body--flush {
  padding: 0;
  line-height: 0;
  overflow: hidden;
}

/* Dock-style widgets hug their content instead of stretching. */
.inline-widget-body--hug {
  justify-content: flex-start;
}

.inline-widget-body--hug > * {
  flex: 0 0 auto;
}
</style>
