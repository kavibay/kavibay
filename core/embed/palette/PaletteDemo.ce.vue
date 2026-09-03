<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useHost, watch } from "vue";
import { type DemoKind, type DemoRow } from "./demoRows";
import { moveSelection, rankRows } from "./demoLogic";
import { DEMO_HOME, demoFileRows, listDemoFolder, searchDemoFolder } from "./demoFiles";
import { FILE_FOLD_PATH, FILE_SHEET_PATH, fileMarkFor } from "./fileMarks";
/*
 * The SDK's own mark, not a copy of the path data. `BrandMark.vue` is the
 * usual way in, but it maps *provider* ids and refuses a bare name on purpose
 * (`brandMarkFor("spotify") === undefined`) — this row is an installed
 * application, not the Spotify provider, so it asks for the picture directly.
 */
import SpotifyMark from "@sdk/brand/SpotifyMark.vue";
import { PALETTE_OPEN_EVENT, paletteOpenDetail } from "./paletteOpen";
import { nextStackOrder } from "../widget/stacking";
import { useDragOffset } from "../widget/useDragOffset";
import { runEmbedAction } from "../widget/embedActions";
import { playTour } from "../demo/tour";
import { playLauncherDemo } from "../demo/launcherScript";
import { demoCase, isDemoCaseId, setDemoCase } from "../demo/demoCase";
import { demoRun, type DemoRun } from "../demo/demoRun";
/*
 * The folder browse is the app's, not a lookalike: `folderScope.ts` owns the
 * stack and the path arithmetic, `fileSort.ts` the order and the two labels a
 * file row carries. Only what is *on* the invented disk is this package's own
 * (`demoFiles.ts`) — a browser has no disk and no `browse_folder` command.
 */
import {
  currentFolder,
  enterFolder,
  folderTitle,
  leaveFolder,
  scopePlaceholder,
  type FolderScopeEntry,
} from "../../app/palette/folderScope";
import {
  nextSortMode,
  sortFileRows,
  sortModeLabel,
  type FileSortMode,
} from "../../app/palette/fileSort";

/**
 * Throwaway marketing palette. Not CommandPalette.vue: that component is a
 * Tauri singleton whose visibility arrives as `palette:show`. That event never
 * fires in a browser, and copying it leaves the input at 0×0.
 *
 * Chrome, status bar and menus stay visual. Enter/click on a row fires
 * `kavibay-palette-open` (composed) so a sibling card on the page can open;
 * this element still has no Tauri host.
 *
 * Props are declared as strings because custom-element attributes arrive as
 * strings. Vue will not coerce them the way it does for in-app components.
 */
const props = defineProps({
  /** `"false"` skips the scripted type-and-walk. Keyboard still works. */
  autotype: { type: String, default: "true" },
  /**
   * Run the page-level tour instead of the local type-and-walk.
   *
   * The palette is the first actor in that story, so it is the element that
   * starts it — but the choreography itself lives in `demo/tour.ts`, because
   * it spans the Wizard and the widget it builds.
   */
  tour: { type: String, default: "false" },
  /**
   * Which local script to play: `"walk"` types one word and steps down the
   * list, `"launcher"` plays the app-and-folders story in
   * `demo/launcherScript.ts`.
   *
   * Separate from `tour` because it is a different kind of thing: the tour
   * spans several elements and owns the page's transport, while a script is
   * this element talking to itself. `autotype="false"` still means neither.
   */
  script: { type: String, default: "walk" },
});

const QUERY_TO_TYPE = "note";
const TYPE_MS = 90;
const WALK_MS = 520;

const query = ref("");
const selectedIndex = ref(0);
const inputEl = ref<HTMLInputElement | null>(null);
const hostEl = ref<HTMLElement | null>(null);
const userTookOver = ref(false);

let typeTimer: ReturnType<typeof setTimeout> | null = null;
let walkTimer: ReturnType<typeof setTimeout> | null = null;
let observer: IntersectionObserver | null = null;

/**
 * The palette floats over the desk and comes forward when it is used — the
 * same stacking every widget card takes part in, from the same counter.
 *
 * It raises itself once on mount, because a palette opens in front: on the
 * desktop it is the thing you just summoned, not a card lying among the
 * others.
 */
const host = useHost();

function raise() {
  host?.style.setProperty("z-index", String(nextStackOrder()));
}

/**
 * The palette moves the way a card does — same composable, same edge rule.
 *
 * The measured box is `.palette`, not the host: the host is as wide as the
 * page gives it, while the panel inside is what a person sees and grabs, and
 * clamping the wrong one stops the palette short of the edge.
 */
const paletteEl = ref<HTMLElement | null>(null);
const { onMovePointerDown } = useDragOffset({
  host,
  box: () => paletteEl.value,
  onGrab: raise,
});

const ranked = computed(() => rankRows(query.value));

/* ── Folder scope ─────────────────────────────────────────────────────────
 *
 * Tab on a folder row and the list stops being "everything you can run" and
 * becomes "what is inside this folder". Stacked, so Shift+Tab walks back up
 * the way it came instead of dropping straight out to the global search.
 *
 * The one structural difference from the app: there, the contents arrive from
 * Rust, so `loadFolderScope` is async, debounced and sequence-guarded against
 * a slow answer overwriting a newer one. Here the disk is a `Map`, so the
 * listing is a computed. Nothing else changes — the same stack, the same
 * sort, the same two labels on a row.
 */
const scopeStack = ref<FolderScopeEntry[]>([]);
const scopeQuery = ref("");
const scopeInputEl = ref<HTMLInputElement | null>(null);
/**
 * Name order, which is the one that groups directories first.
 *
 * The app opens a folder in `DEFAULT_FILE_SORT` — Modified ↓, on the argument
 * that what you touched last is what you came for — and deliberately does not
 * pin folders there: sorting by date is a question about the dates, and
 * Explorer answers it the same way. That is right for someone hunting a file
 * they just saved, and wrong for a demo, where the listing is read as a
 * picture of a folder and the folders belong at the top of it.
 *
 * So this is not a different rule, it is a different starting order — the
 * app's own Name ↑, the one a returning user gets after picking it once
 * (`loadFileSortMode`). The sort control still cycles through all three.
 */
const sortMode = ref<FileSortMode>("name");

const scopeFolder = computed(() => currentFolder(scopeStack.value));
const scopeActive = computed(() => scopeFolder.value !== null);

const scopeRows = computed<DemoRow[]>(() => {
  const folder = scopeFolder.value;
  if (!folder) return [];
  const term = scopeQuery.value.trim();
  const entries = term
    ? searchDemoFolder(folder.path, term)
    : listDemoFolder(folder.path);
  // Rows first, then sorted — the app's order, because `sortFileRows` reads a
  // row's title and the rows are what it keeps in memory.
  return sortFileRows(demoFileRows(entries, folder.path), sortMode.value);
});

/** What the list is showing: the folder's contents, or the query's hits. */
const rows = computed<DemoRow[]>(() =>
  scopeActive.value ? scopeRows.value : ranked.value.map((hit) => hit.row),
);

/**
 * The folder the chip talks about: the one being browsed, or — before Tab —
 * the folder row the selection is sitting on. That preview is what makes the
 * chip a hint rather than a mode nobody finds.
 */
const scopeChipEntry = computed<FolderScopeEntry | null>(() => {
  const active = scopeFolder.value;
  if (active) return active;
  const row = rows.value[selectedIndex.value];
  if (!row || row.kind !== "folder" || !row.path) return null;
  return { path: row.path, title: folderTitle(row.path) };
});

/** Empty list inside a folder: nothing matched, or the folder itself is empty. */
const scopeEmptyLabel = computed(() => {
  const title = scopeFolder.value?.title ?? "this folder";
  return scopeQuery.value.trim() ? `No matches in ${title}` : `${title} is empty`;
});

const sortLabel = computed(() => sortModeLabel(sortMode.value));

/**
 * The app's condition, minus the branches this demo has no equivalent for:
 * `showResultsList` also opens for the calculator, recents and the widgets
 * menu. Here it is the query, or a folder being browsed.
 */
const showResults = computed(() => query.value.trim().length > 0 || scopeActive.value);

watch(rows, (list) => {
  selectedIndex.value = moveSelection(selectedIndex.value, 0, list.length);
});

/**
 * `preventScroll`, everywhere this component moves focus.
 *
 * The palette in the app is an overlay and focusing anything inside it scrolls
 * nothing. This one sits two screens down a marketing page, where a plain
 * `focus()` scrolls the document to reveal the caret and drags the reader
 * somewhere they did not ask to go.
 */
function focusScopeChip() {
  void nextTick(() => scopeInputEl.value?.focus({ preventScroll: true }));
}

/**
 * Descend into `path`. `focus` is false when the script does it: a demo
 * playing on a page nobody has clicked yet should not take the caret.
 */
function enterScope(path: string, focus = true) {
  scopeStack.value = enterFolder(scopeStack.value, path);
  scopeQuery.value = "";
  selectedIndex.value = 0;
  if (focus) focusScopeChip();
}

/** One level back up; leaving the outermost level returns to plain search. */
function leaveScope(focus = true) {
  const next = leaveFolder(scopeStack.value);
  scopeStack.value = next;
  scopeQuery.value = "";
  selectedIndex.value = 0;
  if (!focus) return;
  if (next.length === 0) inputEl.value?.focus({ preventScroll: true });
  else focusScopeChip();
}

/** Drop the browse entirely — Escape, or the query behind it changing. */
function exitScope(focus = true) {
  if (!scopeActive.value) return;
  scopeStack.value = [];
  scopeQuery.value = "";
  selectedIndex.value = 0;
  if (focus) inputEl.value?.focus({ preventScroll: true });
}

/** Step to the next order. Real, because `fileSort.ts` is pure and already here. */
function cycleSort() {
  sortMode.value = nextSortMode(sortMode.value);
  selectedIndex.value = 0;
}

/** Tab or a click on the chip: browse whatever the chip is currently naming. */
function browseFromChip() {
  const entry = scopeChipEntry.value;
  if (!entry) return;
  if (scopeActive.value) {
    focusScopeChip();
    return;
  }
  enterScope(entry.path);
}

const autotypeEnabled = computed(() => props.autotype !== "false");

function clearTimers() {
  if (typeTimer !== null) {
    clearTimeout(typeTimer);
    typeTimer = null;
  }
  if (walkTimer !== null) {
    clearTimeout(walkTimer);
    walkTimer = null;
  }
}

/**
 * Stop the built-in type-and-walk, without claiming a visitor did it.
 *
 * The two were one function, and the tour tripped over it: its first scripted
 * keystroke set the visitor flag, which is the tour's own veto, so every step
 * after it aborted and the palette sat there with the query typed and nothing
 * happening. A script silencing the local demo is not a person taking over.
 */
function stopLocalDemo() {
  clearTimers();
}

/**
 * A hard stop: the scripted demo is over and will not resume by itself.
 *
 * The controls change from Pause to Replay, because the demo stopped since
 * somebody did something, not because it ran out.
 */
function takeOver() {
  if (userTookOver.value) return;
  userTookOver.value = true;
  stopLocalDemo();
  // This palette's own run and no other. A page holds several, and stopping
  // one from here would end a demo playing in a section the visitor is not
  // even looking at.
  demoRunHere.value?.stop();
}

/**
 * A click on the palette pauses rather than ends the demo — same rule as a
 * click on a card (`KavibayWidget.onVisitorPointer`). Typing still takes over:
 * whoever is writing a query means to search, not to watch.
 *
 * Without a run there is no transport to resume with, so a pointer keeps its
 * old meaning and stops the local type-and-walk for good.
 */
function pointerTakeOver() {
  const run = demoRunHere.value;
  if (run?.present.value) {
    stopLocalDemo();
    run.pause();
    return;
  }
  takeOver();
}

function onInput() {
  takeOver();
}

/** The row a key is about to act on, if there is one. */
const selectedRow = computed<DemoRow | undefined>(() => rows.value[selectedIndex.value]);

/** Only a folder can be descended into — the app's `isBrowsableRow`. */
function browsable(row: DemoRow | undefined): row is DemoRow & { path: string } {
  return Boolean(row && row.kind === "folder" && row.path);
}

/* ── Argument chip ────────────────────────────────────────────────────────
 *
 * An action row can take a value — "New Note" takes the note. The app shows
 * the parameter as a dim chip the moment such a row is selected, Tab makes it
 * live, and Enter runs the action with what was typed. Same three states here,
 * with one chip instead of the app's list: the two actions this demo copies
 * declare one parameter each.
 */
const argValue = ref("");
const argActive = ref(false);
const argInputEl = ref<HTMLInputElement | null>(null);

/** The parameter of the selected row, if it has one. A folder browse hides it:
    the chip position belongs to the folder chip while one is open. */
const argParam = computed(() => (scopeActive.value ? null : (selectedRow.value?.param ?? null)));

function enterArgMode(focus = true) {
  if (!argParam.value) return;
  argActive.value = true;
  if (focus) void nextTick(() => argInputEl.value?.focus({ preventScroll: true }));
}

function exitArgMode(focus = true) {
  if (!argActive.value) return;
  argActive.value = false;
  argValue.value = "";
  if (focus) inputEl.value?.focus({ preventScroll: true });
}

/**
 * A chip belongs to the row it was opened on. Move the selection or change the
 * query behind it and the value would be handed to a different action — which
 * is why the app drops arg mode on both.
 */
watch([() => selectedRow.value?.id, query], () => exitArgMode(false));

function onKeydown(event: KeyboardEvent) {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    takeOver();
    event.preventDefault();
    const delta = event.key === "ArrowDown" ? 1 : -1;
    selectedIndex.value = moveSelection(selectedIndex.value, delta, rows.value.length);
    return;
  }

  /*
   * The browse gestures, in the app's own order (`CommandPalette.onKeydown`):
   * Tab descends, Shift+Tab climbs one level, Right descends like Tab, an
   * empty chip turns Backspace into a step back up, and Escape leaves the
   * folder entirely rather than only one level of it.
   */
  if (event.key === "Tab") {
    takeOver();
    if (!event.shiftKey && browsable(selectedRow.value)) {
      event.preventDefault();
      enterScope(selectedRow.value.path);
      return;
    }
    if (scopeActive.value) {
      // Nothing to descend into, but the browser's default would walk focus
      // out of the chip and quietly end the browse.
      event.preventDefault();
      if (event.shiftKey) leaveScope();
      return;
    }
    // A row with a parameter takes Tab for its chip.
    if (!event.shiftKey && argParam.value && !argActive.value) {
      event.preventDefault();
      enterArgMode();
      return;
    }
    if (event.shiftKey && argActive.value) {
      event.preventDefault();
      exitArgMode();
    }
    return;
  }

  if (event.key === "ArrowRight" && browsable(selectedRow.value)) {
    takeOver();
    event.preventDefault();
    enterScope(selectedRow.value.path);
    return;
  }

  if (event.key === "Backspace" && scopeActive.value && scopeQuery.value.length === 0) {
    takeOver();
    event.preventDefault();
    leaveScope();
    return;
  }

  // Deleting past the start of the chip returns to the search text behind it.
  if (event.key === "Backspace" && argActive.value && argValue.value.length === 0) {
    takeOver();
    event.preventDefault();
    exitArgMode();
    return;
  }

  if (event.key === "Escape" && (scopeActive.value || argActive.value)) {
    takeOver();
    event.preventDefault();
    if (argActive.value) exitArgMode();
    else exitScope();
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    runAt(selectedIndex.value);
  }
}

/**
 * Tell the page which row was run. The palette does not mount widgets;
 * `composed` lets a card outside this shadow tree hear the click.
 */
function runAt(index: number) {
  stopLocalDemo();
  const row = rows.value[index];
  if (!row) return;
  selectedIndex.value = index;

  /**
   * Collapse the list, the way `afterPaletteAction` does in the app: it clears
   * the query, leaves any folder scope and resets the selection. Clearing the
   * query is what closes the panel, since that is what `showResultsList`
   * reads. The app also closes an open row menu — this demo has none.
   */
  const reveal = () => {
    hostEl.value?.dispatchEvent(
      new CustomEvent(PALETTE_OPEN_EVENT, {
        bubbles: true,
        composed: true,
        detail: paletteOpenDetail(row),
      }),
    );
    query.value = "";
    exitScope(false);
    exitArgMode(false);
    selectedIndex.value = 0;
  };

  /**
   * An action row runs its handler first, and the card opens *after* it.
   *
   * That order is the app's, and both halves of it matter. The Wizard's "New
   * Widget" showed the first: its handler sets a request the card redeems when
   * the host hands it focus, and skipping it opened a Wizard with all its
   * chrome out, which is not what that row does on a desk. "New Note" shows
   * the second: its handler writes markdown into the card's own `ctx.data`,
   * and the card reads that key while mounting — reveal it first and it can
   * mount before the note is there, which would be a note that quietly failed
   * to arrive.
   */
  if (row.kind === "action") {
    const args = row.param && argValue.value ? { [row.param.name]: argValue.value } : {};
    void runEmbedAction(row.id, args, actionTarget(row)).then(reveal);
    return;
  }

  reveal();
}

/**
 * The card an action writes into, as an instance id.
 *
 * Found the way the tour finds its cards: by walking up from this element and
 * asking each ancestor, never `document.querySelector`. The landing page holds
 * two demos, and the first match in the document is not necessarily the one in
 * this section. An action declaring `needsInstance: false` targets no card and
 * gets the contract's empty id.
 */
/**
 * Shuts the cards in this demo, for a replay.
 *
 * A script that ends by putting a card on the desk has to start without it, or
 * the second run opens what is already open and the last frame arrives first.
 * Same outward walk as `actionTarget` and for the same reason: the cards of
 * *this* section, never the first ones in the document.
 */
function closeCardsHere(): void {
  let node: Element | null = host ?? hostEl.value;
  while (node) {
    const cards = node.querySelectorAll("kavibay-widget");
    if (cards.length > 0) {
      for (const card of cards) (card as unknown as { close?: () => void }).close?.();
      return;
    }
    node = node.parentElement;
  }
}

function actionTarget(row: DemoRow): string {
  if (row.needsInstance === false) return "";
  const selector = `kavibay-widget[opens-on="${row.id}"]`;
  for (let node: Element | null = host ?? hostEl.value; node; node = node.parentElement) {
    const card = node.querySelector(selector) as { instanceId?: () => string } | null;
    if (typeof card?.instanceId === "function") return card.instanceId();
  }
  return "";
}

/**
 * Same verbs the real palette puts on the selected row. Commands with no
 * arguments show nothing — advertising Enter on every row is what the app
 * deliberately does not do.
 */
/**
 * What a page-level demo may do to this palette.
 *
 * `type` puts characters in the query the way the scripted intro does; `run`
 * accepts the selected row. Both go through the same state a keystroke would,
 * so a tour drives the palette rather than simulating one.
 */
async function typeQueryText(text: string, perCharMs = 52) {
  stopLocalDemo();
  query.value = "";
  exitScope(false);
  for (const character of text) {
    query.value += character;
    // The run's beat, not `setTimeout`: pause has to land mid-word too, or the
    // one step that ignores the button is the search bar typing on by itself.
    await demoWait(perCharMs);
  }
}

function runRow(rowId?: string) {
  const index = rowId ? rows.value.findIndex((row) => row.id === rowId) : selectedIndex.value;
  if (index >= 0) runAt(index);
}

function clearQuery() {
  query.value = "";
  exitScope(false);
  selectedIndex.value = 0;
}

/* ── The launcher script's hands ────────────────────────────────────────── */

const SCRIPT_TYPE_MS = 62;
const SCRIPT_ERASE_MS = 34;

/**
 * Types a query from scratch — an empty bar and no folder open.
 *
 * Appending to whatever was there is what it did first, and it worked for as
 * long as every call followed an erase. The step that types "notes" does not:
 * it follows a search inside a folder, and the query behind that chip still
 * read "documents", so the palette went looking for "documentsnotes" and found
 * nothing. Starting a search is starting a search, wherever the last one got
 * to — the same thing `typeQueryText` does for the tour.
 */
async function scriptType(text: string) {
  query.value = "";
  exitScope(false);
  for (const character of text) {
    if (userTookOver.value) return;
    query.value += character;
    await demoWait(SCRIPT_TYPE_MS);
  }
}

/** Backspace held down, rather than a query that swaps itself out in a frame. */
async function scriptErase() {
  while (query.value.length > 0) {
    if (userTookOver.value) return;
    query.value = query.value.slice(0, -1);
    await demoWait(SCRIPT_ERASE_MS);
  }
}

async function scriptTypeInFolder(text: string) {
  for (const character of text) {
    if (userTookOver.value) return;
    scopeQuery.value += character;
    await demoWait(SCRIPT_TYPE_MS);
  }
}

async function scriptTypeInArg(text: string) {
  for (const character of text) {
    if (userTookOver.value) return;
    argValue.value += character;
    await demoWait(SCRIPT_TYPE_MS);
  }
}

defineExpose({
  type: typeQueryText,
  run: runRow,
  clear: clearQuery,
});

function primaryAction(kind: DemoKind): string | null {
  if (kind === "command" || kind === "action") return null;
  if (kind === "widget") return "Focus";
  return "Open";
}

function typeQuery(done: () => void) {
  const chars = QUERY_TO_TYPE.split("");
  let i = 0;
  const step = () => {
    if (userTookOver.value) return;
    if (i >= chars.length) {
      done();
      return;
    }
    query.value += chars[i]!;
    i += 1;
    typeTimer = setTimeout(step, TYPE_MS);
  };
  step();
}

function walkResults() {
  const last = Math.min(2, rows.value.length - 1);
  const step = () => {
    if (userTookOver.value) return;
    if (selectedIndex.value >= last) return;
    selectedIndex.value = moveSelection(selectedIndex.value, 1, rows.value.length);
    walkTimer = setTimeout(step, WALK_MS);
  };
  walkTimer = setTimeout(step, WALK_MS);
}

const tourEnabled = computed(() => props.tour !== "false");
const launcherScript = computed(() => props.script === "launcher");

/**
 * The run this palette belongs to, if it drives one.
 *
 * The name is the same one the director registers and the page's transport
 * addresses (`<kavibay-demo-controls run="launcher">`). A palette playing only
 * the local type-and-walk has none: there is nothing to pause, nothing to
 * replay, and a transport for it would be a control over three seconds of
 * typing.
 */
const demoRunHere = computed<DemoRun | null>(() => {
  if (tourEnabled.value) return demoRun("tour");
  if (launcherScript.value) return demoRun("launcher");
  return null;
});

/**
 * Every scripted wait this component takes.
 *
 * Through the run where there is one, so its Pause holds the typing too — and
 * through this palette's run only, so a Pause pressed in another section does
 * not freeze a search bar here mid-word. The local type-and-walk has no run
 * and no transport, so it falls back to a plain timer.
 */
const demoWait = (ms: number): Promise<void> =>
  demoRunHere.value?.beat(ms) ?? new Promise<void>((resolve) => setTimeout(resolve, ms));

function startDemo() {
  if (userTookOver.value) return;

  // No unrequested motion for someone who asked the system for less of it.
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    if (!autotypeEnabled.value || tourEnabled.value) return;
    /*
     * The end frame, without the journey to it. A still is what a reduced-
     * motion setting asks for, and the launcher's last frame — a folder open,
     * searched, its hits labelled — says more standing still than the walk
     * does moving.
     */
    if (launcherScript.value) {
      enterScope(`${DEMO_HOME}\\Documents`, false);
      scopeQuery.value = "northwind";
      return;
    }
    query.value = QUERY_TO_TYPE;
    return;
  }

  if (launcherScript.value) {
    void playLauncherDemo({
      type: scriptType,
      erase: scriptErase,
      typeInFolder: scriptTypeInFolder,
      rowTitles: () => rows.value.map((row) => row.title),
      selectedIndex: () => selectedIndex.value,
      select: (index) => {
        selectedIndex.value = moveSelection(0, index, rows.value.length);
      },
      // Focus stays where the visitor left it: the script is playing to
      // somebody reading the page, not typing into it.
      browse: () => {
        const row = selectedRow.value;
        if (browsable(row)) enterScope(row.path, false);
      },
      back: () => leaveScope(false),
      // Tab on a row that takes a value, then the value, then Enter — the
      // three gestures a person makes, in that order.
      argMode: () => enterArgMode(false),
      typeInArg: scriptTypeInArg,
      run: () => runAt(selectedIndex.value),
      // Only this component owns the veto, so only it can lift one for a replay.
      reset: () => {
        clearQuery();
        closeCardsHere();
        userTookOver.value = false;
      },
      alive: () => !userTookOver.value,
    });
    return;
  }

  if (tourEnabled.value) {
    void playTour({
      // Its own functions and its own element: a page may hold more than one
      // palette, and the tour must drive this one.
      palette: { type: typeQueryText, run: runRow, clear: clearQuery },
      paletteEl: host ?? hostEl.value,
      wizardRow: "new-widget",
      alive: () => !userTookOver.value,
      // Only this component owns the veto, so only it can lift one for a replay.
      clearVeto: () => {
        userTookOver.value = false;
      },
    });
    return;
  }

  if (!autotypeEnabled.value) return;
  typeQuery(walkResults);
}

/**
 * The two case buttons live in the landing page, outside this element.
 *
 * They pick which recording the tour plays. A click here is not a visitor
 * taking over — it is the same offer Replay makes, aimed at a different
 * story — so it must not set the veto. Walking up from this host finds the
 * buttons in the same section, and nowhere else: the launcher further down
 * has none.
 */
let caseButtons: HTMLButtonElement[] = [];

function nearestCaseButtons(from: Element | null): HTMLButtonElement[] {
  for (let node: Element | null = from; node; node = node.parentElement) {
    const found = [...node.querySelectorAll<HTMLButtonElement>(".wizplay__case")];
    if (found.length > 0) return found;
  }
  return [];
}

function paintCaseButtons(): void {
  const current = demoCase();
  for (const button of caseButtons) {
    button.setAttribute("aria-pressed", button.dataset.case === current ? "true" : "false");
  }
}

function onCaseClick(event: Event): void {
  const button = event.currentTarget;
  if (!(button instanceof HTMLButtonElement)) return;
  if (!isDemoCaseId(button.dataset.case)) return;
  event.preventDefault();
  setDemoCase(button.dataset.case);
  paintCaseButtons();
  userTookOver.value = false;
  const run = demoRunHere.value;
  if (run?.present.value) run.replay();
}

function bindCaseButtons(from: Element | null): void {
  caseButtons = nearestCaseButtons(from);
  paintCaseButtons();
  for (const button of caseButtons) button.addEventListener("click", onCaseClick);
}

function unbindCaseButtons(): void {
  for (const button of caseButtons) button.removeEventListener("click", onCaseClick);
  caseButtons = [];
}

onMounted(() => {
  raise();
  // Capture, so the palette raises even where a child stops the event.
  host?.addEventListener("pointerdown", raise, { capture: true });
  host?.addEventListener("focusin", raise);

  if (!autotypeEnabled.value) {
    inputEl.value?.focus();
    return;
  }

  // The SFC root lives in the shadow tree; IntersectionObserver needs the
  // custom element in the light DOM, or "on view" never fires.
  const root = hostEl.value?.getRootNode();
  const lightHost = root instanceof ShadowRoot ? root.host : hostEl.value;
  if (!(lightHost instanceof Element)) {
    startDemo();
    return;
  }

  observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer?.disconnect();
      observer = null;
      startDemo();
    },
    { threshold: 0.4 },
  );
  observer.observe(lightHost);
  bindCaseButtons(lightHost);
});

onUnmounted(() => {
  clearTimers();
  observer?.disconnect();
  unbindCaseButtons();
  host?.removeEventListener("pointerdown", raise, { capture: true });
  host?.removeEventListener("focusin", raise);
});
</script>

<template>
  <div ref="hostEl" class="demo" @keydown="onKeydown">
    <div ref="paletteEl" class="palette">
      <div class="palette-surface" aria-hidden="true"></div>
      <!--
        The app's own drag strip: a 12px band overhanging the top edge, always
        mounted rather than revealed on hover (`CommandPalette.vue`).
      -->
      <div
        class="palette-drag"
        role="button"
        aria-label="Move palette"
        @pointerdown.stop="onMovePointerDown"
      />
      <div class="palette-card-chrome" aria-hidden="true">
        <button
          type="button"
          class="palette-card-chrome-btn"
          tabindex="-1"
          @pointerdown.prevent="pointerTakeOver"
        >
          <svg width="11" height="11" viewBox="0 0 16 16">
            <circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" stroke-width="1.5" />
          </svg>
        </button>
        <button
          type="button"
          class="palette-card-chrome-btn"
          tabindex="-1"
          @pointerdown.prevent="pointerTakeOver"
        >
          ⋯
        </button>
        <button
          type="button"
          class="palette-card-chrome-btn"
          tabindex="-1"
          @pointerdown.prevent="pointerTakeOver"
        >
          <svg class="palette-card-chrome-icon" viewBox="0 0 24 24">
            <path
              d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-7 0-11-7-11-7a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            />
            <line
              x1="1"
              y1="1"
              x2="23"
              y2="23"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </div>
      <div class="palette-input-row">
        <input
          ref="inputEl"
          v-model="query"
          class="palette-input"
          :class="{ 'palette-input--sized': Boolean(argParam) || Boolean(scopeChipEntry) }"
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          :aria-activedescendant="rows[selectedIndex] ? `demo-row-${rows[selectedIndex]!.id}` : undefined"
          aria-controls="kavibay-palette-demo-results"
          aria-label="Search or run anything"
          placeholder="Search or run anything"
          spellcheck="false"
          @input="onInput"
          @pointerdown="pointerTakeOver"
        />
        <!-- The selected row's argument, dim until Tab commits to it. Same
             chip language as the folder chip below, which is the app's: both
             are a value the row is waiting for. -->
        <input
          v-if="argParam"
          ref="argInputEl"
          v-model="argValue"
          class="palette-arg-chip"
          :class="argActive ? 'palette-arg-chip--active' : 'palette-arg-chip--preview'"
          :style="{ minWidth: `${argParam.placeholder.length + 2}ch` }"
          type="text"
          :placeholder="argParam.placeholder"
          :aria-label="argParam.placeholder"
          :readonly="!argActive"
          :tabindex="argActive ? 0 : -1"
          autocomplete="off"
          spellcheck="false"
          @input="takeOver"
          @pointerdown.prevent="
            pointerTakeOver();
            enterArgMode();
          "
        />
        <!-- Folder chip: dim while it only names the selected folder row, live
             once Tab entered that folder. Typing in it searches inside. -->
        <input
          v-if="scopeChipEntry"
          ref="scopeInputEl"
          v-model="scopeQuery"
          class="palette-arg-chip palette-folder-chip"
          :class="scopeActive ? 'palette-arg-chip--active' : 'palette-arg-chip--preview'"
          :style="{ minWidth: `${scopePlaceholder(scopeChipEntry).length + 2}ch` }"
          type="text"
          :placeholder="scopePlaceholder(scopeChipEntry)"
          :aria-label="scopePlaceholder(scopeChipEntry)"
          :readonly="!scopeActive"
          :tabindex="scopeActive ? 0 : -1"
          autocomplete="off"
          spellcheck="false"
          @input="takeOver"
          @pointerdown.prevent="
            pointerTakeOver();
            browseFromChip();
          "
        />
      </div>
      <div class="palette-statusbar">
        <div class="palette-statusbar-left">
          <button
            type="button"
            class="palette-bar-btn palette-bar-btn--widgets"
            tabindex="-1"
            @pointerdown.prevent="pointerTakeOver"
          >
            <svg class="palette-bar-btn-icon" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="3" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="2" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="2" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="2" />
              <path d="M17.5 14v7M14 17.5h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            </svg>
            <span class="palette-bar-btn-label">Widgets</span>
          </button>
        </div>
        <div class="palette-statusbar-center">
          <button
            type="button"
            class="palette-desk-tab palette-desk-tab--active"
            tabindex="-1"
            @pointerdown.prevent="pointerTakeOver"
          >
            <span class="palette-desk-tab-label">Home</span>
          </button>
        </div>
      </div>
    </div>
    <!--
      Out of the DOM until something is typed, the way `showResultsList` keeps
      it in the app. Hiding it with CSS would leave the rows in the
      accessibility tree, and an empty search bar does not have results.
    -->
    <div v-if="showResults" class="palette-results">
      <!-- Which folder the list belongs to. The chip names only the leaf, and
           after two levels down that stops being enough to place yourself. -->
      <div v-if="scopeFolder" class="palette-scope-bar">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path
            d="M3 7a2 2 0 0 1 2-2h4.2a2 2 0 0 1 1.4.6l1.2 1.2H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linejoin="round"
          />
        </svg>
        <span class="palette-scope-path">{{ scopeFolder.path }}</span>
        <button
          type="button"
          class="palette-scope-exit"
          tabindex="-1"
          @pointerdown.prevent="pointerTakeOver"
          @click="cycleSort"
        >
          <span class="kbd-hint"><kbd class="kbd-key">Ctrl</kbd><kbd class="kbd-key">S</kbd></span>
          <span>{{ sortLabel }}</span>
        </button>
        <button
          type="button"
          class="palette-scope-exit"
          tabindex="-1"
          @pointerdown.prevent="pointerTakeOver"
          @click="leaveScope()"
        >
          <span class="kbd-hint"
            ><kbd class="kbd-key">Shift</kbd><kbd class="kbd-key">Tab</kbd></span
          >
          <span>Back</span>
        </button>
      </div>
      <div class="palette-list-shell">
        <ul
          id="kavibay-palette-demo-results"
          class="palette-list"
          role="listbox"
          aria-label="Results"
        >
          <li
            v-for="(row, index) in rows"
            :id="`demo-row-${row.id}`"
            :key="row.id"
            class="palette-item"
            :class="{ 'palette-item--selected': index === selectedIndex }"
            role="option"
            :aria-selected="index === selectedIndex"
            @mouseenter="selectedIndex = index"
            @pointerdown="pointerTakeOver"
            @click="runAt(index)"
          >
            <!--
              An app row shows the executable's shell icon in the app. There is
              none to fetch here, so a named brand mark stands in where we ship
              one, and the drawn square everywhere else.
            -->
            <span
              v-if="row.brand === 'spotify'"
              class="palette-item-icon"
              aria-hidden="true"
            >
              <SpotifyMark :size="20" />
            </span>
            <span
              v-else-if="row.kind === 'app'"
              class="palette-item-icon"
              aria-hidden="true"
            >
              <svg viewBox="0 0 20 20" width="20" height="20">
                <rect x="2" y="2" width="16" height="16" rx="4" fill="currentColor" opacity="0.22" />
              </svg>
            </span>
            <!--
              The drawn folder mark, which in the app is what a directory keeps
              *because* it has no shell icon: `fileTypeIconKey` returns null for
              one, and that is how a folder stays visually apart from the
              colourful file icons Explorer supplies. There are no shell icons
              in a browser at all, so every row here is the drawn mark.
            -->
            <span
              v-else-if="row.kind === 'folder'"
              class="palette-item-icon"
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24" width="19" height="19">
                <path
                  d="M3 7a2 2 0 0 1 2-2h4.2a2 2 0 0 1 1.4.6l1.2 1.2H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linejoin="round"
                />
              </svg>
            </span>
            <span
              v-else-if="row.kind === 'file'"
              class="palette-item-icon"
              aria-hidden="true"
            >
              <!--
                The type's own mark, standing in for the shell icon the app
                fetches per extension. Colour first: in a list you tell a PDF
                from a spreadsheet before you read either name.
              -->
              <svg viewBox="0 0 24 24" width="19" height="19">
                <path :d="FILE_SHEET_PATH" :fill="fileMarkFor(row.title).color" />
                <path :d="FILE_FOLD_PATH" fill="#fff" opacity="0.45" />
                <g
                  fill="none"
                  stroke="#fff"
                  stroke-width="1.4"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  opacity="0.95"
                >
                  <path v-for="(mark, i) in fileMarkFor(row.title).glyph" :key="i" :d="mark" />
                </g>
              </svg>
            </span>
            <!--
              An action row carries its extension's icon in the app
              (`extensionIconComponent`), in the same round frame a widget row
              uses. Drawn here rather than imported: the palette would
              otherwise have to know which extension contributed the row, and
              the whole file is deliberately ignorant of that.
            -->
            <span
              v-else-if="row.kind === 'action'"
              class="palette-item-icon palette-item-icon--widget"
              aria-hidden="true"
            >
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <rect x="3" y="4" width="18" height="13" rx="2.5" />
                <path d="M8 21h8" />
                <path d="M12 17v4" />
                <path d="M12 7.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z" />
              </svg>
            </span>
            <span
              v-else-if="row.kind === 'widget'"
              class="palette-item-icon palette-item-icon--widget"
              aria-hidden="true"
            >
              <svg viewBox="0 0 20 20" width="18" height="18">
                <rect
                  x="3"
                  y="3"
                  width="14"
                  height="14"
                  rx="3.5"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                />
                <path
                  d="M7 8h6M7 12h4"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                />
              </svg>
            </span>
            <div class="palette-item-main">
              <span class="palette-item-title-line">
                <span class="palette-item-title">{{ row.title }}</span>
                <span
                  v-if="row.kind === 'widget'"
                  class="palette-item-widget-status palette-item-widget-status--open"
                >Open</span>
              </span>
              <!--
                A folder says what it is; a file says how big it is and, when
                it was found somewhere other than the folder being browsed,
                where it came from. Two facts, so two elements — the app keeps
                them apart for the same reason (`fileEntriesToRows`).
              -->
              <span v-if="row.kindLabel" class="palette-item-kind">{{ row.kindLabel }}</span>
              <span
                v-else-if="row.sizeLabel || row.folderLabel"
                class="palette-item-desks palette-item-fileline"
              >
                <span v-if="row.sizeLabel">{{ row.sizeLabel }}</span>
                <span v-if="row.folderLabel" class="palette-item-in-folder">
                  <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
                    <path
                      d="M3 7a2 2 0 0 1 2-2h4.2a2 2 0 0 1 1.4.6l1.2 1.2H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.75"
                      stroke-linejoin="round"
                    />
                  </svg>
                  {{ row.folderLabel }}
                </span>
              </span>
            </div>
            <!-- Whatever the list is sorted by, on the row itself. -->
            <span v-if="row.meta" class="palette-item-meta">{{ row.meta }}</span>
            <!--
              `.palette-item-subtitle` from the app: right-aligned at the end
              of the row, in place of the action chip rather than beside it.
              An extension action shows this and no chip — pressing Enter is
              what the row is for, so advertising it says nothing.
            -->
            <span
              v-if="row.subtitle && row.kind !== 'file'"
              class="palette-item-subtitle"
              >{{ row.subtitle }}</span
            >
            <div
              v-else-if="primaryAction(row.kind)"
              class="palette-item-actions"
              @pointerdown.prevent.stop="pointerTakeOver"
            >
              <button
                type="button"
                class="palette-item-action"
                tabindex="-1"
                @click.stop="runAt(index)"
              >
                <span class="kbd-hint">
                  <kbd class="kbd-key kbd-key--glyph" aria-label="Enter">
                    <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
                      <path
                        d="M12 4V9H4M7 6L4 9L7 12"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                    </svg>
                  </kbd>
                </span>
                <span>{{ primaryAction(row.kind) }}</span>
              </button>
              <!-- Tab enters a folder without leaving the palette. -->
              <button
                v-if="browsable(row)"
                type="button"
                class="palette-item-action"
                tabindex="-1"
                @click.stop="row.path && enterScope(row.path)"
              >
                <span class="kbd-hint"><kbd class="kbd-key">Tab</kbd></span>
                <span>Browse</span>
              </button>
            </div>
          </li>
          <li v-if="rows.length === 0" class="palette-empty">
            {{ scopeActive ? scopeEmptyLabel : "No matches" }}
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style>
/*
 * Lifted from CommandPalette.vue: input, results, item, chrome, status bar
 * and the selected-row action chip. Menus, arg chips and the widget overview
 * stay out — this element has no host to drive them.
 *
 * Colours go through custom properties so they inherit across the shadow
 * boundary from the host page. Fallbacks exist because a document that is
 * only this element (the standalone proof) defines none of those tokens, and
 * `rgba(var(--fg-rgb), …)` without a fallback paints transparent text.
 */

*,
*::before,
*::after {
  box-sizing: border-box;
}

:host {
  display: block;
  /*
   * Drag offset, read from custom properties the composable sets on this
   * element. `translate` rather than `transform` so a page that positions the
   * palette with its own transform keeps working — the playground centres it
   * that way.
   */
  translate: var(--kavibay-embed-dx, 0px) var(--kavibay-embed-dy, 0px);
  font-family: inherit;
  font-size: 14px;
  line-height: 1.4;
  color: rgba(var(--fg-rgb, 255, 255, 255), 0.95);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  --palette-list-height: 400px;
}

.demo {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.palette {
  position: relative;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  border-radius: var(--surface-radius, 16px);
  corner-shape: var(--surface-corner-shape, round);
  overflow: visible;
}

.palette-surface {
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  border-radius: inherit;
  corner-shape: inherit;
  background:
    var(--surface-sheen, linear-gradient(rgba(255, 255, 255, 0), rgba(255, 255, 255, 0))),
    rgba(var(--surface-bg-rgb, 28, 28, 32), var(--surface-alpha, 0.72));
  border: 1px solid var(--surface-border, var(--border, rgba(255, 255, 255, 0.1)));
  box-shadow:
    var(--surface-box-shadow, 0 8px 24px rgba(0, 0, 0, 0.35)),
    var(--surface-inner-highlight, inset 0 1px 0 rgba(255, 255, 255, 0.09));
  backdrop-filter: var(--surface-backdrop-filter, blur(16px));
}

/* Copied from the app, which sizes the band to overhang the rounded corner. */
.palette-drag {
  position: absolute;
  top: -6px;
  left: 0;
  right: 0;
  z-index: 3;
  height: 12px;
  border-radius: var(--surface-radius, 16px) var(--surface-radius, 16px) 0 0;
  corner-shape: var(--surface-corner-shape, round);
  background: transparent;
  cursor: grab;
  touch-action: none;
}

.palette-drag:active {
  cursor: grabbing;
}

.palette-card-chrome {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 3;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 2px;
  opacity: 0;
  pointer-events: none;
}

/*
 * Revealed on hover, like the app's card chrome.
 *
 * This rule once read `.palette:hover` followed by a stray second copy of the
 * `.palette-drag` block, which left `.palette-card-chrome` as an unqualified
 * selector — so pin, menu and hide sat on the palette permanently. Nothing
 * broke; the demo just wore three buttons the app only shows on hover.
 */
.palette:hover .palette-card-chrome {
  opacity: 1;
  pointer-events: auto;
}

.palette-card-chrome-btn {
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 999px;
  corner-shape: var(--surface-corner-shape, round);
  background: transparent;
  color: var(--text-muted, rgba(255, 255, 255, 0.55));
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.palette-card-chrome-icon {
  display: block;
  width: 12px;
  height: 12px;
}

.palette-card-chrome-btn:hover {
  background: var(--fill, rgba(255, 255, 255, 0.08));
  color: var(--text, rgba(255, 255, 255, 0.92));
}

.palette-input-row {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 0 56px 0 20px;
  box-shadow: rgba(0, 0, 0, 0.02) 1px 1px 3px 1px inset;
  border-bottom: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  border-radius: var(--surface-radius, 16px) var(--surface-radius, 16px) 0 0;
  corner-shape: var(--surface-corner-shape, round);
}

/* `font-family: inherit` is not optional here: form controls default to the UA
   font, so without it the query renders in a different typeface than the rows. */
.palette-input {
  flex: 1 1 auto;
  min-width: 0;
  padding: 24px 0;
  border: none;
  background: transparent;
  color: rgba(var(--fg-rgb, 255, 255, 255), 0.95);
  font-size: 15px;
  font-family: inherit;
  outline: none;
}

.palette-input::placeholder {
  color: var(--text-faint, rgba(255, 255, 255, 0.4));
}

.palette-statusbar {
  position: relative;
  z-index: 6;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  padding: 10px 10px;
  border-radius: 0 0 var(--surface-radius, 16px) var(--surface-radius, 16px);
  corner-shape: var(--surface-corner-shape, round);
  background: var(--bar-bg, rgba(0, 0, 0, 0.15));
}

.palette-statusbar-left {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  min-height: 28px;
  flex-shrink: 0;
}

.palette-bar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 999px;
  corner-shape: var(--surface-corner-shape, round);
  background: transparent;
  color: var(--text-muted, rgba(255, 255, 255, 0.55));
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  font-family: inherit;
}

.palette-bar-btn--widgets {
  width: auto;
  gap: 9px;
  padding: 0 12px;
  font-size: 13px;
  font-weight: 500;
}

.palette-bar-btn-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.palette-bar-btn-label {
  line-height: 1;
}

.palette-bar-btn:hover {
  color: var(--text, rgba(255, 255, 255, 0.92));
  background: var(--fill, rgba(255, 255, 255, 0.08));
}

.palette-statusbar-center {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  max-width: calc(100% - 220px);
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.palette-desk-tab {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 12px;
  border: none;
  border-radius: 999px;
  corner-shape: var(--surface-corner-shape, round);
  background: transparent;
  color: var(--text-muted, rgba(255, 255, 255, 0.55));
  font-size: 13px;
  font-weight: 500;
  line-height: 1;
  cursor: pointer;
  max-width: 120px;
  font-family: inherit;
}

.palette-desk-tab--active {
  background: var(--fill-hover, rgba(255, 255, 255, 0.14));
  color: var(--text, rgba(255, 255, 255, 0.92));
}

.palette-desk-tab-label {
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/*
 * In the app this block is `position: absolute; top: calc(100% + 8px)` because
 * the real palette is a compact bar whose height arrives with `palette:show`.
 * That event never fires here, so absolute positioning would measure 0×0 and
 * clip the list. In-flow, with the 8px gap on `.demo`, is the same geometry
 * without the Tauri handshake.
 */
.palette-results {
  position: relative;
  z-index: 5;
  display: flex;
  flex-direction: column;
  /*
   * The app's own default list height (`DEFAULT_PALETTE_LIST_HEIGHT`, 400).
   * Without it the demo grew to whatever the row list happened to be, which
   * on a 720-tall screen was most of the window.
   */
  max-height: 400px;
  overflow-y: auto;
  border-radius: var(--surface-radius, 16px);
  corner-shape: var(--surface-corner-shape, round);
  background:
    var(--surface-sheen, linear-gradient(rgba(255, 255, 255, 0), rgba(255, 255, 255, 0))),
    rgba(var(--surface-bg-rgb, 28, 28, 32), var(--surface-alpha, 0.72));
  border: 1px solid var(--surface-border, var(--border, rgba(255, 255, 255, 0.1)));
  box-shadow:
    var(--surface-box-shadow, 0 8px 24px rgba(0, 0, 0, 0.35)),
    var(--surface-inner-highlight, inset 0 1px 0 rgba(255, 255, 255, 0.09));
  backdrop-filter: var(--surface-backdrop-filter, blur(16px));
  overflow: hidden;
}

.palette-list-shell {
  position: relative;
  flex-shrink: 0;
  overflow: hidden;
  height: var(--palette-list-height, 400px);
}

.palette-list {
  list-style: none;
  margin: 0;
  padding: 8px;
  height: 100%;
  box-sizing: border-box;
  overflow-y: auto;
  scrollbar-width: none;
}

.palette-list::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.palette-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 30px;
  corner-shape: var(--surface-corner-shape, round);
  cursor: pointer;
}

.palette-item--selected {
  background: var(--row-selected-sheen, linear-gradient(rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0))),
    var(--row-selected-bg, rgba(255, 255, 255, 0.1));
  box-shadow: var(--row-selected-rim, inset 0 1px 0 rgba(255, 255, 255, 0.13)),
    var(--row-selected-shadow, 0 1px 3px rgba(0, 0, 0, 0.3));
}

.palette-item-icon {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  color: rgba(var(--fg-rgb, 255, 255, 255), 0.72);
}

.palette-item-icon--widget {
  color: rgba(var(--fg-rgb, 255, 255, 255), 0.72);
  background: rgba(var(--fg-rgb, 255, 255, 255), 0.08);
  border-radius: 6px;
}

.palette-item-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.palette-item-title {
  font-size: 14px;
  color: rgba(var(--fg-rgb, 255, 255, 255), 0.95);
}

.palette-item-title-line {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.palette-item-widget-status {
  flex-shrink: 0;
  padding: 2px 5px;
  border-radius: 4px;
  background: rgba(var(--fg-rgb, 255, 255, 255), 0.1);
  color: rgba(var(--fg-rgb, 255, 255, 255), 0.62);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.06em;
  line-height: 1.2;
  text-transform: uppercase;
}

.palette-item-kind {
  font-size: 11px;
  line-height: 1.2;
  color: rgba(var(--fg-rgb, 255, 255, 255), 0.5);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.palette-item-kind--said {
  text-transform: none;
  letter-spacing: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/*
 * The second line of a browsed file row, and not the kind line above it: a
 * size and a location are two facts, so the app gives them their own line with
 * a gap between them instead of the category treatment. Copied here after the
 * two were sharing `.palette-item-kind`, which left "180 KB" and the folder
 * mark stuck together with no space at all.
 */
.palette-item-desks {
  font-size: 11px;
  line-height: 1.2;
  color: rgba(var(--fg-rgb, 255, 255, 255), 0.45);
}

/* Size and location on one line; the gap does the separating. */
.palette-item-fileline {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.palette-item-in-folder {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.palette-item-in-folder svg {
  flex-shrink: 0;
  opacity: 0.75;
}

.palette-item-subtitle {
  flex-shrink: 0;
  margin-left: auto;
  font-size: 12px;
  color: rgba(var(--fg-rgb, 255, 255, 255), 0.5);
}

.palette-item-actions {
  flex-shrink: 0;
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  visibility: hidden;
}

.palette-item--selected .palette-item-subtitle {
  flex-shrink: 0;
  margin-left: auto;
  font-size: 12px;
  color: rgba(var(--fg-rgb, 255, 255, 255), 0.5);
}

/* Chips belong to the row the caret is on — the app shows them nowhere else,
   and a list where every row advertises Enter says nothing about any of them.
   The prefix was lost in the copy; with a Browse chip beside Open it stopped
   being subtle. */
.palette-item--selected .palette-item-actions {
  visibility: visible;
}

.palette-item-action {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin: 0;
  padding: 4px 8px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: rgba(var(--fg-rgb, 255, 255, 255), 0.55);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  font-family: inherit;
}

.palette-item--selected .palette-item-action {
  color: rgba(var(--fg-rgb, 255, 255, 255), 0.72);
}

.kbd-hint {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.kbd-key {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border: 1px solid rgba(var(--fg-rgb, 255, 255, 255), 0.28);
  border-radius: 6px;
  corner-shape: squircle;
  background: rgba(var(--fg-rgb, 255, 255, 255), 0.08);
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  color: rgba(var(--fg-rgb, 255, 255, 255), 0.88);
}

.kbd-key--glyph {
  padding: 0 3px;
}

.palette-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 16px 12px;
  font-size: 13px;
  color: rgba(var(--fg-rgb, 255, 255, 255), 0.5);
  text-align: center;
}

/* ── Folder scope ─────────────────────────────────────────────────────────
   Chip, breadcrumb and the sort column, lifted from CommandPalette.vue with
   the same values. */

/* Sort value on the row (date or size). Tabular figures so the column reads as
   a column even though every row has a different number in it. */
.palette-item-meta {
  flex-shrink: 0;
  margin-left: auto;
  padding-left: 10px;
  color: rgba(var(--fg-rgb, 255, 255, 255), 0.45);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* Only while chips are on screen: hug the typed text so the first chip sits
   next to it. Alone, the input keeps filling the bar (bigger click target).

   This one rule is what put the chip beside the query instead of out at the
   right edge, and it was the piece missing from the copy — with the input
   still `flex: 1 1 auto`, it ate the whole bar and pushed the chip away. */
.palette-input--sized {
  flex: 0 1 auto;
  min-width: 2ch;
  max-width: 100%;
  field-sizing: content;
}

/* The app's argument chip: a value the selected row is waiting for. */
.palette-arg-chip {
  flex: 0 0 auto;
  padding: 5px 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: rgba(var(--fg-rgb, 255, 255, 255), 0.08);
  color: rgba(var(--fg-rgb, 255, 255, 255), 0.95);
  font-size: 15px;
  font-family: inherit;
  outline: none;
  field-sizing: content;
}

.palette-arg-chip::placeholder {
  color: rgba(var(--fg-rgb, 255, 255, 255), 0.45);
}

/* Hint state: readable, but clearly not where the caret is. */
.palette-arg-chip--preview {
  opacity: 0.55;
  cursor: pointer;
}

.palette-arg-chip--active {
  border-color: rgba(var(--fg-rgb, 255, 255, 255), 0.25);
  background: rgba(var(--fg-rgb, 255, 255, 255), 0.13);
}

/* Folder chip: same chip language, one step brighter than an argument chip —
   while it is live the list below stops answering the query behind it. */
.palette-folder-chip.palette-arg-chip--active {
  border-color: rgba(var(--fg-rgb, 255, 255, 255), 0.4);
  background: rgba(var(--fg-rgb, 255, 255, 255), 0.18);
}

/* Breadcrumb strip above the folder's contents. */
.palette-scope-bar {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  border-bottom: 1px solid rgba(var(--fg-rgb, 255, 255, 255), 0.08);
  color: rgba(var(--fg-rgb, 255, 255, 255), 0.62);
  font-size: 12px;
}

.palette-scope-path {
  flex: 1 1 auto;
  overflow: hidden;
  /* Deep paths lose their head, not their tail: the folder you are in is the
     end of the string and the part worth reading. */
  direction: rtl;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.palette-scope-exit {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}

.palette-scope-exit:hover {
  background: rgba(var(--fg-rgb, 255, 255, 255), 0.08);
  color: rgba(var(--fg-rgb, 255, 255, 255), 0.9);
}
</style>
