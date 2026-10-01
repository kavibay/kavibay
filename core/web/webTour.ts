import { setDemoCase, type DemoCaseId } from "../embed/demo/demoCase";
import { finishedDraftFromThisRun } from "../embed/demo/tourLogic";
import { isMentionPart, type DemoPromptPart } from "../embed/widget/wizardDemoScript";
import { currentWizardDemo } from "../embed/widget/wizardDemos";
import { setWizardThinkingPace } from "../embed/widget/wizardFixture";
import { isEnabledPackage, packageFiles } from "./webWizard";

/**
 * The Wizard tour, played on the real app by working its UI.
 *
 * Same script as the embed demo (`wizardDemos.ts`) and the same moves as its
 * `wizardAutoplay.ts`: type "new widget" into the palette, run the row, type
 * each prompt into the Wizard's composer — naming integrations through its @
 * menu — and send; once the widget is built, press Save, close the Wizard
 * (Ctrl+W), open the widget from the palette and drag it beside the palette,
 * clear of the page's headline above. Nothing here
 * reaches into a component: every step is something a visitor could do.
 *
 * The page starts it (`kavibay:tour-start`) once the stage is on screen and is
 * told how far it got (`kavibay:tour`). It sets the pace with
 * `kavibay:tour-speed` (or a `speed` on the start), any time, mid-tour included:
 * every pause and keystroke here, and the recorded model's thinking time
 * (wizardFixture.ts), runs at `BASE_PACE / speed` of its authored length.
 *
 * It also tells the page where to look (`kavibay:tour-focus`): the palette,
 * the conversation, the preview. The page's camera zooms there, or does not.
 *
 * While it plays, the visitor's clicks and keys do not reach the app — a stray
 * click would otherwise strand the story halfway. Scrolling still passes, or the page would stop scrolling under
 * the pointer. Once the widget is on the desk, the app is the visitor's.
 */

type Phase = "ready" | "playing" | "done";

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
const AFTER_BUILT_MS = 1600;
const AFTER_SAVE_MS = 1200;
const AFTER_CLOSE_MS = 700;
const BEFORE_PLACE_MS = 500;
const PLACE_MS = 700;
/** Room between the palette's right edge and the placed card. */
const PLACE_GAP = 40;

let phase: Phase = "ready";

/** The playback rates the page offers. */
const SPEEDS = [1, 1.25, 1.5, 2, 3];
/** 1x is this much slower than the timings below: calm enough to read along. */
const BASE_PACE = 1.5;
let pace = BASE_PACE;

function setSpeed(value: unknown): void {
  if (typeof value !== "number" || !SPEEDS.includes(value)) return;
  pace = BASE_PACE / value;
  setWizardThinkingPace(pace);
}

/** What a visitor could use to act on the app mid-tour. Scrolling is not here on purpose. */
const HELD_INPUT = [
  "pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "contextmenu",
  "keydown", "keypress", "keyup", "beforeinput", "paste", "drop", "dragstart",
];

/** A pause in the tour's own pace. `until`'s polling and timeouts stay in real time. */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms * pace));
const realSleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const typingPause = () => sleep(TYPE_MIN_MS + Math.random() * TYPE_JITTER_MS);
const playing = () => phase === "playing";

/** What the page's bar says at each point (`step` is 1-based). */
const STEPS = [
  "Opening the Wizard",
  "Describing the widget",
  "Building it",
  "Saving it",
  "Opening it on the desk",
  "On the desk — try it",
];

/**
 * Where the action is, for the page's camera: the element's box in this
 * window's pixels, or null for the whole desk. The page decides whether and how
 * far to zoom; the tour only says where to look.
 */
/** Where typing happens: the composer box. */
const COMPOSER_VIEW = ".wiz-compose";
/** The widget card in the preview, else the preview while it is being sketched. */
const PREVIEW_VIEW = [".wiz-preview-body .widget-card", ".wiz-preview-body iframe", ".wiz-preview-body"];

/** The palette and, when open, its results — which hang below it, outside its box. */
const PALETTE_VIEW = [".palette-anchor", ".palette-results"];

const visibleBox = (selector: string) => {
  const box = document.querySelector(selector)?.getBoundingClientRect();
  return box && box.width > 0 && box.height > 0 ? box : null;
};

/**
 * Frame `selectors`: the first one on screen (tried in order, not document
 * order), or, for the palette, both of its parts together.
 */
function look(selectors: string | string[] | null): void {
  const boxes =
    selectors === PALETTE_VIEW
      ? PALETTE_VIEW.map(visibleBox).filter((box) => box !== null)
      : [[selectors ?? []].flat().map(visibleBox).find((box) => box !== null)].filter((box) => box != null);
  const left = Math.min(...boxes.map((box) => box.left));
  const top = Math.min(...boxes.map((box) => box.top));
  const right = Math.max(...boxes.map((box) => box.right));
  const bottom = Math.max(...boxes.map((box) => box.bottom));
  const rect = boxes.length > 0 ? { x: left, y: top, w: right - left, h: bottom - top } : null;
  window.parent.postMessage({ type: "kavibay:tour-focus", rect }, location.origin);
}

/** Tell the page where the tour is. Once done, it stays that way. */
function report(next: Phase, step?: number): void {
  if (phase === "done") return;
  phase = next;
  window.parent.postMessage({ type: "kavibay:tour", phase, step, steps: STEPS }, location.origin);
}

async function until<T>(find: () => T | null | false, timeoutMs: number): Promise<T | null> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (!playing()) return null;
    const found = find();
    if (found) return found;
    await realSleep(POLL_MS);
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
  look(PALETTE_VIEW);
  if (!(await typeIntoPalette("new widget"))) return;
  // The results have opened under it; keep them in frame.
  look(PALETTE_VIEW);
  await sleep(AFTER_TYPE_MS);
  paletteInput()?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

  const editor = await until(composer, MOUNT_TIMEOUT_MS);
  if (!editor) return;
  look(COMPOSER_VIEW);
  // The query has done its job; its results would show under the card.
  const input = paletteInput();
  if (input) {
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  // Room for the conversation in a card sized to leave the headline visible.
  document.querySelector<HTMLElement>('[aria-label="Collapse sidebar"]')?.click();
  look(COMPOSER_VIEW);
  await sleep(LEAD_IN_MS);
  report("playing", 2);

  for (const [index, parts] of spec.prompts.entries()) {
    const before = answers();
    if (index > 0) look(COMPOSER_VIEW);
    if (!(await sendPrompt(editor, parts))) return;
    // The answer is the widget: watch it being built.
    look(PREVIEW_VIEW);
    if (!(await until(() => answers() > before, ANSWER_TIMEOUT_MS))) return;
    // Its card has a size now; frame that rather than the whole pane.
    await sleep(LEAD_IN_MS);
    look(PREVIEW_VIEW);
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
  if (!finished) return;

  await sleep(AFTER_BUILT_MS);
  report("playing", 4);
  if (!(await save(spec.draftId))) return;

  await sleep(AFTER_SAVE_MS);
  report("playing", 5);
  if (!(await closeWizard())) return;
  look(PALETTE_VIEW);
  await sleep(AFTER_CLOSE_MS);
  const card = await openFromPalette(spec.draftId);
  if (!card) return;
  look(null);
  await sleep(BEFORE_PLACE_MS);
  await placeBesidePalette(card);
  report("done", STEPS.length);
}

const enabledButton = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>(".wiz button")].find(
    (button) => button.textContent?.trim() === text && !button.disabled,
  );

/**
 * The toolbar's Save. A contract package is saved already by the time it is
 * built (Developer Extensions, on by default); then there is nothing to press.
 */
async function save(id: string): Promise<boolean> {
  if (!isEnabledPackage(id)) {
    const button = await until(() => enabledButton("Save"), MOUNT_TIMEOUT_MS);
    if (!button) return false;
    button.click();
  }
  return Boolean(await until(() => isEnabledPackage(id), MOUNT_TIMEOUT_MS));
}

/** Ctrl+W from inside the Wizard, which hides the card the keys are in. */
async function closeWizard(): Promise<boolean> {
  const editor = composer();
  if (!editor) return false;
  editor.focus();
  editor.dispatchEvent(new KeyboardEvent("keydown", { key: "w", ctrlKey: true, bubbles: true, cancelable: true }));
  return Boolean(await until(() => !composer(), MOUNT_TIMEOUT_MS));
}

/** Its name into the palette, then Enter on the row that names it. The new card, or null. */
async function openFromPalette(id: string): Promise<HTMLElement | null> {
  const manifest = JSON.parse(packageFiles(id).find((file) => file.path === "manifest.json")?.contents ?? "{}") as {
    displayName?: string;
    name?: string;
  };
  const name = String(manifest.displayName ?? manifest.name ?? id);
  const input = paletteInput();
  if (input?.value) {
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  if (!(await typeIntoPalette(name.toLocaleLowerCase()))) return null;
  const row = await until(
    () => document.querySelector(".palette-item")?.textContent?.trim().startsWith(name) === true,
    MOUNT_TIMEOUT_MS,
  );
  if (!row) return null;
  look(PALETTE_VIEW);
  await sleep(AFTER_TYPE_MS);
  const anchors = () => [...document.querySelectorAll<HTMLElement>(".widget-anchor")];
  const before = new Set(anchors());
  paletteInput()?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  const opened = await until(() => anchors().find((anchor) => !before.has(anchor)) ?? null, MOUNT_TIMEOUT_MS);
  if (!opened) return null;
  // The search did its job; leave the desk with the card and a quiet palette.
  await sleep(AFTER_TYPE_MS);
  const search = paletteInput();
  if (search) {
    search.value = "";
    search.dispatchEvent(new Event("input", { bubbles: true }));
  }
  return opened;
}

/**
 * Drag the card by its move strip until it sits right of the palette, level
 * with it. The app opens a new card at the nearest free spot, which here is
 * above the palette and under the page's headline; a person would move it.
 * The drag snaps to the desk grid like any other.
 */
async function placeBesidePalette(anchor: HTMLElement): Promise<void> {
  const strip = anchor.querySelector<HTMLElement>(".widget-card-drag");
  const palette = document.querySelector(".palette")?.getBoundingClientRect();
  if (!strip || !palette) return;
  const card = anchor.getBoundingClientRect();
  const grip = strip.getBoundingClientRect();
  const from = { x: grip.left + grip.width / 2, y: grip.top + grip.height / 2 };
  const target = {
    x: palette.right + PLACE_GAP + card.width / 2,
    y: palette.top + palette.height / 2,
  };
  // Where the grip goes when the card's centre lands on the target.
  const to = {
    x: from.x + target.x - (card.left + card.width / 2),
    y: from.y + target.y - (card.top + card.height / 2),
  };
  const pointer = (type: string, x: number, y: number, buttons = 1) =>
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons,
      clientX: x,
      clientY: y,
    });

  strip.dispatchEvent(pointer("pointerdown", from.x, from.y));
  const frames = Math.max(1, Math.round((PLACE_MS * pace) / 16));
  for (let frame = 1; frame <= frames; frame++) {
    const t = frame / frames;
    const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    anchor.dispatchEvent(
      pointer("pointermove", from.x + (to.x - from.x) * eased, from.y + (to.y - from.y) * eased),
    );
    await realSleep(16);
  }
  anchor.dispatchEvent(pointer("pointerup", to.x, to.y, 0));
}

/** Arms the tour for `demo`; it starts when the page asks. */
export function installWebTour(demo: DemoCaseId): void {
  setDemoCase(demo);
  setSpeed(1);

  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin || event.source !== window.parent) return;
    const data = event.data as { type?: unknown; speed?: unknown } | null;
    if (data?.type === "kavibay:tour-speed") setSpeed(data.speed);
    if (data?.type !== "kavibay:tour-start") return;
    setSpeed(data.speed);
    if (phase !== "ready") return;
    phase = "playing";
    void run();
  });

  // Only a person produces trusted input; the tour's own events are synthetic
  // (and execCommand typing raises none of these).
  const holdOff = (event: Event) => {
    if (!event.isTrusted || !playing()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  for (const type of HELD_INPUT) window.addEventListener(type, holdOff, { capture: true });

  report("ready");
}
