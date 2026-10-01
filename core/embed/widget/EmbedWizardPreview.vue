<script setup lang="ts">
import { computed, ref } from "vue";
import type { WizardPreviewElement } from "@sdk/wizardPreview";
import { provideWizardPreviewPicker, useWizardPreviewPicker } from "../../app/extension-host/wizardPreviewPicker";
import PREVIEW_PICKER_SOURCE from "../../app/extension-host/previewPickerGuest.js?raw";
import WidgetCard from "../../app/host/WidgetCard.vue";
import WidgetPreviewShare from "../../app/extension-host/ui/WidgetPreviewShare.vue";
import { demoDraftFiles } from "./wizardFixture";
import { buildPreviewDocument } from "./wizardPreviewDocument";
import RUNTIME_SOURCE from "../../../sdk/runtime/kavibay-runtime.js?raw";

/**
 * The Wizard's preview stage, for a browser.
 *
 * `WizardPreviewStage.vue` injects whatever the host provided under
 * `kavibay:widget-wizard-preview` and hands it the draft's identity. On the
 * desktop that is `WidgetWizardPreviewHost.vue`, which serves the package over
 * the `kavibay-ext://` scheme and speaks the runtime bridge. This page has
 * neither, and cannot import that file anyway: it reaches `cockpit.ts`, which
 * the import guard refuses for pulling the whole extension catalog and Tauri.
 *
 * So this is a second implementation — the only one in the package — and it is
 * deliberately the smallest thing that is still honest:
 *
 *   - The document is assembled from the draft's **own files**, the ones the
 *     Wizard just wrote, read straight out of the in-memory store.
 *   - `@kavibay/runtime.js` is the **real** runtime, inlined from
 *     `sdk/runtime/kavibay-runtime.js`. A generated widget therefore runs
 *     against the same SDK it would run against on a desk.
 *   - The frame is `sandbox="allow-scripts"` with no `allow-same-origin`, so
 *     the generated code sits in an opaque origin and cannot reach this page,
 *     exactly as the app requires of package code.
 *
 * WHAT IT DOES NOT DO, AND WHY THAT IS SAFE HERE:
 *
 * Nothing answers the runtime's bridge. A package that calls `kavibay.http` or
 * `kavibay.storage` waits forever instead of receiving an error. That is a real
 * limitation and it is bounded: this preview only ever shows what the Wizard
 * generated in this tab, and the scripted answer is a DOM-only widget. A page
 * that scripts a network-using widget would need a bridge here first.
 */
const props = defineProps<{
  extId: string;
  entryUrl: string;
  title: string;
  nonce: number;
  grantedPermissions: string[];
  format: "contract" | "runtime";
  initialSize?: { w: number; h: number } | null;
  initialScale?: number | null;
  unmet?: string[];
  sharing?: boolean;
  shareBusy?: boolean;
  shareFeedback?: string;
  picking?: boolean;
  debugTarget?: HTMLElement | null;
  /** Declared so it is not passed through as an attribute; the demo draws no ring. */
  working?: boolean;
}>();

const emit = defineEmits<{
  rename: [title: string];
  resized: [size: { w: number; h: number }, scale?: number];
  fault: [fault: { source: "error" | "rejection" | "console"; message: string; where?: string }];
  "close-share": [];
  export: [];
  selected: [element: WizardPreviewElement];
  "cancel-pick": [];
}>();
const cardEl = ref<HTMLElement | null>(null);
const stageEl = ref<HTMLElement | null>(null);
const iframeEl = ref<HTMLIFrameElement | null>(null);
const picker = provideWizardPreviewPicker({
  picking: computed(() => !!props.picking && !props.sharing),
  select: (element) => emit("selected", element),
  cancel: () => emit("cancel-pick"),
});
useWizardPreviewPicker(iframeEl, computed(() => `${props.extId}:${props.nonce}`), picker);

/**
 * Rebuilt whenever the draft changes, which is what makes the preview follow
 * the conversation: every generated turn writes the draft, and the Wizard
 * bumps `nonce` to say so.
 */
/**
 * The draft id, without the host prefix the Wizard addresses it by.
 *
 * A draft is previewed under `__draft__<id>` (`draftPreviewHost` in
 * `manifestValidate.ts`) so the app can serve a draft and an installed package
 * from different origins. The fixture stores drafts under their plain id, so
 * looking up the prefixed one found nothing and the preview stayed empty even
 * once the URL was right.
 */
const draftId = computed(() => props.extId.replace(/^__draft__/, ""));

const srcdoc = computed(() => {
  void props.nonce;
  return buildPreviewDocument(demoDraftFiles(draftId.value), RUNTIME_SOURCE,
    import.meta.env.DEV ? PREVIEW_PICKER_SOURCE : undefined);
});

const size = computed(() => ({
  width: props.initialSize?.w ?? 280,
  height: props.initialSize?.h ?? 200,
}));
</script>

<template>
  <WidgetPreviewShare
    :open="!!sharing"
    :busy="shareBusy"
    :title="title"
    :preview-target="cardEl"
    :capture-target="stageEl"
    :feedback="shareFeedback"
    @close="emit('close-share')"
    @export="emit('export')"
  >
  <div ref="stageEl" class="embed-preview" :class="{ 'embed-preview--share': sharing }">
    <!--
      The app's own card, so a generated widget is judged in the frame it will
      actually live in rather than against a blank rectangle.

      Not `flush`: that prop drops the card's padding so a widget can fill the
      chrome edge to edge, and it put the generated content directly under the
      title. A widget that wants the whole card says so in its own manifest;
      the preview should not decide that for it.
    -->
    <div v-if="srcdoc" ref="cardEl" class="embed-preview__card">
    <WidgetCard
      :title="title"
      :hide-title="false"
      :instance-id="`preview-${extId}`"
      :has-settings="false"
      :has-about="false"
      :allow-duplicate="false"
      :resizable="false"
      :width="size.width"
      :height="size.height"
      :coach-targets="false"
    >
      <iframe
        ref="iframeEl"
        :key="nonce"
        class="embed-preview__frame"
        sandbox="allow-scripts"
        :srcdoc="srcdoc"
        :title="title"
      ></iframe>
    </WidgetCard>
    </div>

    <p v-else class="embed-preview__empty">Your widget will appear here.</p>
  </div>
  </WidgetPreviewShare>
</template>

<style scoped>
/*
 * The app's own preview stage, copied property for property from `.stage` in
 * `WidgetWizardPreviewHost.vue`.
 *
 * The graph paper is the part that matters and the part that was missing. The
 * Wizard draws the same 20px grid on `.wiz-empty` while it has nothing to show
 * yet, so on the desktop the backdrop simply stays put and the generated card
 * appears on top of it. Here the grid vanished the moment the widget arrived,
 * because this stage — the one thing in the package the app does not supply —
 * was a plain flex box.
 *
 * Copied rather than imported for the reason in the block comment above: that
 * file reaches `cockpit.ts`, which the import guard refuses. Copies drift, so
 * the values stay together in one rule that names its origin.
 */
.embed-preview {
  position: relative;
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  min-height: 0;
  overflow: hidden;
  border-radius: 10px;
  background-image:
    linear-gradient(rgba(var(--fg-rgb), 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(var(--fg-rgb), 0.05) 1px, transparent 1px);
  background-size: 20px 20px;
}

.embed-preview__frame {
  width: 100%;
  height: 100%;
  border: 0;
  background: transparent;
  /*
   * Blocks an inherited colour scheme, and that is not cosmetic.
   *
   * The document inside is transparent on purpose — the card behind it is what
   * draws the glass. But `color-scheme` inherits, and the moment this frame
   * element carries one, Chrome stops letting the frame show through and paints
   * an opaque base under it: a light one. Measured on the landing page, whose
   * stage had `color-scheme: dark` for its scrollbars — the preview became a
   * white rectangle with white text on it and nothing legible but the blue
   * progress bar.
   *
   * The host page cannot be relied on not to do that, so the frame declares its
   * own. The document keeps saying `dark` for its own controls; this only
   * concerns what is painted behind it.
   */
  color-scheme: normal;
}

.embed-preview__card { flex-shrink: 0; }
.embed-preview--share {
  background-image: var(--share-canvas-background);
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
}
.embed-preview--share .embed-preview__card { transform: scale(var(--share-preview-scale, 1)); }

.embed-preview__empty {
  margin: 0;
  color: rgba(var(--fg-rgb, 255, 255, 255), 0.55);
}
</style>
