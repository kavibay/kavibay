/**
 * The whole story on one page: search, build, close, find, use.
 *
 *   1. Only the palette is on screen.
 *   2. "new widget" is typed and run — the Wizard's own contributed action.
 *   3. The Wizard opens and plays the active recording.
 *   4. When the widget exists, the Wizard closes.
 *   5. The finished widget is typed and run.
 *   6. The widget that was just built appears, and works.
 *
 * WHY THIS IS A DIRECTOR AND NOT THREE SCRIPTS:
 *
 * Each element can play its own part — the palette types, the Wizard converses
 * — but nobody except the page knows the order, and the handover points are
 * the interesting bit: the Wizard may not start before its card is open, and
 * the last step must not run before the draft exists. A director makes those
 * waits explicit instead of hiding them in timeouts that happen to be long
 * enough.
 *
 * It talks to elements through the two small surfaces they expose — the
 * palette's `type`/`run`, the card's `close`/`isOpen` — and to nothing else.
 * The one place it reads foreign DOM is counting the Wizard's answers, which
 * is what "the conversation finished" means and has no other observable.
 */
import { currentWizardDemo } from "../widget/wizardDemos";
import { demoDraftFiles, resetWizardFixture } from "../widget/wizardFixture";
import { WATER_TOUR_STEPS } from "../widget/wizardScript";
import { demoRun } from "./demoRun";
import { finishedDraftFromThisRun } from "./tourLogic";

/**
 * The tour's milestones, and the run that owns them.
 *
 * Named "tour", which is how the two parties outside this file reach the same
 * one: the Wizard's typing loop (`wizardAutoplay.ts`), which lives inside a
 * card this director does not own, and the transport the page places
 * (`<kavibay-demo-controls run="tour">`).
 */
export const TOUR_STEPS = WATER_TOUR_STEPS;

const tourRun = demoRun("tour", TOUR_STEPS);

export interface PaletteHandle {
  type(text: string, perCharMs?: number): Promise<void>;
  run(rowId?: string): void;
  clear(): void;
}

interface CardHandle {
  close(): void;
  isOpen(): boolean;
}

/** Beats, in the landing demo's own rhythm. */
const BEFORE_FIRST_TYPE_MS = 900;
const AFTER_TYPE_MS = 450;
const AFTER_WIZARD_MS = 1400;
const BEFORE_LAST_TYPE_MS = 700;

/**
 * Generous on purpose. This budget exists to end the tour if the Wizard never
 * gets going at all, not to police how long it takes — and how long it takes
 * varies wildly: a background or hidden tab throttles rendering to about one
 * frame a second, which stretched a fifteen-second conversation past a minute
 * and cut the tour off one step from the end.
 */
const DRAFT_TIMEOUT_MS = 180000;
const POLL_MS = 150;

/**
 * Every wait goes through `beat`, which holds while the demo is paused. A
 * plain `setTimeout` anywhere in here would be a step that ignores the pause
 * button, and the one that ignored it would be the one somebody noticed.
 */
const wait = (ms: number) => tourRun.beat(ms);

/**
 * The nearest card matching `selector`, searching outwards from the palette.
 *
 * Not `document.querySelector`, and that stopped being a nicety the moment the
 * landing page put a tour at the bottom: it already has a palette in the
 * launcher section further up, and the first match in the document is that one.
 * A tour would have driven a palette in a different section, opened nothing,
 * and looked like a demo that had stalled.
 *
 * Walking up from the palette's own element and asking each ancestor for the
 * card finds the one in the same demo, on both the standalone tour page — where
 * the palette and the desk are siblings — and inside a landing section, with no
 * markup contract beyond "they share an ancestor".
 */
function nearestCard(from: Element | null, selector: string): CardHandle | null {
  for (let node: Element | null = from; node; node = node.parentElement) {
    const hit = node.querySelector(selector);
    if (hit) return hit as unknown as CardHandle;
  }
  return null;
}

/** Every generated card in this demo, so a case switch can shut the last one. */
function nearestDrafts(from: Element | null): CardHandle[] {
  for (let node: Element | null = from; node; node = node.parentElement) {
    const hits = [...node.querySelectorAll("kavibay-widget[draft]")];
    if (hits.length > 0) return hits as unknown as CardHandle[];
  }
  return [];
}

async function until(predicate: () => boolean, timeoutMs: number, alive: () => boolean) {
  const deadline = tourRun.now() + timeoutMs;
  while (tourRun.now() < deadline) {
    if (!alive()) return false;
    if (predicate()) return true;
    await wait(POLL_MS);
  }
  return false;
}

/** Assistant bubbles inside this card — zero on a fresh mount, even if last run's files remain. */
function assistantTurns(card: CardHandle): number {
  return card instanceof Element ? card.querySelectorAll(".wiz-turn.assistant").length : 0;
}

export interface TourOptions {
  /**
   * The palette that started the tour, and its element.
   *
   * Handed over rather than looked up: the component already has these, it is
   * the only palette this tour may drive, and passing them removes the one
   * global query that could pick the wrong one.
   */
  palette: PaletteHandle;
  paletteEl: Element | null;
  /** Row that opens the Wizard — its contributed action. */
  wizardRow: string;
  /** Visitor veto; every step checks it. */
  alive: () => boolean;
  /**
   * Hands the tour back its own permission to run.
   *
   * `alive` turns false the moment a visitor touches anything, and stays
   * false — which is right, until they ask for a replay. Only the palette
   * owns that flag, so only the palette can clear it.
   */
  clearVeto: () => void;
}

/**
 * Back to the first frame: no draft, no scripted turn spent, both cards shut,
 * an empty search bar and the visitor's veto lifted.
 *
 * Reopening the Wizard is not enough on its own — closing its card unmounts
 * the component and its conversation, but the *host* still holds the draft it
 * wrote and the counter saying which scripted answer is next, so a second run
 * would answer the first question with the second reply.
 */
function rewind(options: TourOptions, cards: CardHandle[]): void {
  resetWizardFixture();
  for (const card of cards) card.close();
  options.palette.clear();
  options.clearVeto();
}

/**
 * Which run is the current one.
 *
 * A run is a long chain of awaits, and two of them must never be in flight at
 * once — press Replay while the previous run is parked in a 180-second wait
 * for a package, and both would carry on, one typing over the other. Bumping
 * the token retires everything older: a stale run's next `alive()` is false
 * and it unwinds.
 */
let currentRun = 0;

export async function playTour(options: TourOptions): Promise<void> {
  const wizard = nearestCard(options.paletteEl, 'kavibay-widget[definition="widget-wizard"]');
  if (!wizard) return;

  tourRun.markPresent();
  tourRun.onReplay(() => {
    rewind(options, [wizard, ...nearestDrafts(options.paletteEl)]);
    tourRun.begin();
    void run(options, wizard, (currentRun += 1));
  });

  tourRun.begin();
  await run(options, wizard, (currentRun += 1));
}

async function run(options: TourOptions, wizard: CardHandle, token: number): Promise<void> {
  const { palette } = options;
  const spec = currentWizardDemo();
  demoRun("tour", spec.steps);

  /**
   * Three ways a run can be over, in one question the steps already ask.
   *
   * The visitor's own veto is the palette's, but it is not the only one: a
   * keystroke inside the Wizard's card stops the run through `stop()`, and
   * without that check here the director went on waiting for a package nobody
   * was writing any more. That was the hang — a tour still "running" behind a
   * Pause button, with nothing left to run it.
   */
  const alive = () => token === currentRun && options.alive() && tourRun.phase.value !== "stopped";

  await wait(BEFORE_FIRST_TYPE_MS);
  if (!alive()) return;

  tourRun.reachStep(1);
  await palette.type("new widget");
  await wait(AFTER_TYPE_MS);
  if (!alive()) return;
  palette.run(options.wizardRow);
  tourRun.reachStep(2);

  /**
   * Wait for the *finished* package, not for a duration and not for the first
   * draft.
   *
   * The Wizard types, asks, parses and writes at its own pace, and on a slow
   * machine — or a background tab, where rendering is throttled to about one
   * frame a second — any fixed wait here is either too short or insultingly
   * long. But waiting for a draft to merely exist was worse: turn one writes
   * one, so the tour closed the Wizard while it was still answering the
   * follow-up. `finalMarker` is what the last turn puts in the file.
   *
   * The answers have to belong to this mount as well: Replay used to leave
   * the previous draft in place, and the marker alone then skipped the
   * conversation.
   */
  const isFinished = () =>
    finishedDraftFromThisRun(
      assistantTurns(wizard),
      spec.replies.length,
      demoDraftFiles(spec.draftId),
      spec.finalMarker,
    );
  const built = await until(isFinished, DRAFT_TIMEOUT_MS, alive);
  if (!built) return;

  await wait(AFTER_WIZARD_MS);
  if (!alive()) return;
  wizard.close();

  await wait(BEFORE_LAST_TYPE_MS);
  if (!alive()) return;

  await palette.type(spec.resultQuery);
  await wait(AFTER_TYPE_MS);
  if (!alive()) return;
  palette.run(spec.resultRow);
  tourRun.finish();
}
