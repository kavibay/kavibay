# Wizard point-and-prompt

Development builds only: select multiple elements inside the Wizard preview, then
describe changes around inline chips in the existing composer. Selection never
sends a request by itself.

## Scope and boundaries

- An explicit picker button arms only the Wizard's preview iframe, for runtime and
  contract packages. Installed widgets on the desk keep their normal interactions.
- A guest script highlights and reports the selected element's CSS selector, tag,
  and a short text excerpt. It never reads form values or exports the document.
- Keep `sandbox="allow-scripts"`. The host checks the frame window, a fresh picker
  token, active state, and bounded metadata before accepting a selection.
- Vite's development flag gates the UI and host bridge; Rust debug builds alone
  serve and inject the guest script, and only for an explicitly marked preview URL.
- Selection is transient, removable, and cleared on preview/session changes. The
  next submitted turn includes the metadata alongside the user's own request.
- Keep picking until Escape or the picker toggle ends it. Deduplicate selectors;
  each chip can be removed independently, including through normal text editing.
- Anchor chips at plain-text offsets; keep metadata out of saved drafts. Build
  inline references and their matching DOM context only when the user sends.

## Implementation

- MIT SDK: narrow `WizardPreviewElement` data type.
- GPL host: preview-only Vue context, iframe listener and guest inspector script;
  native protocol injection and development browser preview integration.
- MIT Wizard: picker control, inline selection chips, prompt formatting.

## Verification

- Assert frame identity/token/active-state rejection and metadata bounds.
- Assert prompt context and preview URL opt-in; Rust tests for debug-only injection
  and serving, regular documents, CSP, and nested paths.
- Browser smoke: hover/pick, suppressed widget action, composer focus, manual send,
  removal, Escape, second selection, preview reload, and ordinary widget interaction.
- Run `npm run verify` and `npm run verify:rust`; report native UI limitations.

## Completion

Implemented 2026-09-28. `npm run verify` passed with 190 assert files;
`npm run verify:rust` passed formatting, Clippy, and 538 tests. The production
embed build also passed: no picker is rendered and no inspector script or message
handler is bundled. Browser smoke with the real Wizard and scripted model replies
confirmed selection without triggering the widget action, preserved input text,
composer focus, manual send with DOM context, removal, Escape cancellation,
version-change invalidation, and ordinary widget clicks after selection ends.
Native Tauri UI and a paid model call were not exercised.

Extended on 2026-09-28 with inline multi-selection. `npm run verify` passed all
three steps, including 191 assert files. Browser smoke confirmed multiple chips
at the caret, separate surrounding instructions, deduplication, × and keyboard
removal, Escape without losing selections, suggestions preserving chip positions,
line breaks, version-change cleanup, and manual submission containing only the
remaining references. Picking still suppresses widget actions; normal actions
resume afterward. Model replies were scripted, and native Tauri UI was not run.
