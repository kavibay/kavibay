import { computed, ref } from "vue";
import { Channel, invoke } from "@tauri-apps/api/core";

export type CaptureRegion = { x: number; y: number; width: number; height: number; viewportWidth: number; viewportHeight: number };
export type RecordedClip = { clipId: string; durationMs: number; width: number; height: number; bytes: number };
export type RecordingProgress = { recordingId: string; phase: "preparing" | "recording" | "encoding"; elapsedMs: number };
export type RecordingAvailability = { supported: boolean; available: boolean; reason?: string };
export interface RecordingTransport {
  availability(): Promise<RecordingAvailability>;
  record(id: string, region: CaptureRegion, progress: (event: RecordingProgress) => void): Promise<RecordedClip>;
  cancel(id: string): Promise<void>;
  copy(id: string): Promise<void>;
  save(id: string): Promise<boolean>;
  read(id: string): Promise<ArrayBuffer>;
}

const nativeTransport: RecordingTransport = {
  availability: () => invoke("preview_recording_availability"),
  record: (recordingId, region, progress) => {
    const onEvent = new Channel<RecordingProgress>();
    onEvent.onmessage = progress;
    return invoke("record_preview_clip", { recordingId, region, onEvent });
  },
  cancel: (recordingId) => invoke("cancel_preview_clip", { recordingId }),
  copy: (clipId) => invoke("copy_preview_clip", { clipId }),
  save: (clipId) => invoke("save_preview_clip", { clipId }),
  read: (clipId) => invoke("read_preview_clip", { clipId }),
};

export function usePreviewRecording(transport = nativeTransport, detachVideo: () => void = () => {}) {
  const phase = ref<"idle" | "preparing" | "recording" | "encoding" | "ready" | "error">("idle");
  const clip = ref<RecordedClip | null>(null);
  const error = ref("");
  const elapsedMs = ref(0);
  const cancelling = ref(false);
  const active = computed(() => ["preparing", "recording", "encoding"].includes(phase.value));
  const copyStatus = ref<"idle" | "copying" | "copied" | "error">("idle");
  const copyError = ref("");
  const saving = ref(false);
  const saveFeedback = ref("");
  const view = ref<"live" | "playback">("live");
  const videoUrl = ref<string | null>(null);
  const playbackLoading = ref(false);
  const playbackError = ref("");
  const availability = ref<RecordingAvailability | null>(null);

  let generation = 0;
  let playbackGeneration = 0;
  let activeId: string | null = null;
  let disposed = false;
  let copyPending = false;
  const message = (value: unknown) => value instanceof Error ? value.message : String(value);

  async function checkAvailability() {
    try { const result = await transport.availability(); if (!disposed) availability.value = result; }
    catch (e) { if (!disposed) availability.value = { supported: true, available: false, reason: message(e) }; }
  }

  function releaseVideo() {
    detachVideo();
    if (videoUrl.value) URL.revokeObjectURL(videoUrl.value);
    videoUrl.value = null;
  }

  function backToWidget() {
    playbackGeneration++;
    detachVideo();
    view.value = "live";
    playbackLoading.value = false;
    playbackError.value = "";
  }

  async function start(prepare: () => Promise<CaptureRegion>) {
    if (disposed || active.value || copyPending || saving.value || !availability.value?.available) return;
    const current = ++generation;
    const id = crypto.randomUUID();
    activeId = id;
    backToWidget();
    cancelling.value = false;
    phase.value = "preparing";
    elapsedMs.value = 0;
    error.value = "";
    copyStatus.value = "idle";
    copyError.value = "";
    saveFeedback.value = "";
    const isCurrent = () => !disposed && generation === current && activeId === id && !cancelling.value;
    try {
      const region = await prepare();
      if (!isCurrent()) return;
      const result = await transport.record(id, region, (event) => {
        if (event.recordingId !== id) return;
        if (!isCurrent()) {
          // Cancellation can arrive before Rust has registered the start command.
          void transport.cancel(id).catch(() => {});
          return;
        }
        phase.value = event.phase;
        elapsedMs.value = Math.min(5000, Math.max(0, event.elapsedMs));
      });
      if (!isCurrent()) return;
      releaseVideo();
      clip.value = result;
      phase.value = "ready";
    } catch (e) {
      if (isCurrent()) { error.value = message(e); phase.value = "error"; }
    } finally {
      if (generation === current) {
        if (cancelling.value) phase.value = clip.value ? "ready" : "idle";
        cancelling.value = false;
        activeId = null;
      }
    }
  }

  function cancel() {
    if (!activeId || !active.value) return;
    cancelling.value = true;
    void transport.cancel(activeId).catch(() => {});
  }

  async function copyClip() {
    const id = clip.value?.clipId;
    if (!id || disposed || copyPending || active.value) return;
    const current = generation;
    copyPending = true;
    copyStatus.value = "copying";
    copyError.value = "";
    try {
      await transport.copy(id);
      if (!disposed && current === generation) copyStatus.value = "copied";
    } catch (e) {
      if (!disposed && current === generation) { copyStatus.value = "error"; copyError.value = message(e); }
    } finally {
      copyPending = false;
      if (current !== generation) copyStatus.value = "idle";
    }
  }

  async function saveClip() {
    const id = clip.value?.clipId;
    if (!id || disposed || saving.value || active.value) return;
    const current = generation;
    saving.value = true;
    saveFeedback.value = "";
    try {
      const saved = await transport.save(id);
      if (!disposed && current === generation && saved) saveFeedback.value = "Video saved";
    } catch (e) {
      if (!disposed && current === generation) saveFeedback.value = message(e);
    } finally { saving.value = false; }
  }

  async function playRecording() {
    const id = clip.value?.clipId;
    if (!id || disposed || active.value || playbackLoading.value) return;
    const current = ++playbackGeneration;
    playbackError.value = "";
    view.value = "playback";
    if (videoUrl.value) return;
    playbackLoading.value = true;
    try {
      const bytes = await transport.read(id);
      if (disposed || current !== playbackGeneration || clip.value?.clipId !== id) return;
      videoUrl.value = URL.createObjectURL(new Blob([bytes], { type: "video/mp4" }));
    } catch (e) {
      if (!disposed && current === playbackGeneration) playbackError.value = message(e);
    } finally {
      if (current === playbackGeneration) playbackLoading.value = false;
    }
  }

  function close() {
    cancel();
    generation++;
    activeId = null;
    cancelling.value = false;
    phase.value = clip.value ? "ready" : "idle";
    error.value = "";
    copyError.value = "";
    copyStatus.value = copyPending ? "copying" : "idle";
    saveFeedback.value = "";
    backToWidget();
    releaseVideo();
  }

  function dispose() { close(); disposed = true; }

  return { phase, clip, error, elapsedMs, cancelling, active, copyStatus, copyError, saving, saveFeedback,
    view, videoUrl, playbackLoading, playbackError, availability, checkAvailability,
    start, cancel, copyClip, saveClip, playRecording, backToWidget, close, dispose };
}
