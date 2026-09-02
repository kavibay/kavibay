/**
 * The Wizard's file editor, read-only for a page.
 *
 * WHY NOT CSS, LIKE THE SAVE ROW NEXT DOOR:
 *
 * The editor is two stacked layers: a `<pre>` that carries the syntax colours
 * and a transparent `<textarea>` on top that owns the caret, the selection and
 * — the part that matters here — the scrolling, which the `<pre>` mirrors.
 * `pointer-events: none` on the textarea would therefore take the scrollbar
 * with it, and a code panel you cannot scroll is worse than one you can edit.
 * CSS has no way to say "readonly" either.
 *
 * SO: TWO CAPTURE LISTENERS ON THE DOCUMENT, AND BOTH EARN THEIR PLACE.
 *
 * `focusin` sets the element's `readOnly` property. That is the real answer —
 * the browser then refuses typing, paste and drop itself, while the caret, the
 * selection and the scrollbar all keep working. It is set on focus rather than
 * once at load because the component owns the element: it binds `:disabled`,
 * it can re-render, and a property written before a re-create would be gone.
 * Focus always happens before typing, so the flag is never late.
 *
 * `beforeinput` cancels anything that gets that far anyway. Measured, and the
 * reason this file has two listeners rather than one:
 * `document.execCommand("insertText")` on a textarea can still change the
 * value in Chrome, and a guard that only holds against real keystrokes is a
 * guard whose failures nobody sees coming.
 *
 * Scoped to `.wiz-code-edit` inside a `<kavibay-widget>`, so nothing else on
 * the host page is affected — and the app, which loads none of this, keeps its
 * editable editor.
 */
const EDITOR = ".wiz-code-edit";

/** The Wizard's code editor, when that is what the event is about. */
function editorIn(event: Event): HTMLTextAreaElement | null {
  const target = event.target;
  if (!(target instanceof HTMLTextAreaElement)) return null;
  if (!target.matches(EDITOR)) return null;
  if (!target.closest("kavibay-widget")) return null;
  return target;
}

function markReadOnly(event: Event): void {
  const editor = editorIn(event);
  if (editor) editor.readOnly = true;
}

function refuseEdit(event: Event): void {
  const editor = editorIn(event);
  if (!editor) return;
  // Belt as well as braces: whatever slipped through, the field is properly
  // read-only from here on.
  editor.readOnly = true;
  event.preventDefault();
}

/**
 * Installed once per document, from `lazyWizard.ts` — so only a page that
 * mounts the Wizard carries it, and mounting two Wizards does not stack two
 * listeners.
 */
let installed = false;

export function makeWizardFilesReadOnly(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;
  /*
   * Both, because `focusin` only fires when focus actually moves — click into
   * a field that already has it and nothing is dispatched. A visitor reaches
   * the editor with a pointer either way.
   */
  document.addEventListener("pointerdown", markReadOnly, { capture: true });
  document.addEventListener("focusin", markReadOnly, { capture: true });
  document.addEventListener("beforeinput", refuseEdit, { capture: true });
}
