<script setup lang="ts">
/**
 * The install dialog for a widget from a zip, and the listener for dropped files.
 *
 * It shows what Rust scanned in the staged package and nothing else. A widget
 * that reads from accounts gets the same `PermissionRequest` its approval uses
 * everywhere, so its boxes start unticked here too.
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { extensionHost } from "../extension-host/cockpit";
import { buildPermissionRequest } from "../extension-host/permissionRequest";
import PermissionRequest from "../extension-host/ui/PermissionRequest.vue";
import type { ApprovedGrant } from "../extension-host/widgetPackage";
import { setClickThroughPaused, syncInteractiveRegions } from "../system/clickThrough";
import { consentLinesFor, contractGrantFrom } from "./runtimeInstallLogic";
import { cancelImport, importState, installReviewed, listenForDroppedWidgets } from "./widgetImport";

const dialogEl = ref<HTMLElement | null>(null);
const primaryEl = ref<HTMLButtonElement | null>(null);

// Nothing shows while the archive is read: it takes milliseconds, and a
// dialog that flashes up only to be replaced is worse than a short wait.
const open = computed(() => importState.value.kind !== "idle" && importState.value.kind !== "reading");
const preview = computed(() => {
  const state = importState.value;
  return state.kind === "review" || state.kind === "installing" ? state.preview : null;
});
const pkg = computed(() => preview.value?.package ?? null);
const installing = computed(() => importState.value.kind === "installing");
const failure = computed(() => (importState.value.kind === "failed" ? importState.value : null));
const consentLines = computed(() => (pkg.value ? consentLinesFor(pkg.value) : []));
const source = computed(() =>
  pkg.value && preview.value ? `Version ${pkg.value.version}, from ${preview.value.fileName}` : "",
);

/**
 * Undefined for a runtime package, and for a contract manifest the request
 * cannot be built from. The runtime layout then installs with no account
 * grant, which the widget reports as not approved: the fail-closed answer.
 */
const contractRequest = computed(() => {
  const row = pkg.value;
  if (!row || row.format !== "contract" || row.contractManifest == null) return undefined;
  try {
    return buildPermissionRequest(row.contractManifest, extensionHost.registry);
  } catch (error) {
    console.error("[kavibay] an imported widget's manifest could not be read:", error);
    return undefined;
  }
});

function onApprove(grant: ApprovedGrant) {
  void installReviewed(contractGrantFrom(grant));
}

function onBackdropPointerDown(event: PointerEvent) {
  if (event.target === event.currentTarget) cancelImport();
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape" || !open.value) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  cancelImport();
}

watch(open, async (isOpen) => {
  setClickThroughPaused(isOpen);
  await nextTick();
  if (isOpen) {
    // A drop arrives while another app has focus, and Enter and Esc
    // should answer this dialog, not that app.
    await getCurrentWindow()
      .setFocus()
      .catch(() => {});
    (primaryEl.value ?? dialogEl.value)?.focus();
  }
  syncInteractiveRegions();
});

let unlistenDrops: UnlistenFn | undefined;

onMounted(async () => {
  document.addEventListener("keydown", onDocumentKeydown, true);
  try {
    unlistenDrops = await listenForDroppedWidgets();
  } catch {
    // No Tauri webview in the browser harness, so nothing can be dropped.
  }
});

onUnmounted(() => {
  document.removeEventListener("keydown", onDocumentKeydown, true);
  unlistenDrops?.();
  if (open.value) setClickThroughPaused(false);
});
</script>

<template>
  <div v-if="open" class="widget-import-backdrop" data-interactive @pointerdown="onBackdropPointerDown">
    <section
      ref="dialogEl"
      class="widget-import-modal"
      data-interactive
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      :aria-label="pkg ? `Install ${pkg.name}` : 'Widget import'"
      @pointerdown.stop
    >
      <div v-if="failure" class="widget-import-body">
        <h2 class="widget-import-title">Can't install {{ failure.fileName }}</h2>
        <p class="widget-import-message">{{ failure.message }}</p>
        <footer class="widget-import-actions">
          <button ref="primaryEl" type="button" class="primary" @click="cancelImport">Close</button>
        </footer>
      </div>

      <PermissionRequest
        v-else-if="pkg && contractRequest"
        :display-name="pkg.name"
        :request="contractRequest"
        :title="`Install ${pkg.name}?`"
        confirm-label="Install widget"
        @approve="onApprove"
        @cancel="cancelImport"
      >
        <template v-if="consentLines.length">
          <p class="widget-import-lead">It may also:</p>
          <ul class="widget-import-lines">
            <li v-for="line in consentLines" :key="line">{{ line }}</li>
          </ul>
        </template>
        <p class="widget-import-note">{{ source }}. A widget from a file is code you did not write. Install only what you trust.</p>
      </PermissionRequest>

      <div v-else-if="pkg" class="widget-import-body">
        <header>
          <h2 class="widget-import-title">Install {{ pkg.name }}?</h2>
          <p class="widget-import-sub">{{ source }}</p>
        </header>
        <p v-if="pkg.description" class="widget-import-message">{{ pkg.description }}</p>
        <template v-if="consentLines.length">
          <p class="widget-import-lead">Installing it allows it to:</p>
          <ul class="widget-import-lines">
            <li v-for="line in consentLines" :key="line">{{ line }}</li>
          </ul>
        </template>
        <p v-else class="widget-import-lead">This widget asks for nothing.</p>
        <p class="widget-import-note">A widget from a file is code you did not write. Install only what you trust.</p>
        <footer class="widget-import-actions">
          <button type="button" class="ghost" :disabled="installing" @click="cancelImport">Cancel</button>
          <button ref="primaryEl" type="button" class="primary" :disabled="installing" @click="installReviewed()">
            Install widget
          </button>
        </footer>
      </div>
    </section>
  </div>
</template>

<style scoped>
.widget-import-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  padding: 24px;
  pointer-events: auto;
  background: rgba(0, 0, 0, 0.35);
}

.widget-import-modal {
  width: min(440px, 100%);
  max-height: min(560px, 100%);
  overflow: auto;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  border-radius: 16px;
  background: rgb(var(--surface-bg-rgb));
  box-shadow: var(--surface-box-shadow);
  outline: none;
}

.widget-import-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 18px 20px;
}

.widget-import-title {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
}

.widget-import-sub,
.widget-import-note {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: rgba(var(--fg-rgb), 0.55);
}

.widget-import-message,
.widget-import-lead {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: rgba(var(--fg-rgb), 0.8);
}

.widget-import-lines {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  line-height: 1.45;
}

.widget-import-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 2px;
}

.widget-import-actions button {
  padding: 7px 14px;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  color: inherit;
  border-radius: 8px;
  cursor: pointer;
}

.widget-import-actions button:disabled {
  opacity: 0.5;
  cursor: default;
}

.ghost {
  background: transparent;
  border: 1px solid rgba(var(--fg-rgb), 0.16);
}

.primary {
  background: rgba(var(--fg-rgb), 0.1);
  border: 1px solid rgba(var(--fg-rgb), 0.28);
}

.widget-import-actions button:not(:disabled):hover {
  background: rgba(var(--fg-rgb), 0.16);
}
</style>
