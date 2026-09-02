/**
 * Pure todo tree helpers: flat parentId/order model, normalize, persist, moves.
 */

export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
  parentId: string | null;
  /** Sibling order among items that share the same parentId. */
  order: number;
  /** When true, children are hidden in the visible walk. */
  collapsed: boolean;
}

export interface TodoWidgetState {
  items: TodoItem[];
  width: number;
  height: number;
}

/** Visible row used by the widget list (tree walk). */
export interface TodoVisibleRow {
  id: string;
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
}

export type DropPlacement = "before" | "after" | "into";

export const DEFAULT_WIDTH = 280;
export const DEFAULT_HEIGHT = 260;
export const MIN_WIDTH = 200;
export const MIN_HEIGHT = 140;
export const MAX_WIDTH = 480;
export const MAX_HEIGHT = 700;
export const MAX_DEPTH = 5;

/** Create a new blank item under a parent. */
export function createItem(parentId: string | null, order: number): TodoItem {
  return {
    id: newId(),
    text: "",
    done: false,
    parentId,
    order,
    collapsed: false,
  };
}

/** Default widget state with one focused-ready blank root. */
export function emptyState(): TodoWidgetState {
  return {
    items: [createItem(null, 0)],
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
  };
}

/** Clamp width/height into allowed bounds. */
export function clampSize(width: number, height: number): { width: number; height: number } {
  const w = Number.isFinite(width) ? width : DEFAULT_WIDTH;
  const h = Number.isFinite(height) ? height : DEFAULT_HEIGHT;
  return {
    width: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(w))),
    height: Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(h))),
  };
}

/** Normalize raw persisted JSON into a safe state. */
export function normalizeState(raw: unknown): TodoWidgetState {
  if (!raw || typeof raw !== "object") return emptyState();
  const o = raw as Record<string, unknown>;
  const size = clampSize(
    typeof o.width === "number" ? o.width : DEFAULT_WIDTH,
    typeof o.height === "number" ? o.height : DEFAULT_HEIGHT,
  );
  const items = normalizeItems(Array.isArray(o.items) ? o.items : []);
  return { items: items.length ? items : [createItem(null, 0)], ...size };
}

/** Flatten item texts for palette search. */
export function itemsToSearchText(items: TodoItem[]): string {
  return items
    .map((i) => i.text.trim())
    .filter(Boolean)
    .join(" ");
}

/** Count completed and open todos, ignoring the widget's empty input rows. */
export function todoItemCounts(items: TodoItem[]): { done: number; open: number } {
  return items.reduce(
    (counts, item) => {
      if (!item.text.trim()) return counts;
      if (item.done) counts.done += 1;
      else counts.open += 1;
      return counts;
    },
    { done: 0, open: 0 },
  );
}

/** Children of a parent, sorted by order. */
export function childrenOf(items: TodoItem[], parentId: string | null): TodoItem[] {
  return items
    .filter((i) => i.parentId === parentId)
    .slice()
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** Depth of an item (root = 0). Missing parent chains stop at root. */
export function depthOf(items: TodoItem[], id: string): number {
  const byId = indexById(items);
  let depth = 0;
  let cur = byId.get(id);
  const seen = new Set<string>();
  while (cur?.parentId) {
    if (seen.has(cur.id)) break;
    seen.add(cur.id);
    depth += 1;
    cur = byId.get(cur.parentId);
  }
  return depth;
}

/** Max depth of a subtree rooted at id (root contributes 0 extra). */
export function subtreeHeight(items: TodoItem[], id: string): number {
  const kids = childrenOf(items, id);
  if (!kids.length) return 0;
  return 1 + Math.max(...kids.map((k) => subtreeHeight(items, k.id)));
}

/** All descendant ids (not including self). */
export function descendantIds(items: TodoItem[], id: string): string[] {
  const out: string[] = [];
  const walk = (parentId: string) => {
    for (const child of childrenOf(items, parentId)) {
      out.push(child.id);
      walk(child.id);
    }
  };
  walk(id);
  return out;
}

/**
 * Visible rows in document order, skipping children of collapsed ancestors.
 */
export function visibleRows(items: TodoItem[]): TodoVisibleRow[] {
  const rows: TodoVisibleRow[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const item of childrenOf(items, parentId)) {
      const kids = childrenOf(items, item.id);
      rows.push({
        id: item.id,
        depth,
        hasChildren: kids.length > 0,
        collapsed: item.collapsed,
      });
      if (!item.collapsed && kids.length) {
        walk(item.id, depth + 1);
      }
    }
  };
  walk(null, 0);
  return rows;
}

/** Set text on one item. */
export function setItemText(items: TodoItem[], id: string, text: string): TodoItem[] {
  return items.map((i) => (i.id === id ? { ...i, text } : i));
}

/**
 * Toggle done. Completing a parent completes all descendants;
 * unchecking only clears the parent.
 */
export function toggleDone(items: TodoItem[], id: string): TodoItem[] {
  const item = items.find((i) => i.id === id);
  if (!item) return items;
  const nextDone = !item.done;
  if (!nextDone) {
    return items.map((i) => (i.id === id ? { ...i, done: false } : i));
  }
  const cascade = new Set([id, ...descendantIds(items, id)]);
  return items.map((i) => (cascade.has(i.id) ? { ...i, done: true } : i));
}

/** Expand/collapse a parent row. */
export function toggleCollapsed(items: TodoItem[], id: string): TodoItem[] {
  return items.map((i) => (i.id === id ? { ...i, collapsed: !i.collapsed } : i));
}

/** Ensure a parent is expanded (e.g. after nesting under it). */
export function expandItem(items: TodoItem[], id: string): TodoItem[] {
  return items.map((i) => (i.id === id ? { ...i, collapsed: false } : i));
}

/**
 * Remove an item and its descendants. Leaves at least one root blank item.
 */
export function removeItem(items: TodoItem[], id: string): TodoItem[] {
  const drop = new Set([id, ...descendantIds(items, id)]);
  const next = reindexOrders(items.filter((i) => !drop.has(i.id)));
  return next.length ? next : [createItem(null, 0)];
}

/**
 * Remove every completed item. Orphaned incomplete children become roots.
 * Leaves at least one blank root when the list would be empty.
 */
export function clearCompleted(items: TodoItem[]): TodoItem[] {
  const kept = items.filter((i) => !i.done);
  if (kept.length === items.length) return items;
  const known = new Set(kept.map((i) => i.id));
  const repaired = kept.map((i) =>
    i.parentId && !known.has(i.parentId) ? { ...i, parentId: null } : i,
  );
  const next = reindexOrders(repaired);
  return next.length ? next : [createItem(null, 0)];
}

/** True when at least one item is marked done. */
export function hasCompleted(items: TodoItem[]): boolean {
  return items.some((i) => i.done);
}

/**
 * Swap with the previous/next sibling (-1 / +1). No-op at edges.
 */
export function moveAmongSiblings(
  items: TodoItem[],
  id: string,
  direction: -1 | 1,
): TodoItem[] {
  const item = items.find((i) => i.id === id);
  if (!item) return items;
  const siblings = childrenOf(items, item.parentId);
  const idx = siblings.findIndex((s) => s.id === id);
  const other = siblings[idx + direction];
  if (!other) return items;
  return moveItem(items, id, other.id, direction < 0 ? "before" : "after");
}

/**
 * Insert a sibling after `afterId` (same parent). Returns { items, newId }.
 */
export function addSiblingAfter(
  items: TodoItem[],
  afterId: string,
): { items: TodoItem[]; newId: string } {
  const after = items.find((i) => i.id === afterId);
  if (!after) {
    const item = createItem(null, childrenOf(items, null).length);
    return { items: [...items, item], newId: item.id };
  }
  const siblings = childrenOf(items, after.parentId);
  const at = siblings.findIndex((s) => s.id === afterId);
  const newbie = createItem(after.parentId, after.order + 1);
  const shifted = items.map((i) => {
    if (i.parentId === after.parentId && i.order > after.order) {
      return { ...i, order: i.order + 1 };
    }
    return i;
  });
  // keep `at` unused but document intent for insert-after
  void at;
  return { items: reindexOrders([...shifted, newbie]), newId: newbie.id };
}

/** Append a new root item. */
export function addRootItem(items: TodoItem[]): { items: TodoItem[]; newId: string } {
  const roots = childrenOf(items, null);
  const item = createItem(null, roots.length ? roots[roots.length - 1]!.order + 1 : 0);
  return { items: reindexOrders([...items, item]), newId: item.id };
}

/**
 * Indent: become last child of the previous sibling.
 * No-op when there is no previous sibling or max depth would be exceeded.
 */
export function indentItem(items: TodoItem[], id: string): TodoItem[] {
  const item = items.find((i) => i.id === id);
  if (!item) return items;
  const siblings = childrenOf(items, item.parentId);
  const idx = siblings.findIndex((s) => s.id === id);
  if (idx <= 0) return items;
  const prev = siblings[idx - 1]!;
  const newDepth = depthOf(items, prev.id) + 1;
  if (newDepth + subtreeHeight(items, id) > MAX_DEPTH) return items;
  const lastChildOrder = childrenOf(items, prev.id).length;
  let next = items.map((i) =>
    i.id === id ? { ...i, parentId: prev.id, order: lastChildOrder } : i,
  );
  next = expandItem(next, prev.id);
  return reindexOrders(next);
}

/**
 * Outdent: become next sibling of the current parent.
 * Children of the outdented item stay attached to it.
 */
export function outdentItem(items: TodoItem[], id: string): TodoItem[] {
  const item = items.find((i) => i.id === id);
  if (!item || item.parentId == null) return items;
  const parent = items.find((i) => i.id === item.parentId);
  if (!parent) return items;
  const next = items.map((i) => {
    if (i.id === id) {
      return { ...i, parentId: parent.parentId, order: parent.order + 1 };
    }
    if (i.parentId === parent.parentId && i.order > parent.order && i.id !== id) {
      return { ...i, order: i.order + 1 };
    }
    return i;
  });
  return reindexOrders(next);
}

/**
 * Move a subtree via drag-drop. Rejects drops on self/descendants
 * and moves that would exceed MAX_DEPTH.
 */
export function moveItem(
  items: TodoItem[],
  dragId: string,
  targetId: string,
  placement: DropPlacement,
): TodoItem[] {
  if (dragId === targetId) return items;
  const drag = items.find((i) => i.id === dragId);
  const target = items.find((i) => i.id === targetId);
  if (!drag || !target) return items;
  const forbidden = new Set(descendantIds(items, dragId));
  if (forbidden.has(targetId)) return items;

  let newParentId: string | null;
  let insertOrder: number;

  if (placement === "into") {
    newParentId = targetId;
    insertOrder = childrenOf(items, targetId).filter((c) => c.id !== dragId).length;
  } else {
    newParentId = target.parentId;
    insertOrder = placement === "before" ? target.order : target.order + 1;
  }

  const parentDepth = newParentId == null ? -1 : depthOf(items, newParentId);
  const newDepth = parentDepth + 1;
  if (newDepth + subtreeHeight(items, dragId) > MAX_DEPTH) return items;

  // Temporarily park the drag node, then reopen a slot at insertOrder.
  let next = items.map((i) => {
    if (i.id === dragId) return { ...i, parentId: newParentId, order: -1 };
    return i;
  });

  next = next.map((i) => {
    if (i.id === dragId) return i;
    if (i.parentId === newParentId && i.order >= insertOrder) {
      return { ...i, order: i.order + 1 };
    }
    return i;
  });

  next = next.map((i) => (i.id === dragId ? { ...i, order: insertOrder } : i));

  if (placement === "into") {
    next = expandItem(next, targetId);
  }

  return reindexOrders(next);
}

/** Pick drop placement from Y offset within a row (0–1). */
export function placementFromYRatio(ratio: number): DropPlacement {
  if (ratio < 0.28) return "before";
  if (ratio > 0.72) return "after";
  return "into";
}

/** Reassign contiguous 0..n-1 orders per parent group. */
export function reindexOrders(items: TodoItem[]): TodoItem[] {
  const groups = new Map<string | null, TodoItem[]>();
  for (const item of items) {
    const key = item.parentId;
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  const orderById = new Map<string, number>();
  for (const [, list] of groups) {
    list
      .slice()
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
      .forEach((item, index) => orderById.set(item.id, index));
  }
  return items.map((i) => ({ ...i, order: orderById.get(i.id) ?? i.order }));
}

/** Coerce a raw items array into valid TodoItems with repaired links. */
function normalizeItems(raw: unknown[]): TodoItem[] {
  const ids = new Set<string>();
  const items: TodoItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const o = entry as Record<string, unknown>;
    const id = typeof o.id === "string" && o.id ? o.id : newId();
    if (ids.has(id)) continue;
    ids.add(id);
    items.push({
      id,
      text: typeof o.text === "string" ? o.text : "",
      done: o.done === true,
      parentId: typeof o.parentId === "string" ? o.parentId : null,
      order: typeof o.order === "number" && Number.isFinite(o.order) ? o.order : items.length,
      collapsed: o.collapsed === true,
    });
  }

  // Drop parent links that point nowhere (orphan → root).
  const known = new Set(items.map((i) => i.id));
  const linked = items.map((i) =>
    i.parentId && !known.has(i.parentId) ? { ...i, parentId: null } : i,
  );
  return reindexOrders(breakCycles(linked));
}

/** Break parent cycles by detaching the later node to root. */
function breakCycles(items: TodoItem[]): TodoItem[] {
  const byId = indexById(items);
  return items.map((item) => {
    const seen = new Set<string>();
    let cur: TodoItem | undefined = item;
    while (cur?.parentId) {
      if (seen.has(cur.id)) {
        return { ...item, parentId: null };
      }
      seen.add(cur.id);
      cur = byId.get(cur.parentId);
    }
    return item;
  });
}

function indexById(items: TodoItem[]): Map<string, TodoItem> {
  return new Map(items.map((i) => [i.id, i]));
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `todo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
