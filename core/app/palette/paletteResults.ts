import type { Component } from "vue";
import type { ActionParam, ExtensionAction } from "@sdk/types";
import type { Command } from "./commands";
import { fuzzyMatch } from "./fuzzy";
import type { WidgetInstance } from "../host/types";

/** Minimal catalog shape for type rows (builtin or runtime HostExtensionRef). */
export type PaletteTypeCatalogEntry = {
  id: string;
  title: string;
  keywords?: readonly string[];
  /** Resolved icon URL when the extension declares manifest.icon. */
  iconUrl?: string;
  /**
   * Inline icon component, first-party extensions only. Unlike `inlineView`
   * this is catalog data, not row data — the palette looks it up by type id at
   * render time, so rows stay plain JSON.
   */
  iconComponent?: Component;
  /** Palette actions; they ride on the type row instead of getting their own. */
  actions?: readonly ExtensionAction[];
};

/**
 * The palette's widget catalog: built-in extensions plus enabled runtime
 * packages.
 *
 * Runtime packages were absent from this list entirely, which made "enabled"
 * and "usable" two different things — a widget could be installed, granted and
 * running and still be impossible to add, because the only place a person picks
 * a widget never knew it existed.
 *
 * Both sources pass through the same per-extension enable toggle. Ids collide
 * on purpose: a built-in wins, since a package cannot shadow shipped code.
 */
export function mergePaletteCatalog(
  builtin: readonly PaletteTypeCatalogEntry[],
  runtime: readonly PaletteTypeCatalogEntry[],
  isEnabled: (id: string) => boolean,
): PaletteTypeCatalogEntry[] {
  const seen = new Set(builtin.map((entry) => entry.id));
  return [
    ...builtin,
    ...runtime.filter((entry) => !seen.has(entry.id) && isEnabled(entry.id)),
  ];
}

/** Command row in the unified palette list (OS commands only). */
export interface PaletteCommandRow {
  kind: "command";
  id: string;
  title: string;
  subtitle?: string;
  keywords: string[];
  commandId: string;
  /** Normalized to []; non-empty means Tab opens argument chips. */
  params: ActionParam[];
  /** Direct Tauri command instead of `execute_action`. */
  invokeCommand?: string;
}

/** Palette row for an action-only extension (no widget instance is created). */
export interface PaletteExtensionActionRow {
  kind: "extensionAction";
  id: string;
  extId: string;
  actionId: string;
  title: string;
  subtitle?: string;
  keywords: string[];
  /** Action-only extensions also need palette argument chips. */
  params: ActionParam[];
  /** Resolved icon URL when the extension declares manifest.icon. */
  iconUrl?: string;
  /**
   * This action is how the extension's widget gets opened, so its catalog row
   * is redundant beside it. Declared, never inferred — see `replacesCatalogRow`
   * in `WidgetActionDeclaration`.
   */
  replacesCatalogRow?: boolean;
}

/** Widget-instance row in the unified palette list. */
export interface PaletteWidgetRow {
  kind: "widget";
  id: string;
  instanceId: string;
  typeId: string;
  title: string;
  subtitle: string;
  keywords: string[];
  hidden: boolean;
  /** Desk names where this instance is placed (e.g. "Main" or "Main, Work"). */
  onDesks: string;
  /** Inline preview when the query matched note body text. */
  snippet?: string;
  /** Current plain-text content shown for Notes widget rows. */
  notePreview?: string;
  /** First declared extension action, available directly on this instance row. */
  action?: ExtensionAction;
}

/** Smart-open intent for a registry type row. */
export type PaletteTypeSmart = "show" | "focus" | "create";

/** Registry type row — open / focus / create even with zero instances. */
export interface PaletteTypeRow {
  kind: "type";
  id: string;
  typeId: string;
  title: string;
  /** Primary action label (Enter): Open / Show / Focus. */
  subtitle: string;
  keywords: string[];
  smart: PaletteTypeSmart;
  /** Instance to show/focus/hide when smart is show|focus. */
  targetInstanceId?: string;
  /** When true, H hides `targetInstanceId` (visible instance). */
  canHide: boolean;
  /** Resolved extension icon URL; missing → generic widget mark. */
  iconUrl?: string;
  /**
   * The extension's action, reachable with Tab on this row. An extension gets
   * exactly one palette row, so only the first declared action rides along —
   * a second action would need a picker.
   */
  action?: ExtensionAction;
  /**
   * Set by `groupInstancesWithCreateRow` when this create row was pulled under
   * instance rows of its own type. The palette renders those compactly — next
   * to real instances a full-weight row reads as a third widget, not as the
   * action that makes one.
   */
  attachedToGroup?: boolean;
}

/** Installed Windows app row — launch via `launch_path`. */
export interface PaletteAppRow {
  kind: "app";
  id: string;
  title: string;
  subtitle: string;
  keywords: string[];
  path: string;
  pinned: boolean;
  /** Extra score from habitual palette launches (0 if one-off / unused). */
  usageBoost: number;
  /** Final rank score from buildAppRows (fuzzy + pin + usage); avoid re-fuzzy. */
  rankScore: number;
  /** True when listed only after expanding "Show more" hidden matches. */
  fromHiddenSearch?: boolean;
}

/** Well-known folder row — open in Explorer via `launch_path`. */
export interface PaletteFolderRow {
  kind: "folder";
  id: string;
  title: string;
  subtitle: string;
  keywords: string[];
  path: string;
  /** Final rank score from buildFolderRows; avoid re-fuzzy. */
  rankScore: number;
}

/** Path-autocomplete row from `list_path_completions`. */
export interface PalettePathRow {
  kind: "path";
  id: string;
  title: string;
  subtitle: string;
  keywords: string[];
  path: string;
  isDir: boolean;
  rankScore: number;
  /** Last write time (epoch ms); null when it could not be read. Sort key. */
  modifiedMs?: number | null;
  /** Bytes, 0 for directories. Sort key. */
  size?: number;
  /**
   * Containing folder, set only when it is not the one being browsed. Kept
   * apart from `subtitle` because it renders with a folder glyph — a location
   * and a file size are two facts, not one string.
   */
  parentLabel?: string;
}

export type PaletteRow =
  | PaletteCommandRow
  | PaletteExtensionActionRow
  | PaletteWidgetRow
  | PaletteTypeRow
  | PaletteAppRow
  | PaletteFolderRow
  | PalettePathRow;

/** Map Rust path completions into palette rows (Files). */
export function pathCompletionsToRows(
  entries: {
    name: string;
    path: string;
    isDir: boolean;
    modifiedMs?: number | null;
    size?: number;
  }[],
): PalettePathRow[] {
  return entries.map((entry, index) => ({
    kind: "path" as const,
    id: `path:${entry.path}`,
    title: entry.name,
    subtitle: entry.isDir ? "Folder" : "File",
    keywords: [entry.name],
    path: entry.path,
    isDir: entry.isDir,
    // Keep completion order (dirs first from Rust); slight decay by index.
    rankScore: 10_000 - index,
    modifiedMs: entry.modifiedMs ?? null,
    size: entry.size ?? 0,
  }));
}

/**
 * What running the selected row's action needs, independent of row kind.
 * Type rows carry an extension action; command rows are OS actions.
 */
export type PaletteRowAction = {
  /** Present for extension actions; absent for OS commands. */
  extId?: string;
  /** Action id (extension) or command id (OS). */
  actionId: string;
  params: ActionParam[];
  needsInstance: boolean;
  /** Exact widget target when an action is invoked from an instance row. */
  instanceId?: string;
  /** Direct Tauri command instead of `execute_action`. */
  invokeCommand?: string;
};

/**
 * The action reachable from one row, or null when there is none.
 * An extension owns a single palette row, so its action hangs off the type row
 * instead of competing with it as a second entry.
 */
export function paletteRowAction(row: PaletteRow | undefined): PaletteRowAction | null {
  if (!row) return null;

  if (row.kind === "type") {
    if (!row.action) return null;
    return {
      extId: row.typeId,
      actionId: row.action.id,
      params: row.action.params ?? [],
      needsInstance: row.action.needsInstance !== false,
    };
  }

  if (row.kind === "widget" && row.action) {
    return {
      extId: row.typeId,
      actionId: row.action.id,
      params: row.action.params ?? [],
      needsInstance: row.action.needsInstance !== false,
      instanceId: row.instanceId,
    };
  }

  if (row.kind === "extensionAction") {
    return {
      extId: row.extId,
      actionId: row.actionId,
      params: row.params,
      needsInstance: false,
    };
  }

  if (row.kind === "command" && row.params.length > 0) {
    return {
      actionId: row.commandId,
      params: row.params,
      needsInstance: false,
      ...(row.invokeCommand ? { invokeCommand: row.invokeCommand } : {}),
    };
  }

  return null;
}

/**
 * The single place a `Command` becomes a palette row — used by the search
 * filter and by the recents list, so both carry the same action fields.
 */
export function toCommandRow(command: Command): PaletteCommandRow {
  return {
    kind: "command",
    id: command.id,
    title: command.title,
    subtitle: command.subtitle,
    keywords: command.keywords,
    commandId: command.id,
    params: command.params ?? [],
    ...(command.invokeCommand ? { invokeCommand: command.invokeCommand } : {}),
  };
}

/** How an action reaches its target instance. */
export type ActionTarget = {
  mode: "use" | "reveal" | "create";
  instanceId?: string;
};

/**
 * Resolve which instance an action runs against.
 *
 * Visible wins over hidden — deliberately the opposite of `resolveTypeSmart`:
 * a widget on screen is the one the user means, whereas smart-open is about
 * bringing something back. Do not "align" these two.
 */
export function resolveActionTarget(
  typeId: string,
  instances: readonly WidgetInstance[],
): ActionTarget {
  const ofType = instances.filter((item) => item.typeId === typeId);

  const visible = ofType.find((item) => item.hidden !== true);
  if (visible) return { mode: "use", instanceId: visible.instanceId };

  const hidden = ofType.find((item) => item.hidden === true);
  if (hidden) return { mode: "reveal", instanceId: hidden.instanceId };

  return { mode: "create" };
}

/**
 * Decide smart-open for one widget type given current instances.
 * Prefer show-first-hidden, else focus-first-visible, else create.
 */
export function resolveTypeSmart(
  typeId: string,
  instances: WidgetInstance[],
): { smart: PaletteTypeSmart; targetInstanceId?: string } {
  const ofType = instances.filter((item) => item.typeId === typeId);
  const hidden = ofType.find((item) => item.hidden === true);
  if (hidden) {
    return { smart: "show", targetInstanceId: hidden.instanceId };
  }
  const visible = ofType.find((item) => item.hidden !== true);
  if (visible) {
    return { smart: "focus", targetInstanceId: visible.instanceId };
  }
  return { smart: "create" };
}

/** Subtitle copy for a type row’s smart intent. */
export function subtitleForSmart(smart: PaletteTypeSmart): string {
  // "Show" only when a soft-hidden instance can be revealed; create uses New.
  if (smart === "show") return "Show widget";
  if (smart === "focus") return "Focus widget";
  return "New widget";
}

/** Short action label for + menu rows (Show / Focus / New). */
export function actionLabelForSmart(smart: PaletteTypeSmart): string {
  if (smart === "show") return "Show";
  if (smart === "focus") return "Focus";
  return "New";
}

/** + menu filter chip: all types, types with visible instances, or soft-hidden. */
export type AddMenuFilter = "all" | "open" | "hidden";

/**
 * Whether a registry type belongs in the + menu filter on the active desk.
 * Open = ≥1 visible; Hidden = ≥1 soft-hidden; types with both match both filters.
 */
export function typeMatchesAddFilter(
  typeId: string,
  instances: WidgetInstance[],
  filter: AddMenuFilter,
): boolean {
  if (filter === "all") return true;
  const ofType = instances.filter((item) => item.typeId === typeId);
  if (filter === "open") return ofType.some((item) => item.hidden !== true);
  return ofType.some((item) => item.hidden === true);
}

/**
 * Smart action for + menu rows, scoped to the active filter chip.
 * Hidden always targets a soft-hidden instance (Show); Open targets a visible one (Focus).
 * All keeps the global prefer-hidden → prefer-visible → create order.
 */
export function resolveTypeSmartForFilter(
  typeId: string,
  instances: WidgetInstance[],
  filter: AddMenuFilter,
): { smart: PaletteTypeSmart; targetInstanceId?: string } {
  const ofType = instances.filter((item) => item.typeId === typeId);
  if (filter === "hidden") {
    const hidden = ofType.find((item) => item.hidden === true);
    if (hidden) {
      return { smart: "show", targetInstanceId: hidden.instanceId };
    }
  }
  if (filter === "open") {
    const visible = ofType.find((item) => item.hidden !== true);
    if (visible) {
      return { smart: "focus", targetInstanceId: visible.instanceId };
    }
  }
  return resolveTypeSmart(typeId, instances);
}

/**
 * Build one catalog row per registered extension.
 * Smart intent depends on whether instances of that type exist.
 */
export function buildTypeRows(
  extensions: PaletteTypeCatalogEntry[],
  instances: WidgetInstance[],
): PaletteTypeRow[] {
  return extensions.map((ext) => {
    const { smart, targetInstanceId } = resolveTypeSmart(ext.id, instances);
    // Do not index description: loose subsequence fuzzy matching turns prose into
    // false hits (e.g. "snake" inside "Focus timer with work and break sessions.").
    const action = ext.actions?.[0];
    // The action's own words search the same row — "start"/"stop" must find
    // Pomodoro, without the action becoming a second row for one extension.
    const keywords = [
      ext.id,
      ext.title,
      ...(ext.keywords ?? []),
      ...(action ? [action.title, ...(action.keywords ?? [])] : []),
    ];
    return {
      kind: "type",
      id: `type:${ext.id}`,
      typeId: ext.id,
      title: ext.title,
      subtitle: subtitleForSmart(smart),
      keywords,
      smart,
      canHide: smart === "focus" && Boolean(targetInstanceId),
      ...(targetInstanceId ? { targetInstanceId } : {}),
      ...(ext.iconUrl ? { iconUrl: ext.iconUrl } : {}),
      ...(action ? { action } : {}),
    };
  });
}

/**
 * Create rows for the search list — one per extension, always create, always
 * ranked under that type's instance rows.
 *
 * The row is titled with the bare type name. It used to read "Open new Timer",
 * which spent the most prominent text in the row on what the row's own New
 * button and Widget label already say.
 *
 * Kept separate from `buildTypeRows`: that row is the smart show/focus/create
 * entry the + menu and the MRU list need, where creating would be a lie.
 */
export function buildOpenNewRows(
  extensions: PaletteTypeCatalogEntry[],
): PaletteTypeRow[] {
  return extensions.map((ext) => {
    const action = ext.actions?.[0];
    const keywords = [
      ext.id,
      ext.title,
      ...(ext.keywords ?? []),
      ...(action ? [action.title, ...(action.keywords ?? [])] : []),
    ];
    return {
      kind: "type",
      id: `type:${ext.id}`,
      typeId: ext.id,
      title: ext.title,
      subtitle: subtitleForSmart("create"),
      keywords,
      smart: "create",
      canHide: false,
      ...(ext.iconUrl ? { iconUrl: ext.iconUrl } : {}),
      ...(action ? { action } : {}),
    };
  });
}

/**
 * The empty-query widget overview is a compact inventory, not a search rank.
 * Keep placed cards first so their Focus/Show actions are immediately useful,
 * then offer the full catalog as explicit New actions.
 */
export function buildWidgetOverviewRows(
  instances: PaletteWidgetRow[],
  types: PaletteTypeRow[],
): PaletteRow[] {
  return [
    ...instances.filter((row) => !row.hidden),
    ...instances.filter((row) => row.hidden),
    ...types,
  ];
}

/**
 * Pull each create row down to just below the last instance row of that type,
 * keeping relative order otherwise.
 *
 * Score alone cannot do this: the create row's title is the type name, so it
 * ties with an instance called the same thing and wins the kind tie-break —
 * "Timer" would land above the timer that is actually running.
 */
export function groupInstancesWithCreateRow(rows: PaletteRow[]): PaletteRow[] {
  const lastInstanceIndex = new Map<string, number>();
  rows.forEach((row, index) => {
    if (row.kind === "widget") lastInstanceIndex.set(row.typeId, index);
  });

  const createRows = new Map<string, PaletteTypeRow>();
  const rest: PaletteRow[] = [];
  for (const row of rows) {
    if (row.kind === "type" && lastInstanceIndex.has(row.typeId)) {
      createRows.set(row.typeId, row);
      continue;
    }
    rest.push(row);
  }
  if (createRows.size === 0) return rows;

  // Re-index against `rest` — dropping the create rows shifted every position.
  const lastInRest = new Map<string, number>();
  rest.forEach((row, index) => {
    if (row.kind === "widget") lastInRest.set(row.typeId, index);
  });

  const out: PaletteRow[] = [];
  rest.forEach((row, index) => {
    out.push(row);
    if (row.kind !== "widget" || lastInRest.get(row.typeId) !== index) return;
    const createRow = createRows.get(row.typeId);
    // Flag it here rather than in the template: only this function knows the
    // row ended up trailing its own instances.
    if (createRow) out.push({ ...createRow, attachedToGroup: true });
  });
  return out;
}

/**
 * Build display titles per instanceId.
 * Same base name among siblings gets " 2", " 3", … in encounter order.
 */
export function disambiguatedTitles(
  instances: WidgetInstance[],
  titleFor: (instance: WidgetInstance) => string,
): Map<string, string> {
  const counts = new Map<string, number>();
  const out = new Map<string, string>();

  for (const instance of instances) {
    const base = titleFor(instance);
    const n = (counts.get(base) ?? 0) + 1;
    counts.set(base, n);
    out.set(instance.instanceId, n === 1 ? base : `${base} ${n}`);
  }

  // Keep the first title unnumbered; number later duplicates in encounter order.
  return out;
}

/** Build searchable widget rows for all known registry instances. */
export function buildWidgetRows(
  instances: WidgetInstance[],
  titleFor: (instance: WidgetInstance) => string,
  typeKeywordsFor: (instance: WidgetInstance) => string[],
  /** Resolves desk label(s) for an instance; empty string when unknown. */
  desksLabelFor: (instanceId: string) => string = () => "",
  actionFor: (instance: WidgetInstance) => ExtensionAction | undefined = () => undefined,
): PaletteWidgetRow[] {
  const titles = disambiguatedTitles(instances, titleFor);
  const rows: PaletteWidgetRow[] = [];

  for (const instance of instances) {
    const title = titles.get(instance.instanceId) ?? titleFor(instance);
    const hidden = instance.hidden === true;
    const onDesks = desksLabelFor(instance.instanceId);
    const action = actionFor(instance);
    rows.push({
      kind: "widget",
      id: `widget:${instance.instanceId}`,
      instanceId: instance.instanceId,
      typeId: instance.typeId,
      title,
      // Enter brings the widget forward; hiding it moved to its own chord.
      subtitle: hidden ? "Show widget" : "Focus widget",
      keywords: typeKeywordsFor(instance),
      hidden,
      onDesks,
      ...(action ? { action } : {}),
    });
  }

  return rows;
}

/** Attach extension-provided plain text to widget rows for their preview. */
export function attachNotePreviews(
  rows: PaletteWidgetRow[],
  bodyFor: (instanceId: string) => string,
): PaletteWidgetRow[] {
  return rows.map((row) => {
    const notePreview = bodyFor(row.instanceId);
    return notePreview ? { ...row, notePreview } : row;
  });
}

/**
 * Build a short inline snippet around the query match in plain text.
 * Prefers a contiguous substring hit; falls back to the fuzzy-match span.
 */
export function extractSearchSnippet(text: string, query: string, pad = 28): string | null {
  const q = query.trim();
  if (!q || !text) return null;

  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  let matchStart = lower.indexOf(ql);
  let matchEnd = matchStart >= 0 ? matchStart + ql.length : -1;

  if (matchStart < 0) {
    const indices: number[] = [];
    let qi = 0;
    for (let i = 0; i < lower.length && qi < ql.length; i++) {
      if (lower[i] === ql[qi]) {
        indices.push(i);
        qi += 1;
      }
    }
    if (indices.length !== ql.length) return null;
    matchStart = indices[0]!;
    matchEnd = indices[indices.length - 1]! + 1;
  }

  const from = Math.max(0, matchStart - pad);
  const to = Math.min(text.length, matchEnd + pad);
  let snip = text.slice(from, to).replace(/\s+/g, " ").trim();
  if (from > 0) snip = `…${snip}`;
  if (to < text.length) snip = `${snip}…`;
  return snip;
}

/**
 * Attach extension-provided body snippets to widget rows when the query matches.
 * Title-only matches stay without a snippet (normal hide/show rows).
 */
export function attachNoteSnippets(
  rows: PaletteRow[],
  query: string,
  bodyFor: (instanceId: string) => string,
): PaletteRow[] {
  const trimmed = query.trim();
  if (!trimmed) return rows;
  // Skip body lookups when no widget rows can receive snippets.
  if (!rows.some((row) => row.kind === "widget")) {
    return rows;
  }

  return rows.map((row) => {
    if (row.kind !== "widget") return row;
    const body = bodyFor(row.instanceId);
    if (!body) return row;
    const { matched } = fuzzyMatch(trimmed, body);
    if (!matched) return row;
    const snippet = extractSearchSnippet(body, trimmed);
    return snippet ? { ...row, snippet } : row;
  });
}

/**
 * A hit on the row's own title beats a hit on a hidden keyword.
 *
 * Without this, typing "timer" ranked Pomodoro first: it carries "timer" as a
 * manifest keyword, which scores exactly like Timer's title match, and the tie
 * fell back to catalog order (alphabetical by id). What the user typed is the
 * name they mean.
 */
const TITLE_MATCH_BONUS = 8;

function scoreRow(query: string, title: string, keywords: string[]): number {
  let best = -1;

  const titleHit = fuzzyMatch(query, title);
  if (titleHit.matched) best = titleHit.score + TITLE_MATCH_BONUS;

  for (const candidate of keywords) {
    const { matched, score } = fuzzyMatch(query, candidate);
    if (matched && score > best) best = score;
  }

  return best;
}

/**
 * Build palette rows for installed apps matching the query (fuzzy on name).
 * Caps results for a snappy list; pinned + habitual launches get score boosts.
 * Duplicate launch targets (same path / same app name+version variants) collapse to one row.
 */
export function buildAppRows(
  query: string,
  apps: { name: string; path: string; pinned?: boolean; nameLower?: string }[],
  limit = 12,
  usageBoost: (app: { name: string; path: string }) => number = () => 0,
  queryBoost: (app: { name: string; path: string }) => number = () => 0,
): PaletteAppRow[] {
  const trimmed = query.trim();
  if (!trimmed || apps.length === 0) return [];

  const qLower = trimmed.toLowerCase();
  const q0 = qLower[0]!;

  const scored: { row: PaletteAppRow; score: number }[] = [];
  for (const app of apps) {
    const name = app.name?.trim();
    const path = app.path?.trim();
    if (!name || !path) continue;
    const nameLower = app.nameLower ?? name.toLowerCase();
    // Cheap reject before full fuzzy — most apps fail this for multi-char queries.
    if (!nameLower.includes(q0)) continue;
    const { matched, score } = fuzzyMatch(trimmed, name);
    if (!matched || score < 0) continue;
    const pinned = app.pinned === true;
    const usage = usageBoost({ name, path });
    const qBoost = queryBoost({ name, path });
    // Pinned wins close ties; habitual + query frecency rank above one-offs.
    const boosted = score + (pinned ? 5 : 0) + usage + qBoost;
    scored.push({
      score: boosted,
      row: {
        kind: "app",
        id: `app:${path}`,
        title: name,
        subtitle: pinned ? "Pinned app" : "App",
        keywords: [name],
        path,
        pinned,
        usageBoost: usage,
        rankScore: boosted,
      },
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return dedupeAppRows(scored)
    .slice(0, limit)
    .map((entry) => entry.row);
}

/**
 * Build palette rows for well-known folders matching the query
 * (fuzzy on title + aliases). Small catalog — no usage ranking.
 */
export function buildFolderRows(
  query: string,
  folders: {
    id: string;
    title: string;
    path: string;
    aliases: string[];
  }[],
  limit = 8,
): PaletteFolderRow[] {
  const trimmed = query.trim();
  if (!trimmed || folders.length === 0) return [];

  const scored: { row: PaletteFolderRow; score: number }[] = [];
  for (const folder of folders) {
    const title = folder.title?.trim();
    const path = folder.path?.trim();
    if (!title || !path) continue;
    const keywords = [title, ...(folder.aliases ?? [])];
    const score = scoreRow(trimmed, title, keywords);
    if (score < 0) continue;
    // Slight boost so short queries like "desk" / "dl" surface folders over weak app ties.
    const boosted = score + 8;
    scored.push({
      score: boosted,
      row: {
        kind: "folder",
        id: `folder:${folder.id}`,
        title,
        subtitle: "Folder",
        keywords,
        path,
        rankScore: boosted,
      },
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((entry) => entry.row);
}

/** Path key for collapsing identical launch strings (posix-style, OS-agnostic). */
function pathDedupeKey(path: string): string {
  return path.trim().toLowerCase().replace(/\\/g, "/");
}

/** Name key that ignores a trailing dotted version ("HeidiSQL 12.11.0.7065" → "heidisql"). */
export function appNameDedupeKey(name: string): string {
  const n = name.trim().toLowerCase();
  const idx = n.lastIndexOf(" ");
  if (idx > 0) {
    const ver = n.slice(idx + 1);
    // Dotted versions only — keep "Visual Studio 2022" distinct.
    if (/^\d+\.\d[\d.]*$/.test(ver)) return n.slice(0, idx).trimEnd();
  }
  return n;
}

/**
 * Keep one row per executable path and per versionless app name.
 * Prefers already-sorted order (higher score / pinned first).
 */
function dedupeAppRows(
  scored: { row: PaletteAppRow; score: number }[],
): { row: PaletteAppRow; score: number }[] {
  const out: { row: PaletteAppRow; score: number }[] = [];
  const seenPath = new Set<string>();
  const seenName = new Set<string>();
  for (const entry of scored) {
    const pathKey = pathDedupeKey(entry.row.path);
    const nameKey = appNameDedupeKey(entry.row.title);
    if (seenPath.has(pathKey) || seenName.has(nameKey)) continue;
    seenPath.add(pathKey);
    seenName.add(nameKey);
    out.push(entry);
  }
  return out;
}

/**
 * Unified filter: empty query ⇒ no rows (search-first empty state).
 * Non-empty ⇒ scored commands + widgets + types + apps + folders, best score first.
 */
export function filterPaletteRows(
  query: string,
  commands: Command[],
  widgetRows: PaletteWidgetRow[],
  typeRows: PaletteTypeRow[] = [],
  appRows: PaletteAppRow[] = [],
  folderRows: PaletteFolderRow[] = [],
  extensionActionRows: PaletteExtensionActionRow[] = [],
): PaletteRow[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return [];
  }

  const commandRows: PaletteCommandRow[] = commands.map(toCommandRow);

  const scored: { row: PaletteRow; score: number }[] = [];

  for (const row of commandRows) {
    const score = scoreRow(trimmed, row.title, row.keywords);
    if (score >= 0) scored.push({ row, score });
  }

  for (const row of extensionActionRows) {
    const score = scoreRow(trimmed, row.title, row.keywords);
    if (score >= 0) scored.push({ row, score });
  }

  for (const row of widgetRows) {
    const score = scoreRow(trimmed, row.title, row.keywords);
    if (score >= 0) scored.push({ row, score });
  }

  /**
   * Catalog rows an action row has made redundant.
   *
   * Only for an action that says so, and only while its own row is in *these*
   * results — a catalog row is how a widget gets added, and hiding one because
   * some action exists somewhere would take that away. Snippets' "Expand
   * Snippet" is the case that must not be caught: it fills a template and never
   * opens the widget, so its catalog row is the only way to get the card.
   */
  const superseded = new Set(
    scored
      .map((entry) => entry.row)
      .filter(
        (row): row is PaletteExtensionActionRow =>
          row.kind === "extensionAction" && row.replacesCatalogRow === true,
      )
      .map((row) => row.extId),
  );

  for (const row of typeRows) {
    if (superseded.has(row.typeId)) continue;
    const score = scoreRow(trimmed, row.title, row.keywords);
    if (score >= 0) scored.push({ row, score });
  }

  // Apps / folders arrive pre-scored — do not fuzzy them again.
  for (const row of appRows) {
    scored.push({ row, score: row.rankScore });
  }
  for (const row of folderRows) {
    scored.push({ row, score: row.rankScore });
  }

  // Prefer type / folder / app rows over instance rows when scores tie.
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const rank = (row: PaletteRow) => {
      if (row.kind === "path") return 5;
      if (row.kind === "type") return 4;
      if (row.kind === "folder") return 3;
      if (row.kind === "app") return 2;
      if (row.kind === "widget") return 1;
      return 0;
    };
    if (rank(b.row) !== rank(a.row)) return rank(b.row) - rank(a.row);
    // Still tied: the shorter title is the closer fit ("tim" → Timer, not Time
    // Tracker). Beats falling back to catalog order, which is alphabetical by id.
    return a.row.title.length - b.row.title.length;
  });

  // A strong match for a short query makes low-scoring subsequences noise:
  // "ala" should show Alarm, not unrelated aliases such as Zwischenablage.
  const strongestScore = scored[0]?.score ?? 0;
  const visible =
    trimmed.length >= 3 && strongestScore >= 20
      ? scored.filter((entry) => entry.score >= 12)
      : scored;
  return visible.map((entry) => entry.row);
}

/** Build directly runnable rows from enabled extensions without widget cards. */
export function buildExtensionActionRows(
  extensions: readonly PaletteTypeCatalogEntry[],
): PaletteExtensionActionRow[] {
  return extensions.flatMap((extension) =>
    (extension.actions ?? [])
      .filter((action) => action.needsInstance === false)
      .map((action) => ({
        kind: "extensionAction" as const,
        id: `extension-action:${extension.id}:${action.id}`,
        extId: extension.id,
        actionId: action.id,
        title: action.title,
        ...(action.subtitle ? { subtitle: action.subtitle } : {}),
        params: action.params ?? [],
        keywords: [
          extension.id,
          extension.title,
          ...(extension.keywords ?? []),
          ...action.keywords,
        ],
        ...(extension.iconUrl ? { iconUrl: extension.iconUrl } : {}),
        ...(action.replacesCatalogRow ? { replacesCatalogRow: true as const } : {}),
      })),
  );
}
