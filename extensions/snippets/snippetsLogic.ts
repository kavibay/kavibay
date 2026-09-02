// SPDX-License-Identifier: MIT
/**
 * Named text templates with `{placeholder}` tokens.
 *
 * The palette action types a template (or a saved name) as the first argument;
 * further chips are the placeholders found in that body. Filling them copies
 * the result to the clipboard — the widget is only the editor for the library.
 */
import type { WidgetActionParam } from "@sdk/contract/sdk";

export interface Snippet {
  id: string;
  name: string;
  template: string;
}

export const MAX_SNIPPETS = 50;

/** `{name}`-style tokens; first appearance order, duplicates collapsed. */
const PLACEHOLDER_RE = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** Unique placeholder names in the order they first appear in `template`. */
export function extractPlaceholders(template: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const match of template.matchAll(PLACEHOLDER_RE)) {
    const name = match[1];
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

/** Replace `{name}` tokens; unknown names are left as written. */
export function fillSnippetTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(PLACEHOLDER_RE, (token, name: string) => {
    return Object.prototype.hasOwnProperty.call(values, name) ? values[name]! : token;
  });
}

/**
 * A saved snippet name (trimmed, case-insensitive) expands to its body;
 * anything else is treated as a raw template.
 */
export function resolveSnippetTemplate(snippets: readonly Snippet[], input: string): string {
  const raw = input.trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  const match = snippets.find((item) => item.name.toLowerCase() === lower);
  return match ? match.template : raw;
}

/**
 * Palette chips for one expand: first the template, then one chip per
 * placeholder in the resolved body. Saved names are suggestions, not an enum,
 * so a one-off `hallo {name}` still works when a library exists.
 */
export function snippetActionParams(
  snippets: readonly Snippet[],
  values: readonly string[],
): WidgetActionParam[] {
  const names = snippets.map((item) => item.name).filter((name) => name.length > 0);
  const templateParam: WidgetActionParam = {
    name: "template",
    type: "text",
    required: true,
    placeholder: names.length ? "Snippet or template" : "Template (hallo {name})",
    ...(names.length ? { options: names } : {}),
  };
  const body = resolveSnippetTemplate(snippets, values[0] ?? "");
  const extra = extractPlaceholders(body)
    .filter((name) => name !== templateParam.name)
    .map((name) => ({
      name,
      type: "text" as const,
      required: true,
      placeholder: `{${name}}`,
    }));
  return [templateParam, ...extra];
}

/** Drop malformed rows and duplicate ids; cap the library. */
export function normalizeSnippets(raw: unknown): Snippet[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { snippets?: unknown }).snippets)
      ? (raw as { snippets: unknown[] }).snippets
      : null;
  if (!list) return [];

  const out: Snippet[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (out.length >= MAX_SNIPPETS) break;
    if (!item || typeof item !== "object") continue;
    const row = item as { id?: unknown; name?: unknown; template?: unknown };
    if (typeof row.id !== "string" || !row.id.trim()) continue;
    if (typeof row.name !== "string" || !row.name.trim()) continue;
    const id = row.id.trim();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: row.name.trim(),
      template: typeof row.template === "string" ? row.template.trim() : "",
    });
  }
  return out;
}

/** New library row; blank fields are for the widget to fill in. */
export function createSnippet(partial?: { name?: string; template?: string }): Snippet {
  return {
    id: `snip-${crypto.randomUUID()}`,
    name: (partial?.name ?? "").trim(),
    template: (partial?.template ?? "").trim(),
  };
}

