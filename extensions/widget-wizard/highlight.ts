// SPDX-License-Identifier: MIT
/**
 * A very small syntax highlighter, for the Wizard's file editor.
 *
 * Deliberately not a library. The editor shows three kinds of file — a
 * manifest, an `api.json`, and a widget script — and the job is to make a
 * string look different from a key so a misplaced quote is visible. Prism and
 * highlight.js do that too, and also bring a grammar registry, a plugin system
 * and a theme format, none of which this editor has any use for.
 *
 * ONE TOKENIZER FOR BOTH LANGUAGES. JSON is a subset of JavaScript's literal
 * syntax, so the same scanner reads both. The JavaScript keywords cannot
 * misfire on JSON: they match only as bare words, and in JSON every bare word
 * that is not `true`, `false` or `null` is already a syntax error.
 *
 * WHAT IT DOES NOT DO: regular-expression literals, template-literal
 * interpolation, and JSX are not recognised and fall through as plain text.
 * They are unhighlighted rather than mis-highlighted, which is the right way
 * for a highlighter this size to be wrong.
 */

/**
 * Above this, the file renders unhighlighted.
 *
 * The tokens become DOM nodes that are rebuilt as you type, and a generated
 * widget is a few hundred lines — a file two orders of magnitude larger is not
 * something this editor is for, and turning highlighting off is a better
 * failure than a keystroke that takes a visible moment.
 */
export const HIGHLIGHT_LIMIT = 60_000;

export type TokenKind = "plain" | "comment" | "string" | "key" | "number" | "literal" | "keyword";

export interface CodeToken {
  readonly kind: TokenKind;
  readonly text: string;
}

/** Extensions worth scanning. Anything else — Markdown, text — renders plain. */
const CODE_SUFFIXES = [".json", ".js", ".mjs", ".ts", ".mts"];

export function isHighlightable(path: string): boolean {
  const lower = path.toLowerCase();
  return CODE_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

const LITERALS = new Set(["true", "false", "null", "undefined", "NaN", "Infinity"]);

/**
 * Order matters: comments before strings, so a `"` inside a comment does not
 * open one. The reverse case is handled by position rather than order — in
 * `"http://x"` the quote comes first, so the string alternative is the one
 * tried at the earlier index and it swallows the slashes.
 *
 * Every string alternative ends in an optional closing quote (`"?`) and stops
 * at a newline. That is what keeps typing usable: the moment you open a quote,
 * the rest of the file would otherwise turn into one string until you close it.
 */
const TOKEN = new RegExp(
  // Written as regex literals and joined by `.source`, not as strings: a
  // character class like `[^"\\\n]` needs its backslashes doubled again inside
  // a string, and the version that is wrong still compiles.
  [
    /\/\/[^\n]*/,
    /\/\*[\s\S]*?(?:\*\/|$)/,
    /"(?:[^"\\\n]|\\.)*"?/,
    /'(?:[^'\\\n]|\\.)*'?/,
    /`(?:[^`\\]|\\.)*`?/,
    // `(?<!\.)` so a property keeps its own colour: `obj.default`, `ctx.get`
    // and `state.of` are ordinary names, and painting them as keywords is the
    // sort of wrongness that makes a reader distrust the rest of the file.
    /(?<!\.)\b(?:true|false|null|undefined|NaN|Infinity)\b/,
    /(?<!\.)\b(?:async|await|break|case|catch|class|const|continue|default|delete|do|else|export|extends|finally|for|from|function|get|if|import|in|instanceof|let|new|of|return|set|static|super|switch|this|throw|try|typeof|var|void|while|yield)\b/,
    /\b0[xX][0-9a-fA-F]+\b/,
    /\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/,
  ]
    .map((part) => part.source)
    .join("|"),
  "g",
);

/**
 * Which alternative matched, read off the first character.
 *
 * Cheaper and far more legible than nine capture groups, and it cannot drift
 * out of step with the pattern the way numbered groups do when one is added.
 */
function classify(text: string): TokenKind {
  const first = text[0]!;
  if (first === "/") return "comment";
  if (first === '"' || first === "'" || first === "`") return "string";
  if (first >= "0" && first <= "9") return "number";
  return LITERALS.has(text) ? "literal" : "keyword";
}

/** A string followed by a colon is a property name, not a value. */
const KEY_AHEAD = /^\s*:/;

export function tokenize(source: string): CodeToken[] {
  if (source.length === 0) return [];
  if (source.length > HIGHLIGHT_LIMIT) return [{ kind: "plain", text: source }];

  const tokens: CodeToken[] = [];
  let last = 0;
  TOKEN.lastIndex = 0;

  for (let match = TOKEN.exec(source); match !== null; match = TOKEN.exec(source)) {
    const text = match[0];
    if (match.index > last) tokens.push({ kind: "plain", text: source.slice(last, match.index) });

    const end = match.index + text.length;
    let kind = classify(text);
    // A bounded slice, not the rest of the file: an unbounded lookahead makes
    // this quadratic, which is invisible on a manifest and not on a script.
    if (kind === "string" && text.startsWith('"') && KEY_AHEAD.test(source.slice(end, end + 8))) {
      kind = "key";
    }

    tokens.push({ kind, text });
    last = end;
  }

  if (last < source.length) tokens.push({ kind: "plain", text: source.slice(last) });
  return tokens;
}
