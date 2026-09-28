import { usePreviewRecording, type RecordingTransport, type RecordingProgress, type RecordedClip } from "./usePreviewRecording";

const assert = {
  equal(actual: unknown, expected: unknown, message = "values differ") {
    if (!Object.is(actual, expected)) throw new Error(`${message}: ${String(actual)} !== ${String(expected)}`);
  },
  ok(value: unknown, message = "expected a truthy value") { if (!value) throw new Error(message); },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
const region = { x: 0, y: 0, width: 100, height: 100, viewportWidth: 200, viewportHeight: 200 };
const result: RecordedClip = { clipId: "clip-one", durationMs: 5000, width: 100, height: 100, bytes: 20 };
let recording = deferred<RecordedClip>();
let reading = deferred<ArrayBuffer>();
let copying = deferred<void>();
let progress: (value: RecordingProgress) => void = () => {};
let recordId = "";
let records = 0, copies = 0, cancelled = 0;
const transport: RecordingTransport = {
  availability: async () => ({ supported: true, available: true }),
  record: (id, _region, listener) => { records++; recordId = id; progress = listener; return recording.promise; },
  cancel: async () => { cancelled++; },
  copy: () => { copies++; return copying.promise; },
  save: async () => true,
  read: () => reading.promise,
};
const model = usePreviewRecording(transport);
await model.checkAvailability();
let job = model.start(async () => region);
await Promise.resolve();
assert.equal(model.active.value, true);
await model.start(async () => region);
assert.equal(records, 1, "only one job may start");
assert.equal(model.elapsedMs.value, 0, "preparation does not consume recording time");
progress({ recordingId: recordId, phase: "recording", elapsedMs: 100 });
assert.equal(model.phase.value, "recording");
recording.resolve(result);
await job;
assert.equal(model.clip.value?.clipId, result.clipId);
assert.equal(model.phase.value, "ready");
progress({ recordingId: recordId, phase: "encoding", elapsedMs: 5000 });
assert.equal(model.phase.value, "ready", "late progress cannot restart a completed recording");
assert.equal(copies, 0, "recording never copies automatically");

const copy = model.copyClip();
await model.copyClip();
assert.equal(copies, 1, "duplicate copy clicks are suppressed");
copying.reject(new Error("clipboard busy"));
await copy;
assert.equal(model.copyStatus.value, "error");
assert.equal(model.clip.value?.clipId, result.clipId);
copying = deferred<void>();
const retry = model.copyClip(); copying.resolve(); await retry;
assert.equal(model.copyStatus.value, "copied");
assert.equal(copies, 2);

const play = model.playRecording();
model.backToWidget();
reading.resolve(new ArrayBuffer(8));
await play;
assert.equal(model.videoUrl.value, null, "late read cannot reopen playback");
assert.equal(copies, 2, "playback does not copy");
reading = deferred<ArrayBuffer>();
const playAgain = model.playRecording(); reading.resolve(new ArrayBuffer(8)); await playAgain;
const url = model.videoUrl.value;
assert.ok(url);
assert.equal(model.view.value, "playback");

recording = deferred<RecordedClip>();
job = model.start(async () => region);
await Promise.resolve();
assert.equal(model.view.value, "live");
model.cancel();
progress({ recordingId: recordId, phase: "recording", elapsedMs: 500 });
recording.resolve({ ...result, clipId: "cancelled" });
await job;
assert.ok(cancelled > 0);
assert.equal(model.clip.value?.clipId, result.clipId, "cancel preserves previous clip");

recording = deferred<RecordedClip>();
job = model.start(async () => region);
await Promise.resolve();
model.close();
recording.resolve({ ...result, clipId: "closed" });
await job;
assert.equal(model.clip.value?.clipId, result.clipId, "late result cannot replace clip after close");
assert.equal(model.active.value, false);
assert.equal(model.videoUrl.value, null);
assert.equal(copies, 2);
let released = false;
try { await fetch(url!); } catch { released = true; }
assert.ok(released, "closing revokes the playback Blob URL");
model.dispose();

// Cancelling while layout/background preparation is pending must not start Rust.
const preparing = usePreviewRecording(transport);
await preparing.checkAvailability();
const geometry = deferred<typeof region>();
const before = records;
const preparation = preparing.start(() => geometry.promise);
preparing.cancel();
geometry.resolve(region);
await preparation;
assert.equal(records, before);
assert.equal(preparing.active.value, false);
preparing.dispose();
console.log("preview recording lifecycle assertions passed");
