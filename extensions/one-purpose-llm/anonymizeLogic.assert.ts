/**
 * Redaction checks: `npx tsx extensions/one-purpose-llm/anonymizeLogic.assert.ts`
 *
 * The interesting cases are the ones where a mark cannot be resolved exactly.
 * Every one of them must redact more, never less.
 */
import {
  type AnonymizedTerm,
  hasUnknownPlaceholder,
  markSelection,
  nextTermId,
  normalizeTerms,
  placeholderFor,
  redactText,
  restoreText,
  staleTerms,
  unmarkTerm,
} from "./anonymizeLogic";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) throw new Error(`${msg}: ${String(actual)} !== ${String(expected)}`);
}

function deepEq(actual: unknown, expected: unknown, msg: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg}: ${a} !== ${b}`);
}

const term = (
  id: number,
  value: string,
  all = false,
  ordinal = 0,
): AnonymizedTerm => ({ id, term: value, all, ordinal });

// Nothing marked, nothing changed.
{
  eq(redactText("Hallo Max", []), "Hallo Max", "no marks leaves the text alone");
  eq(restoreText("Hallo Max", []), "Hallo Max", "no marks leaves the answer alone");
}

// "Anonymize": this occurrence only.
{
  const text = "Max wrote to Max.";
  eq(
    redactText(text, [term(1, "Max", false, 1)]),
    "Max wrote to [ANONYMIZED_1].",
    "a single mark covers the occurrence that was marked",
  );
}

// "Anonymize all": every occurrence.
{
  const text = "Max wrote to Max.";
  eq(
    redactText(text, [term(1, "Max", true)]),
    "[ANONYMIZED_1] wrote to [ANONYMIZED_1].",
    "an all-mark covers every occurrence",
  );
}

// Fail closed: the marked occurrence is gone after an edit. Redacting nothing
// would send the value to the provider, so redact everywhere instead.
{
  const edited = "Max";
  eq(
    redactText(edited, [term(1, "Max", false, 3)]),
    "[ANONYMIZED_1]",
    "an out-of-range ordinal redacts every occurrence",
  );
}

// A value inside a longer marked value must not be redacted twice, and the
// longer one wins — otherwise "[ANONYMIZED_2] Müller" leaks the surname.
{
  const text = "Max Müller met Max.";
  eq(
    redactText(text, [term(1, "Max Müller", true), term(2, "Max", true)]),
    "[ANONYMIZED_1] met [ANONYMIZED_2].",
    "the longer value wins where they overlap",
  );
}

// A value that happens to look like a placeholder cannot corrupt another mark:
// ranges are taken from the original text, never from the partly built output.
{
  const text = "a b";
  eq(
    redactText(text, [term(1, "a", true), term(2, "b", true)]),
    "[ANONYMIZED_1] [ANONYMIZED_2]",
    "replacements do not see each other",
  );
}

// Round trip: whatever the model echoes back comes out as the original text.
{
  const text = "Max Müller lives in Bonn.";
  const marks = [term(1, "Max Müller", true), term(2, "Bonn", true)];
  const redacted = redactText(text, marks);
  assert(!redacted.includes("Müller"), "the value must not survive redaction");
  assert(!redacted.includes("Bonn"), "the value must not survive redaction");
  eq(restoreText(redacted, marks), text, "restore undoes redact exactly");
}

// The model reorders and repeats placeholders; all of them map back.
{
  const marks = [term(1, "Max", true), term(2, "Bonn", true)];
  eq(
    restoreText("[ANONYMIZED_2]: [ANONYMIZED_1] and [ANONYMIZED_1]", marks),
    "Bonn: Max and Max",
    "every placeholder maps back, in any order",
  );
}

// A placeholder we have no value for is left alone and reported, rather than
// silently handed to the user as if it were part of the answer.
{
  const marks = [term(1, "Max", true)];
  eq(
    restoreText("[ANONYMIZED_1] and [ANONYMIZED_9]", marks),
    "Max and [ANONYMIZED_9]",
    "an unknown placeholder is left as-is",
  );
  assert(hasUnknownPlaceholder("[ANONYMIZED_9]", marks), "an unknown placeholder is reported");
  assert(!hasUnknownPlaceholder("[ANONYMIZED_1]", marks), "a known placeholder is not reported");
  assert(!hasUnknownPlaceholder("no placeholders here", marks), "plain text is not reported");
}

// Marking from a selection ------------------------------------------------

// A double-click takes the trailing space with it; the mark must not.
{
  const text = "Hallo Max Müller, ";
  const marks = markSelection(text, 6, 10, false, []);
  eq(marks.length, 1, "one mark added");
  eq(marks[0].term, "Max", "the selection is trimmed");
  eq(marks[0].ordinal, 0, "the ordinal is the occurrence that was selected");
}

// The third occurrence is the third, not the first.
{
  const text = "Max, Max, Max";
  const marks = markSelection(text, 10, 13, false, []);
  eq(marks[0].ordinal, 2, "the ordinal follows the selection, not the first match");
  eq(
    redactText(text, marks),
    "Max, Max, [ANONYMIZED_1]",
    "only the selected occurrence is redacted",
  );
}

// An empty or whitespace-only selection is not a mark.
{
  deepEq(markSelection("Hallo", 2, 2, false, []), [], "an empty selection adds nothing");
  deepEq(markSelection("a  b", 1, 3, false, []), [], "a whitespace selection adds nothing");
}

// Marking a second occurrence of an already-marked value widens it to all,
// rather than leaving the other one exposed.
{
  const text = "Max, Max";
  const first = markSelection(text, 0, 3, false, []);
  const second = markSelection(text, 5, 8, false, first);
  eq(second.length, 1, "the same value stays one mark");
  eq(second[0].all, true, "marking a second occurrence widens the scope");
  eq(redactText(text, second), "[ANONYMIZED_1], [ANONYMIZED_1]", "both are redacted");
}

// Scope only ever widens: "Anonymize all" after "Anonymize" upgrades, and the
// reverse does not quietly downgrade.
{
  const text = "Max, Max";
  const once = markSelection(text, 0, 3, false, []);
  const widened = markSelection(text, 0, 3, true, once);
  eq(widened[0].all, true, "all-marking an existing value widens it");
  const narrowed = markSelection(text, 0, 3, false, widened);
  eq(narrowed[0].all, true, "marking one occurrence does not narrow an all-mark");
}

// A value that overlaps itself ("aa" in "aaa") is counted left to right, so a
// selection can land on a match the count never reaches. Rather than guess an
// ordinal, cover every occurrence.
{
  const text = "aaa";
  const marks = markSelection(text, 1, 3, false, []);
  eq(marks[0].term, "aa", "the selection is the value");
  eq(marks[0].all, true, "a selection the occurrence count misses covers all of them");
  assert(!redactText(text, marks).includes("aa"), "and the value does not survive");
}

// Housekeeping ------------------------------------------------------------

{
  eq(nextTermId([]), 1, "the first placeholder is 1");
  eq(nextTermId([term(1, "a"), term(4, "b")]), 5, "ids never repeat");
  eq(placeholderFor(3), "[ANONYMIZED_3]", "placeholder format is stable");

  deepEq(
    unmarkTerm([term(1, "a"), term(2, "b")], 1).map((entry) => entry.id),
    [2],
    "unmark drops one mark",
  );

  deepEq(
    staleTerms("only a here", [term(1, "a"), term(2, "gone")]).map((entry) => entry.id),
    [2],
    "a value no longer in the text is stale",
  );
}

// localStorage is user-writable, so the stored shape is checked.
{
  deepEq(normalizeTerms("nope"), [], "a non-array is dropped");
  deepEq(
    normalizeTerms([
      { id: 1, term: "Max", all: true, ordinal: 0 },
      { id: 1, term: "duplicate id", all: false, ordinal: 0 },
      { id: 0, term: "id too small", all: false, ordinal: 0 },
      { id: 2, term: "", all: false, ordinal: 0 },
      { id: 3, term: "Bonn", all: "yes", ordinal: -4 },
      null,
    ]),
    [
      { id: 1, term: "Max", all: true, ordinal: 0 },
      { id: 3, term: "Bonn", all: false, ordinal: 0 },
    ],
    "only well-formed marks survive",
  );
}

console.log("anonymizeLogic.assert.ts: OK");
