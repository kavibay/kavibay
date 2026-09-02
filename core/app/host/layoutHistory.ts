/**
 * Undo/redo snapshots for layout geometry (move + resize only).
 * Pure helpers — host owns when to capture and apply.
 */

import type { WidgetInstance, WidgetPosition } from "./types";

const DEFAULT_MAX_DEPTH = 40;

/** Geometry fields that move/resize gestures change. */
export interface LayoutGeometrySnapshot {
  palette: WidgetPosition;
  paletteWidth?: number;
  paletteListHeight?: number;
  instances: Array<{
    instanceId: string;
    offset: WidgetPosition;
    width?: number;
    height?: number;
    contentScale?: number;
  }>;
}

/** Live layout fields needed to capture geometry. */
export interface LayoutGeometrySource {
  palette: WidgetPosition;
  paletteWidth?: number;
  paletteListHeight?: number;
  instances: WidgetInstance[];
}

/** Mutable layout target for applying a snapshot (refs via setters). */
export interface LayoutGeometryTarget {
  palette: WidgetPosition;
  instances: WidgetInstance[];
  setPaletteWidth: (width: number | undefined) => void;
  setPaletteListHeight: (height: number | undefined) => void;
}

/** Deep-clone the move/resize-relevant geometry from live layout state. */
export function captureLayoutGeometry(
  source: LayoutGeometrySource,
): LayoutGeometrySnapshot {
  return {
    palette: { x: source.palette.x, y: source.palette.y },
    ...(typeof source.paletteWidth === "number"
      ? { paletteWidth: source.paletteWidth }
      : {}),
    ...(typeof source.paletteListHeight === "number"
      ? { paletteListHeight: source.paletteListHeight }
      : {}),
    instances: source.instances.map((i) => ({
      instanceId: i.instanceId,
      offset: { x: i.offset.x, y: i.offset.y },
      ...(typeof i.width === "number" ? { width: i.width } : {}),
      ...(typeof i.height === "number" ? { height: i.height } : {}),
      ...(typeof i.contentScale === "number"
        ? { contentScale: i.contentScale }
        : {}),
    })),
  };
}

/** True when two geometry snapshots describe the same layout. */
export function layoutGeometryEqual(
  a: LayoutGeometrySnapshot,
  b: LayoutGeometrySnapshot,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Write snapshot geometry onto live instances/palette.
 * Matches by instanceId; unknown ids in the snapshot are ignored.
 */
export function applyLayoutGeometry(
  target: LayoutGeometryTarget,
  snapshot: LayoutGeometrySnapshot,
): void {
  target.palette.x = snapshot.palette.x;
  target.palette.y = snapshot.palette.y;
  target.setPaletteWidth(
    typeof snapshot.paletteWidth === "number" ? snapshot.paletteWidth : undefined,
  );
  target.setPaletteListHeight(
    typeof snapshot.paletteListHeight === "number"
      ? snapshot.paletteListHeight
      : undefined,
  );

  const byId = new Map(snapshot.instances.map((i) => [i.instanceId, i]));
  for (const instance of target.instances) {
    const geo = byId.get(instance.instanceId);
    if (!geo) continue;
    instance.offset = { x: geo.offset.x, y: geo.offset.y };
    if (typeof geo.width === "number") instance.width = geo.width;
    else delete instance.width;
    if (typeof geo.height === "number") instance.height = geo.height;
    else delete instance.height;
    if (typeof geo.contentScale === "number") {
      instance.contentScale = geo.contentScale;
    } else {
      delete instance.contentScale;
    }
  }
}

/** In-memory undo/redo stacks of pre-gesture geometry snapshots. */
export class LayoutGeometryHistory {
  private undoStack: LayoutGeometrySnapshot[] = [];
  private redoStack: LayoutGeometrySnapshot[] = [];

  constructor(private readonly maxDepth = DEFAULT_MAX_DEPTH) {}

  /** Record state from before a completed move/resize (clears redo). */
  pushBefore(before: LayoutGeometrySnapshot): void {
    this.undoStack.push(before);
    if (this.undoStack.length > this.maxDepth) {
      this.undoStack.splice(0, this.undoStack.length - this.maxDepth);
    }
    this.redoStack = [];
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * Pop undo → return snapshot to apply; `current` goes onto redo.
   * Returns null when the undo stack is empty.
   */
  undo(current: LayoutGeometrySnapshot): LayoutGeometrySnapshot | null {
    const prev = this.undoStack.pop();
    if (!prev) return null;
    this.redoStack.push(current);
    return prev;
  }

  /**
   * Pop redo → return snapshot to apply; `current` goes onto undo.
   * Returns null when the redo stack is empty.
   */
  redo(current: LayoutGeometrySnapshot): LayoutGeometrySnapshot | null {
    const next = this.redoStack.pop();
    if (!next) return null;
    this.undoStack.push(current);
    return next;
  }
}
