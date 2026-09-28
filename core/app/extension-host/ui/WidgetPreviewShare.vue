<script setup lang="ts">
import DialogCloseButton from "@sdk/ui/DialogCloseButton.vue";
import IconBase from "@sdk/icons/IconBase.vue";
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, useId, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { holdHostDismiss } from "@sdk/hostDismiss";
import ResizeEdges from "../../host/ResizeEdges.vue";
import { type ResizeApplyResult, type ResizeClamps } from "../../host/resizeLogic";
import { scheduleRegionSync } from "../../system/clickThrough";
import defaultBackground from "../../assets/share-canvas/nebula.png";
import { usePreviewRecording, type CaptureRegion } from "./usePreviewRecording";
import PreviewSizePicker from "./PreviewSizePicker.vue";
import { fitPreviewSize, type PreviewFraming } from "./previewSize";

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
const video = ref<HTMLVideoElement | null>(null);
const previewArea = ref<HTMLElement | null>(null);
const sizePicker = ref<InstanceType<typeof PreviewSizePicker> | null>(null);
const recordingControls = ref<HTMLElement | null>(null);
const recordMenuTrigger = ref<HTMLButtonElement | null>(null);
const recordMenuOption = ref<HTMLButtonElement | null>(null);
const recordMenuOpen = ref(false);
const recordMenuId = useId();
const previewFraming = ref<PreviewFraming | null>(null);
const previewSpace = ref({ width: 0, height: 0 });
const recording = reactive(usePreviewRecording(undefined, () => {
  if (!video.value) return;
  video.value.pause();
  video.value.removeAttribute("src");
  video.value.load();
}));
const canvasStyle = computed(() => {
  if (!props.open || !previewFraming.value) return undefined;
  const size = fitPreviewSize(previewFraming.value, previewSpace.value);
  return { width: `${size.width}px`, height: `${size.height}px` };
});
const screenshot = shallowRef<ArrayBuffer | null>(null);
const imageAction = ref<"capture" | "copy" | "save" | null>(null);
const capturing = computed(() => imageAction.value === "capture");
const copied = ref(false);
const imageSaved = ref(false);
const copyError = ref("");
const previewScale = ref(1);
const backgroundInput = ref<HTMLInputElement | null>(null);
const customBackground = ref<string | null>(null);
const backgroundName = ref("");
const backgroundError = ref("");
const loadingBackground = ref(false);
const backgroundSource = computed(() => customBackground.value ?? defaultBackground);
const baseWorking = computed(() => !!props.busy || imageAction.value !== null || loadingBackground.value);
const working = computed(() => baseWorking.value || recording.active || recording.copyStatus === "copying" || recording.saving);
const recordingLabel = computed(() => {
  if (recording.cancelling) return "Cancelling…";
  if (recording.phase === "countdown") return "Starting in 1s…";
  if (recording.phase === "preparing") return "Preparing…";
  if (recording.phase === "encoding") return "Finishing…";
  const seconds = Math.floor(recording.elapsedMs / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
});
const recordingFeedback = computed(() => recording.error || recording.copyError || recording.saveFeedback
  || recording.availability?.reason || (recording.copyStatus === "copied" ? "Video copied" : ""));
const recordingSuccess = computed(() => ["Video copied", "Video saved"].includes(recordingFeedback.value));
const showRecordingFeedback = ref(false);
let recordingFeedbackTimeout: ReturnType<typeof setTimeout> | undefined;
watch(recordingFeedback, (message) => {
  clearTimeout(recordingFeedbackTimeout);
  showRecordingFeedback.value = !!message;
  if (recordingSuccess.value) recordingFeedbackTimeout = setTimeout(() => { showRecordingFeedback.value = false; }, 2200);
});
function copyRecording(): void {
  recording.saveFeedback = "";
  void recording.copyClip();
}
function saveRecording(): void {
  recording.copyError = "";
  recording.copyStatus = "idle";
  void recording.saveClip();
}
type DialogBox = { left: number; top: number; width: number; height: number };
const dialogBox = ref<DialogBox | null>(null);
const dialogStyle = computed(() => props.open && dialogBox.value ? {
  inset: "auto",
  margin: "0",
  left: `${dialogBox.value.left}px`,
  top: `${dialogBox.value.top}px`,
  width: `${dialogBox.value.width}px`,
  height: `${dialogBox.value.height}px`,
} : undefined);
const resizeClamps = ref<ResizeClamps>({ minWidth: 480, minHeight: 300, maxWidth: 16384, maxHeight: 16384 });
let resizeStart: ReturnType<typeof measureDialog> | null = null;
let disposed = false;
let restoreFocus: HTMLElement | null = null;
let releaseDismiss: (() => void) | undefined;
let resizeObserver: ResizeObserver | undefined;
let previewAreaObserver: ResizeObserver | undefined;
let previewAreaFrame = 0;
let copyFeedbackTimeout: ReturnType<typeof setTimeout> | undefined;
let imageGeneration = 0;
let captureBounds: CaptureRegion | null = null;
let geometryFrame = 0;
let captureEpoch = 0;

function stopGeometryWatch(): void {
  captureEpoch++;
  cancelAnimationFrame(geometryFrame);
  geometryFrame = 0;
  captureBounds = null;
}

function readCaptureBounds(): CaptureRegion {
  if (!props.captureTarget || !props.open) throw new Error("Open the widget preview before recording.");
  const rect = props.captureTarget.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
    viewportWidth: window.innerWidth, viewportHeight: window.innerHeight };
}

function watchCaptureBounds(): void {
  if (!recording.active || !captureBounds || !props.open) return;
  const current = readCaptureBounds();
  if (document.hidden || Object.keys(current).some((key) =>
    Math.abs(current[key as keyof CaptureRegion] - captureBounds![key as keyof CaptureRegion]) > 0.5)) {
    recording.cancel();
    return;
  }
  geometryFrame = requestAnimationFrame(watchCaptureBounds);
}

function closeRecordMenu(restoreFocus = false): boolean {
  if (!recordMenuOpen.value) return false;
  recordMenuOpen.value = false;
  if (restoreFocus) recordMenuTrigger.value?.focus();
  return true;
}

async function toggleRecordMenu(): Promise<void> {
  if (working.value || closeRecordMenu(true)) return;
  sizePicker.value?.close();
  recordMenuOpen.value = true;
  await nextTick();
  recordMenuOption.value?.focus();
}

function onRecordMenuOutside(event: Event): void {
  if (event.target instanceof Node && !recordingControls.value?.contains(event.target)) closeRecordMenu();
}
function onRecordMenuBlur(): void { closeRecordMenu(); }

async function recordVideo(delayMs = 0): Promise<void> {
  if (working.value) return;
  closeRecordMenu(true);
  const epoch = ++captureEpoch;
  resetCopyFeedback();
  await recording.start(async () => {
    await loadBackground(backgroundSource.value);
    await nextTick();
    fitPreview();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    if (epoch !== captureEpoch || !props.open) throw new Error("Recording cancelled.");
    captureBounds = readCaptureBounds();
    watchCaptureBounds();
    return captureBounds;
  }, delayMs);
  // A previous background decode can finish after Share closes and reopens.
  // Its cleanup must not stop the next recording's geometry observer.
  if (epoch === captureEpoch) {
    stopGeometryWatch();
    await nextTick();
    fitPreview();
  }
}

async function playRecording(): Promise<void> {
  await recording.playRecording();
  await nextTick();
  if (recording.view === "playback" && video.value && recording.videoUrl) {
    // A delayed file read can consume browser activation; native controls remain usable.
    await video.value.play().catch(() => {});
  }
}

function onVideoError(): void {
  if (recording.videoUrl && recording.view === "playback") {
    recording.playbackError = "This video could not be played. You can still copy or save it.";
  }
}

function onVisibilityChange(): void { if (document.hidden && recording.active) recording.cancel(); }

function requestClose(): void {
  if (baseWorking.value || recording.saving) return;
  stopGeometryWatch();
  recording.close();
  emit("close");
}

function cancelOrClose(): void {
  if (closeRecordMenu(true)) return;
  if (sizePicker.value?.close(true)) return;
  if (recording.active) void recording.stop();
  else requestClose();
}

function changePreviewSize(size: PreviewFraming): void {
  if (working.value) return;
  recording.backToWidget();
  resetCopyFeedback();
  previewFraming.value = size;
}

function measureDialog() {
  const element = dialog.value;
  if (!element) return null;
  const bounds = element.getBoundingClientRect();
  // A top-layer dialog still inherits the host's CSS zoom.
  const scaleX = bounds.width / element.offsetWidth || 1;
  const scaleY = bounds.height / element.offsetHeight || 1;
  return {
    left: bounds.left / scaleX, top: bounds.top / scaleY,
    width: bounds.width / scaleX, height: bounds.height / scaleY,
    viewportWidth: window.innerWidth / scaleX, viewportHeight: window.innerHeight / scaleY,
  };
}

function startResize(event: PointerEvent): void {
  if (event.button !== 0) return;
  resizeStart = measureDialog();
  if (!resizeStart) return;
  const maxWidth = Math.max(1, resizeStart.viewportWidth - 24);
  const maxHeight = Math.max(1, resizeStart.viewportHeight - 24);
  resizeClamps.value = {
    minWidth: Math.min(480, maxWidth), minHeight: Math.min(300, maxHeight),
    maxWidth, maxHeight,
  };
}

function onResize(size: ResizeApplyResult & { edge?: string }): void {
  if (!resizeStart || !size.edge) return;
  const start = resizeStart;
  const fromLeft = size.edge.includes("w");
  const fromTop = size.edge.includes("n");
  // Clamp the dragged edge, keeping the opposite edge fixed at the viewport limit.
  const width = Math.min(size.width, fromLeft ? start.left + start.width - 12 : start.viewportWidth - start.left - 12);
  const height = Math.min(size.height, fromTop ? start.top + start.height - 12 : start.viewportHeight - start.top - 12);
  dialogBox.value = {
    width, height,
    left: fromLeft ? start.left + start.width - width : start.left,
    top: fromTop ? start.top + start.height - height : start.top,
  };
}

function endResize(): void {
  resizeStart = null;
  scheduleRegionSync();
}

function onViewportResize(): void {
  if (!props.open) return;
  if (recording.active) recording.cancel();
  const current = measureDialog();
  if (!current) return;
  const width = Math.min(current.width, Math.max(1, current.viewportWidth - 24));
  const height = Math.min(current.height, Math.max(1, current.viewportHeight - 24));
  dialogBox.value = {
    width, height,
    left: Math.max(12, Math.min(current.left, current.viewportWidth - width - 12)),
    top: Math.max(12, Math.min(current.top, current.viewportHeight - height - 12)),
  };
  scheduleRegionSync();
}

function resetCopyFeedback(): void {
  clearTimeout(copyFeedbackTimeout);
  copyFeedbackTimeout = undefined;
  copied.value = false;
  imageSaved.value = false;
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
  if (recording.view === "playback") return;
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

watch([previewArea, () => props.open], ([area, open]) => {
  previewAreaObserver?.disconnect();
  cancelAnimationFrame(previewAreaFrame);
  if (!area || !open) return;
  // The toolbar and the format picker do not control the preview's position.
  previewAreaObserver = new ResizeObserver(([entry]) => {
    if (!entry) return;
    cancelAnimationFrame(previewAreaFrame);
    previewAreaFrame = requestAnimationFrame(() => {
      previewSpace.value = { width: entry.contentRect.width, height: entry.contentRect.height };
    });
  });
  previewAreaObserver.observe(area);
  previewSpace.value = { width: area.clientWidth, height: area.clientHeight };
}, { flush: "post" });

/** Enter the top layer without reparenting or remounting the live iframe. */
async function syncDialog(): Promise<void> {
  const element = dialog.value;
  if (!element) return;
  imageGeneration++;
  resetCopyFeedback();
  dialogBox.value = null;
  resizeStart = null;
  if (props.open) {
    if ("__TAURI_INTERNALS__" in window && !recording.availability) void recording.checkAvailability();
    restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    releaseDismiss = holdHostDismiss("widget-share");
    element.close();
    element.showModal();
    await nextTick();
    onViewportResize();
    heading.value?.focus();
  } else {
    stopGeometryWatch();
    recording.close();
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
  if (event.repeat) return;
  cancelOrClose();
}

/** A native dialog reports clicks on its backdrop as clicks on the dialog. */
function onBackdrop(event: PointerEvent): void {
  const element = dialog.value;
  if (!element || !props.open || baseWorking.value || event.target !== element) return;
  const bounds = element.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom) requestClose();
}

function resetScreenshot(): void {
  if (working.value) return;
  screenshot.value = null;
  resetCopyFeedback();
}

/** Keep the captured pixels unchanged until the user resets the screenshot. */
async function captureImage(): Promise<void> {
  if (working.value || !props.open || !props.captureTarget || !props.previewTarget) return;
  const generation = imageGeneration;
  imageAction.value = "capture";
  resetCopyFeedback();
  showRecordingFeedback.value = false;
  recording.backToWidget();
  try {
    if (!("__TAURI_INTERNALS__" in window)) {
      throw new Error("Screenshots are available in the Kavibay desktop app.");
    }
    await loadBackground(backgroundSource.value);
    await nextTick();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    if (disposed || !props.open || generation !== imageGeneration) return;
    const rect = props.captureTarget.getBoundingClientRect();
    const image = await invoke<ArrayBuffer>("capture_preview_image", {
      region: {
        x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
      },
    });
    if (!disposed && props.open && generation === imageGeneration) screenshot.value = image;
  } catch (error) {
    if (!disposed && props.open && generation === imageGeneration) copyError.value = error instanceof Error ? error.message : String(error);
  } finally {
    imageAction.value = null;
  }
}

async function exportImage(action: "copy" | "save"): Promise<void> {
  if (working.value || !screenshot.value) return;
  const generation = imageGeneration;
  imageAction.value = action;
  resetCopyFeedback();
  try {
    // Binary IPC avoids turning the PNG into a large JSON array of byte values.
    const result = await invoke<boolean | void>(action === "copy" ? "copy_preview_image" : "save_preview_image", screenshot.value);
    if (disposed || !props.open || generation !== imageGeneration || result === false) return;
    copied.value = action === "copy";
    imageSaved.value = action === "save";
    copyFeedbackTimeout = setTimeout(resetCopyFeedback, 2000);
  } catch (error) {
    if (!disposed && props.open && generation === imageGeneration) copyError.value = error instanceof Error ? error.message : String(error);
  } finally {
    imageAction.value = null;
  }
}

watch(() => props.open, () => { closeRecordMenu(); void syncDialog(); }, { flush: "post" });
watch(working, (busy) => { if (busy) closeRecordMenu(); });
watch(() => recording.view, async (view) => { if (view === "live") { await nextTick(); fitPreview(); } });
onMounted(() => {
  void syncDialog();
  document.addEventListener("keydown", onKeydown, true);
  window.addEventListener("resize", onViewportResize);
  document.addEventListener("visibilitychange", onVisibilityChange);
  document.addEventListener("pointerdown", onRecordMenuOutside, true);
  document.addEventListener("focusin", onRecordMenuOutside);
  window.addEventListener("blur", onRecordMenuBlur);
  window.addEventListener("resize", onRecordMenuBlur);
});
onBeforeUnmount(() => {
  disposed = true;
  screenshot.value = null;
  stopGeometryWatch();
  recording.dispose();
  resetCopyFeedback();
  clearTimeout(recordingFeedbackTimeout);
  if (customBackground.value) URL.revokeObjectURL(customBackground.value);
  resizeObserver?.disconnect();
  previewAreaObserver?.disconnect();
  cancelAnimationFrame(previewAreaFrame);
  document.removeEventListener("keydown", onKeydown, true);
  window.removeEventListener("resize", onViewportResize);
  document.removeEventListener("visibilitychange", onVisibilityChange);
  document.removeEventListener("pointerdown", onRecordMenuOutside, true);
  document.removeEventListener("focusin", onRecordMenuOutside);
  window.removeEventListener("blur", onRecordMenuBlur);
  window.removeEventListener("resize", onRecordMenuBlur);
  dialog.value?.close();
  releaseDismiss?.();
  restoreFocus?.focus();
  scheduleRegionSync();
});
</script>

<template>
  <!-- File inputs also emit cancel; only handle the dialog's own cancellation. -->
  <dialog
    ref="dialog"
    class="preview-dialog"
    :class="{ 'preview-dialog--share': open, 'preview-dialog--capturing': capturing, 'preview-dialog--contents': !open && inlineLayout === 'contents' }"
    :style="dialogStyle"
    :role="open ? 'dialog' : 'region'"
    :aria-label="open ? `Share ${title}` : 'Widget preview'"
    :aria-modal="open ? true : undefined"
    :data-interactive="open ? '' : undefined"
    @cancel.self.prevent="cancelOrClose"
    @pointerdown="onBackdrop"
  >
    <!-- Make the native backdrop clickable even outside the Wizard's host card. -->
    <div v-if="open" class="share-hit-region" data-interactive aria-hidden="true"></div>
    <ResizeEdges
      v-if="open && !working"
      :measure-el="dialog"
      :clamps="resizeClamps"
      @pointerdown.capture="startResize"
      @resize="onResize"
      @resize-end="endResize"
    />
    <header v-if="open" class="share-header">
      <h2 ref="heading" tabindex="-1">Share {{ title }}</h2>
      <DialogCloseButton label="Close share dialog" :disabled="baseWorking || recording.saving" @click="requestClose" />
    </header>
    <div class="share-layout" :class="{ 'share-layout--preview-only': !exportable }">
      <div ref="previewArea" class="share-preview" :style="{ '--share-preview-scale': previewScale, '--share-canvas-background': `url('${backgroundSource}')` }">
        <div class="share-live" :style="canvasStyle" :class="{ 'share-live--framed': !!previewFraming, 'share-live--hidden': recording.view === 'playback' }" :inert="recording.view === 'playback'">
          <slot :capture-active="recording.active" />
        </div>
        <div v-if="open && recording.view === 'playback'" class="share-playback">
          <video v-if="recording.videoUrl" ref="video" :src="recording.videoUrl" controls playsinline aria-label="Recorded widget preview" @error="onVideoError" />
          <div class="share-playback-actions">
            <button type="button" @click="recording.backToWidget">
              <IconBase :size="14"><path d="m14 6-6 6 6 6" /></IconBase>
              Back to widget
            </button>
            <button type="button" aria-label="Reset recording" title="Reset recording" :disabled="working" @click="recording.reset">
              <IconBase :size="14"><path d="m6 6 12 12M6 18 18 6" /></IconBase>
            </button>
          </div>
          <span v-if="recording.playbackLoading" role="status">Loading video…</span>
          <p v-if="recording.playbackError" role="alert">{{ recording.playbackError }}</p>
        </div>
      </div>
      <footer v-if="open" class="share-footer">
        <div class="share-capture-actions">
          <input ref="backgroundInput" type="file" accept="image/*" aria-label="Choose canvas background" hidden @change="chooseBackground" />
          <div class="share-screenshot share-media-actions">
            <div v-if="screenshot" class="share-clip-actions" role="group" aria-label="Captured screenshot">
              <button type="button" class="share-icon-button" aria-label="Save screenshot" :title="imageAction === 'save' ? 'Saving…' : 'Save screenshot'"
                :disabled="working" :class="{ 'share-icon-button--success': imageSaved }" @click="exportImage('save')">
                <IconBase :size="15">
                  <path v-if="imageSaved" d="m5 12 4 4L19 6" />
                  <path v-else d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4" />
                </IconBase>
              </button>
              <button type="button" class="share-icon-button" aria-label="Copy screenshot to clipboard" :title="imageAction === 'copy' ? 'Copying…' : 'Copy screenshot to clipboard'"
                :disabled="working" :class="{ 'share-icon-button--success': copied }" @click="exportImage('copy')">
                <IconBase :size="15">
                  <path v-if="copied" d="m5 12 4 4L19 6" />
                  <template v-else><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></template>
                </IconBase>
              </button>
              <button type="button" class="share-icon-button" aria-label="Reset screenshot" title="Reset screenshot" :disabled="working" @click="resetScreenshot">
                <IconBase :size="15"><path d="m6 6 12 12M6 18 18 6" /></IconBase>
              </button>
            </div>
            <button v-else type="button" class="share-capture-button" :disabled="working || !captureTarget || !previewTarget" @click="captureImage">
              <IconBase :size="14">
                <path d="M14.5 4h-5l-2 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3.5Z" />
                <circle cx="12" cy="13" r="3" />
              </IconBase>
              {{ capturing ? 'Capturing…' : 'Capture screenshot' }}
            </button>
            <p v-if="copied || imageSaved" class="share-media-feedback share-media-feedback--success" role="status">{{ copied ? 'Screenshot copied' : 'Screenshot saved' }}</p>
          </div>
          <div v-if="recording.availability?.supported" ref="recordingControls" class="share-recording share-media-actions" aria-label="Video recording">
            <div v-if="recording.active" class="share-recording-active" :class="{ 'share-recording-active--capturing': recording.phase === 'recording' && !recording.cancelling }">
              <span class="share-recording-timer" role="status">
                <span class="share-record-dot" aria-hidden="true"></span>
                {{ recordingLabel }}
              </span>
              <button type="button" class="share-icon-button"
                :aria-label="recording.phase === 'countdown' || recording.phase === 'preparing' ? 'Cancel recording start' : 'Stop recording'"
                title="Stop recording (Esc)" :disabled="recording.cancelling || recording.stopping || recording.phase === 'encoding'" @click="recording.stop">
                <IconBase :size="14">
                  <path v-if="recording.phase === 'countdown' || recording.phase === 'preparing'" d="m6 6 12 12M6 18 18 6" />
                  <rect v-else x="6" y="6" width="12" height="12" rx="1" fill="currentColor" stroke="none" />
                </IconBase>
              </button>
              <span v-if="recording.phase === 'recording'" class="share-recording-progress" :style="{ transform: `scaleX(${recording.elapsedMs / 90000})` }" aria-hidden="true"></span>
            </div>
            <div v-else-if="recording.clip" class="share-clip-actions" role="group" aria-label="Recorded clip">
              <button type="button" class="share-icon-button" aria-label="Play recording" title="Play recording" :disabled="working || recording.playbackLoading" :aria-pressed="recording.view === 'playback'" @click="playRecording">
                <IconBase :size="15"><path d="m8 5 11 7-11 7Z" /></IconBase>
              </button>
              <button type="button" class="share-icon-button" aria-label="Save clip" :title="recording.saving ? 'Saving…' : 'Save clip'" :disabled="working" :class="{ 'share-icon-button--success': showRecordingFeedback && recordingFeedback === 'Video saved' }" @click="saveRecording">
                <IconBase :size="15">
                  <path v-if="showRecordingFeedback && recordingFeedback === 'Video saved'" d="m5 12 4 4L19 6" />
                  <template v-else><path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4" /></template>
                </IconBase>
              </button>
              <button type="button" class="share-icon-button" aria-label="Copy video" :title="recording.copyStatus === 'copying' ? 'Copying…' : 'Copy video'" :disabled="working" :class="{ 'share-icon-button--success': showRecordingFeedback && recordingFeedback === 'Video copied' }" @click="copyRecording">
                <IconBase :size="15">
                  <path v-if="showRecordingFeedback && recordingFeedback === 'Video copied'" d="m5 12 4 4L19 6" />
                  <template v-else><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></template>
                </IconBase>
              </button>
              <button type="button" class="share-icon-button" aria-label="Reset recording" title="Reset recording" :disabled="working" @click="recording.reset">
                <IconBase :size="15"><path d="m6 6 12 12M6 18 18 6" /></IconBase>
              </button>
            </div>
            <div v-else class="share-record-split" role="group" aria-label="Start recording">
              <button type="button" class="share-capture-button" :disabled="working || !recording.availability.available"
                :title="recording.availability.reason || 'Record up to 90 seconds'" @click="recordVideo()">
                <span class="share-record-dot" aria-hidden="true"></span>
                Record clip
              </button>
              <button ref="recordMenuTrigger" type="button" class="share-record-options" aria-label="Recording options"
                aria-haspopup="menu" :aria-expanded="recordMenuOpen" :aria-controls="recordMenuId"
                :disabled="working || !recording.availability.available" @mousedown.prevent @click="toggleRecordMenu"
                @keydown.down.prevent="toggleRecordMenu" @keydown.up.prevent="toggleRecordMenu">
                <IconBase :size="12"><path d="m6 9 6 6 6-6" /></IconBase>
              </button>
              <div v-if="recordMenuOpen" :id="recordMenuId" class="share-record-menu" role="menu" aria-label="Recording options">
                <button ref="recordMenuOption" type="button" role="menuitem" @mousedown.prevent @click="recordVideo(1000)"
                  @keydown.down.prevent @keydown.up.prevent @keydown.home.prevent @keydown.end.prevent>
                  <IconBase :size="14"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></IconBase>
                  Start recording in 1s
                </button>
              </div>
            </div>
            <p v-if="showRecordingFeedback" class="share-media-feedback" :class="{ 'share-media-feedback--success': recordingSuccess }" :role="recordingSuccess ? 'status' : 'alert'">{{ recordingFeedback }}</p>
          </div>
        </div>
        <div class="share-preview-actions">
          <PreviewSizePicker ref="sizePicker" :model-value="previewFraming" :current-size="previewSpace" :disabled="working"
            :background-name="backgroundName" :has-custom-background="!!customBackground"
            @update:model-value="changePreviewSize" @upload-background="backgroundInput?.click()" @reset-background="resetBackground" />
        </div>
        <p v-if="copyError" class="share-feedback" role="alert">{{ copyError }}</p>
        <p v-if="backgroundError" class="share-feedback" role="alert">{{ backgroundError }}</p>
      </footer>
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
  container: share-dialog / inline-size;
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
.preview-dialog--contents > .share-layout > .share-preview,
.preview-dialog--contents > .share-layout > .share-preview > .share-live { display: contents; }
.share-hit-region { position: fixed; inset: 0; pointer-events: none; }
.share-header { display: flex; flex-shrink: 0; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.share-header h2 { margin: 0; font-size: 16px; font-weight: 600; overflow-wrap: anywhere; }
.share-layout, .share-preview, .share-live { display: flex; flex: 1; min-width: 0; min-height: 0; }
.share-preview, .share-live { flex-direction: column; }
.preview-dialog--share .share-preview { position: relative; grid-area: 1 / 1; }
.preview-dialog--share .share-live--framed { flex: none; margin: auto; }
.share-live--hidden { visibility: hidden; pointer-events: none; }
.share-playback { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; background: #111; border-radius: 12px; overflow: hidden; }
.share-playback video { width: 100%; height: 100%; min-height: 0; object-fit: contain; }
.share-playback p, .share-playback span { padding: 12px; font-size: 12px; }
.preview-dialog--share .share-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 174px;
  grid-template-rows: minmax(0, 1fr) auto;
  gap: 10px 16px;
}
.preview-dialog--share .share-layout--preview-only { grid-template-columns: minmax(0, 1fr); }
.share-playback-actions { position: absolute; z-index: 1; inset: 10px 10px auto; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.share-playback-actions button { display: inline-flex; align-items: center; gap: 6px; padding: 6px 9px; border: 1px solid #ffffff24; border-radius: 7px; background: #171719dc; color: #ffffffe0; font: inherit; font-size: 11px; cursor: pointer; }
.share-playback-actions button:hover:not(:disabled) { background: #303033; }
.share-playback-actions button:disabled { opacity: 0.45; cursor: default; }
.share-playback-actions button:focus-visible { outline: 2px solid #ffffff99; outline-offset: 2px; }
/* An explicit width also reserves this space in WebKit's intrinsic flex sizing. */
.share-recording { position: relative; display: flex; justify-content: flex-start; align-items: center; flex: none; width: 144px; min-height: 30px; }
.share-screenshot { position: relative; display: flex; align-items: center; flex: none; width: 156px; min-height: 30px; }
.share-media-actions button { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; height: 30px; border: 0; border-radius: 7px; background: transparent; color: rgba(var(--fg-rgb), 0.7); font: inherit; font-size: 11px; cursor: pointer; transition: background 140ms ease, color 140ms ease; }
.share-media-actions button:hover:not(:disabled) { background: rgba(var(--fg-rgb), 0.08); color: rgba(var(--fg-rgb), 0.95); }
.share-media-actions button:disabled { opacity: 0.4; cursor: default; }
.share-media-actions button:focus-visible { outline: 2px solid rgba(var(--fg-rgb), 0.6); outline-offset: 2px; }
.share-record-dot { width: 6px; height: 6px; flex-shrink: 0; border-radius: 50%; background: #f07878; }
.share-clip-actions { display: flex; gap: 3px; align-items: center; }
.share-media-actions .share-icon-button { width: 30px; padding: 0; }
.share-icon-button[aria-pressed="true"] { background: rgba(var(--fg-rgb), 0.08); color: rgba(var(--fg-rgb), 0.95); }
.share-media-actions .share-icon-button--success { color: #7dcba2; }
.share-record-split { position: relative; display: inline-flex; align-items: center; }
.share-recording .share-record-options { position: relative; width: 26px; padding: 0; border-radius: 0 5px 5px 0; color: rgba(var(--fg-rgb), 0.5); }
.share-record-options::before { content: ""; position: absolute; left: 0; top: 8px; height: 14px; border-left: 1px solid rgba(var(--fg-rgb), 0.12); }
.share-recording .share-record-options[aria-expanded="true"] { background: rgba(var(--fg-rgb), 0.08); color: rgba(var(--fg-rgb), 0.95); }
.share-record-menu { position: absolute; z-index: 3; left: 0; bottom: calc(100% + 8px); width: max-content; padding: 5px; border: 1px solid rgba(var(--fg-rgb), 0.13); border-radius: 9px; background: rgb(var(--surface-bg-rgb)); box-shadow: 0 8px 32px #0006; }
.share-recording .share-record-menu button { justify-content: flex-start; gap: 8px; padding: 0 9px; white-space: nowrap; }
.share-recording-active { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 144px; height: 30px; border-radius: 7px; background: rgba(var(--fg-rgb), 0.045); }
.share-recording-timer { display: inline-flex; align-items: center; gap: 8px; padding-left: 10px; font-size: 11px; font-variant-numeric: tabular-nums; color: rgba(var(--fg-rgb), 0.65); }
.share-recording-active--capturing .share-record-dot { animation: share-record-pulse 1.4s ease-in-out infinite; }
.share-recording-progress { position: absolute; bottom: 0; left: 7px; right: 7px; height: 1px; background: #f07878; transform-origin: left; transition: transform 100ms linear; }
.share-media-feedback { position: absolute; z-index: 2; left: 0; bottom: calc(100% + 8px); width: max-content; max-width: min(300px, 65cqw); margin: 0; padding: 7px 10px; border: 1px solid rgba(var(--fg-rgb), 0.12); border-radius: 7px; background: rgb(var(--surface-bg-rgb)); box-shadow: 0 3px 12px #0003; color: rgba(var(--fg-rgb), 0.8); font-size: 11px; line-height: 1.5; overflow-wrap: anywhere; }
.share-media-feedback--success { color: #7dcba2; }
@keyframes share-record-pulse { 50% { opacity: 0.4; } }
.share-actions { grid-column: 2; grid-row: 1 / -1; display: flex; flex-direction: column; gap: 10px; width: 174px; flex-shrink: 0; overflow-y: auto; }
.share-actions > * { flex-shrink: 0; }
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
.share-footer { grid-column: 1; grid-row: 2; display: flex; align-items: flex-start; justify-content: space-between; gap: 4px 16px; flex-wrap: wrap; min-width: 0; }
.share-preview-actions { display: flex; flex: none; align-items: center; gap: 8px; margin-left: auto; }
.share-capture-actions { display: flex; align-items: center; flex-wrap: wrap; flex: 1; gap: 4px 10px; min-width: 0; min-height: 30px; }
.share-capture-actions .share-capture-button { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 2px 10px; border: 0; border-radius: 5px; background: transparent; font: inherit; font-size: 11px; color: rgba(var(--fg-rgb), 0.5); cursor: pointer; white-space: nowrap; transition: background 140ms ease, color 140ms ease; }
.share-capture-actions .share-capture-button:hover:not(:disabled) { color: rgba(var(--fg-rgb), 0.85); background: rgba(var(--fg-rgb), 0.05); }
.share-capture-actions .share-capture-button:focus-visible { outline: 2px solid rgba(var(--fg-rgb), 0.6); outline-offset: 2px; }
.share-capture-actions .share-capture-button:disabled { opacity: 0.45; cursor: default; }
.share-record-split .share-capture-button { border-radius: 5px 0 0 5px; }
.share-footer .share-feedback { flex-basis: 100%; }
.preview-dialog--capturing .share-preview { pointer-events: none; }
@media (prefers-reduced-motion: reduce) {
  .share-media-actions button, .share-capture-actions .share-capture-button, .share-recording-progress { transition: none; }
  .share-recording-active--capturing .share-record-dot { animation: none; }
}
@media (max-width: 640px) {
  .preview-dialog--share { width: calc(100vw - 24px); height: min(540px, calc(100vh - 24px)); padding: 14px; }
}
@container share-dialog (max-width: 560px) {
  .preview-dialog--share .share-layout { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto auto; gap: 10px; }
  .preview-dialog--share .share-layout--preview-only { grid-template-rows: minmax(0, 1fr) auto; }
  .share-actions { grid-column: 1; grid-row: 3; width: auto; max-height: 140px; }
  .share-capture-actions { gap: 2px 6px; }

}
</style>
