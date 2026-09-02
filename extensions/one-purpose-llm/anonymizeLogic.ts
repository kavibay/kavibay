/**
 * Local redaction: swap marked values for placeholders on the way out, put
 * them back when the answer returns.
 *
 * The marks are values, not positions. Positions would be simpler right up to
 * the moment the user edits the text before sending, at which point every
 * offset is wrong and the leak is silent. Storing what was marked means a
 * later edit can move it around freely.
 *
 * The rule this module is built around: **when a mark cannot be resolved
 * exactly, redact more, never less.** Over-redacting produces a worse answer;
 * under-redacting sends the value to a provider. Only one of those can be
 * taken back.
 */

/** One value the user marked in their text. */
export interface AnonymizedTerm {
  /** Number in the placeholder: 1 → `[ANONYMIZED_1]`. */
  id: number;
  /** The exact text that was selected. */
  term: string;
  /** True: every occurrence. False: only the one at `ordinal`. */
  all: boolean;
  /** 0-based index of the marked occurrence when it was marked. */
  ordinal: number;
}

const PLACEHOLDER_PREFIX = "[ANONYMIZED_";

export function placeholderFor(id: number): string {
  return `${PLACEHOLDER_PREFIX}${id}]`;
}

/** Instruction added to the outgoing system prompt while marks are active. */
export const ANONYMIZE_SYSTEM_NOTE =
  "Some values in the user's text have been replaced with placeholders of the " +
  "form [ANONYMIZED_1]. Reproduce every placeholder exactly as it appears — " +
  "never translate, rename, correct, expand or drop one.";

/** Next free placeholder number. */
export function nextTermId(terms: AnonymizedTerm[]): number {
  return terms.reduce((max, term) => Math.max(max, term.id), 0) + 1;
}

/** Every start offset of `term` in `text`, left to right, non-overlapping. */
function occurrences(text: string, term: string): number[] {
  if (!term) return [];
  const found: number[] = [];
  let at = text.indexOf(term);
  while (at !== -1) {
    found.push(at);
    at = text.indexOf(term, at + term.length);
  }
  return found;
}

/**
 * Mark the current selection.
 *
 * The selection is trimmed first — a double-click usually takes the trailing
 * space with it, and a mark that includes one would miss the same name in the
 * middle of a sentence.
 */
export function markSelection(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  all: boolean,
  terms: AnonymizedTerm[],
): AnonymizedTerm[] {
  const raw = text.slice(selectionStart, selectionEnd);
  const leading = raw.length - raw.trimStart().length;
  const term = raw.trim();
  if (!term) return terms;

  const start = selectionStart + leading;
  const ordinal = occurrences(text, term).indexOf(start);
  // A selection that spans two matches is not one of them; treat it as its own
  // value and redact everywhere rather than guessing which one was meant.
  const scopeAll = all || ordinal === -1;

  const existing = terms.find((entry) => entry.term === term);
  if (existing) {
    // Marking the same value again can only widen the scope, never narrow it.
    if (scopeAll && !existing.all) {
      return terms.map((entry) =>
        entry.term === term ? { ...entry, all: true } : entry,
      );
    }
    if (!scopeAll && !existing.all && existing.ordinal !== ordinal) {
      // A second, different occurrence of a value marked once: cover both.
      return terms.map((entry) =>
        entry.term === term ? { ...entry, all: true } : entry,
      );
    }
    return terms;
  }

  return [...terms, { id: nextTermId(terms), term, all: scopeAll, ordinal: Math.max(ordinal, 0) }];
}

/** Drop one mark by placeholder id. */
export function unmarkTerm(terms: AnonymizedTerm[], id: number): AnonymizedTerm[] {
  return terms.filter((term) => term.id !== id);
}

/** Marks whose value no longer appears in the text — stale, safe to drop. */
export function staleTerms(text: string, terms: AnonymizedTerm[]): AnonymizedTerm[] {
  return terms.filter((entry) => !text.includes(entry.term));
}

interface Range {
  start: number;
  end: number;
  id: number;
}

/**
 * Replace every marked value with its placeholder.
 *
 * Ranges are collected against the original text and applied in one pass, so a
 * value can never match inside a placeholder another mark just inserted.
 * Longer values win over shorter ones they contain — marking both "Max Müller"
 * and "Max" must not leave "[ANONYMIZED_2] Müller" behind.
 */
export function redactText(text: string, terms: AnonymizedTerm[]): string {
  if (!terms.length || !text) return text;

  const byLength = [...terms].sort((a, b) => b.term.length - a.term.length);
  const ranges: Range[] = [];

  for (const entry of byLength) {
    const starts = occurrences(text, entry.term);
    if (!starts.length) continue;
    // Fail closed: a mark whose occurrence has moved or vanished covers every
    // occurrence instead of silently covering none.
    const targets =
      entry.all || entry.ordinal >= starts.length ? starts : [starts[entry.ordinal]];
    for (const start of targets) {
      ranges.push({ start, end: start + entry.term.length, id: entry.id });
    }
  }

  ranges.sort((a, b) => a.start - b.start || b.end - a.end);

  let out = "";
  let cursor = 0;
  for (const range of ranges) {
    // Dropped rather than merged: the longer value was sorted first, so an
    // overlap here is the shorter one inside it, already covered.
    if (range.start < cursor) continue;
    out += text.slice(cursor, range.start) + placeholderFor(range.id);
    cursor = range.end;
  }
  return out + text.slice(cursor);
}

/** Put the real values back into an answer that carries placeholders. */
export function restoreText(text: string, terms: AnonymizedTerm[]): string {
  if (!terms.length || !text) return text;
  let out = text;
  for (const entry of terms) {
    out = out.split(placeholderFor(entry.id)).join(entry.term);
  }
  return out;
}

/** True when the answer still holds a placeholder we have no value for. */
export function hasUnknownPlaceholder(text: string, terms: AnonymizedTerm[]): boolean {
  const known = new Set(terms.map((term) => placeholderFor(term.id)));
  const found = text.match(/\[ANONYMIZED_\d+\]/g);
  return (found ?? []).some((placeholder) => !known.has(placeholder));
}

/** Keep only well-formed marks (localStorage is user-writable). */
export function normalizeTerms(raw: unknown): AnonymizedTerm[] {
  if (!Array.isArray(raw)) return [];
  const out: AnonymizedTerm[] = [];
  const seen = new Set<number>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const id = typeof entry.id === "number" && Number.isInteger(entry.id) ? entry.id : null;
    const term = typeof entry.term === "string" ? entry.term : "";
    if (id === null || id < 1 || seen.has(id) || !term) continue;
    seen.add(id);
    out.push({
      id,
      term,
      all: entry.all === true,
      ordinal:
        typeof entry.ordinal === "number" && Number.isInteger(entry.ordinal) && entry.ordinal >= 0
          ? entry.ordinal
          : 0,
    });
  }
  return out;
}
