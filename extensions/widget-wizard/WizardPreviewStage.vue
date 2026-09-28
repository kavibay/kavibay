<script setup lang="ts">
/**
 * Adapter to host-owned preview chrome.
 *
 * The extension supplies data; the host supplies the WidgetCard and the right
 * runtime frame. This keeps the MIT extension independent from GPL host files.
 */
import { inject, type Component } from "vue";
import type { WizardPreviewElement } from "@sdk/wizardPreview";

const props = defineProps<{
  extId: string;
  entryUrl: string;
  title: string;
  nonce: number;
  grantedPermissions: string[];
  format: "contract" | "runtime";
  initialSize?: { w: number; h: number } | null;
  initialScale?: number | null;
  /**
   * Providers this contract widget declared and still cannot read.
   *
   * Passed down rather than derived in the host: the grant and the manifest are
   * both the wizard's to read, and the host's preview chrome has neither.
   */
  unmet?: string[];
  sharing?: boolean;
  shareBusy?: boolean;
  shareFeedback?: string;
  picking?: boolean;
  /** Toolbar mount point for host-owned debug controls. */
  debugTarget?: HTMLElement | null;
}>();

/** Mirrors what the host's preview chrome emits; see WidgetWizardPreviewHost. */
export interface PreviewFault {
  source: "error" | "rejection" | "console";
  message: string;
  where?: string;
}

const emit = defineEmits<{
  rename: [title: string];
  resized: [size: { w: number; h: number }, scale?: number];
  fault: [fault: PreviewFault];
  "close-share": [];
  export: [];
  selected: [element: WizardPreviewElement];
  "cancel-pick": [];
}>();

function onResized(size: { w: number; h: number }, scale?: number) {
  emit("resized", size, scale);
}

const previewHost = inject<Component>("kavibay:widget-wizard-preview");
</script>

<template>
  <component
    :is="previewHost"
    v-if="previewHost"
    v-bind="props"
    @rename="emit('rename', $event)"
    @resized="onResized"
    @fault="emit('fault', $event)"
    @close-share="emit('close-share')"
    @export="emit('export')"
    @selected="emit('selected', $event)"
    @cancel-pick="emit('cancel-pick')"
  />
  <div v-else class="missing-host">
    Widget preview is unavailable.
  </div>
</template>

<style scoped>
.missing-host {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: rgba(var(--fg-rgb), 0.55);
}
</style>
