/**
 * Quick checks for palette type-row / smart-open helpers.
 * Run: npx tsx src/palette/paletteResults.assert.ts
 */
import type { WidgetInstance } from "../host/types";
import type { RegisteredExtension } from "@sdk/types";
import {
  buildAppRows,
  buildWidgetOverviewRows,
  buildExtensionActionRows,
  buildTypeRows,
  paletteRowAction,
  resolveActionTarget,
  buildWidgetRows,
  filterPaletteRows,
  buildOpenNewRows,
  groupInstancesWithCreateRow,
  resolveTypeSmart,
  subtitleForSmart,
  attachNotePreviews,
  typeMatchesWidgetFilter,
  buildOffDeskWidgetRows,
  mergePaletteCatalog,
} from "./paletteResults";
import type { PaletteRow } from "./paletteResults";
import type { Command } from "./commands";
import { commands as registeredCommands } from "./commands";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function ext(partial: Partial<RegisteredExtension> & { id: string; title: string }): RegisteredExtension {
  return {
    description: "",
    version: "1.0.0",
    author: "test",
    keywords: [],
    categories: [],
    isWidget: true,
    position: { x: 0, y: 0 },
    defaultSize: { w: 220, h: 220 },
    allowDuplicate: true,
    flush: false,
    compact: false,
    defaultHideTitle: false,
    defaultScale: 1,
    grabCursor: true,
    fullDrag: false,
    resizable: true,
    playground: false,
    hugHeight: false,
    opaque: false,
    commands: [],
    actions: [],
    actionHandlers: {},
    permissions: [],
    component: {} as RegisteredExtension["component"],
    ...partial,
  };
}

const snake = ext({
  id: "snake",
  title: "Snake",
  keywords: ["snake", "game"],
  description: "Classic Snake",
});
const clock = ext({ id: "clock", title: "Clock", keywords: ["time"] });

assert(resolveTypeSmart("snake", []).smart === "create", "no instances → create");
assert(subtitleForSmart("create") === "New widget", "create subtitle is New");
assert(subtitleForSmart("show") === "Show widget", "Show only for hidden");

const hidden: WidgetInstance = {
  instanceId: "h1",
  typeId: "snake",
  offset: { x: 0, y: 0 },
  hidden: true,
};
assert(resolveTypeSmart("snake", [hidden]).smart === "show", "hidden → show");
assert(resolveTypeSmart("snake", [hidden]).targetInstanceId === "h1", "show target");

const visible: WidgetInstance = {
  instanceId: "v1",
  typeId: "snake",
  offset: { x: 0, y: 0 },
};
assert(resolveTypeSmart("snake", [visible]).smart === "focus", "visible → focus");

const typeRows = buildTypeRows([snake, clock], [visible]);
const snakeRow = typeRows.find((r) => r.typeId === "snake")!;
assert(snakeRow.canHide === true, "visible type row can hide");
assert(snakeRow.smart === "focus", "visible type row focuses");

{
  const noteRows = buildWidgetRows(
    [{ instanceId: "note-1", typeId: "notes", offset: { x: 0, y: 0 } }],
    () => "Notes",
    () => ["notes"],
  );
  const withPreviews = attachNotePreviews(noteRows, (instanceId) =>
    instanceId === "note-1" ? "Remember the milk" : "",
  );
  assert(withPreviews[0]?.notePreview === "Remember the milk", "notes rows show content");
}

const second: WidgetInstance = {
  instanceId: "v2",
  typeId: "snake",
  offset: { x: 10, y: 10 },
};

const renamed: WidgetInstance = {
  instanceId: "r1",
  typeId: "snake",
  offset: { x: 0, y: 0 },
  title: "Grammar Police",
};

// --- create rows ------------------------------------------------------------------
{
  const openNew = buildOpenNewRows([snake, clock]);
  const row = openNew.find((r) => r.typeId === "snake")!;
  // Bare type name — the New button and the Widget label carry the verb.
  assert(row.title === "Snake", "create row is titled with the type name");
  assert(row.smart === "create", "create row always creates");
  assert(row.canHide === false, "create row has nothing to hide");
  assert(
    openNew.length === 2,
    "one create row per extension, instances or not",
  );
  // Type keywords must survive or the row stops being findable by name.
  assert(row.keywords.includes("snake"), "create row keeps the type id");
}

// --- hidden instances are listed too ----------------------------------------------
{
  const hiddenInstance: WidgetInstance = {
    instanceId: "h1",
    typeId: "snake",
    offset: { x: 0, y: 0 },
    hidden: true,
  };
  const rows = buildWidgetRows(
    [visible, hiddenInstance],
    () => "Snake",
    () => ["snake"],
  );
  assert(rows.length === 2, "a soft-hidden instance still gets its own row");
  const hiddenRow = rows.find((r) => r.instanceId === "h1")!;
  assert(hiddenRow.hidden === true, "the row knows it is hidden");
  assert(hiddenRow.subtitle === "Show widget", "hidden rows offer Show");
  // Enter raises the widget; hiding it is Ctrl/Cmd+H, not the primary action.
  const visibleRow = rows.find((r) => r.instanceId === "v1")!;
  assert(visibleRow.subtitle === "Focus widget", "visible rows offer Focus");
}

// --- create row sits under its instances ------------------------------------------
{
  const instanceRows = buildWidgetRows(
    [visible, second],
    () => "Snake",
    () => ["snake"],
  );
  const createRow = buildOpenNewRows([snake])[0]!;
  // Worst case: the create row outranked both instances before grouping.
  const grouped = groupInstancesWithCreateRow([createRow, ...instanceRows]);
  assert(grouped.length === 3, "grouping neither drops nor duplicates rows");
  assert(grouped[0]!.kind === "widget", "instances come first");
  assert(grouped[1]!.kind === "widget", "every instance keeps its own row");
  assert(
    grouped[2]!.kind === "type" && grouped[2]!.typeId === "snake",
    "create row lands below the last instance of its type",
  );
  // The palette renders an attached create row compactly — without the flag it
  // looks like a third Snake instance.
  assert(
    grouped[2]!.kind === "type" && grouped[2]!.attachedToGroup === true,
    "an attached create row says so",
  );
  assert(
    createRow.attachedToGroup !== true,
    "grouping copies the row instead of mutating the source",
  );
  assert(
    grouped[2]!.title === "Snake",
    "the attached row keeps the bare title; the palette prefixes New at render",
  );
}

{
  // With no instances of that type there is nothing to sink below.
  const createRow = buildOpenNewRows([snake])[0]!;
  const grouped = groupInstancesWithCreateRow([createRow]);
  assert(grouped.length === 1 && grouped[0] === createRow, "lone create row stays put");
  assert(
    createRow.attachedToGroup === undefined,
    "a lone create row is not attached — it keeps the full row treatment",
  );
}

// --- empty-query widget overview groups placed cards before the catalog -----------
{
  const instanceRows = buildWidgetRows(
    [hidden, visible],
    (instance) => instance.typeId,
    (instance) => [instance.typeId],
  );
  const overview = buildWidgetOverviewRows(instanceRows, buildOpenNewRows([snake, clock]));
  assert(overview[0]?.kind === "widget" && !overview[0].hidden, "open widgets come first");
  assert(overview[1]?.kind === "widget" && overview[1].hidden, "hidden widgets follow open widgets");
  assert(overview[2]?.kind === "type", "the catalog follows placed widgets");
  assert(overview.length === 4, "overview retains every instance and catalog widget");
}

// --- instances parked on another desk sit between the hidden ones and the catalog ---
{
  const instanceRows = buildWidgetRows(
    [hidden, visible],
    (instance) => instance.typeId,
    (instance) => [instance.typeId],
  );
  const offDesk = buildOffDeskWidgetRows([
    { instanceId: "o1", typeId: "clock", title: "Clock", onDesks: "Work" },
  ]);
  assert(offDesk[0]?.offDesk === true, "off-desk rows are flagged");
  assert(offDesk[0]?.subtitle === "Place on this desk", "Enter brings the instance over");
  assert(
    offDesk[0]?.keywords.includes("Work") === true,
    "the desk name is searchable — it is how duplicate titles are told apart",
  );
  const overview = buildWidgetOverviewRows(
    instanceRows,
    buildOpenNewRows([snake, clock]),
    offDesk,
  );
  assert(
    overview[2]?.kind === "widget" && overview[2].offDesk === true,
    "off-desk instances follow the placed ones",
  );
  assert(overview[3]?.kind === "type", "the catalog still comes last");
}

{
  // Full path with the real ranking. The create row is now titled exactly like
  // its instances, so it wins the score tie and the type/widget tie-break —
  // only the grouping pass keeps a running Snake above the row that makes one.
  const instanceRows = buildWidgetRows(
    [visible, second],
    () => "Snake",
    () => ["snake"],
  );
  const grouped = groupInstancesWithCreateRow(
    filterPaletteRows("snake", [], instanceRows, buildOpenNewRows([snake])),
  );
  assert(
    grouped.map((r) => r.kind).join(",") === "widget,widget,type",
    "ranked results still put the create row last in its group",
  );
}

{
  // Two types interleaved: each create row follows its own instances.
  const snakeRows = buildWidgetRows([visible], () => "Snake", () => ["snake"]);
  const clockRows = buildWidgetRows(
    [{ instanceId: "c1", typeId: "clock", offset: { x: 0, y: 0 } }],
    () => "Clock",
    () => ["clock"],
  );
  const [snakeCreate, clockCreate] = buildOpenNewRows([snake, clock]);
  const grouped = groupInstancesWithCreateRow([
    ...snakeRows,
    ...clockRows,
    snakeCreate!,
    clockCreate!,
  ]);
  assert(
    grouped.map((r) => r.kind).join(",") === "widget,type,widget,type",
    "each create row follows its own type's instances",
  );
}

const commands: Command[] = [
  {
    id: "lock-screen",
    title: "Lock Screen",
    keywords: ["lock"],
  },
];

const empty = filterPaletteRows("", commands, [], typeRows);
assert(empty.length === 0, "empty query: no rows (search-first)");

const snakeHits = filterPaletteRows("snake", commands, [], typeRows);
assert(
  snakeHits.some((r) => r.kind === "type" && r.typeId === "snake"),
  "query snake finds type row with zero instances",
);
assert(
  !snakeHits.some((r) => r.kind === "widget"),
  "single-instance snake has no separate hide row in this filter input",
);

{
  const renamedRows = buildWidgetRows(
    [renamed],
    (instance) => instance.title ?? "Snake",
    (instance) => ["snake", "Snake", ...(instance.title ? [instance.title] : [])],
  );
  const hits = filterPaletteRows("police", commands, renamedRows, typeRows);
  assert(
    hits.some((r) => r.kind === "widget" && r.title === "Grammar Police"),
    "searching the custom title finds the renamed widget",
  );
}

const appRows = buildAppRows("chr", [
  { name: "Google Chrome", path: "C:\\chrome.exe", pinned: true },
  { name: "Notepad", path: "C:\\notepad.exe" },
  { name: "Calculator", path: "C:\\calc.exe" },
]);
assert(appRows.length === 1 && appRows[0]!.title === "Google Chrome", "fuzzy chr → Chrome");
assert(appRows[0]!.kind === "app" && appRows[0]!.pinned, "app row marked pinned");
assert(appRows[0]!.usageBoost === 0, "unused app has zero usage boost");

const habitual = buildAppRows(
  "note",
  [
    { name: "Notepad", path: "C:\\notepad.exe" },
    { name: "Notes Helper", path: "C:\\notes-helper.exe" },
  ],
  12,
  (app) => (app.path.includes("notepad") ? 20 : 0),
);
assert(
  habitual[0]?.title === "Notepad",
  "habitual usage ranks Notepad above Notes Helper",
);

const ranked = buildAppRows(
  "sp",
  [
    { name: "Spark", path: "/Applications/Spark.app" },
    { name: "Spotify", path: "/Applications/Spotify.app" },
  ],
  12,
  () => 0,
  (app) => (app.name === "Spotify" ? 50 : 0),
);
assert(ranked[0]?.title === "Spotify", "query frecency beats other sp* fuzzy hits");

const heidiDupes = buildAppRows("heidi", [
  {
    name: "HeidiSQL",
    path: "C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\HeidiSQL.lnk",
    pinned: true,
  },
  { name: "HeidiSQL", path: "C:\\Program Files\\HeidiSQL\\heidisql.exe" },
  {
    name: "HeidiSQL 12.11.0.7065",
    path: "C:\\Program Files\\HeidiSQL\\heidisql.exe",
  },
]);
assert(heidiDupes.length === 1, "same app / version variants collapse to one row");
assert(heidiDupes[0]?.pinned === true, "pinned variant wins dedupe");
assert(heidiDupes[0]?.title === "HeidiSQL", "shorter/pinned title kept");

const pathSlashDupes = buildAppRows("heidi", [
  { name: "HeidiSQL", path: "C:\\Program Files\\HeidiSQL\\heidisql.exe" },
  { name: "HeidiSQL", path: "C:/Program Files/HeidiSQL/heidisql.exe" },
]);
assert(pathSlashDupes.length === 1, "backslash vs slash paths collapse to one row");

const mixed = filterPaletteRows("chr", commands, [], [], appRows);
assert(
  mixed.some((r) => r.kind === "app" && r.title === "Google Chrome"),
  "filter keeps app rows",
);

assert(typeMatchesWidgetFilter("snake", [], "all") === true, "all includes empty");
assert(typeMatchesWidgetFilter("snake", [], "open") === false, "open empty");
assert(typeMatchesWidgetFilter("snake", [], "hidden") === false, "hidden empty");
assert(typeMatchesWidgetFilter("snake", [visible], "open") === true, "open visible");
assert(typeMatchesWidgetFilter("snake", [visible], "hidden") === false, "hidden not visible-only");
assert(typeMatchesWidgetFilter("snake", [hidden], "hidden") === true, "hidden filter matches");
assert(typeMatchesWidgetFilter("snake", [hidden], "open") === false, "open not hidden-only");
assert(
  typeMatchesWidgetFilter("snake", [visible, hidden], "open") === true,
  "both → open",
);
assert(
  typeMatchesWidgetFilter("snake", [visible, hidden], "hidden") === true,
  "both → hidden",
);


console.log("paletteResults.assert: ok");

// --- mergePaletteCatalog ---
// A widget that is enabled but absent from this list is installed and unusable:
// the palette is the only place a person picks one.
{
  const builtin = [{ id: "clock", title: "Clock" }];
  const runtime = [
    { id: "water-tracker", title: "Water Tracker" },
    { id: "clock", title: "Impostor Clock" },
    { id: "muted", title: "Muted" },
  ];
  const merged = mergePaletteCatalog(builtin, runtime, (id) => id !== "muted");

  assert(
    JSON.stringify(merged.map((entry) => entry.id)) ===
      JSON.stringify(["clock", "water-tracker"]),
    "runtime packages join the catalog; disabled ones stay out",
  );
  assert(
    merged[0].title === "Clock",
    "a package cannot shadow a built-in that shipped with the app",
  );
  assert(mergePaletteCatalog([], [], () => true).length === 0, "empty in, empty out");
}

console.log("paletteResults.assert.ts: merge ok");

// --- the name you typed wins over a foreign keyword --------------------
{
  // Real manifests: Pomodoro and Time Tracker both list "timer" as a keyword.
  const catalog = [
    { id: "pomodoro", title: "Pomodoro", keywords: ["pomodoro", "focus", "timer"] },
    {
      id: "time-tracker",
      title: "Time Tracker",
      keywords: ["time", "track", "tracker", "timer", "zeiterfassung"],
    },
    { id: "timer", title: "Timer", keywords: ["timer", "countdown"] },
  ];
  const rows = buildTypeRows(catalog, []);

  const ranked = filterPaletteRows("timer", [], [], rows).map((r) =>
    r.kind === "type" ? r.typeId : r.id,
  );
  assert(ranked[0] === "timer", `"timer" must rank the Timer extension first, got ${ranked[0]}`);

  // Two equally strong title matches: the shorter title is the closer fit.
  const partial = filterPaletteRows("tim", [], [], rows).map((r) =>
    r.kind === "type" ? r.typeId : r.id,
  );
  assert(partial[0] === "timer", `"tim" should lead with Timer, got ${partial[0]}`);
  assert(partial[1] === "time-tracker", "Time Tracker follows, it is not dropped");

  // A keyword-only hit is still found — it just ranks below title hits.
  const byKeyword = filterPaletteRows("focus", [], [], rows).map((r) =>
    r.kind === "type" ? r.typeId : r.id,
  );
  assert(byKeyword.includes("pomodoro"), "keyword-only matches stay findable");

  // Words nobody has a title for keep working.
  const zeit = filterPaletteRows("zeiterfassung", [], [], rows).map((r) =>
    r.kind === "type" ? r.typeId : r.id,
  );
  assert(zeit[0] === "time-tracker", "a unique keyword still wins its row");
}

// --- strong short matches suppress loose alias noise -------------------
{
  const catalog = [
    { id: "alarm", title: "Alarm", keywords: ["alarm"] },
    { id: "launcher-buttons", title: "Launcher Buttons", keywords: ["launcher-buttons", "applications"] },
    { id: "clipboard", title: "Clipboard", keywords: ["zwischenablage"] },
    { id: "one-purpose-llm", title: "One-purpose LLM", keywords: ["translate"] },
  ];
  const rows = buildTypeRows(catalog, []);
  const matched = filterPaletteRows("ala", [], [], rows).map((row) =>
    row.kind === "type" ? row.typeId : row.id,
  );
  assert(matched.join(",") === "alarm", "ala keeps Alarm and drops weak alias matches");
}

// --- actions ride on the extension's own row ---------------------------
{
  const setTimer = {
    id: "set-timer",
    title: "Set Timer",
    keywords: ["countdown"],
    params: [{ name: "duration", type: "text" as const, required: true }],
  };
  const catalog = [
    { id: "timer", title: "Timer", keywords: ["timer"], actions: [setTimer] },
    { id: "clock", title: "Clock", keywords: ["time"] },
  ];

  const rows = buildTypeRows(catalog, []);
  assert(rows.length === 2, "one row per extension — never a second action row");

  const timerRow = rows[0];
  assert(timerRow.action?.id === "set-timer", "the action hangs off its widget row");
  assert(rows[1].action === undefined, "extensions without actions stay plain");

  // The action's own words search the same row.
  assert(
    timerRow.keywords.includes("Set Timer") && timerRow.keywords.includes("countdown"),
    "action title and keywords are searchable on the extension row",
  );
  assert(
    filterPaletteRows("countdown", [], [], rows).length === 1,
    "an action keyword finds exactly one row, not two",
  );
  assert(
    filterPaletteRows("timer", [], [], rows).length === 1,
    "the extension name finds exactly one row",
  );

  // Only the first action rides along (one row, one Tab).
  const twoActions = buildTypeRows(
    [{ id: "x", title: "X", actions: [setTimer, { id: "b", title: "B", keywords: [] }] }],
    [],
  );
  assert(twoActions[0].action?.id === "set-timer", "the first declared action wins");
}

// --- paletteRowAction: one accessor for both row kinds -----------------
{
  const typeRow = buildTypeRows(
    [
      {
        id: "pomodoro",
        title: "Pomodoro",
        actions: [
          {
            id: "pomodoro",
            title: "Pomodoro",
            keywords: [],
            params: [{ name: "mode", type: "enum" as const, required: true, options: ["start"] }],
          },
        ],
      },
    ],
    [],
  )[0];

  const fromType = paletteRowAction(typeRow);
  assert(fromType?.extId === "pomodoro", "type rows yield an extension action");
  assert(fromType?.actionId === "pomodoro", "action id comes from the manifest");
  assert(fromType?.needsInstance === true, "needsInstance defaults to true");
  assert(fromType?.params.length === 1, "params come along");

  const plainType = buildTypeRows([{ id: "clock", title: "Clock" }], [])[0];
  assert(paletteRowAction(plainType) === null, "no action, no spec");

  const widgetRow = buildWidgetRows(
    [({ instanceId: "hidden-llm", typeId: "one-purpose-llm", hidden: true } as WidgetInstance)],
    () => "Single Purpose LLM",
    () => ["llm"],
    () => "",
    () => ({
      id: "use-template",
      title: "Use template",
      keywords: [],
      params: [{ name: "template", type: "enum", required: true, options: ["Translate"] }],
    }),
  )[0];
  const fromWidget = paletteRowAction(widgetRow);
  assert(fromWidget?.instanceId === "hidden-llm", "widget action retains its exact target instance");
  assert(fromWidget?.actionId === "use-template", "widget rows expose their declared action");

  const osRow = filterPaletteRows(
    "vol",
    [
      {
        id: "set-volume",
        title: "Set Volume",
        keywords: ["vol"],
        params: [{ name: "level", type: "number", required: true }],
      },
    ] as Command[],
    [],
  )[0] as Extract<PaletteRow, { kind: "command" }>;
  const fromCommand = paletteRowAction(osRow);
  assert(fromCommand?.actionId === "set-volume", "OS action id is the command id");
  assert(fromCommand?.needsInstance === false, "OS commands never resolve an instance");

  const plainCommand = filterPaletteRows(
    "lock",
    [{ id: "lock-screen", title: "Lock Screen", keywords: ["lock"] }] as Command[],
    [],
  )[0] as Extract<PaletteRow, { kind: "command" }>;
  assert(plainCommand.params.length === 0, "params-free command normalizes to []");
  assert(paletteRowAction(plainCommand) === null, "a command without params has no chips");

  assert(paletteRowAction(undefined) === null, "no row, no spec");
}

// --- an instance-less action from an extension that also ships a widget ------
{
  // The palette used to build these rows only from extensions with no widget
  // card, which conflates two different questions: whether the extension has a
  // card, and whether the action wants one. An action declaring
  // `needsInstance: false` on a widget extension was then unreachable, not
  // merely misplaced — a widget extension's actions are otherwise run from an
  // instance row, and this one asks for no instance to have a row for.
  const rows = buildExtensionActionRows([
    {
      id: "widget-wizard",
      title: "Widget Wizard",
      keywords: ["wizard"],
      actions: [
        {
          id: "new-widget",
          title: "New Widget",
          subtitle: "Start a new project in the Widget Wizard",
          keywords: ["new", "create"],
          needsInstance: false,
        },
        {
          id: "rename",
          title: "Rename",
          keywords: ["rename"],
        },
      ],
    },
  ]);
  assert(rows.length === 1, "only the action that wants no instance gets its own row");
  assert(rows[0]?.title === "New Widget", "titled by the action, not by the widget");
  assert(rows[0]?.extId === "widget-wizard", "and it still names the extension that runs it");
  assert(
    rows[0]?.subtitle === "Start a new project in the Widget Wizard",
    "the action's subtitle is the row's second line",
  );
}

// --- an action that supersedes its own catalog row ---------------------------
{
  const wizardAction = buildExtensionActionRows([
    {
      id: "widget-wizard",
      title: "Widget Wizard",
      keywords: ["wizard"],
      actions: [
        {
          id: "new-widget",
          title: "New Widget",
          keywords: ["new"],
          needsInstance: false,
          replacesCatalogRow: true,
        },
      ],
    },
  ]);
  const snippetsAction = buildExtensionActionRows([
    {
      id: "snippets",
      title: "Snippets",
      keywords: ["snippet"],
      actions: [
        { id: "expand", title: "Expand Snippet", keywords: ["snippet"], needsInstance: false },
      ],
    },
  ]);
  const catalog = buildTypeRows(
    [
      { id: "widget-wizard", title: "Widget Wizard", keywords: ["wizard"] },
      { id: "snippets", title: "Snippets", keywords: ["snippet"] },
    ],
    [],
  );

  const wizardRows = filterPaletteRows("widget", [], [], catalog, [], [], wizardAction);
  assert(
    wizardRows.filter((row) => row.kind === "type" && row.typeId === "widget-wizard").length === 0,
    "the catalog row is dropped where the action row already opens the widget",
  );
  assert(
    wizardRows.some((row) => row.kind === "extensionAction" && row.actionId === "new-widget"),
    "and the action row is what is left",
  );

  // The case a blanket rule would break: this action fills a template and never
  // opens the card, so the catalog row is the only way to add the widget.
  const snippetRows = filterPaletteRows("snippet", [], [], catalog, [], [], snippetsAction);
  assert(
    snippetRows.some((row) => row.kind === "type" && row.typeId === "snippets"),
    "an instance-less action that does not open its widget keeps the catalog row",
  );

  // Without its own row in these results, nothing is superseded — the catalog
  // row is how the widget is added, and a query that misses the action must not
  // take that away.
  const otherQuery = filterPaletteRows("wizard", [], [], catalog, [], [], []);
  assert(
    otherQuery.some((row) => row.kind === "type" && row.typeId === "widget-wizard"),
    "with no action row present the catalog row stands",
  );
}

// --- action-only extensions ---------------------------------------------
{
  const rows = buildExtensionActionRows([
    {
      id: "confetti",
      title: "Confetti",
      keywords: ["celebrate"],
      actions: [
        {
          id: "launch",
          title: "Launch Confetti",
          keywords: ["party"],
          params: [{ name: "intensity", type: "number", required: false }],
          needsInstance: false,
        },
      ],
    },
  ]);
  const row = filterPaletteRows("confetti", [], [], [], [], [], rows)[0];
  const action = paletteRowAction(row);
  assert(row?.kind === "extensionAction", "action-only extension yields a direct row");
  assert(action?.extId === "confetti", "direct row identifies its extension");
  assert(action?.needsInstance === false, "direct row never creates a widget");
  assert(action?.params[0]?.name === "intensity", "direct row retains action parameters");
}

{
  const rows = buildExtensionActionRows([
    {
      id: "kill-port",
      title: "Kill Port",
      iconUrl: "file://kill-port.svg",
      actions: [
        {
          id: "kill-port",
          title: "Kill Port",
          keywords: ["port"],
          params: [{ name: "port", type: "text", required: true }],
          needsInstance: false,
        },
      ],
    },
  ]);
  assert(rows[0]?.iconUrl === "file://kill-port.svg", "action-only rows keep the catalog icon");
  assert(rows[0]?.params[0]?.required === true, "required port chip is declared");
}

// --- action target resolution ------------------------------------------
{
  const inst = (instanceId: string, typeId: string, isHidden = false): WidgetInstance =>
    ({ instanceId, typeId, offset: { x: 0, y: 0 }, hidden: isHidden }) as WidgetInstance;

  assert(resolveActionTarget("timer", []).mode === "create", "no instance → create one");

  const revealed = resolveActionTarget("timer", [inst("a", "timer", true)]);
  assert(revealed.mode === "reveal" && revealed.instanceId === "a", "hidden → reveal it");

  const used = resolveActionTarget("timer", [inst("a", "timer")]);
  assert(used.mode === "use" && used.instanceId === "a", "visible → use it");

  // Opposite of resolveTypeSmart on purpose.
  const both = resolveActionTarget("timer", [inst("h", "timer", true), inst("v", "timer")]);
  assert(both.mode === "use" && both.instanceId === "v", "visible wins over hidden");

  assert(
    resolveActionTarget("timer", [inst("c", "clock")]).mode === "create",
    "other types are ignored",
  );

  const many = resolveActionTarget("timer", [inst("v1", "timer"), inst("v2", "timer")]);
  assert(many.instanceId === "v1", "several visible → first in order (V1 rule)");
}

// --- the settings-file commands are reachable and route to themselves --------
//
// Two things a comment cannot enforce. First, the palette dispatcher treats the
// `open-settings-` prefix as "open this Settings section", so an id shaped like
// its neighbours would silently open the modal with `file` as a section name
// instead of the file. Second, the whole point of these entries is that someone
// types what they are looking for — "settings.json", "config", "folder" — and
// finds them.
{
  const ids = registeredCommands.map((command) => command.id);
  assert(ids.includes("settings-open-file"), "the open-the-file command is registered");
  assert(ids.includes("settings-reveal-folder"), "the reveal-the-folder command is registered");

  for (const id of ["settings-open-file", "settings-reveal-folder"]) {
    assert(
      !id.startsWith("open-settings-"),
      `${id} must not use the prefix the dispatcher reads as a Settings section`,
    );
  }

  /** Command ids the palette offers for a query, in rank order. */
  const idsFor = (query: string) =>
    filterPaletteRows(query, registeredCommands, [])
      .filter((row): row is Extract<PaletteRow, { kind: "command" }> => row.kind === "command")
      .map((row) => row.commandId);

  assert(
    idsFor("settings.json").includes("settings-open-file"),
    "typing the file name finds the command that opens it",
  );
  assert(
    idsFor("config").includes("settings-open-file"),
    "the word people use for the file finds it too",
  );
  assert(
    idsFor("settings folder").includes("settings-reveal-folder"),
    "asking for the folder finds the reveal command",
  );
  assert(
    idsFor("appdata").includes("settings-reveal-folder"),
    "so does the name of the place it lives",
  );
}

console.log("paletteResults.assert.ts: actions ok");
