/**
 * Quick checks for the inline (in-palette) widget target resolver.
 * Run: npx tsx core/app/palette/inlineWidgetTarget.assert.ts
 */
import {
  inlineScratchInstanceId,
  isInlineScratchInstanceId,
  resolveInlineWidgetTarget,
} from "./inlineWidgetTarget";
import type { PaletteRow, PaletteTypeRow, PaletteWidgetRow } from "./paletteResults";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function widgetRow(partial: Partial<PaletteWidgetRow> = {}): PaletteWidgetRow {
  return {
    kind: "widget",
    id: "widget:a",
    instanceId: "a",
    typeId: "timer",
    title: "Timer",
    subtitle: "Open",
    keywords: [],
    hidden: false,
    onDesks: "Main",
    ...partial,
  };
}

function typeRow(partial: Partial<PaletteTypeRow> = {}): PaletteTypeRow {
  return {
    kind: "type",
    id: "type:timer",
    typeId: "timer",
    title: "Timer",
    subtitle: "Open",
    keywords: [],
    smart: "create",
    canHide: false,
    ...partial,
  };
}

// --- instance rows render themselves -----------------------------------------
{
  const target = resolveInlineWidgetTarget(widgetRow());
  assert(target?.kind === "instance", "an instance row renders that instance");
  assert(target.instanceId === "a", "and keeps its id");
  assert(target.typeId === "timer" && target.title === "Timer", "type and title ride along");
}

// A hidden card still renders inline — the panel is not the desk.
{
  const target = resolveInlineWidgetTarget(widgetRow({ instanceId: "h", hidden: true }));
  assert(
    target?.kind === "instance" && target.instanceId === "h",
    "hidden instances open inline without being un-hidden",
  );
}

// A note-body finding is still the note's instance.
{
  const target = resolveInlineWidgetTarget(
    widgetRow({ typeId: "notes", snippet: "…groceries…" }),
  );
  assert(target?.kind === "instance", "a note finding opens its note");
}

// --- catalog rows ------------------------------------------------------------
// No instance yet: the palette shows its own copy. It must never ask for a new
// layout instance — that is what put a card on the desk.
{
  const target = resolveInlineWidgetTarget(typeRow());
  assert(target?.kind === "scratch", "a catalog row opens the palette's own copy");
  assert(target.typeId === "timer", "and names the type it stands for");
}

// "New Timer" under its own instances is still just the inline view of a Timer.
{
  const target = resolveInlineWidgetTarget(typeRow({ attachedToGroup: true }));
  assert(target?.kind === "scratch", "an attached create row opens inline too");
}

// show/focus rows point at a concrete card, so reuse it instead of scratch.
{
  const shown = resolveInlineWidgetTarget(
    typeRow({ smart: "show", targetInstanceId: "t1", canHide: false }),
  );
  assert(
    shown?.kind === "instance" && shown.instanceId === "t1",
    "a show row reuses its target instance",
  );

  const focused = resolveInlineWidgetTarget(
    typeRow({ smart: "focus", targetInstanceId: "t2", canHide: true }),
  );
  assert(
    focused?.kind === "instance" && focused.instanceId === "t2",
    "a focus row reuses its target instance",
  );
}

// A create row that somehow carries a target stays scratch — smart wins.
{
  const target = resolveInlineWidgetTarget(typeRow({ targetInstanceId: "t3" }));
  assert(target?.kind === "scratch", "smart:create is not overridden by a stale target");
}

// --- scratch ids -------------------------------------------------------------
// Stable per type, so reopening the view finds the same widget state.
{
  const first = inlineScratchInstanceId("notes");
  assert(first === inlineScratchInstanceId("notes"), "the same type gives the same id");
  assert(first !== inlineScratchInstanceId("todo"), "different types do not share one");
  assert(isInlineScratchInstanceId(first), "its own ids are recognised");
  assert(
    !isInlineScratchInstanceId("50e5bfb7-52dd-49a7-828c-6604ab72df2e"),
    "a layout instance id is not a scratch id",
  );
}

// --- rows with no widget behind them ----------------------------------------
{
  const rows: PaletteRow[] = [
    {
      kind: "app",
      id: "app:1",
      title: "Notepad",
      subtitle: "App",
      keywords: [],
      path: "C:/n.exe",
      pinned: false,
      usageBoost: 0,
      rankScore: 1,
    },
    {
      kind: "folder",
      id: "folder:1",
      title: "Docs",
      subtitle: "Folder",
      keywords: [],
      path: "C:/Docs",
      rankScore: 1,
    },
    {
      kind: "path",
      id: "path:1",
      title: "a.txt",
      subtitle: "File",
      keywords: [],
      path: "C:/a.txt",
      isDir: false,
      rankScore: 1,
    },
  ];
  for (const row of rows) {
    assert(resolveInlineWidgetTarget(row) === null, `${row.kind} rows have no inline target`);
  }
  assert(resolveInlineWidgetTarget(undefined) === null, "no selection → no target");
}

console.log("inlineWidgetTarget.assert.ts: ok");
