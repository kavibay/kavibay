/**
 * Session undo stack for widget Hide / Remove (Ctrl+Z when not editing text).
 * Host owns when to push and how to apply; this module is pure.
 */

import type { DeskPlacement, WidgetCatalogEntry } from "./types";

export const WIDGET_CLOSE_UNDO_LIMIT = 5;

/** Soft-hide undo: reveal the same instance id. */
export interface HideCloseUndo {
  kind: "hide";
  instanceId: string;
}

/**
 * Hard-remove undo: restore catalog (if disposed) and the placement rows that
 * were dropped. `disposed` means the catalog entry was removed with the action.
 */
export interface RemoveCloseUndo {
  kind: "remove";
  instanceId: string;
  mode: "desk" | "everywhere";
  disposed: boolean;
  catalog: WidgetCatalogEntry;
  placements: Array<{ deskId: string; placement: DeskPlacement }>;
}

export type WidgetCloseUndoEntry = HideCloseUndo | RemoveCloseUndo;

/** In-memory LIFO stack of close actions (max `limit`). */
export class WidgetCloseHistory {
  private stack: WidgetCloseUndoEntry[] = [];

  constructor(private readonly limit = WIDGET_CLOSE_UNDO_LIMIT) {}

  /** Push a close action; drops oldest when over limit. */
  push(entry: WidgetCloseUndoEntry): void {
    this.stack.push(entry);
    if (this.stack.length > this.limit) {
      this.stack.splice(0, this.stack.length - this.limit);
    }
  }

  get canUndo(): boolean {
    return this.stack.length > 0;
  }

  /** Pop the newest close action, or null when empty. */
  pop(): WidgetCloseUndoEntry | null {
    return this.stack.pop() ?? null;
  }

  /** Newest entry without popping (for tests / debugging). */
  peek(): WidgetCloseUndoEntry | null {
    return this.stack.length > 0 ? this.stack[this.stack.length - 1]! : null;
  }
}
