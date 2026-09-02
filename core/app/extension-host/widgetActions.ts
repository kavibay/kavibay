import type { WidgetActionParam } from "@sdk/contract/sdk";

/**
 * What a local action is, as declared in `manifest.json`. The handler lives in
 * the widget definition and is paired with this by `id`.
 */
export interface WidgetActionDeclaration {
  id: string;
  title: string;
  subtitle?: string;
  keywords?: string[];
  params?: WidgetActionParam[];
  /** False exposes the action globally instead of targeting a widget instance. */
  needsInstance?: boolean;
  /**
   * This action is how the widget gets opened, so the catalog row beside it is
   * redundant and is dropped from search results.
   *
   * Declared rather than inferred, because "has an instance-less action" does
   * not imply it: Snippets' "Expand Snippet" fills a template and never opens
   * the card, so its catalog row is the only way to add the widget at all.
   */
  replacesCatalogRow?: boolean;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asStrings = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : undefined;

/**
 * SPLIT OUT OF `bundledExtensions.ts` TO BE TESTABLE: that file reaches for
 * `import.meta.glob` and cannot run under `tsx`. This function is pure, and both
 * of its failure modes are silent in production — so it gets a test rather than
 * a careful read.
 */
/**
 * Pairs what the manifest declares with what the definition implements.
 *
 * A HARD ERROR IN BOTH DIRECTIONS, because both halves are silent on their own:
 * a declaration without a handler puts a row in the palette that does nothing
 * when pressed, and a handler without a declaration is code no one can reach
 * and no reviewer reading the manifest would know about. The old loader only
 * warned about the second and dropped it.
 */
export function toActionDeclarations(
  folder: string,
  widgetName: string,
  raw: unknown,
  handlers: Record<string, unknown> | undefined,
): WidgetActionDeclaration[] {
  const declared = Array.isArray(raw) ? raw : [];
  const at = (message: string) =>
    new Error(`Extension "${folder}": widget "${widgetName}" ${message}`);

  const out: WidgetActionDeclaration[] = [];
  for (const value of declared) {
    const entry = asRecord(value);
    const id = typeof entry.id === "string" ? entry.id : "";
    const title = typeof entry.title === "string" ? entry.title : "";
    if (!id || !title) throw at("declares an action without an id or a title");
    if (!handlers?.[id]) {
      throw at(`declares the action "${id}", which the widget definition does not implement`);
    }
    out.push({
      id,
      title,
      ...(typeof entry.subtitle === "string" ? { subtitle: entry.subtitle } : {}),
      keywords: asStrings(entry.keywords) ?? [],
      params: Array.isArray(entry.params) ? (entry.params as WidgetActionParam[]) : [],
      needsInstance: entry.needsInstance !== false,
      ...(entry.replacesCatalogRow === true ? { replacesCatalogRow: true } : {}),
    });
  }

  for (const id of Object.keys(handlers ?? {})) {
    if (!out.some((action) => action.id === id)) {
      throw at(`implements the action "${id}", which manifest.json does not declare`);
    }
  }
  return out;
}
