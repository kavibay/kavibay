import { DEMO_HOME } from "./demoFiles";

/**
 * `action` is a widget's contributed action — "New Widget" is one, declared in
 * `extensions/widget-wizard/manifest.json`. It is kept apart from `command`
 * because an action opens the widget that contributes it, and apart from
 * `widget` because it is not an instance on a desk.
 *
 * `folder` is the only kind you can descend into. It covers both of the app's
 * browsable rows — a well-known folder from the catalog and a directory found
 * inside one — because from the palette's side they behave identically: Tab
 * takes you in.
 */
export type DemoKind = "app" | "file" | "folder" | "command" | "widget" | "action";

export interface DemoRow {
  id: string;
  kind: DemoKind;
  title: string;
  /** Extra strings fuzzy.ts is scored against, the way real keywords are. */
  keywords: string[];
  /**
   * Right-aligned end of the row, where the app puts an extension action's
   * own description. Not a location — see `folderLabel` for that.
   */
  subtitle?: string;
  /** Absolute path; folder rows and file rows carry one, nothing else does. */
  path?: string;
  /**
   * Brand mark to draw instead of the generic app square, where the app itself
   * would show the executable's shell icon. Named rather than free-form: a
   * logo is a trademark, and this list stays as short as the demo needs.
   */
  brand?: "spotify";
  /**
   * Second line of a browsed file row: its size. Empty for a directory, the
   * way `fileEntriesToRows` leaves it — the folder mark already says what it
   * is, and a folder has no size worth printing.
   */
  sizeLabel?: string;
  /**
   * Containing folder, drawn with the folder glyph. Set when the row was found
   * somewhere other than the folder being browsed, which is what tells two
   * hits of one recursive search apart.
   */
  folderLabel?: string;
  /** Right-aligned sort value — whatever the list is currently ordered by. */
  meta?: string;
  /**
   * The kind line under the title, which in the app only a well-known folder
   * row carries. A directory found *inside* one says nothing there: the mark
   * beside it and the folder you are browsing have already said it.
   */
  kindLabel?: string;
  /**
   * The one argument an action row takes, copied from its manifest.
   *
   * Tab turns it into a live chip beside the query and Enter runs the action
   * with what was typed. One rather than a list because that is what the two
   * actions in this demo declare; the app's `argParams` is an array.
   */
  param?: { name: string; placeholder: string };
  /**
   * `false` for a shared action that targets no card — the manifest flag, and
   * the reason the Wizard's "New Widget" runs with an empty instance id while
   * "New Note" runs against the card it is about to fill.
   */
  needsInstance?: boolean;
}

/**
 * Hand-rolled rows. Not catalog-shaped on purpose: `paletteResults.ts` is on
 * the refused-import list because it reaches the registry, and the registry
 * reaches the extension glob.
 *
 * A `widget` row's id is also what reopens a closed `<kavibay-widget>` on the
 * page — the element listens for its own definition name. So the ids of the
 * widget rows are not decoration: `todo` here and
 * `<kavibay-widget definition="todo">` are the same widget, and a row whose id
 * matches no mounted element simply opens nothing.
 */
export const DEMO_ROWS: DemoRow[] = [
  { id: "chrome", kind: "app", title: "Google Chrome", keywords: ["browser"] },
  { id: "code", kind: "app", title: "Visual Studio Code", keywords: ["vscode", "editor"] },
  /**
   * The one app row that carries its real logo.
   *
   * On a desktop an app row shows the executable's own shell icon — that is
   * what `fileTypeIcons.ts` fetches, and a browser can fetch none of it. The
   * launcher script types this name, so this row is the one somebody actually
   * looks at, and the drawn grey square underneath it says "a placeholder" in
   * a section whose whole claim is that this is the real thing.
   *
   * The mark is the SDK's own `SpotifyMark.vue`, not a second copy: the logo
   * is a trademark and belongs to one file. See THIRD-PARTY-NOTICES.md — a
   * licence on an SVG grants no trademark rights.
   */
  { id: "spotify", kind: "app", title: "Spotify", brand: "spotify", keywords: ["music"] },
  { id: "notes", kind: "widget", title: "Notes", keywords: ["write", "markdown"] },
  { id: "todo", kind: "widget", title: "Todo", keywords: ["tasks"] },
  { id: "clock", kind: "widget", title: "Clock", keywords: ["time"] },
  { id: "wizard", kind: "widget", title: "Widget Wizard", keywords: ["generate", "ai"] },
  /**
   * The Wizard's own contributed action, copied from its manifest — same id,
   * title, subtitle and keywords. Typing "new widget" in the app reaches this
   * row, so it reaches this one too.
   */
  {
    id: "new-widget",
    kind: "action",
    title: "New Widget",
    subtitle: "Start a new project in the Widget Wizard",
    keywords: ["new", "widget", "wizard", "create", "build", "generate", "project"],
    needsInstance: false,
  },
  /**
   * The Notes widget's action, copied from `extensions/notes/manifest.json`
   * the same way — id, title, subtitle, keywords, and its one parameter with
   * the placeholder the manifest gives it.
   *
   * It declares no `needsInstance`, so it targets a card: the handler writes
   * the markdown into that instance's `ctx.data`, and the card renders it when
   * it opens. `<kavibay-widget opens-on="new-note">` on the page is the card.
   */
  {
    id: "new-note",
    kind: "action",
    title: "New Note",
    subtitle: "Jot something down",
    keywords: ["note", "notes", "jot", "write", "capture"],
    param: { name: "text", placeholder: "Note text" },
  },
  { id: "calculator", kind: "widget", title: "Calculator", keywords: ["math", "rechner"] },
  { id: "timer", kind: "widget", title: "Timer", keywords: ["countdown"] },
  { id: "stopwatch", kind: "widget", title: "Stopwatch", keywords: ["lap", "stoppuhr"] },
  { id: "pomodoro", kind: "widget", title: "Pomodoro", keywords: ["focus", "tomato"] },
  { id: "emoji-picker", kind: "widget", title: "Emoji Picker", keywords: ["emoji", "smiley"] },
  { id: "gallery", kind: "widget", title: "Widget Gallery", keywords: ["browse", "catalog"] },
  { id: "redacted", kind: "widget", title: "Redacted", keywords: ["blur", "hide", "privacy"] },
  { id: "snake", kind: "widget", title: "Snake", keywords: ["game", "play"] },
  { id: "time-tracker", kind: "widget", title: "Time Tracker", keywords: ["hours", "log"] },
  { id: "set-timer", kind: "command", title: "Set Timer", keywords: ["countdown", "start"] },
  { id: "settings", kind: "command", title: "Settings", keywords: ["preferences"] },
  /**
   * The four folders the app's own catalog starts with (`knownFolders.ts`),
   * with its aliases. Their paths are the roots of the invented disk in
   * `demoFiles.ts`, so Tab on one of these rows lands in a folder that has
   * something in it.
   */
  {
    id: "folder:desktop",
    kind: "folder",
    kindLabel: "Folder",
    title: "Desktop",
    path: `${DEMO_HOME}\\Desktop`,
    keywords: ["desktop", "schreibtisch"],
  },
  {
    id: "folder:documents",
    kind: "folder",
    kindLabel: "Folder",
    title: "Documents",
    path: `${DEMO_HOME}\\Documents`,
    keywords: ["documents", "document", "docs", "dokumente"],
  },
  {
    id: "folder:downloads",
    kind: "folder",
    kindLabel: "Folder",
    title: "Downloads",
    path: `${DEMO_HOME}\\Downloads`,
    keywords: ["downloads", "download", "dl"],
  },
  {
    id: "folder:projects",
    kind: "folder",
    kindLabel: "Folder",
    title: "Projects",
    path: `${DEMO_HOME}\\Projects`,
    keywords: ["projects", "code", "repos"],
  },
  {
    id: "readme",
    kind: "file",
    title: "README.md",
    path: `${DEMO_HOME}\\Documents\\README.md`,
    folderLabel: "Documents",
    keywords: ["docs"],
  },
  {
    id: "timesheet",
    kind: "file",
    title: "timesheet-2026.xlsx",
    path: `${DEMO_HOME}\\Desktop\\timesheet-2026.xlsx`,
    folderLabel: "Desktop",
    keywords: ["sheet"],
  },
  /**
   * The widget the Wizard demo builds. Its id is the draft's, so the row that
   * opens it and the package it opens are the same name.
   */
  {
    id: "water-tracker",
    kind: "widget",
    title: "Water",
    /**
     * "water tracker" is in the list as a phrase, not only as two words.
     * `fuzzyMatch` scores a query against one string at a time, so a
     * two-word query matches neither the title nor either single keyword —
     * the tour typed it and the palette found nothing.
     */
    keywords: ["water tracker", "water", "tracker", "hydration", "drink"],
  },
  {
    id: "inbox",
    kind: "widget",
    title: "Inbox",
    /**
     * The Linear/GitHub demo types this as one word. Keep the accounts in
     * the keywords so a visitor who searches for either still finds it.
     */
    keywords: ["inbox", "tasks", "linear", "github", "reviews", "prs"],
  },
];
