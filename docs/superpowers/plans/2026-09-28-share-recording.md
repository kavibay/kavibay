# Five-second Share Recording Implementation Plan

> **Status:** Implementation authorized and delivered in the current checkout. Windows runtime measurements and target-client paste validation remain open; see the execution evidence below.

**Goal:** Record five seconds of live widget interaction in Share, play the resulting MP4 directly in the dialog, and copy it on button click for use in Discord, Slack and WhatsApp.

**Architecture:** Reuse native webview snapshots and encode MP4/H.264 through Windows Media Foundation or macOS AVFoundation. A separate user-triggered action puts the completed file on the clipboard through arboard. Play completed clips with the webview's native video element using a bounded binary read and Blob URL. Keep widget interaction live while a host-owned recording session fixes the capture rectangle and owns cancellation. Validate native capture, playback and target-app paste before completing the UI.

**Tech Stack:** Vue 3, TypeScript, Tauri 2, Rust, existing `image`, `arboard`, `webview2-com` and `windows` crates; Windows Media Foundation.

**Spec:** [Proposed design](../specs/2026-09-28-share-recording-design.md).

## Global constraints

- Duration: 5,000 ms from the first accepted frame; no audio.
- At most one native snapshot in flight and two decoded frames queued for the encoder.
- Windows is the v0.1 release target; no recording UI in the browser embed.
- No new npm dependency, Rust crate, external executable or CSP entry is planned.
- MP4 only: the maintainer deprioritized GIF when it adds work.
- Playback includes play/pause, seeking and replay in Share, using native controls.
- Only `Copy video` writes a clip to the clipboard; recording and playback leave it unchanged.
- Only the main host webview may record; iframe sandbox and bridge permissions stay unchanged.
- Completed clips remain available for clipboard references; partial files are cleaned up.
- Implementation was approved by the maintainer after review of this proposal.

## Review focus

1. A resized/zoomed canvas on a scaled monitor must not capture neighboring UI (Tasks 1, 3, 4).
2. Slow capture/encoding must not stretch a five-second clip or accumulate frames (Tasks 1, 2).
3. Recording completion, cancellation, playback and late callbacks must not write to the clipboard; only an explicit copy request may do so (Tasks 3, 4).
4. Ctrl+V must transfer an animated/playable file, including after Share closes (Tasks 1, 3, 5).
5. Missing native codecs must produce a clear unavailable state; interacting with the widget must remain responsive (Tasks 2, 4, 5).
6. Playback must preserve widget state, release video resources and never become the next recording's capture source (Tasks 3, 4, 5).

## Task 1: Prove the Windows capture and paste path

**Files:** Temporary probe outside production source; record results in this plan.

**Interfaces:** Exercise existing `CaptureRegion`, Windows snapshot capture,
Media Foundation sink writer and
`arboard::Clipboard::set().file_list`. No production command or UI yet.

- [ ] Build a throwaway Windows probe under an isolated `KAVIBAY_DATA_DIR` and
  `WEBVIEW2_USER_DATA_FOLDER`; use a deterministic sandboxed counter/scroll/text
  widget and the current nebula canvas.
- [ ] Compare clipped `Page.captureScreenshot` with full capture plus crop at
  100%, 125% and 150% monitor scaling and host zoom. Confirm no header/sidebar
  pixels and verify pointer hotspot positioning. Record output dimensions.
- [ ] Record MP4 at 20 fps / 1,280-pixel longest side. Measure the spec's
  performance criteria, file sizes
  and gradient quality. Establish a working H.264 input pixel format and
  profile on the supported Windows installation.
- [ ] Play the generated MP4 in a native webview video element via a Blob URL.
  Verify play/pause, seeking to intermediate frames and replay after the end.
- [ ] Copy the actual MP4 through arboard; test paste and playback in the
  specified clients, including after the source dialog closes. Use only
  disposable test content; sending/uploading to external conversations needs
  the maintainer's explicit instruction. Clipboard/file readback can be tested
  locally without such a send.
- [ ] Record pass/fail/unavailable by client. If capture throughput
  or clipboard delivery fails, revise the design with the evidence before
  implementing the remaining tasks. Do not label a save/upload workaround as
  fulfillment of button-triggered clipboard sharing.

## Task 2: Implement timed frame capture and the MP4 encoder

**Files:**
- Modify `src-tauri/src/preview_capture/mod.rs` and `windows.rs`.
- Create `src-tauri/src/preview_capture/recording.rs`,
  `video_windows.rs`, `media_foundation.rs` and `cursor_windows.rs`.
- Modify `src-tauri/Cargo.toml` only to enable Media Foundation and library-loader features on the existing Windows binding.

**Interfaces:** Factor `capture_snapshot(window: &tauri::WebviewWindow) ->
Result<Vec<u8>, String>` out of image copying. `TimedFrame` contains a cropped
RGBA image and monotonic `at_ms`.
`encode_mp4` consumes a bounded stream of timed frames, output
profile, cancellation flag and destination path; it finalizes a five-second
file or removes its partial output. Keep the concrete encoder simple;
do not introduce a plugin/codec framework.

- [x] Add Rust unit tests for `output_dimensions`, `sample_duration` and crop/
  cursor coordinates. Assert preserved aspect ratio, no upscaling, even MP4
  dimensions, and MP4 durations summing to 50,000,000 units of 100 ns despite
  dropped samples. Run them and observe
  failure before implementing the new logic.
- [x] Extract the snapshot operation and keep `copy_preview_image` behavior
  unchanged. Implement the capture mapping selected by Task 1 and pointer
  composition; capture screenshots only from the owned webview.
- [x] Implement asynchronous capture with a single native request in flight,
  bounded encoding work, a 500 ms snapshot timeout and a backend-enforced
  recording deadline. Use timed frames,
  never `frame_count / fps`, to preserve real interaction speed.
- [x] Implement MP4 with the Media Foundation configuration; native runtime validation remains open. Keep COM
  lifecycle on its worker thread;
  check cancellation between frames and before finalization. Apply the 16 MiB
  output bound and explicit missing-codec error.
- [ ] Verify a generated MP4's dimensions, ordering and duration with Windows Media
  Foundation metadata/readback and playback. Rerun the existing pixel-crop
  tests and the probe's responsiveness measurement.

## Task 3: Own recording sessions, artifacts and clipboard delivery

**Files:** Create `src-tauri/src/preview_capture/recording_commands.rs` and
`artifacts.rs`; modify `preview_capture/mod.rs` and `src-tauri/src/lib.rs`.

**Command contract:**
- `preview_recording_availability` returns `{ available: true }` or
  `{ available: false, reason }`. Windows and macOS are supported; other platforms are unavailable. Probe native
  capability without installing anything.
- `record_preview_clip` accepts `{ recordingId, region, onEvent }`.
  `onEvent` is a Tauri IPC channel receiving `{ recordingId, phase, elapsedMs }`
  where phase is `preparing | recording | encoding`. The command resolves
  after the completed artifact is stored; only phases need streaming, not
  pixel buffers. It never writes to the clipboard.
- The result is `{ clipId, durationMs, width, height, bytes }`.
  Encoding/cancellation returns an error.
- `cancel_preview_clip({ recordingId })` is idempotent.
  `copy_preview_clip({ clipId })` copies the completed artifact on explicit
  button click, returning success or a copy error without changing the artifact;
  `save_preview_clip({ clipId })` opens the native save dialog and copies it.
- `read_preview_clip({ clipId })` returns a binary response containing a
  completed MP4 for local playback. Accept only host-owned completed IDs;
  enforce the 16 MiB bound before reading. Do not accept filesystem paths.

- [ ] Add Rust tests for concurrent starts, duplicate cancellation, stale job
  completion, hidden-window cancellation and unavailable codec. Use
  controllable capture/clipboard seams; assert zero clipboard writes on
  recording success, cancellation, encoding error and playback reads. Observe
  the tests fail.
- [x] Implement one managed main-window recording session. Validate regions,
  output bounds and IDs; scope all commands to `main`; check cancellation before
  accepting each callback and publishing the artifact. Do not publish results
  from an old job into a new one. Keep clipboard writes in the separate copy
  command, which accepts only completed clip IDs.
- [x] Store partials via `paths::cache_dir` and completed clips via
  `paths::data_dir`, with generated filenames and atomic publication. Implement
  file-list clipboard write with the existing retry convention. Keep completed
  files across close/restart; clean cancelled files and startup `.partial.mp4` leftovers.
- [ ] Test that an explicit copy request writes the selected completed file,
  and a copy failure preserves the artifact for playback and retry. Test
  copying again without recapture, unique clips without overwriting previous
  files, Unicode paths, `KAVIBAY_DATA_DIR`, partial cleanup and readable files
  after closing/restarting. Test save cancellation as a no-op.
- [x] Implement bounded binary playback reads and test unknown IDs, partial
  artifacts, path traversal, oversized files and non-main-window callers.
  Return the existing artifact bytes without base64 or frame streaming.
- [x] Register commands in the sorted `preview_capture` group. Let `build.rs`
  generate permissions; verify quickaction and runtime bridges expose none of
  these commands. Run the focused Rust tests and existing ACL asserts.

## Task 4: Wire the five-second interaction into Share

**Files:** Create `core/app/extension-host/ui/usePreviewRecording.ts` and its
colocated `.assert.ts`; modify `WidgetPreviewShare.vue`,
`WidgetWizardPreviewHost.vue`, `core/app/host/WidgetInstanceView.vue` and
`WidgetCard.vue`.

**Interfaces:** The composable owns a discriminated state
`idle | preparing | recording | encoding | ready | error`, a current
recording ID and `start`, `cancel`, `copyClip`, `saveClip`, `dispose` actions.
Track copy status separately as `idle | copying | copied | error`; copy failure
does not make the recording unavailable.
Keep an independent `live | playback` view and `playRecording`/`backToWidget`
actions; retain the latest successful artifact across failed/cancelled attempts.
Share exposes `captureActive: boolean` to its default slot. WidgetCard receives
`captureActive?: boolean` and suppresses only host chrome/move/resize controls.

- [x] Add plain-node assert cases for ignored stale progress, one active start,
  completion after disposal, clipboard-error retry and cancellation transitions.
  Assert recording completion and playback never call the copy command, one
  explicit click calls it once, and duplicate clicks are disabled while pending.
  Assert preparing time does not consume the displayed five seconds. Run the
  colocated file with `npx tsx` and observe failure before implementation.
- [ ] Cover playback reads completing after close, returning to the widget,
  starting another recording or replacing the clip. Assert stale reads never
  attach a video, Blob URLs are released, and clipboard failure still permits
  playback. Keep the previous clip on recording cancellation/failure.
- [x] Add the availability check and the spec's exact button/status
  labels. Decode the selected background before starting, reserve footer space
  and measure the final canvas rectangle after capture chrome is hidden.
- [x] Show `Video ready` when recording completes. Wire `Copy video` to the
  separate copy command, with pending/success/error feedback and retry on
  another click. Keep playback and saving available after copy failure. Block
  another recording while copy is pending; ignore copy results after Share
  closes/reopens, without scheduling any additional write.
- [x] Keep the widget body interactive while preventing host framing changes.
  Share's existing `working`/copying rules cannot simply disable the whole
  preview during recording. Wire both desk and Wizard cards through the slot.
- [x] Add `Play recording` and `Back to widget` with a native
  `<video controls playsinline>` in the preview area. Preserve the live widget
  component while hiding its view; start playback only on user action and
  report read/decode errors without losing copy/save actions. Disable image
  copy while the player is shown and disable playback during active recording
  jobs. Stop playback and restore the live layout
  before starting a recording; never include video controls in captured frames.
- [x] Load the MP4 lazily as a `video/mp4` Blob URL, keeping at most one.
  Pause/detach before revoking on replacement, Share close and disposal; guard
  asynchronous reads by clip/view generation. Keep recording and playback
  state separate; loading or playing a clip never triggers copying.
- [x] Cancel on geometry changes, unmount and hidden document; make Escape and
  close follow the spec. Restore presentation, resizing and focus after every
  success, failure and cancellation path. Dispose channel callbacks/observers.
- [ ] Browser-smoke the lifecycle with a fake transport: click, type and scroll
  inside a sandboxed widget throughout recording; cancel/reopen; keep widget
  state; verify no blue selection ring or recording UI in the canvas. Verify
  playback, pause, seeking, replay and returning to the same widget state.
  Verify recording completion leaves the clipboard untouched until `Copy video`
  is clicked, and closing during an explicit copy causes no stale UI update.
  Verify the embed receives no recording action and image copy still works.

## Task 5: Verify native behavior and document the actual limits

**Files:** Update this plan and `docs/widget-wizard.md` with verified behavior.

- [ ] Run `npm run verify` and `npm run verify:rust`; run Windows build/checks
  and native UI smoke because macOS compilation cannot prove the Windows path.
- [ ] Run native capture with changing text, scrolling and a sandboxed iframe,
  different Share dimensions, custom background, zoom/DPI changes, repeated
  recording, lost focus, missing codec, clipboard contention and cancellation.
  Confirm bounded memory, five-second playback and no cropped dialog controls.
- [ ] In Share, play/pause, seek and replay a real clip; return to the live
  widget and record again. Test close during playback/load, clipboard failure
  with successful playback, read/decode failure and repeated clip replacement.
  Confirm resources are released and the retained file remains copyable.
- [ ] Confirm the clipboard remains unchanged after recording and playback,
  then click `Copy video` and verify the selected clip is pasted. Repeat the
  copy without recording again; test closing during the requested operation.
- [ ] Repeat the Task 1 client matrix with production-generated clips. Report
  exact tested versions and unsupported/unverified combinations honestly.
  Verify `Save clip…` as a separate fallback without treating it as Ctrl+V.
- [ ] Record dependency diff (expected: existing Windows features only), actual
  output sizes and performance. Mark tasks complete only with their evidence.

## Execution evidence — 2026-09-28

- Implemented bounded native snapshots, H.264/MP4 encoding, capture-time cursor
  state, a fresh frame-zero snapshot after encoder preparation, session
  cancellation, persistent clip artifacts, explicit copy/save/read commands,
  and the live/playback UI in both desk and Wizard Share.
- No npm dependency or Rust crate added. Two features were enabled on the
  existing `windows` dependency. Optional Media Foundation DLLs are resolved
  from System32 at runtime, so missing media components cannot add a static
  DLL requirement to app startup.
- Pure Rust tests cover scaling/even dimensions, five-second sample timing,
  NV12 pixel layout, pointer coordinates on scaled/negative-origin monitors,
  cancellation isolation, clip bounds/IDs, partial cleanup, unique completed
  files and main-window authorization. TS assertions cover explicit-only copy,
  retry, preparation cancellation, stale progress/results/reads, preserved clips
  and playback URL cleanup. Runtime capture/clipboard adapter integration still
  needs Windows; no native clipboard write was exercised on this macOS host.
- Browser smoke with a test transport and a generated video confirmed live
  clicking/typing, hidden host framing controls while recording, completion
  without copying, native video playback, explicit copy/save, preserving live
  widget state, cancellation retaining the previous clip, and playback after
  a simulated clipboard error. The test media is not encoder-output evidence.
- `npm run verify`: typecheck, lint and 196 assertion files passed.
  `npm run verify:rust`: formatter, clippy and the macOS Rust suite passed
  outside the sandbox (sandboxed system clipboard, Keychain and local socket
  tests cannot run): 569 tests passed, one ignored.
- The exact `preview_capture` Rust source, including commands, is checked with
  Windows-target clippy and test compilation in an isolated temporary harness
  using the project's locked dependencies and Tauri APIs. The full app's
  Windows cross-check is blocked here by the absent Windows C SDK (`ring`
  cannot find `assert.h`); this is not a Windows build or runtime pass.
- Independent review found optional-DLL startup, delayed-pointer and frame-zero
  timing issues; all were addressed. Windows-only missing-library tests compile
  but cannot execute here. No claim of runtime regression-test execution is
  made for those fixes.

Open release checks: Task 1's Windows performance/DPI/client matrix; real MP4
decode, pause/seek/replay, missing-media-component behavior, clipboard contention
and native cancellation on Windows. Discord, Slack and WhatsApp paste support
remains explicitly unverified. Full-window snapshot plus Rust crop is retained
until an actual Windows probe can justify changing the capture path.

## Original planning verification

Repository and installed dependency source were inspected; primary vendor/API
documentation was checked. No capture benchmark, encoder prototype or messaging
client paste test was run during planning. Product implementation followed the
maintainer's subsequent approval; the execution evidence above supersedes the
planning-only status.

## macOS extension — authorized 2026-09-28

The maintainer explicitly requested macOS recording after encountering the
Windows-only availability gate. This extends the feature without changing
v0.1's Windows release scope.

- [x] Share the bounded capture/session pipeline between Windows and macOS.
- [x] Add the system AVFoundation H.264/MP4 writer, using existing Objective-C
  bindings and CoreVideo only; no new crate, package or executable dependency.
- [x] Capture AppKit pointer pixels and coordinates on the main thread, then
  composite them using WKWebView point-to-snapshot scaling.
- [x] Enable the existing Record / Play / Copy / Save controls on macOS through
  the same native availability probe.
- [x] Add a native encoder roundtrip test and `scripts/shareRecordingMacSmoke.swift`
  for H.264, five-second duration, dimensions, decoded colors/orientation, the
  final interaction frame and file URLs on a private pasteboard.
- [x] Run the complete native Share interaction smoke in an ephemeral Tauri
  window using production `WidgetPreviewShare.vue` and `preview_capture` commands:
  Record button availability, sandboxed iframe interaction captured as changing
  decoded pixels, five-second MP4, play/pause, seeking/replay, cancellation, retained
  previous clip and close/reopen all passed, at 100% and 125% CSS zoom. No
  clipboard write or external send. The optimized 1064×592 sample is 5.0 seconds,
  462,101 bytes, about 20 fps, with a largest sample gap of 67 ms on this Mac.
  Capturing only the preview rect improved the initial full-window result
  (about 10 fps); this is a local measurement, not a hardware-wide guarantee.
- [x] `npm run verify`: typecheck, lint and all 196 assertion files passed.
- [x] `npm run verify:rust`: formatting, Clippy and 571 tests passed (1 ignored),
  including the native macOS MP4 roundtrip and Retina/viewport cursor mapping.
- [x] Exact production preview-capture source and tests pass Windows-target Clippy
  in the existing isolated harness; native Windows execution remains unverified.

Target-client paste behavior in Discord, Slack and WhatsApp remains unverified.
The private-pasteboard check proves a readable native file reference only.

## Share toolbar refinement — requested 2026-09-28

- Align `Record 5s clip` with the preview's right edge, opposite the image actions.
- Replace the completed recording action with exactly three icon buttons:
  Play, Save, Copy. Keep tooltips and accessible labels.
- Use an inline timer, cancel icon and thin progress indicator during capture.
  Success feedback briefly shows a checkmark and floating notice; it adds no
  persistent status row. Keep the action width fixed so the capture rect stays
  stable through every state, including narrow dialogs.
- Move `Back to widget` and `Record again` into the player.
- Browser visual smoke passed at 760px and 480px dialog widths; preview bounds
  remained identical before/during/after capture. Save/copy feedback and playback
  used a fake native transport and a real previously recorded MP4.
- Native macOS smoke passed with the production Share component and commands:
  actual five-second sandboxed widget capture, the three icons, playback/seek,
  Record again, cancellation, retained previous clip and close/reopen.
- `npm run verify` passed: typecheck, lint and all 196 assertion files.
