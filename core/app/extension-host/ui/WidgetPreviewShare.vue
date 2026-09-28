<script setup lang="ts">
import DialogCloseButton from "@sdk/ui/DialogCloseButton.vue";
import IconBase from "@sdk/icons/IconBase.vue";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { holdHostDismiss } from "@sdk/hostDismiss";
import { scheduleRegionSync } from "../../system/clickThrough";
import defaultBackground from "../../assets/share-canvas/nebula.png";

const props = withDefaults(defineProps<{
  open: boolean;
  busy?: boolean;
  title: string;
  previewTarget: HTMLElement | null;
  captureTarget: HTMLElement | null;
  feedback?: string;
  /** Desk cards retain their intrinsic layout until the dialog opens. */
  inlineLayout?: "fill" | "contents";
  /** Bundled widgets have no standalone package to export. */
  exportable?: boolean;
}>(), { exportable: true });
const emit = defineEmits<{ close: []; export: [] }>();
const dialog = ref<HTMLDialogElement | null>(null);
const heading = ref<HTMLHeadingElement | null>(null);
const copying = ref(false);
const copied = ref(false);
const copyError = ref("");
const previewScale = ref(1);
const backgroundInput = ref<HTMLInputElement | null>(null);
const customBackground = ref<string | null>(null);
const backgroundName = ref("");
const backgroundError = ref("");
const loadingBackground = ref(false);
const backgroundSource = computed(() => customBackground.value ?? defaultBackground);
const working = computed(() => !!props.busy || copying.value || loadingBackground.value);
let disposed = false;
let restoreFocus: HTMLElement | null = null;
let releaseDismiss: (() => void) | undefined;
let resizeObserver: ResizeObserver | undefined;
let copyFeedbackTimeout: ReturnType<typeof setTimeout> | undefined;

function resetCopyFeedback(): void {
  clearTimeout(copyFeedbackTimeout);
  copyFeedbackTimeout = undefined;
  copied.value = false;
  copyError.value = "";
}

/** Decode before showing or capturing an image so the screenshot cannot race its load. */
async function loadBackground(source: string): Promise<void> {
  const image = new Image();
  image.src = source;
  await image.decode();
}

/** Keep chosen files local to this preview; release each temporary URL when replaced. */
async function chooseBackground(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || working.value) return;
  backgroundError.value = "";
  if (!file.type.startsWith("image/")) {
    backgroundError.value = "Choose an image file.";
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    backgroundError.value = "Choose an image smaller than 20 MB.";
    return;
  }
  loadingBackground.value = true;
  let candidate: string | null = null;
  try {
    candidate = URL.createObjectURL(file);
    await loadBackground(candidate);
    if (disposed) return;
    const previous = customBackground.value;
    customBackground.value = candidate;
    backgroundName.value = file.name;
    candidate = null;
    if (previous) URL.revokeObjectURL(previous);
  } catch {
    if (!disposed) backgroundError.value = "This image could not be opened. Try a PNG, JPG or WebP image.";
  } finally {
    if (candidate) URL.revokeObjectURL(candidate);
    loadingBackground.value = false;
  }
}

/** Restore the bundled background without changing the widget. */
function resetBackground(): void {
  if (customBackground.value) URL.revokeObjectURL(customBackground.value);
  customBackground.value = null;
  backgroundName.value = "";
  backgroundError.value = "";
}

function fitPreview(): void {
  const card = props.previewTarget;
  const stage = props.captureTarget;
  previewScale.value = props.open && card && stage && card.offsetWidth && card.offsetHeight
    ? Math.min(1, Math.max(1, stage.clientWidth - 32) / card.offsetWidth, Math.max(1, stage.clientHeight - 32) / card.offsetHeight)
    : 1;
}

watch(() => [props.previewTarget, props.captureTarget], ([card, stage]) => {
  resizeObserver?.disconnect();
  if (!card) return;
  resizeObserver = new ResizeObserver(fitPreview);
  resizeObserver.observe(card);
  if (stage) resizeObserver.observe(stage);
  fitPreview();
}, { flush: "post" });

/** Enter the top layer without reparenting or remounting the live iframe. */
async function syncDialog(): Promise<void> {
  const element = dialog.value;
  if (!element) return;
  resetCopyFeedback();
  if (props.open) {
    restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    releaseDismiss = holdHostDismiss("widget-share");
    element.close();
    element.showModal();
    await nextTick();
    heading.value?.focus();
  } else {
    element.close();
    element.show();
    releaseDismiss?.();
    releaseDismiss = undefined;
    restoreFocus?.focus();
    restoreFocus = null;
  }
  await nextTick();
  fitPreview();
  scheduleRegionSync();
}

/** Escape belongs to the modal while it is open, including during a copy. */
function onKeydown(event: KeyboardEvent): void {
  if (!props.open || event.key !== "Escape") return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (!working.value) emit("close");
}

/** A native dialog reports clicks on its backdrop as clicks on the dialog. */
function onBackdrop(event: PointerEvent): void {
  const element = dialog.value;
  if (!element || !props.open || working.value || event.target !== element) return;
  const bounds = element.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom) emit("close");
}

/** Capture the canvas and widget together; keep the dialog's actions outside the image. */
async function copyImage(): Promise<void> {
  if (working.value || !props.captureTarget || !props.previewTarget) return;
  copying.value = true;
  resetCopyFeedback();
  try {
    if (!("__TAURI_INTERNALS__" in window)) {
      throw new Error("Copy preview image is available in the Kavibay desktop app.");
    }
    await loadBackground(backgroundSource.value);
    await nextTick();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const rect = props.captureTarget.getBoundingClientRect();
    await invoke("copy_preview_image", {
      region: {
        x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
      },
    });
    if (disposed || !props.open) return;
    copied.value = true;
    copyFeedbackTimeout = setTimeout(() => {
      copied.value = false;
      copyFeedbackTimeout = undefined;
    }, 2000);
  } catch (error) {
    if (!disposed && props.open) copyError.value = error instanceof Error ? error.message : String(error);
  } finally {
    copying.value = false;
  }
}

watch(() => props.open, syncDialog, { flush: "post" });
onMounted(() => {
  void syncDialog();
  document.addEventListener("keydown", onKeydown, true);
});
onBeforeUnmount(() => {
  disposed = true;
  resetCopyFeedback();
  if (customBackground.value) URL.revokeObjectURL(customBackground.value);
  resizeObserver?.disconnect();
  document.removeEventListener("keydown", onKeydown, true);
  dialog.value?.close();
  releaseDismiss?.();
  restoreFocus?.focus();
  scheduleRegionSync();
});
</script>

<template>
  <dialog
    ref="dialog"
    class="preview-dialog"
    :class="{ 'preview-dialog--share': open, 'preview-dialog--copying': copying, 'preview-dialog--contents': !open && inlineLayout === 'contents' }"
    :role="open ? 'dialog' : 'region'"
    :aria-label="open ? `Share ${title}` : 'Widget preview'"
    :aria-modal="open ? true : undefined"
    :data-interactive="open ? '' : undefined"
    @cancel.prevent="!working && emit('close')"
    @pointerdown="onBackdrop"
  >
    <!-- Make the native backdrop clickable even outside the Wizard's host card. -->
    <div v-if="open" class="share-hit-region" data-interactive aria-hidden="true"></div>
    <header v-if="open" class="share-header">
      <h2 ref="heading" tabindex="-1">Share {{ title }}</h2>
      <DialogCloseButton label="Close share dialog" :disabled="working" @click="emit('close')" />
    </header>
    <div class="share-layout">
      <div class="share-preview" :style="{ '--share-preview-scale': previewScale, '--share-canvas-background': `url('${backgroundSource}')` }"><slot /></div>
      <aside v-if="open && exportable !== false" class="share-actions" aria-label="Share options">
        <button type="button" class="share-export" :disabled="working" @click="resetCopyFeedback(); emit('export')">
          <IconBase :size="18" :stroke-width="1.75" class="share-export-icon">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
            <path d="M14 2v6h6M12 11v6m-3-3 3 3 3-3" />
          </IconBase>
          <span>Export widget as file</span>
        </button>
        <details class="share-import-help">
          <summary>
            <IconBase :size="12" class="share-import-chevron"><path d="m9 5 7 7-7 7" /></IconBase>
            How to import
          </summary>
          <ol>
            <li>In Kavibay, search for <strong>Import Widget</strong>.</li>
            <li>Choose the exported <strong>.zip</strong> file.</li>
            <li>Review the requested access and click <strong>Install widget</strong>.</li>
          </ol>
          <p>You can also drag the .zip file onto Kavibay.</p>
        </details>
        <p v-if="feedback && !copyError && !copied" class="share-feedback" role="status">{{ feedback }}</p>
      </aside>
    </div>
    <footer v-if="open" class="share-footer">
      <input ref="backgroundInput" type="file" accept="image/*" aria-label="Choose canvas background" hidden @change="chooseBackground" />
      <button type="button" :disabled="working" @click="backgroundInput?.click()">
        <IconBase :size="14">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="m21 15-5-5L5 21" />
        </IconBase>
        {{ loadingBackground ? 'Loading image…' : 'Upload background image' }}
      </button>
      <span v-if="backgroundName" class="share-background-name" :title="backgroundName">{{ backgroundName }}</span>
      <button v-if="customBackground" type="button" :disabled="working" @click="resetBackground">Reset background</button>
      <button type="button" :disabled="working || !captureTarget || !previewTarget" @click="copyImage">
        <IconBase :size="14">
          <rect x="9" y="9" width="12" height="12" rx="2" />
          <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
        </IconBase>
        <span class="share-copy-label" :class="{ 'share-copy-label--copied': copied }" aria-live="polite" aria-atomic="true">
          <span class="share-copy-default" :aria-hidden="copied">{{ copying ? 'Copying…' : 'Copy preview image' }}</span>
          <span class="share-copy-success" :aria-hidden="!copied">Copied!</span>
        </span>
      </button>
      <p v-if="copyError" class="share-feedback" role="alert">{{ copyError }}</p>
      <p v-if="backgroundError" class="share-feedback" role="alert">{{ backgroundError }}</p>
    </footer>
  </dialog>
</template>

<style scoped>
h2[tabindex="-1"] { outline: none; }

.preview-dialog {
  position: relative;
  inset: auto;
  display: flex;
  flex: 1;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  max-width: none;
  max-height: none;
  margin: 0;
  padding: 0;
  border: 0;
  color: inherit;
  background: transparent;
  overflow: visible;
  box-sizing: border-box;
}
.preview-dialog--share {
  position: fixed;
  inset: 0;
  width: min(760px, calc(100vw - 48px));
  height: min(480px, calc(100vh - 48px));
  margin: auto;
  padding: 18px;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  border-radius: 16px;
  background: rgb(var(--surface-bg-rgb));
  color: rgba(var(--fg-rgb), 0.92);
  box-shadow: 0 16px 64px rgba(0, 0, 0, 0.35);
  pointer-events: auto;
}
.preview-dialog::backdrop { background: rgba(0, 0, 0, 0.4); }
.preview-dialog--contents,
.preview-dialog--contents > .share-layout,
.preview-dialog--contents > .share-layout > .share-preview { display: contents; }
.share-hit-region { position: fixed; inset: 0; pointer-events: none; }
.share-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.share-header h2 { margin: 0; font-size: 16px; font-weight: 600; overflow-wrap: anywhere; }
.share-layout, .share-preview { display: flex; flex: 1; min-width: 0; min-height: 0; }
.share-preview { flex-direction: column; }
.preview-dialog--share .share-layout { gap: 16px; }
.share-actions { display: flex; flex-direction: column; gap: 10px; width: 174px; flex-shrink: 0; overflow-y: auto; }
.share-actions button { border: 1px solid rgba(var(--fg-rgb), 0.12); border-radius: 8px; padding: 10px; background: rgba(var(--fg-rgb), 0.05); color: inherit; font: inherit; text-align: left; cursor: pointer; }
.share-export { display: flex; align-items: center; gap: 8px; min-height: 46px; }
.share-export span { min-width: 0; font-size: 12px; font-weight: 500; line-height: 1.45; }
.share-export-icon { flex-shrink: 0; color: rgba(var(--fg-rgb), 0.7); }
.share-actions button:hover:not(:disabled) { background: rgba(var(--fg-rgb), 0.12); }
.share-actions button:focus-visible { outline: 2px solid rgba(var(--fg-rgb), 0.6); outline-offset: 2px; }
.share-actions button:disabled { opacity: 0.45; cursor: default; }
.share-import-help { font-size: 11px; line-height: 1.6; color: rgba(var(--fg-rgb), 0.55); }
.share-import-help summary { display: flex; align-items: center; gap: 6px; padding: 4px 0; list-style: none; cursor: pointer; }
.share-import-help summary::-webkit-details-marker { display: none; }
.share-import-help summary:hover { color: rgba(var(--fg-rgb), 0.85); }
.share-import-help summary:focus-visible { outline: 2px solid rgba(var(--fg-rgb), 0.6); outline-offset: 2px; border-radius: 4px; }
.share-import-chevron { flex-shrink: 0; }
.share-import-help[open] .share-import-chevron { transform: rotate(90deg); }
.share-import-help ol { margin: 8px 0; padding-left: 18px; }
.share-import-help li + li { margin-top: 8px; }
.share-import-help strong { font-weight: 600; color: rgba(var(--fg-rgb), 0.75); }
.share-import-help p { margin: 10px 0 0; }
.share-feedback { margin: 4px 0; font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; color: rgba(var(--fg-rgb), 0.65); }
.share-footer { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 12px; margin-top: 10px; flex-shrink: 0; }
.share-footer button { display: inline-flex; align-items: center; gap: 6px; min-height: 24px; padding: 2px 4px; border: 0; border-radius: 4px; background: transparent; font: inherit; font-size: 11px; color: rgba(var(--fg-rgb), 0.5); cursor: pointer; }
.share-footer button:hover:not(:disabled) { color: rgba(var(--fg-rgb), 0.85); background: rgba(var(--fg-rgb), 0.05); }
.share-footer button:focus-visible { outline: 2px solid rgba(var(--fg-rgb), 0.6); outline-offset: 2px; }
.share-footer button:disabled { opacity: 0.45; cursor: default; }
.share-copy-label { display: grid; text-align: left; }
.share-copy-label > span { grid-area: 1 / 1; transition: opacity 200ms ease; }
.share-copy-success, .share-copy-label--copied .share-copy-default { opacity: 0; }
.share-copy-label--copied .share-copy-success { opacity: 1; }
.share-background-name { max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: rgba(var(--fg-rgb), 0.45); }
.share-footer .share-feedback { flex-basis: 100%; }
.preview-dialog--copying .share-preview { pointer-events: none; }
@media (prefers-reduced-motion: reduce) {
  .share-copy-label > span { transition: none; }
}
@media (max-width: 640px) {
  .preview-dialog--share { width: calc(100vw - 24px); height: min(540px, calc(100vh - 24px)); padding: 14px; }
  .preview-dialog--share .share-layout { flex-direction: column; gap: 14px; }
  .share-actions { width: auto; }
}
</style>
