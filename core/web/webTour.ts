import { setDemoCase, type DemoCaseId } from "../embed/demo/demoCase";
import { finishedDraftFromThisRun } from "../embed/demo/tourLogic";
import { isMentionPart, type DemoPromptPart } from "../embed/widget/wizardDemoScript";
import { currentWizardDemo } from "../embed/widget/wizardDemos";
import { packageFiles } from "./webWizard";

/**
 * The Wizard tour, played on the real app by working its UI.
 *
 * Same script as the embed demo (`wizardDemos.ts`) and the same moves as its
 * `wizardAutoplay.ts`: type "new widget" into the palette, run the row, type
 * each prompt into the Wizard's composer — naming integrations through its @
 * menu — and send, then wait until the draft holds the finished widget. Nothing
 * here reaches into a component: every step is something a visitor could do.
 *
 * The page starts it (`kavibay:tour-start`) once the stage is on screen and is
 * told how far it got (`kavibay:tour`). The first real click, key or scroll in
 * the app ends it: from then on the visitor has the app.
 */

type Phase = "ready" | "playing" | "done" | "took-over";

const TYPE_MIN_MS = 36;
const TYPE_JITTER_MS = 32;
const BEFORE_FIRST_TYPE_MS = 900;
const AFTER_TYPE_MS = 450;
const LEAD_IN_MS = 700;
const BEFORE_SEND_MS = 450;
const BETWEEN_TURNS_MS = 2400;
const POLL_MS = 100;
const MOUNT_TIMEOUT_MS = 8000;
const ANSWER_TIMEOUT_MS = 20000;
const DRAFT_TIMEOUT_MS = 60000;

let phase: Phase = "ready";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const typingPause = () => sleep(TYPE_MIN_MS + Math.random() * TYPE_JITTER_MS);
const playing = () => phase === "playing";

/** Tell the page where the tour is. Once taken over or done, it stays that way. */
/**
 * What the page's bar says at each point. Its own words rather than the embed
 * script's `steps`: that tour ended by opening the result on the desk, this
 * one ends with the widget running in the Wizard's preview.
 */
const STEPS = ["Opening the Wizard", "Describing the widget", "Refining it", "Built — try it"];

function report(next: Phase, step?: number): void {
  if (phase === "took-over" || phase === "done") return;
  phase = next;
  window.parent.postMessage({ type: "kavibay:tour", phase, step, steps: STEPS }, location.origin);
}

async function until<T>(find: () => T | null | false, timeoutMs: number): Promise<T | null> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (!playing()) return null;
    const found = find();
    if (found) return found;
    await sleep(POLL_MS);
  }
  return null;
}

const paletteInput = () => document.querySelector<HTMLInputElement>(".palette input");
const composer = () =>
  document.querySelector<HTMLElement>(".wiz-composer-editor[contenteditable='true']");
const answers = () => document.querySelectorAll(".wiz-turn.assistant").length;

async function typeIntoPalette(text: string): Promise<boolean> {
  const input = await until(paletteInput, MOUNT_TIMEOUT_MS);
  if (!input) return false;
  input.focus();
  for (const character of text) {
    if (!playing()) return false;
    input.value += character;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await typingPause();
  }
  return true;
}

function mentionOption(label: string): HTMLElement | null {
  for (const button of document.querySelectorAll<HTMLElement>(".wiz-integration-option")) {
    const name = button.getAttribute("aria-label") ?? "";
    if (name === label || name.startsWith(`${label},`)) return button;
  }
  return null;
}

async function typeIntoComposer(editor: HTMLElement, text: string): Promise<boolean> {
  for (const character of text) {
    if (!playing()) return false;
    if (document.activeElement !== editor) editor.focus();
    // The path a keystroke takes: the editor's own input handling runs,
    // including the @ menu, which a direct DOM write would skip.
    document.execCommand("insertText", false, character);
    await typingPause();
  }
  return true;
}

async function sendPrompt(editor: HTMLElement, parts: DemoPromptPart[]): Promise<boolean> {
  for (const part of parts) {
    if (!isMentionPart(part)) {
      if (!(await typeIntoComposer(editor, part))) return false;
      continue;
    }
    if (!(await typeIntoComposer(editor, `@${part.mention.toLocaleLowerCase()}`))) return false;
    const option = await until(() => mentionOption(part.mention), MOUNT_TIMEOUT_MS);
    if (!option) return false;
    option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    await sleep(BEFORE_SEND_MS);
  }
  await sleep(BEFORE_SEND_MS);
  const send = document.querySelector<HTMLElement>('[aria-label="Send"]');
  if (!playing() || !send) return false;
  send.click();
  return true;
}

async function run(): Promise<void> {
  const spec = currentWizardDemo();

  await sleep(BEFORE_FIRST_TYPE_MS);
  report("playing", 1);
  if (!(await typeIntoPalette("new widget"))) return;
  await sleep(AFTER_TYPE_MS);
  paletteInput()?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

  const editor = await until(composer, MOUNT_TIMEOUT_MS);
  if (!editor) return;
  // The query has done its job; its results would show under the card.
  const input = paletteInput();
  if (input) {
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  // Room for the conversation in a card sized to leave the headline visible.
  document.querySelector<HTMLElement>('[aria-label="Collapse sidebar"]')?.click();
  await sleep(LEAD_IN_MS);
  report("playing", 2);

  for (const [index, parts] of spec.prompts.entries()) {
    const before = answers();
    if (!(await sendPrompt(editor, parts))) return;
    if (!(await until(() => answers() > before, ANSWER_TIMEOUT_MS))) return;
    if (index === 0) report("playing", 3);
    if (index < spec.prompts.length - 1) await sleep(BETWEEN_TURNS_MS);
  }

  const finished = await until(
    () =>
      // A contract package is saved as soon as it is generated (Developer
      // Extensions, on by default), so the files may already be a package.
      finishedDraftFromThisRun(answers(), spec.replies.length, packageFiles(spec.draftId), spec.finalMarker),
    DRAFT_TIMEOUT_MS,
  );
  if (finished) report("done", STEPS.length);
}

/** Arms the tour for `demo`; it starts when the page asks. */
export function installWebTour(demo: DemoCaseId): void {
  setDemoCase(demo);

  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin || event.source !== window.parent) return;
    if ((event.data as { type?: unknown } | null)?.type !== "kavibay:tour-start") return;
    if (phase !== "ready") return;
    phase = "playing";
    void run();
  });

  // Only a person produces trusted input; the tour's own events are synthetic.
  const takeOver = (event: Event) => {
    if (event.isTrusted && playing()) report("took-over");
  };
  for (const type of ["pointerdown", "keydown", "wheel"]) {
    window.addEventListener(type, takeOver, { capture: true });
  }

  report("ready");
}
