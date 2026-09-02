// SPDX-License-Identifier: MIT
/**
 * Checks for the Wizard's file-editor highlighter.
 * Run: npx tsx extensions/widget-wizard/highlight.assert.ts
 *
 * The cases worth pinning are the ones where a highlighter quietly stops being
 * useful: a half-typed string that swallows the rest of the file, a URL inside
 * a string read as a comment, a keyword list that fires inside JSON.
 */
import { HIGHLIGHT_LIMIT, isHighlightable, tokenize, type CodeToken } from "./highlight";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

/** The tokens, rejoined — must always reproduce the input exactly. */
const joined = (tokens: CodeToken[]) => tokens.map((token) => token.text).join("");

/** The kind covering a given substring, for asserting without counting tokens. */
function kindOf(source: string, needle: string): string | undefined {
  let at = 0;
  for (const token of tokenize(source)) {
    if (at <= source.indexOf(needle) && source.indexOf(needle) < at + token.text.length) {
      return token.kind;
    }
    at += token.text.length;
  }
  return undefined;
}

// --- lossless ----------------------------------------------------------------
// Everything else is cosmetic; this one is not. The tokens are what the reader
// sees, so a dropped character is a file that looks different from the file.
for (const source of [
  '{"a": 1}',
  "const x = 1; // hi\nreturn x;",
  "/* unterminated",
  '"unterminated',
  "",
  "  \n\t ",
  "a/b/c",
  "café — ✓",
]) {
  assert(joined(tokenize(source)) === source, `tokens rejoin to the source: ${JSON.stringify(source)}`);
}

// --- json --------------------------------------------------------------------
assert(kindOf('{"name": "clock"}', '"name"') === "key", "a string before a colon is a key");
assert(kindOf('{"name": "clock"}', '"clock"') === "string", "a string after a colon is a value");
assert(kindOf('{"n": 12.5}', "12.5") === "number", "numbers are numbers");
assert(kindOf('{"on": true}', "true") === "literal", "true is a literal, not a keyword");
assert(kindOf('{"a" : 1}', '"a"') === "key", "whitespace before the colon still makes a key");

// --- strings are not comments, and comments are not strings ------------------
assert(
  kindOf('{"url": "https://api.example.com"}', '"https://api.example.com"') === "string",
  "a // inside a string does not start a comment",
);
assert(kindOf('// says "hi"', '"hi"') === "comment", "a quote inside a comment does not open a string");

// --- half-typed input --------------------------------------------------------
// The editor tokenizes on every keystroke, so the intermediate states matter as
// much as the final one. An unterminated string must not colour the rest of the
// file: that is the moment the highlighter would be most visibly wrong.
{
  const typed = '{\n  "name": "clo\n  "other": 1\n}';
  assert(kindOf(typed, '"other"') === "key", "an unterminated string stops at its newline");
}
assert(kindOf("/* open\nstill open", "still") === "comment", "an unterminated block comment runs on");

// --- javascript --------------------------------------------------------------
assert(kindOf("const x = 1", "const") === "keyword", "keywords are keywords");
assert(kindOf("constant = 1", "constant") === "plain", "a keyword prefix is not a keyword");
assert(kindOf("obj.default", "default") === "plain", "a keyword after a dot is a property");

// --- what it declines to read ------------------------------------------------
assert(isHighlightable("manifest.json"), "json is highlighted");
assert(isHighlightable("widget.js"), "js is highlighted");
assert(!isHighlightable("README.md"), "markdown is left alone");
assert(!isHighlightable("notes"), "an extensionless file is left alone");

{
  const huge = "x".repeat(HIGHLIGHT_LIMIT + 1);
  const tokens = tokenize(huge);
  assert(tokens.length === 1 && tokens[0]!.kind === "plain", "an oversized file renders plain");
  assert(joined(tokens) === huge, "an oversized file is still reproduced whole");
}

console.log("highlight.assert.ts ok");
