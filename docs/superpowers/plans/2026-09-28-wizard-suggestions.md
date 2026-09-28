# Wizard follow-up suggestions

Tier M: add contextual suggestions to the existing authoring response and composer.

## Goal and decisions

- After a successful turn, show up to three short suggestions above the composer.
- Generate a fresh set in the existing model request, for both package formats.
- Each suggestion has a short `label` and a complete, editable `prompt`.
- Clicking appends the prompt to any unsent input and focuses the composer. It never sends.
- Keep suggestions on their assistant bubble and show only the latest turn's set
  while its version matches the current draft. Hide them during generation,
  repairs, failed turns, and conflicting or invalid drafts.
- Missing or malformed suggestion metadata must not break valid widget files.
- Keep existing sandbox, consent, persistence and provider boundaries.

## Files and interfaces

| File | Change |
| --- | --- |
| `src-tauri/src/wizard/prompt.rs` | Shared instruction for a final `kavibay-suggestions` JSON fence |
| `extensions/widget-wizard/wizardSuggestions.ts` | `WizardSuggestion`, normalization, latest-turn selection, composer append |
| `extensions/widget-wizard/widgetWizardLogic.ts` | Parse metadata separately from files; optional suggestions on assistant bubbles |
| `extensions/widget-wizard/WizardSuggestions.vue` | Wrapping chips emitting `choose(suggestion)` |
| `extensions/widget-wizard/WidgetWizardWidget.vue` | Attach suggestions after successful writes; render and insert into composer |
| `extensions/widget-wizard/wizardSuggestions.assert.ts` | Parsing, compatibility, stale-turn and draft-preservation assertions |
| `docs/widget-wizard.md` | Explain the editing flow |

## Tasks and verification

1. Add bounded parsing and selection helpers; verify valid, malformed, duplicate,
   truncated and embedded-in-file metadata, and conversation save/reload.
2. Include one shared suggestion instruction in both authoring prompts.
3. Wire successful completion to the latest-turn chips and the editable composer.
4. Run `npm run verify` and `npm run verify:rust`.
5. Browser smoke with scripted replies: first and next turn replace chips,
   choosing preserves unsent input without sending, busy/cancel states hide stale
   chips, and long labels wrap without overflowing.

## Completion

Completed 2026-09-28. `npm run verify` passed (188 assert files, typecheck and
lint); `npm run verify:rust` passed (format, clippy and 537 tests). A browser smoke
using the complete Wizard with scripted model replies verified first/next-turn
replacement, preserving unsent input, duplicate-click handling, keyboard
activation, no model request on chip selection, and discarding cancelled replies.
The chip component also fit 48-character labels in a 180px column without
horizontal overflow. No paid model call or native Tauri smoke was performed.
