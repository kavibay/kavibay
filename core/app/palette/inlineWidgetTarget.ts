/**
 * Which widget an inline open (Ctrl/Cmd+Enter in the palette) should render.
 *
 * Its own module rather than a branch in the component: this is the one place
 * that decides whether the chord reuses an instance or falls back to the
 * palette's own copy, and getting it wrong either opens somebody else's widget
 * or litters the desk with cards nobody asked for.
 */
import type { PaletteRow } from "./paletteResults";

/** Marks an instance id as the palette's, not the layout's. */
const SCRATCH_PREFIX = "palette-inline:";

/**
 * Instance id for the palette's own copy of a type.
 *
 * Derived from the type rather than random, so the widget's state — which every
 * extension keys by instance id — survives closing and reopening the view. One
 * scratch widget per type is the whole budget, so nothing accumulates.
 */
export function inlineScratchInstanceId(typeId: string): string {
  return `${SCRATCH_PREFIX}${typeId}`;
}

/** True for ids minted by `inlineScratchInstanceId` (never a layout instance). */
export function isInlineScratchInstanceId(instanceId: string): boolean {
  return instanceId.startsWith(SCRATCH_PREFIX);
}

/**
 * An existing instance to render, or a type with none — which the palette shows
 * as its own scratch copy rather than by creating a desk card.
 */
export type InlineWidgetTarget =
  | { kind: "instance"; instanceId: string; typeId: string; title: string }
  | { kind: "scratch"; typeId: string; title: string };

/**
 * Resolve the inline target of a result row, or null when the row has no widget
 * behind it (apps, files, folders and OS commands).
 *
 * A hidden instance resolves like any other: rendering it in the panel is not
 * the same as putting its card back on the desk, so inline open deliberately
 * leaves the Hidden flag alone. An instance on *another* desk is different: it
 * is not mounted here at all, so it resolves to null.
 *
 * A catalog row resolves to `scratch` rather than to "create an instance". The
 * layout has no home for an instance that is deliberately on no desk — the host
 * treats hidden-everywhere instances as leftovers and purges them on load
 * (`purgeRedundantHiddenInstances`) — so inline open of a type the user does not
 * own yet must not mint one.
 */
export function resolveInlineWidgetTarget(
  row: PaletteRow | undefined,
): InlineWidgetTarget | null {
  if (!row) return null;

  if (row.kind === "widget") {
    // Parked on another desk, so it is not mounted: there is no live widget to
    // render in the panel. Enter on such a row places it here first.
    if (row.offDesk) return null;
    return {
      kind: "instance",
      instanceId: row.instanceId,
      typeId: row.typeId,
      title: row.title,
    };
  }

  if (row.kind === "type") {
    if (row.smart !== "create" && row.targetInstanceId) {
      return {
        kind: "instance",
        instanceId: row.targetInstanceId,
        typeId: row.typeId,
        title: row.title,
      };
    }
    return { kind: "scratch", typeId: row.typeId, title: row.title };
  }

  return null;
}
