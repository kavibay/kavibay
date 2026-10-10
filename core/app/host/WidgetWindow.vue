<script setup lang="ts">
import { onMounted, onUnmounted, provide, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WIDGET_FOCUS_EVENT, type WidgetSurface } from "@sdk";
import { getExtension } from "../extensions/registry";
import { onWizardPackagesChanged } from "../extension-host/cockpit";
import CommandHost from "../extension-host/ui/CommandHost.vue";
import { useRuntimeExtensions } from "../runtime/useRuntimeExtensions";
import { useSettingsModal } from "../settings/useSettingsModal";
import FloatingTipHost from "../system/FloatingTipHost.vue";
import { widgetWindowInstanceId, type WidgetWindowRequest } from "./widgetWindow";

/**
 * The whole document of a widget window: one widget, no desk.
 *
 * Whatever the widget asks of the host that only the overlay has — Settings, a
 * card on the desk — is handed to Rust, which reveals the overlay and passes it
 * on. Package changes go the same way, so the palette knows a saved widget.
 */
const props = defineProps<{ typeId: string }>();

const extension = getExtension(props.typeId);
const appWindow = getCurrentWindow();
const instanceId = widgetWindowInstanceId(props.typeId);
provide("widgetInstanceId", instanceId);
provide("widgetSurface", "desk" satisfies WidgetSurface);

/**
 * Requests wait for the view: its focus listener exists only once mounted, and
 * an action's own request ("New Widget") expires if the window is slow to boot.
 * The first one, from the URL, is there only when the window was just created.
 */
let viewMounted = false;
let pending: WidgetWindowRequest | null = initialRequest();

function initialRequest(): WidgetWindowRequest {
  const raw = new URLSearchParams(location.search).get("request");
  return raw ? (JSON.parse(raw) as WidgetWindowRequest) : {};
}

function onRequest(request: WidgetWindowRequest) {
  pending = request;
  flush();
}

function flush() {
  if (!viewMounted || !pending) return;
  const request = pending;
  pending = null;
  // An action runs here, where the widget's state is; it asks for focus itself.
  if (request.action) {
    void extension?.actionHandlers[request.action]?.({ instanceId: "", args: request.args ?? {} });
  } else {
    focusWidget(request.openPackageId);
  }
}

provide("kavibayWidgetViewMounted", (id: string) => {
  if (id !== instanceId) return;
  viewMounted = true;
  flush();
});

function focusWidget(openPackageId?: string) {
  window.dispatchEvent(new CustomEvent(WIDGET_FOCUS_EVENT, {
    detail: { instanceId, surface: "desk" satisfies WidgetSurface, ...(openPackageId ? { openPackageId } : {}) },
  }));
}

/** The widget opening itself (a new project) or another widget (onto the desk). */
function onRunRuntimeWidget(event: Event) {
  const detail = (event as CustomEvent<{ typeId?: string; openPackageId?: string }>).detail;
  if (!detail?.typeId) return;
  if (detail.typeId === props.typeId) focusWidget(detail.openPackageId);
  else void invoke("widget_window_run", { detail }).catch(console.error);
}

const settings = useSettingsModal();
watch(settings.open, (open) => {
  if (!open) return;
  settings.hide();
  const focus =
    settings.credentialType.value ?? settings.aiProvider.value ?? settings.searchPart.value;
  void invoke("widget_window_show_settings", { section: settings.section.value, focus })
    .catch(console.error);
});

onWizardPackagesChanged(() => {
  void emitTo("main", "widget-window:packages-changed").catch(console.error);
});

let unlistenRequest: UnlistenFn | undefined;
onMounted(async () => {
  window.addEventListener("kavibay:run-runtime-widget", onRunRuntimeWidget);
  void useRuntimeExtensions().rescan();
  unlistenRequest = await listen<WidgetWindowRequest>("widget-window:request", ({ payload }) =>
    onRequest(payload),
  );
});
onUnmounted(() => {
  window.removeEventListener("kavibay:run-runtime-widget", onRunRuntimeWidget);
  unlistenRequest?.();
});
</script>

<template>
  <main class="widget-window">
    <!-- The card's title row, so the window looks like the card it was. -->
    <header class="widget-window-head" data-tauri-drag-region>
      <p class="widget-window-title" data-tauri-drag-region>{{ extension?.title }}</p>
      <button type="button" class="widget-window-btn" aria-label="Minimize" @click="appWindow.minimize()">
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6h8" /></svg>
      </button>
      <button type="button" class="widget-window-btn" aria-label="Maximize" @click="appWindow.toggleMaximize()">
        <svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2.5" y="2.5" width="7" height="7" rx="1" /></svg>
      </button>
      <button type="button" class="widget-window-btn widget-window-btn--close" aria-label="Close" @click="appWindow.close()">
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" /></svg>
      </button>
    </header>
    <div class="widget-window-body">
      <component :is="extension.component" v-if="extension?.component" />
      <p v-else class="missing">This widget is not available.</p>
    </div>
  </main>
  <FloatingTipHost />
  <CommandHost />
</template>

<style scoped>
/* The card surface with the glass taken out, like an opaque card on the desk. */
.widget-window {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: rgb(var(--surface-bg-rgb));
  color: rgba(var(--fg-rgb), 0.92);
}

/* Same type as `.widget-card-title`; the empty part drags the window. */
.widget-window-head {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 2px;
  padding: 6px 6px 0 16px;
  user-select: none;
}

.widget-window-title {
  flex: 1;
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(var(--fg-rgb), 0.5);
}

.widget-window-btn {
  display: grid;
  place-items: center;
  width: 28px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.5);
}

.widget-window-btn svg {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.3;
  stroke-linecap: round;
}

.widget-window-btn:hover,
.widget-window-btn:focus-visible {
  background: rgba(var(--fg-rgb), 0.1);
  color: rgba(var(--fg-rgb), 0.9);
}

.widget-window-btn--close:hover,
.widget-window-btn--close:focus-visible {
  background: rgb(196, 43, 28);
  color: #fff;
}

.widget-window-body {
  position: relative;
  flex: 1;
  min-height: 0;
}

.missing {
  margin: 24px;
}
</style>
