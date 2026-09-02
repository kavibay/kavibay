/**
 * Pure normalization for manifest `textActions` — selection quick actions.
 *
 * Kept apart from `textActions.ts` so it can be unit-tested: that file is all
 * Vite `import.meta.glob`, which only exists inside a bundler.
 *
 * Fails soft, like `normalizeActions` in loadExtensions.ts: one malformed entry
 * is dropped with a warning instead of taking the whole menu down. The menu is
 * shown on a global hotkey over someone else's text field — an exception there
 * would look like the hotkey is broken, with no window to show the error in.
 */

/** One menu row, ready to render. */
export interface ResolvedTextAction {
  /** Extension folder = manifest id; also the key for the lazy module import. */
  extensionId: string;
  /** `TextAction.id` within that extension. */
  actionId: string;
  title: string;
  subtitle?: string;
  widgetAction?: { id: string; args: Record<string, string> };
}

/** The subset of a manifest this module reads. */
interface TextActionManifest {
  id?: unknown;
  textActions?: unknown;
}

/**
 * Read one manifest's declarations. `folder` wins over `manifest.id` as the
 * extension key: the folder is what the module glob is keyed by, so trusting a
 * mismatching id would produce rows whose handler can never be loaded.
 */
export function normalizeTextActions(
  folder: string,
  raw: unknown,
  warn: (message: string) => void = (message) => console.warn(message),
): ResolvedTextAction[] {
  if (!raw || typeof raw !== "object") return [];
  const declared = (raw as TextActionManifest).textActions;
  if (declared === undefined) return [];
  if (!Array.isArray(declared)) {
    warn(`[kavibay] Extension "${folder}": manifest.textActions must be an array — ignored`);
    return [];
  }

  const out: ResolvedTextAction[] = [];
  const seen = new Set<string>();

  for (const entry of declared) {
    const action = entry as {
      id?: unknown;
      title?: unknown;
      subtitle?: unknown;
      widgetAction?: unknown;
    };
    if (typeof action?.id !== "string" || !action.id.trim()) {
      warn(`[kavibay] Extension "${folder}": text action without an id — skipped`);
      continue;
    }
    if (typeof action.title !== "string" || !action.title.trim()) {
      warn(`[kavibay] Extension "${folder}": text action "${action.id}" has no title — skipped`);
      continue;
    }
    const actionId = action.id.trim();
    if (seen.has(actionId)) {
      warn(`[kavibay] Extension "${folder}": duplicate text action "${actionId}" — skipped`);
      continue;
    }
    seen.add(actionId);
    const widgetAction = normalizeWidgetAction(folder, action.id, action.widgetAction, warn);
    out.push({
      extensionId: folder,
      actionId,
      title: action.title.trim(),
      ...(typeof action.subtitle === "string" && action.subtitle.trim()
        ? { subtitle: action.subtitle.trim() }
        : {}),
      ...(widgetAction ? { widgetAction } : {}),
    });
  }

  return out;
}

/** Validate the optional hand-off without making the primary quick action unavailable. */
function normalizeWidgetAction(
  folder: string,
  textActionId: unknown,
  raw: unknown,
  warn: (message: string) => void,
): { id: string; args: Record<string, string> } | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object") {
    warn(`[kavibay] Extension "${folder}": text action "${textActionId}" has an invalid widgetAction — ignored`);
    return undefined;
  }
  const candidate = raw as { id?: unknown; args?: unknown };
  if (typeof candidate.id !== "string" || !candidate.id.trim()) {
    warn(`[kavibay] Extension "${folder}": text action "${textActionId}" has a widgetAction without an id — ignored`);
    return undefined;
  }
  if (candidate.args !== undefined && (!candidate.args || typeof candidate.args !== "object" || Array.isArray(candidate.args))) {
    warn(`[kavibay] Extension "${folder}": text action "${textActionId}" has invalid widgetAction args — ignored`);
    return undefined;
  }
  const args: Record<string, string> = {};
  for (const [key, value] of Object.entries(candidate.args ?? {})) {
    if (typeof value !== "string") {
      warn(`[kavibay] Extension "${folder}": text action "${textActionId}" has non-text widgetAction args — ignored`);
      return undefined;
    }
    args[key] = value;
  }
  return { id: candidate.id.trim(), args };
}

/**
 * Group by extension (id order), keep each extension's declaration order.
 *
 * Declaration order matters: the extension author decided that Translate comes
 * before Correct grammar, and the first row is what Enter runs.
 */
export function sortTextActions(actions: ResolvedTextAction[]): ResolvedTextAction[] {
  const byExtension = new Map<string, ResolvedTextAction[]>();
  for (const action of actions) {
    const list = byExtension.get(action.extensionId) ?? [];
    list.push(action);
    byExtension.set(action.extensionId, list);
  }
  return [...byExtension.keys()]
    .sort((a, b) => a.localeCompare(b))
    .flatMap((extensionId) => byExtension.get(extensionId) ?? []);
}

/** Extract `extensions/<folder>` from a glob path. */
export function folderFromManifestPath(path: string): string | undefined {
  return path.match(/extensions\/([^/]+)\/manifest\.json$/)?.[1];
}
