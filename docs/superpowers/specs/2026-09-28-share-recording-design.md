# Five-second Share recordings

Status: approved and implemented; native Windows runtime validation remains open.

## User outcome

From Share, record five seconds of interacting with the live widget, play the
result in the dialog, and copy it to the clipboard on button click for Discord,
Slack and WhatsApp.
The maintainer requested planning before implementation and no new external
libraries unless necessary. They subsequently clarified that GIF is not
important when it adds work; this proposal therefore includes MP4 only.
The completed recording must also be playable directly in Share.

## Proposed experience

- Place `Record 5s clip` at the right edge directly below the preview, opposite
  the image actions. After recording, replace it with three icon buttons in
  order: Play, Save, Copy. Each has a tooltip and accessible name. No format
  selector or GIF export.
- Show `Preparing…` until capture is ready, then `Recording… 5.0s` counting down
  for exactly five seconds. No separate countdown before recording.
- Keep the widget fully interactive: clicks, typing and scrolling must work.
  Capture its canvas and selected background, with the pointer when inside the
  canvas. Do not record audio, the dialog header, footer or export sidebar.
- Fix the canvas rectangle during recording: disable dialog resizing,
  background changes, image copy and package export. Hide host widget chrome,
  drag and resize grips for the recording; preserve controls inside the widget.
  Reserve footer space so status text cannot resize the canvas.
- Show remaining time and a thin progress indicator during capture, then
  `Finishing…`. Completed clips use the three compact actions. Copy/save success
  briefly shows a checkmark and a small notice without changing preview bounds.
  `Record again` is available inside playback.
  Completing a recording leaves the clipboard unchanged.
- Only clicking `Copy video` writes the completed clip to the clipboard. Show
  `Copying…` during the operation and `Video copied` on success. Allow copying
  the same clip again without another recording. A clipboard error keeps that
  clip available for playback, saving and retry.
- `Play recording` opens the completed MP4 in the existing preview area, with
  native video controls for play/pause, seeking and replay. Playback starts only
  on user action. `Back to widget` returns to the live preview with its state
  intact. Keep the widget mounted while its preview is hidden. Playback and
  copying are independent actions; viewing a clip never changes the clipboard.
- Starting another recording stops playback, returns to the live widget and
  waits for its layout before measuring the capture rectangle. Keep image copy
  disabled while the player is displayed so it cannot capture the player UI.
  Disable playback while a recording job is preparing, capturing or finishing.
  A successful new recording replaces the available clip; a failed/cancelled
  attempt leaves the previous clip available.
- `Cancel recording` or Escape cancels without replacing the clipboard; Escape
  leaves Share open. Closing Share cancels the job. An externally changed
  canvas/viewport or a hidden/destroyed window cancels rather than recording the
  wrong rectangle. Recording cancellation does not involve the clipboard.
- An explicitly requested copy is a separate, short operation. Disable repeated
  copy clicks and starting a new recording until it finishes. Closing Share
  may let that already requested copy finish, but cannot schedule another copy
  or let its result update a closed/reopened dialog.
- The widget remains mounted throughout. Recording does not change its saved
  size, position, selected background or content state.

## Format and dependency decision

Use MP4/H.264 for small files and smooth gradients. This is an engineering
recommendation,
not a verified claim that every target client accepts clipboard pastes.

| Option | Existing building blocks | Tradeoff |
| --- | --- | --- |
| MP4/H.264 | Windows Media Foundation through the existing `windows` crate | More native integration work; compact video and full-color output |
| GIF | `image` 0.25.10 already enables its GIF encoder | Simpler encoder; fewer colors and larger files for the nebula background |
| WebM via MediaRecorder | Browser canvas stream and built-in recorder | Requires transferring captured frames into JS; target-app codec/paste support still needs proof |

Implement only MP4. The alternatives above explain the decision; they are not
additional deliverables. No FFmpeg executable, WASM encoder, screen-recording
package,
new npm dependency or new Rust crate is planned. Enable
`Win32_Media_MediaFoundation` and `Win32_System_LibraryLoader` on the existing
Windows binding dependency. Resolve optional media DLLs from System32 at
runtime so Windows without Media Foundation can still start Kavibay.
Detect missing native encoding support and explain that video recording is
unavailable on that installation; do not install codecs or silently substitute
formats. Windows remains the v0.1 release target. The maintainer subsequently
requested macOS recording too: its existing WKWebView snapshots feed the system
AVFoundation H.264 writer through the existing Objective-C bindings. The
macOS snapshot captures the preview rectangle directly to avoid processing the
full window on every frame; still-image copying keeps its existing path. No new
crate or library is needed. Linux and the browser embed remain unsupported.

Proposed fixed output profile, subject to the first implementation probe:

- Duration: 5,000 ms from the first accepted frame; no audio.
- MP4: target 20 fps, longest side at most 1,280 pixels, H.264 at 3 Mbit/s;
  even dimensions, preserved aspect ratio, no upscaling.
- At most one native snapshot in flight and two decoded frames queued for the
  encoder. Drop late samples rather than accumulating work or slowing the clip.
  Derive frame durations from monotonic capture timestamps. MP4 sample
  durations must sum to five seconds.
- Abort on a snapshot taking more than 500 ms; do not reuse the still-image
  command's 15-second timeout or start overlapping snapshots after a timeout.
- Reject an output exceeding 16 MiB with a retryable error. This is our own
  resource bound, not a promise about a recipient's current upload limit.

## Capture and clipboard design

Extend `src-tauri/src/preview_capture/`. Its existing Windows implementation
already uses WebView2 `Page.captureScreenshot` and captures sandboxed iframes
without DOM access. Factor out the snapshot operation from `copy_preview_image`
so a recording can reuse it without writing each frame to the clipboard.
Probe a clipped screenshot request before choosing it over the existing full
snapshot plus Rust crop; prove CSS zoom and monitor-DPI mapping on Windows.

Run capture scheduling asynchronously and decoding/resizing/encoding on a
bounded worker. Keep native encoder creation, use and release on one worker
thread (COM on Windows, an autorelease pool on macOS). On macOS, read the
AppKit cursor and convert screen points into WKWebView coordinates on the main
thread; composite its pixels on the worker.
The frame timeline determines playback speed even when capture falls behind.
Native screenshots are not assumed to contain the system pointer: sample and
composite it separately, including hotspot and crop/DPI conversion. Do not add
a cursor overlay to the widget DOM or relax iframe sandboxing.

On an explicit `Copy video` action, the clipboard carries an existing `.mp4` file through
`arboard::Clipboard::set().file_list(...)`. That API already appears in the
clipboard widget and maps to Windows `CF_HDROP` or macOS file URLs. Do not call `set_image`, which
would transfer bitmap pixels and lose animation. Host code calls arboard
directly; it must not depend on the clipboard extension's private implementation.

Write partial files as `<generated-id>.partial.mp4` under
`paths::cache_dir(app)/share-recordings/` so the native sink can infer the MP4
container from the extension. Move a
finished clip into `paths::data_dir(app)/shared-clips/<generated-id>.mp4`
before publishing its file reference. Completed recordings are not regenerable
cache files. Retain them after closing Share, making another clip and restarting
Kavibay so the clipboard and clipboard-history entries do not become dangling
references. Remove failed/cancelled partials; do not silently delete completed
clips in v1. `Save clip…` copies the completed artifact to a user-chosen path.
The frontend receives an opaque clip ID, not arbitrary file read/write access.

## Playback design

Use the webview's built-in `<video controls playsinline>` element; no player
library. On the first playback request, read the completed MP4 through a
main-window-only `read_preview_clip({ clipId })` command returning binary bytes.
Resolve only host-owned completed clip IDs, enforce the same 16 MiB bound before
reading, and reject partial files and arbitrary paths. Create a `video/mp4`
Blob URL in the frontend; the existing CSP already permits `blob:` media.

Keep recording state separate from the preview's `live | playback` view. Keep
at most one playback Blob URL, pause and detach the video before revoking it,
and release it on clip replacement, Share close or disposal. Ignore late reads
after leaving playback, starting another recording or closing Share. A decode
or read error offers retry and preserves the completed artifact and its
copy/save actions. Revoking a Blob URL never deletes the persistent clip file.

## Integration boundaries

- One host-owned active recording for the main webview. A second start is
  rejected. Progress and cancellation are correlated by recording ID.
- Recording and encoding never write to the clipboard. The separate copy
  command operates on a completed clip and runs only on explicit button clicks.
- New recording, cancellation, playback-read, copy and save commands
  check the calling window just like `copy_preview_image`. No recording APIs in either extension
  SDK, iframe bridge or quick-action-window capabilities.
- Keep the native image-copy path working. No new CSP entries.
- Use a small host composable for the recording lifecycle. Share provides a
  capture-presentation flag to its preview slot; `WidgetCard` uses it to hide
  host editing chrome without disabling the widget body. Both the desk and
  Wizard preview consume the same flag.
- Late progress/results from a cancelled recording cannot change the next
  recording's state. Ignore stale copy results in the UI. Dispose observers and
  listeners.

## Evidence and first implementation gate

Verified from this checkout: native screenshot capture, arboard file-list
writes, and Media Foundation bindings already exist. Their
composition is implemented and cross-target checked, but has not been
benchmarked or executed on Windows in this macOS working environment.

Before the full feature, a Windows probe must record real interactions in a
sandboxed widget, produce an MP4, verify native webview playback and seeking,
and test Ctrl+V into the Windows clients
of Discord, Slack and WhatsApp. Record client and WebView2 versions. Test browser
clients separately if they are used; file upload support alone is not proof of
clipboard support. A save/upload fallback is useful but does not count as a
passing Ctrl+V test. Any unavailable target remains explicitly unverified.

Measure actual sample rate, longest gap, UI responsiveness, additional memory,
finalization time, output size and color quality on the nebula background.
Initial acceptance: at least 15 captured fps on the test
machine, no capture gap above 250 ms during an active interaction, and a
five-second playback timeline. Aim for finalization within two seconds. If
those conditions fail, revise the capture/profile choice before building the
full UI; do not add a dependency by default.

## Primary references

- [WebView2 native API](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2)
- [Media Foundation MPEG-4 support](https://learn.microsoft.com/en-us/windows/win32/medfound/mpeg-4-support-in-media-foundation)
- [Media Foundation sink-writer flow](https://learn.microsoft.com/en-us/windows/win32/medfound/tutorial--using-the-sink-writer-to-encode-video)
- [Existing arboard file-list API](https://docs.rs/arboard/3.6.1/arboard/struct.Set.html#method.file_list)
- [Windows file clipboard format](https://learn.microsoft.com/en-us/windows/win32/shell/clipboard#cf_hdrop)
- [Discord file attachments](https://support.discord.com/hc/en-us/articles/25444343291031-File-Attachments-FAQ)
- [Slack file uploads](https://slack.com/help/articles/201330736-Add-files-to-Slack)

Target-app Ctrl+V behavior and Windows performance remain empirical questions.
No target-app messages or uploads were sent while preparing this design.
