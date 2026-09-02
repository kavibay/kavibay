export interface FuzzyMatch {
  matched: boolean;
  score: number;
}

/**
 * A typed space, hyphen or underscore matches any of the three.
 *
 * A generated widget is named by its id — `hello-world`, `air-quality` — and
 * the id is one of the keywords a palette row is searched by. Without this,
 * typing the name the way a person says it finds nothing: the comparison is
 * character-for-character, so the space in "hello world" fails against the
 * hyphen and the whole query is rejected. The widget was there the entire time.
 *
 * Only separators are widened, never letters, so nothing that used to be a
 * non-match becomes one on the strength of a real character.
 */
const SEPARATOR = /[\s\-_]/;

const sameChar = (a: string, b: string) =>
  a === b || (SEPARATOR.test(a) && SEPARATOR.test(b));

/**
 * One way of laying the query over the target, plus everything the accept rules
 * and the ranking need to judge it.
 *
 * Split out because a query can be laid over the same target in more than one
 * place, and which one you measure decides whether the row survives at all.
 */
interface Alignment {
  score: number;
  maxConsecutive: number;
  wordStartHits: number;
  firstMatchAt: number;
  lastMatchAt: number;
}

/**
 * Greedy alignment: every query character takes the earliest target character
 * that fits. Returns null when the query is not a subsequence at all, which is
 * the cheap reject almost every non-matching row leaves through.
 */
function alignLeft(q: string, t: string): Alignment | null {
  let score = 0;
  let queryIndex = 0;
  let consecutiveRun = 0;
  let maxConsecutive = 0;
  let wordStartHits = 0;
  let firstMatchAt = -1;
  let lastMatchAt = -1;

  for (let i = 0; i < t.length && queryIndex < q.length; i++) {
    if (!sameChar(t[i]!, q[queryIndex]!)) {
      consecutiveRun = 0;
      continue;
    }

    let charScore = 1;

    const isWordStart = i === 0 || SEPARATOR.test(t[i - 1]!);
    if (isWordStart) {
      charScore += 3;
      wordStartHits += 1;
    }

    consecutiveRun += 1;
    maxConsecutive = Math.max(maxConsecutive, consecutiveRun);
    charScore += Math.min(consecutiveRun - 1, 4);

    // Penalize long gaps between matched characters (sparse noise).
    if (lastMatchAt >= 0) {
      const gap = i - lastMatchAt - 1;
      if (gap > 0) score -= Math.min(gap, 8);
    }

    score += charScore;
    if (firstMatchAt < 0) firstMatchAt = i;
    lastMatchAt = i;
    queryIndex += 1;
  }

  if (queryIndex !== q.length || firstMatchAt < 0) return null;
  return { score, maxConsecutive, wordStartHits, firstMatchAt, lastMatchAt };
}

/**
 * The same match pulled as far right as it goes: query characters are taken
 * from `endAt` leftwards instead of from the front.
 *
 * "wiz" against "Widget Wizard" is the case this exists for. Greedily the w and
 * the i come out of *Widget* and only the z out of *Wizard* — three characters
 * spread over ten, sparse enough that the density rule below threw the row
 * away. Typing the widget's name did not find the widget, and no amount of
 * keywords fixes that, because the title itself was the thing being rejected.
 *
 * Reading from the right instead lands on *Wizard* whole: contiguous, on a word
 * start, and scored like the exact hit it is. Every term is either per-position
 * or between neighbours, so accumulating in reverse totals the same as forward.
 *
 * Anchored at the end the greedy pass found rather than searching all
 * alignments. That is the one this file needs and it stays two linear scans.
 */
function alignRight(q: string, t: string, endAt: number): Alignment {
  let score = 0;
  let queryIndex = q.length - 1;
  let consecutiveRun = 0;
  let maxConsecutive = 0;
  let wordStartHits = 0;
  let firstMatchAt = -1;
  const lastMatchAt = endAt;
  let previousMatchAt = -1;

  for (let i = endAt; i >= 0 && queryIndex >= 0; i--) {
    if (!sameChar(t[i]!, q[queryIndex]!)) {
      consecutiveRun = 0;
      continue;
    }

    let charScore = 1;

    const isWordStart = i === 0 || SEPARATOR.test(t[i - 1]!);
    if (isWordStart) {
      charScore += 3;
      wordStartHits += 1;
    }

    consecutiveRun += 1;
    maxConsecutive = Math.max(maxConsecutive, consecutiveRun);
    charScore += Math.min(consecutiveRun - 1, 4);

    if (previousMatchAt >= 0) {
      const gap = previousMatchAt - i - 1;
      if (gap > 0) score -= Math.min(gap, 8);
    }

    score += charScore;
    firstMatchAt = i;
    previousMatchAt = i;
    queryIndex -= 1;
  }

  return { score, maxConsecutive, wordStartHits, firstMatchAt, lastMatchAt };
}

/**
 * The accept rules, applied to one alignment.
 *
 * Accept when any of:
 * - contiguous run covers most of the query (typed chunk / substring feel)
 * - enough hits land on word starts (acronym style)
 * - match span is dense enough relative to query length
 */
function judge(q: string, a: Alignment): FuzzyMatch {
  const { maxConsecutive, wordStartHits, firstMatchAt, lastMatchAt } = a;

  // One-char queries match almost every title via mid-word hits — require word start
  // (keeps "s" → Spotify/Settings, drops noise, and makes search much cheaper).
  if (q.length === 1 && wordStartHits < 1) {
    return { matched: false, score: 0 };
  }

  if (q.length === 2) {
    const span2 = lastMatchAt - firstMatchAt + 1;
    const density2 = q.length / span2;
    const contiguous = maxConsecutive === 2;
    const contiguousOk =
      contiguous && (wordStartHits >= 1 || firstMatchAt === 0);
    const twoWordStarts = wordStartHits >= 2 && firstMatchAt === 0;
    // Prefix-dense: "sb" → Sublime (s+b in opening syllable, not fully contiguous).
    const prefixDense = firstMatchAt === 0 && density2 >= 0.5;
    if (!contiguousOk && !twoWordStarts && !prefixDense) {
      return { matched: false, score: 0 };
    }
  }

  // Length-2 queries are fully gated above; skip general reject (acronym forced
  // false + sparse density would wrongly drop twoWordStarts like "ob" → Open Browser).
  let tightChunk = false;
  if (q.length !== 2) {
    const span = lastMatchAt - firstMatchAt + 1;
    const density = q.length / span;
    const needWordStarts = Math.ceil(q.length * 0.6);
    // Contiguous chunk: whole query, or at least 3 chars for longer queries.
    const needContiguous = Math.min(q.length, 3);

    tightChunk = maxConsecutive >= needContiguous;
    const acronym = wordStartHits >= needWordStarts;
    // Three-letter queries are specific enough to reject loose subsequences
    // such as "ala" in "Calculator" while keeping acronyms and typed chunks.
    const minDensity = q.length === 3 ? 0.6 : q.length < 3 ? 0.5 : 0.35;
    const dense = density >= minDensity;

    if (!tightChunk && !acronym && !dense) {
      return { matched: false, score: 0 };
    }
  }

  // Contiguous / prefix feel should rank above sparse-but-dense hits.
  let score = a.score;
  if (maxConsecutive === q.length) score += 12;
  else if (tightChunk) score += 4;

  return { matched: true, score: Math.max(score, 1) };
}

/**
 * Subsequence fuzzy matcher: query chars must appear in order in the target
 * ("gta" → "Grand Theft Auto"), but sparse accidental hits are rejected.
 *
 * The query is laid over the target twice — from the left and pulled to the
 * right — and judged on whichever reads better. One pass alone cannot do it:
 * greedy-from-the-left is what makes "gta" an acronym hit, and it is also what
 * turned "wiz" into three scattered letters of "Widget Wizard". Neither
 * alignment is the right one in general, so the row is judged on its best.
 *
 * Score bonuses: word-start hits, consecutive runs; gap penalty for ranking.
 *
 * Separators are interchangeable — see `SEPARATOR`.
 */
export function fuzzyMatch(query: string, target: string): FuzzyMatch {
  if (query.length === 0) {
    return { matched: true, score: 0 };
  }

  const q = query.toLowerCase();
  const t = target.toLowerCase();

  const left = alignLeft(q, t);
  // Not a subsequence in either direction: the right-hand pass reuses the end
  // the left one found, so there is nothing to anchor it to.
  if (!left) return { matched: false, score: 0 };

  const fromLeft = judge(q, left);
  const fromRight = judge(q, alignRight(q, t, left.lastMatchAt));
  // No shortcut for "the left pass was already contiguous": "cat" finds one
  // inside *concat* before it finds the word *Cat*, and the second is the one
  // the person meant. Both passes are linear over a title, and the expensive
  // rows — every app that shares no subsequence — never get this far.
  if (fromLeft.matched !== fromRight.matched) return fromLeft.matched ? fromLeft : fromRight;
  return fromRight.score > fromLeft.score ? fromRight : fromLeft;
}
