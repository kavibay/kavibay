/**
 * The launcher's own demo: search an app, then walk a folder.
 *
 *   1. "spotify" is typed. The app is there, one keystroke from running.
 *      Nothing is launched — this is a web page, and pretending otherwise
 *      would be the one dishonest frame in the whole section.
 *   2. The query is erased and "documents" typed instead. The folder row
 *      offers Tab.
 *   3. Tab, and the list stops being "everything you can run" and becomes
 *      "what is in this folder", dated and sized.
 *   4. Down to Invoices, Tab again: two levels deep, still in the search bar.
 *   5. Shift+Tab climbs back out one level, which is the part a stack buys.
 *   6. "northwind" typed into the folder chip searches inside Documents, and
 *      the two hits name the subfolders they came from.
 *   7. "notes", Tab, "hello world", Enter. The row takes a value, and the
 *      widget arrives on the desk with the note already written.
 *
 * WHY THIS IS NOT THE TOUR IN `tour.ts`:
 *
 * That one spans three components and a widget being built. This is one
 * element doing one thing for half a minute. What they share is the shape:
 * both own a `DemoRun` (`demoRun.ts`), both take every wait from it so one
 * Pause button holds the whole script, and both report milestones so the bar
 * moves on things that happened rather than on a clock.
 *
 * What they do not share is the run itself. Pausing the tour must not freeze
 * this section two screens down, and this section's Replay must not restart a
 * Wizard nobody is looking at.
 *
 * Every step asks `alive()` first. The moment somebody types in this palette,
 * the script is over and the palette is theirs.
 */
import { demoRun } from "./demoRun";

/**
 * The milestones the bar fills to. Each one is reached by something the
 * visitor can see happen, which is why the caption beside the bar can name it.
 *
 * Written as places and activities rather than as results ("App found"),
 * because the caption shows the label of the milestone just passed — and
 * before the first one it shows the first label. A results wording therefore
 * announced a find at 0%, one beat before it happened. Every line here is true
 * for the whole stretch it is on screen.
 */
export const LAUNCHER_STEPS = [
  "Searching",
  "In Documents",
  "In Invoices",
  "Back in Documents",
  "Searching inside",
  "Note on the desk",
] as const;

const run = demoRun("launcher", LAUNCHER_STEPS);

/** Beats, in the same rhythm the tour uses. */
const LEAD_IN_MS = 1100;
const READ_APP_MS = 1900;
const AFTER_ERASE_MS = 480;
const BEFORE_BROWSE_MS = 950;
const READ_FOLDER_MS = 2300;
const PER_STEP_MS = 190;
const AFTER_BACK_MS = 1500;
const READ_HITS_MS = 2400;
const BEFORE_ARG_MS = 700;
const BEFORE_RUN_MS = 600;
const FINAL_MS = 2600;

/**
 * Every wait goes through the run, which holds while somebody has this demo
 * paused. A plain `setTimeout` anywhere in here would be a step that ignores
 * the Pause button, and the one that ignored it would be the one somebody
 * noticed.
 */
const wait = (ms: number) => run.beat(ms);

/**
 * What the script may do to the palette.
 *
 * Deliberately the visitor's own vocabulary: type, erase, move the selection,
 * Tab into a folder, Shift+Tab back out. There is no "show this list" or "set
 * that state" — every step goes through the same code a keystroke reaches, so
 * this drives the palette rather than posing it.
 */
export interface LauncherStage {
  type(text: string): Promise<void>;
  erase(): Promise<void>;
  /** Titles of the visible rows, in order — how the script finds its target. */
  rowTitles(): string[];
  selectedIndex(): number;
  select(index: number): void;
  /** Tab: descend into the selected folder. */
  browse(): void;
  /** Shift+Tab: one level back up. */
  back(): void;
  /** Types into the folder chip, which searches inside the browsed folder. */
  typeInFolder(text: string): Promise<void>;
  /** Tab on a row that takes a value: turns its chip live. */
  argMode(): void;
  /** Types into that chip. */
  typeInArg(text: string): Promise<void>;
  /** Enter on the selected row, with whatever is in the chip. */
  run(): void;
  /**
   * Back to the first frame: empty search bar, no folder open, and the
   * visitor's veto lifted.
   *
   * Only the palette owns that veto, so only the palette can clear one — the
   * same division `tour.ts` makes. Without it Replay would start a script
   * whose every step immediately asks `alive()` and gives up.
   */
  reset(): void;
  alive(): boolean;
}

/**
 * Which run is the current one.
 *
 * Press Replay while the previous run is parked in a beat and both would carry
 * on, one typing over the other. Bumping the token retires everything older: a
 * stale run's next `alive()` is false and it unwinds.
 */
let currentRun = 0;

/**
 * Walks the selection down to a row by name, one step at a time.
 *
 * Jumping straight to it would be a cut; a person presses Down and you can see
 * where they are going. Returns false when the row is not there — a list this
 * script did not get the answer it expected from, which ends the run instead
 * of pressing Tab on whatever happens to be selected.
 */
async function walkTo(stage: LauncherStage, title: string, alive: () => boolean): Promise<boolean> {
  const target = stage.rowTitles().findIndex((row) => row === title);
  if (target < 0) return false;

  while (stage.selectedIndex() !== target) {
    if (!alive()) return false;
    const step = stage.selectedIndex() < target ? 1 : -1;
    stage.select(stage.selectedIndex() + step);
    await wait(PER_STEP_MS);
  }
  return alive();
}

export async function playLauncherDemo(stage: LauncherStage): Promise<void> {
  run.markPresent();
  run.onReplay(() => {
    stage.reset();
    run.begin();
    void play(stage, (currentRun += 1));
  });

  run.begin();
  await play(stage, (currentRun += 1));
}

async function play(stage: LauncherStage, token: number): Promise<void> {
  /**
   * Three ways a run can be over, in one question every step already asks: a
   * newer run took over, the visitor typed, or something stopped this run —
   * a keystroke in a card, or the transport's own Replay.
   */
  const alive = () => token === currentRun && stage.alive() && run.phase.value !== "stopped";

  await wait(LEAD_IN_MS);
  if (!alive()) return;

  // Apps first, because that is what a launcher is expected to be, and this
  // one is that before it is anything else.
  await stage.type("spotify");
  if (!alive()) return;
  run.reachStep(1);
  await wait(READ_APP_MS);
  if (!alive()) return;

  // Erased rather than replaced: the search bar is somebody changing their
  // mind, and a query that swaps itself out in one frame reads as a slide.
  await stage.erase();
  await wait(AFTER_ERASE_MS);
  if (!alive()) return;

  await stage.type("documents");
  await wait(BEFORE_BROWSE_MS);
  if (!(await walkTo(stage, "Documents", alive))) return;

  stage.browse();
  run.reachStep(2);
  await wait(READ_FOLDER_MS);
  if (!alive()) return;

  if (!(await walkTo(stage, "Invoices", alive))) return;
  stage.browse();
  run.reachStep(3);
  await wait(READ_FOLDER_MS);
  if (!alive()) return;

  stage.back();
  run.reachStep(4);
  await wait(AFTER_BACK_MS);
  if (!alive()) return;

  // A search that reaches into subfolders, with each hit saying which one it
  // came from.
  await stage.typeInFolder("northwind");
  if (!alive()) return;
  run.reachStep(5);
  await wait(READ_HITS_MS);
  if (!alive()) return;

  /*
   * And the last frame: a row that takes a value.
   *
   * "notes", Tab, "hello world", Enter — the palette is not only a list of
   * things to open, it is where you put something in. The card lands on the
   * desk with the text already in it, and nothing here fakes that: the handler
   * is the Notes extension's own `new-note`, the argument is what was typed,
   * and it writes into the card's data the same way it does on a desk.
   */
  await stage.type("notes");
  await wait(BEFORE_ARG_MS);
  if (!(await walkTo(stage, "New Note", alive))) return;

  stage.argMode();
  await wait(BEFORE_ARG_MS);
  if (!alive()) return;

  await stage.typeInArg("hello world");
  await wait(BEFORE_RUN_MS);
  if (!alive()) return;

  stage.run();
  run.reachStep(6);
  await wait(FINAL_MS);
  if (!alive()) return;
  run.finish();
}
