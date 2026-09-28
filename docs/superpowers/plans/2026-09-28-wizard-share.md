# Wizard sharing

## Outcome and design

Replace the Wizard's Export action with Share. The modal keeps the live preview
on the left and offers Export as file and Copy preview image on the right.
Export uses the existing ZIP flow. Copy captures the widget and its canvas background.

The preview stays mounted in one DOM location. A normally inline `dialog` enters
the browser's top layer with `showModal()`, so opening Share does not recreate or
move the sandboxed iframe, lose its state, or register a second preview identity.
The dialog holds host dismissal, restores focus on close, and reports copy errors
without closing. While copying or exporting, closing is disabled.

Native Webview capture includes sandboxed frames without changing their origins
or sandbox permissions. The main-window-only command captures the webview, crops
using the preview's viewport-relative bounds, and writes RGBA pixels to the OS
clipboard. No capture API is added to the runtime bridge or extension SDK.

## Files and interfaces

| Files | Change |
| --- | --- |
| `extensions/widget-wizard/WidgetWizardWidget.vue`, `WizardPreviewStage.vue` | Share state; `sharing`, `shareBusy`, `shareFeedback` props; `close-share` and `export` events |
| `core/app/extension-host/ui/WidgetPreviewShare.vue` | Inline/modal preview wrapper; capture target and export actions |
| `core/app/extension-host/ui/WidgetWizardPreviewHost.vue` | Supply canvas capture target; keep resizing available and hide debug chrome during sharing |
| `core/embed/widget/EmbedWizardPreview.vue` | Same modal wrapper; native copy unavailable in browser demo |
| `src-tauri/src/preview_capture/` | Native snapshots, validated crop geometry, clipboard command and unit tests |
| `src-tauri/Cargo.toml`, `Cargo.lock`, `src/lib.rs` | Existing native binding crates made direct dependencies; command registration |
| `docs/widget-wizard.md` | Document the sharing flow |

## Implementation and verification

1. Wire the modal and keep the existing iframe mounted; verify opening/closing,
   keyboard focus, export delegation, narrow layout, and retained preview state.
2. Implement native snapshots on macOS, Windows and Linux; test crop geometry,
   scale conversion, invalid rectangles, and out-of-bounds rejection.
3. Run `npm run verify` and `npm run verify:rust`.
4. Smoke the modal in the browser fixture and native copy in an isolated macOS
   test app. Report Windows/Linux execution limits honestly.

## Completed — 2026-09-28

- Share dialog, live preview, existing file export, native image copy, fitting,
  focus restoration, Escape and backdrop handling implemented. Packages without
  a runnable preview can still be exported; only image copy needs a visible card.
- Browser smoke confirmed the modal layout, retained iframe state over close and
  reopen, Escape, focus restoration and both action/error paths.
- An isolated macOS Tauri harness ran the production capture command against a
  sandboxed iframe. Clipboard readback was 640 × 440 pixels; the expected blue
  center pixel and the saved PNG confirmed the crop excluded the red surround.
- Windows adapter cross-compiled for `x86_64-pc-windows-msvc` against the actual
  WebView2 bindings. Its controller seam used the same type as Tauri. Full Windows
  app execution and Linux execution remain untested on this macOS machine.
- `npm run verify` and `npm run verify:rust` passed. Rust crop tests cover scaling,
  fractional edges, invalid bounds and actual pixel content.

### Share canvas refinement

The modal is now 760 × 480 CSS pixels at most. It keeps the Wizard's grid and
resize/move controls, and capture uses the whole canvas. Resizing accounts for
automatic preview fitting so scaled cards still follow pointer movement. The
native capture command and platform adapters are unchanged.

Verified: edge/corner growth and shrinking, dimensions retained after closing,
scaled resizing with the opposite edge fixed, and a capture request matching the
canvas bounds. Native macOS clipboard readback produced a 1048 × 796 image with
the grid and widget, excluding the header and actions. `npm run verify` passed.

### Canvas background image

The maintainer-supplied nebula image is bundled as the default Share background.
A local file picker accepts custom images up to 20 MB, validates decoding before
replacing the background, and provides a reset to the bundled image. Object URLs
are released on replacement or disposal; custom images are held for the current
preview session. Capture waits for image decoding. The editing canvas stays a
grid, and both desktop and embed Share canvases use the selected image.

Verified: local file chooser, replacement, reopening with the selected image,
invalid-image feedback, and reset to the bundled image in the browser. Native
macOS clipboard capture includes the nebula background around the widget.
`npm run verify` passed (188 assert files).
