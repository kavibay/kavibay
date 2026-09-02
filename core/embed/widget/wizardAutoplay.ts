/**
 * Types a prompt into the real Widget Wizard and sends it.
 *
 * WHY THIS DRIVES THE UI FROM OUTSIDE:
 *
 * Everything else in this package hands a component its data and lets it
 * render. A conversation cannot be handed over that way — the transcript, the
 * draft and the preview are all consequences of somebody typing, and the
 * Wizard owns every one of them. So the demo does what a visitor does: it puts
 * characters in the composer and presses Send.
 *
 * That means reaching into another component's DOM, which is normally the
 * thing to avoid. It is contained here, in one file, with the two selectors it
 * depends on named and checked at runtime: if the Wizard renames its composer
 * or its Send button, this stops silently rather than breaking the widget, and
 * the page simply shows a Wizard nobody typed into.
 *
 * HOW THE TYPING WORKS:
 *
 * The composer is a ProseMirror editor. Setting `textContent` does not reach
 * its state — the editor re-renders from its own document and the text
 * vanishes. `document.execCommand("insertText")` goes through the same input
 * path a keystroke does, which ProseMirror understands. Measured against the
 * live component before this file existed.
 */
import { DEMO_PROMPTS } from "./wizardScript";
import { demoRun } from "../demo/demoRun";

/**
 * The tour's run, by name.
 *
 * This loop types inside a card the director does not own, so it cannot be
 * handed the run as an argument without threading it through the element that
 * mounts every widget — which would put knowledge of one demo in the mounting
 * code. The name is the address instead, and it is the same one `tour.ts`
 * registers.
 */
const tourRun = demoRun("tour");

/** Per character. The landing page's hand-built demo uses the same range. */
const TYPE_MIN_MS = 36;
const TYPE_JITTER_MS = 32;

/** Before the first character, and between the last one and Send. */
const LEAD_IN_MS = 700;
const BEFORE_SEND_MS = 450;

/**
 * Between an answer landing and the follow-up being typed.
 *
 * The landing page's hand-built demo waits 2400 ms here, long enough to read
 * the reply before the next request starts arriving.
 */
const BETWEEN_TURNS_MS = 2400;

/** How long to wait for a turn's answer before giving up on the rest. */
const ANSWER_TIMEOUT_MS = 20000;

/** How long to wait for the Wizard to finish mounting its composer. */
const MOUNT_TIMEOUT_MS = 8000;
const POLL_MS = 100;

/**
 * The demo's own clock, so Pause reaches inside the Wizard too. Without it the
 * director would stop while the conversation kept typing — the one part of the
 * demo a visitor is most likely to be watching when they press it.
 */
const wait = (ms: number) => tourRun.beat(ms);

/** Assistant turns in the transcript; the count is how far the demo has got. */
function answerCount(root: ParentNode): number {
  return root.querySelectorAll(".wiz-turn.assistant").length;
}

function composerIn(root: ParentNode): HTMLElement | null {
  return root.querySelector<HTMLElement>(".wiz-composer-editor[contenteditable='true']")
    ?? root.querySelector<HTMLElement>("[contenteditable='true']");
}

function sendButtonIn(root: ParentNode): HTMLElement | null {
  return root.querySelector<HTMLElement>('[aria-label="Send"]');
}

/**
 * Folds the project list away, using the Wizard's own control.
 *
 * A demo has one project and it is about to be made, so the list beside it is
 * 180px of a 1060px card spent on nothing. The app agrees, and for a stronger
 * reason: arriving through the palette's "New Widget" row calls
 * `startProjectFromPalette`, which tucks the sidebar (and the header) away
 * because somebody who pressed that has exactly one thing to do.
 *
 * That path is not reproduced here. It needs the action's own request flag and
 * the host's focus event, and wiring both through this package would put
 * knowledge of one extension in the element that mounts all of them. Pressing
 * the button is what a person does, it is the same control, and it lands in the
 * same state — `toggleSidebar` sets `sidebarCollapsed`, the app's own field.
 *
 * The label is the selector, so this stops doing anything if the Wizard renames
 * it rather than breaking the demo — same rule as the composer and Send above.
 * It also self-limits: the label reads "Collapse sidebar" only while the
 * sidebar is out, so a second call finds nothing and a visitor who expanded it
 * again is not overruled.
 */
function collapseSidebarIn(root: ParentNode): void {
  root.querySelector<HTMLElement>('[aria-label="Collapse sidebar"]')?.click();
}

/**
 * Waits for a mounted composer, because the Wizard's `setup` is async and its
 * first render happens after the widget's own hydration.
 */
async function waitForComposer(root: ParentNode, alive: () => boolean): Promise<HTMLElement | null> {
  const deadline = tourRun.now() + MOUNT_TIMEOUT_MS;
  while (tourRun.now() < deadline) {
    if (!alive()) return null;
    const composer = composerIn(root);
    if (composer) return composer;
    await wait(POLL_MS);
  }
  return null;
}

/**
 * Waits for the transcript to gain an answer, so the follow-up is typed into a
 * finished conversation rather than over a running one.
 */
async function waitForAnswer(
  root: ParentNode,
  before: number,
  alive: () => boolean,
): Promise<boolean> {
  const deadline = tourRun.now() + ANSWER_TIMEOUT_MS;
  while (tourRun.now() < deadline) {
    if (!alive()) return false;
    if (answerCount(root) > before) return true;
    await wait(POLL_MS);
  }
  return false;
}

async function typeAndSend(
  root: ParentNode,
  composer: HTMLElement,
  prompt: string,
  alive: () => boolean,
): Promise<boolean> {
  /*
   * `preventScroll`, because this composer is in a page, not in an overlay.
   *
   * On the desktop the Wizard floats over everything and focusing its composer
   * scrolls nothing. On the landing page the card sits two screens down, and a
   * plain `focus()` scrolled the document to reveal the composer — which moved
   * the palette, the tour's next actor, off screen. The caret still lands here;
   * only the document stays where the visitor put it.
   */
  composer.focus({ preventScroll: true });
  for (const character of prompt) {
    if (!alive()) return false;
    /*
     * Re-focus if the caret has moved on.
     *
     * `insertText` goes wherever the focus is, and a visitor can now pause the
     * demo by clicking — which usually means clicking somewhere else. Resuming
     * without this typed the rest of the sentence into whatever they had
     * clicked, or into nothing at all.
     */
    if (document.activeElement !== composer) composer.focus({ preventScroll: true });
    // Same input path a keystroke takes; ProseMirror ignores textContent.
    document.execCommand("insertText", false, character);
    await wait(TYPE_MIN_MS + Math.random() * TYPE_JITTER_MS);
  }

  await wait(BEFORE_SEND_MS);
  if (!alive()) return false;

  const send = sendButtonIn(root);
  if (!send) return false;
  send.click();
  return true;
}

/**
 * `alive` is the visitor's veto: the caller returns false once somebody clicks
 * or types, and every step checks it. A demo that keeps typing over a person's
 * own sentence is worse than no demo.
 *
 * The two turns are the landing page's two: ask for the tracker, then ask for
 * a percentage. Between them the Wizard is entirely on its own — it asks the
 * fixture, parses the reply, writes the draft and renders the preview, and
 * nothing here stage-manages any of it. This only types and presses Send.
 */
export async function playWizardDemo(root: ParentNode, alive: () => boolean): Promise<void> {
  const composer = await waitForComposer(root, alive);
  if (!composer || !alive()) return;

  // First, and in the same tick the Wizard finished mounting: the grip renders
  // with the composer, so waiting any longer only widens the moment the
  // sidebar is visible before it folds.
  collapseSidebarIn(root);

  await wait(LEAD_IN_MS);

  for (const [index, prompt] of DEMO_PROMPTS.entries()) {
    if (!alive()) return;

    const before = answerCount(root);
    if (!(await typeAndSend(root, composer, prompt, alive))) return;

    const isLast = index === DEMO_PROMPTS.length - 1;
    if (isLast) return;

    if (!(await waitForAnswer(root, before, alive))) return;
    // The first version exists. The tour's progress bar has no other way to
    // know: everything between the two prompts happens inside this loop.
    tourRun.reachStep(3);
    await wait(BETWEEN_TURNS_MS);
  }
}
