// SPDX-License-Identifier: MIT
/**
 * A very small syntax highlighter, for the Wizard's file editor.
 *
 * Deliberately not a library. The editor shows a handful of kinds of file — a
 * manifest, an `api.json`, a widget script, its HTML and CSS — and the job is
 * to make a string look different from a key so a misplaced quote is visible. Prism and
 * highlight.js do that too, and also bring a grammar registry, a plugin system
 * and a theme format, none of which this editor has any use for.
 *
 * ONE SCANNER FOR JSON AND SCRIPT. JSON is a subset of JavaScript's literal
 * syntax, so the same scanner reads both. The JavaScript keywords cannot
 * misfire on JSON: they match only as bare words, and in JSON every bare word
 * that is not `true`, `false` or `null` is already a syntax error.
 *
 * WHAT IT DOES NOT DO: regular-expression literals, template-literal
 * interpolation, and JSX are not recognised and fall through as plain text.
 * They are unhighlighted rather than mis-highlighted, which is the right way
 * for a highlighter this size to be wrong.
 *
 * MARKUP AND STYLE. A generated `index.html` is mostly a `<style>` block and a
 * `<script>`, so HTML is read as tags with the bodies of those two handed to
 * the CSS and script scanners. CSS colours what can be told apart without a
 * parser: selectors, property names, numbers and colours, at-rules. Value
 * words such as `grid` or `center` stay plain.
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

export type TokenKind =
  | "plain"
  | "comment"
  | "string"
  | "key"
  | "number"
  | "literal"
  | "keyword"
  | "tag"
  | "attr";

/** Which scanner reads a file. JSON goes through `script`, see above. */
export type Language = "script" | "markup" | "style";

export interface CodeToken {
  readonly kind: TokenKind;
  readonly text: string;
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

/**
 * Splits `source` into the matches of `pattern` and the plain text between
 * them. Every alternative of every pattern consumes at least one character;
 * the zero-length guard only keeps a future mistake from hanging the editor.
 */
function scan(
  source: string,
  pattern: RegExp,
  kindOf: (match: RegExpExecArray) => TokenKind,
): CodeToken[] {
  const tokens: CodeToken[] = [];
  let last = 0;
  pattern.lastIndex = 0;

  for (let match = pattern.exec(source); match !== null; match = pattern.exec(source)) {
    const text = match[0];
    if (text.length === 0) {
      pattern.lastIndex += 1;
      continue;
    }
    if (match.index > last) tokens.push({ kind: "plain", text: source.slice(last, match.index) });
    tokens.push({ kind: kindOf(match), text });
    last = match.index + text.length;
  }

  if (last < source.length) tokens.push({ kind: "plain", text: source.slice(last) });
  return tokens;
}

/** A string followed by a colon is a property name, not a value. */
const KEY_AHEAD = /^\s*:/;

function scanScript(source: string): CodeToken[] {
  return scan(source, TOKEN, (match) => {
    const text = match[0];
    const end = match.index + text.length;
    const kind = classify(text);
    // A bounded slice, not the rest of the file: an unbounded lookahead makes
    // this quadratic, which is invisible on a manifest and not on a script.
    return kind === "string" && text.startsWith('"') && KEY_AHEAD.test(source.slice(end, end + 8))
      ? "key"
      : kind;
  });
}

/**
 * CSS, told apart by position rather than parsed.
 *
 * A property is a name right after `{`, `;` or a comment whose colon is not
 * followed by a `{`: that last part is what keeps `a:hover {` a selector. A
 * selector is text right after `}`, `{`, `;`, a comment or the start of the
 * file that runs into a `{`. Everything the two lookbehinds turn away, such
 * as `http` in `url(http://x)`, stays plain.
 */
const STYLE_TOKEN = new RegExp(
  [
    /\/\*[\s\S]*?(?:\*\/|$)/,
    /"(?:[^"\\\n]|\\.)*"?/,
    /'(?:[^'\\\n]|\\.)*'?/,
    /@[\w-]+/,
    /!important\b/,
    /(?<property>(?<=[{;/]\s*)[\w-]+(?=\s*:(?![^;{}]*\{)))/,
    /#[0-9a-fA-F]{3,8}\b/,
    /(?<![\w#-])-?\d*\.?\d+(?:[a-zA-Z]+|%)?/,
    /(?<selector>(?<=(?:^|[{};/])\s*)[^\s{};][^{};]*?(?=\s*\{))/,
  ]
    .map((part) => part.source)
    .join("|"),
  "g",
);

function scanStyle(source: string): CodeToken[] {
  return scan(source, STYLE_TOKEN, (match) => {
    if (match.groups?.property !== undefined) return "key";
    if (match.groups?.selector !== undefined) return "tag";
    const first = match[0][0];
    if (first === "/") return "comment";
    if (first === '"' || first === "'") return "string";
    if (first === "@" || first === "!") return "keyword";
    return "number";
  });
}

/**
 * HTML: comments, the doctype, entities, and tags. A tag is matched whole and
 * then split into its name, attributes and values. It stops at the next `<`
 * when unclosed, so a tag being typed does not swallow the one after it.
 */
const MARKUP_TOKEN = new RegExp(
  [/<!--[\s\S]*?(?:-->|$)/, /<![^<>]*>?/, /<\/?[A-Za-z][^<>]*>?/, /&(?:#\d+|#x[0-9a-fA-F]+|\w+);/]
    .map((part) => part.source)
    .join("|"),
  "g",
);

const TAG_PART = /^<\/?[\w:-]*|\/?>$|"[^"]*"?|'[^']*'?|[^\s"'=<>/]+/g;

function scanTag(tag: string): CodeToken[] {
  return scan(tag, TAG_PART, (match) => {
    const text = match[0];
    if (text.startsWith("<") || text.endsWith(">")) return "tag";
    if (text.startsWith('"') || text.startsWith("'")) return "string";
    // An unquoted value is a value, not another attribute.
    return tag[match.index - 1] === "=" ? "string" : "attr";
  });
}

/** The two elements whose bodies are another language. */
const EMBEDDED_OPEN = /^<(script|style)\b[^<>]*(?<!\/)>$/i;

function scanMarkup(source: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  let last = 0;
  MARKUP_TOKEN.lastIndex = 0;

  for (let match = MARKUP_TOKEN.exec(source); match !== null; match = MARKUP_TOKEN.exec(source)) {
    const text = match[0];
    if (match.index > last) tokens.push({ kind: "plain", text: source.slice(last, match.index) });
    let end = match.index + text.length;

    if (text.startsWith("<!--")) tokens.push({ kind: "comment", text });
    else if (text.startsWith("&")) tokens.push({ kind: "literal", text });
    else if (text.startsWith("<!")) tokens.push({ kind: "tag", text });
    else {
      tokens.push(...scanTag(text));
      const embedded = EMBEDDED_OPEN.exec(text)?.[1]?.toLowerCase();
      if (embedded) {
        const close = source.slice(end).search(new RegExp(`</${embedded}\\b`, "i"));
        const bodyEnd = close === -1 ? source.length : end + close;
        const body = source.slice(end, bodyEnd);
        if (body) tokens.push(...(embedded === "script" ? scanScript(body) : scanStyle(body)));
        end = bodyEnd;
        MARKUP_TOKEN.lastIndex = end;
      }
    }
    last = end;
  }

  if (last < source.length) tokens.push({ kind: "plain", text: source.slice(last) });
  return tokens;
}

const SCANNERS: Record<Language, (source: string) => CodeToken[]> = {
  script: scanScript,
  markup: scanMarkup,
  style: scanStyle,
};

/** Which language a file is read as is the caller's: see `highlightLanguage`. */
export function tokenize(source: string, language: Language): CodeToken[] {
  if (source.length === 0) return [];
  if (source.length > HIGHLIGHT_LIMIT) return [{ kind: "plain", text: source }];
  return SCANNERS[language](source);
}
