/** Google vs Windows file search prefix kinds. */
export type PrefixSearchKind = "google" | "files";

/** Result of parsing a palette prefix (`g` / `google` / `f`). */
export interface PrefixSearchMatch {
  kind: PrefixSearchKind;
  /** Search term; empty means homepage / empty Windows Search. */
  term: string;
}

/**
 * Parse `g` / `google` / `f` as a whole first token.
 * Returns null when the query is not a prefix search action.
 */
export function parsePrefixSearch(query: string): PrefixSearchMatch | null {
  const trimmed = query.trim();
  if (!trimmed) return null;

  const m = /^(\S+)(?:\s+(.*))?$/.exec(trimmed);
  if (!m) return null;

  const token = m[1].toLowerCase();
  const term = (m[2] ?? "").trim();

  if (token === "g" || token === "google") {
    return { kind: "google", term };
  }
  if (token === "f") {
    return { kind: "files", term };
  }
  return null;
}

/** Google search URL; empty term opens the homepage. */
export function buildGoogleSearchUrl(term: string): string {
  const t = term.trim();
  if (!t) return "https://www.google.com/";
  return `https://www.google.com/search?q=${encodeURIComponent(t)}`;
}

/**
 * Term for static Search Google / Search Files commands.
 * Only uses a remainder when the query is a prefix of the same kind; otherwise empty.
 */
export function resolveStaticSearchTerm(
  query: string,
  kind: PrefixSearchKind,
): string {
  const parsed = parsePrefixSearch(query);
  if (parsed && parsed.kind === kind) return parsed.term;
  return "";
}
