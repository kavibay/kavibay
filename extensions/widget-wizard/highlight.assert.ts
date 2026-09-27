// SPDX-License-Identifier: MIT
/**
 * Checks for the Wizard's file-editor highlighter.
 * Run: npx tsx extensions/widget-wizard/highlight.assert.ts
 *
 * The cases worth pinning are the ones where a highlighter quietly stops being
 * useful: a half-typed string that swallows the rest of the file, a URL inside
 * a string read as a comment, a keyword list that fires inside JSON.
 */
import { HIGHLIGHT_LIMIT, tokenize, type CodeToken, type Language } from "./highlight";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

/** The tokens, rejoined — must always reproduce the input exactly. */
const joined = (tokens: CodeToken[]) => tokens.map((token) => token.text).join("");

/** The kind covering a given substring, for asserting without counting tokens. */
function kindOf(source: string, needle: string, language: Language = "script"): string | undefined {
  let at = 0;
  for (const token of tokenize(source, language)) {
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
  assert(joined(tokenize(source, "script")) === source, `tokens rejoin to the source: ${JSON.stringify(source)}`);
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

// --- css ---------------------------------------------------------------------
{
  const css = "body {\n  display: grid;\n  color: #e8e8ea;\n  margin: -4px 0.5em;\n}";
  assert(kindOf(css, "body", "style") === "tag", "a selector is a selector");
  assert(kindOf(css, "display", "style") === "key", "a name before a colon in a block is a property");
  assert(kindOf(css, "grid", "style") === "plain", "a value word stays plain");
  assert(kindOf(css, "#e8e8ea", "style") === "number", "a hex colour is a value");
  assert(kindOf(css, "-4px", "style") === "number", "a negative length is a number");
  assert(kindOf(css, "0.5em", "style") === "number", "a length with a unit is a number");
}
assert(kindOf("a:hover { color: red }", "a:hover", "style") === "tag", "a pseudo-class is part of the selector");
assert(kindOf("a:hover { color: red }", "color", "style") === "key", "a property after a pseudo-class selector");
assert(
  kindOf("x { background: url(http://a/b.png) }", "http", "style") === "plain",
  "the colon in a url does not make a property",
);
assert(kindOf("@media (max-width: 340px) { .a { top: 0 } }", "@media", "style") === "keyword", "at-rules");
assert(kindOf("@media (max-width: 340px) { .a { top: 0 } }", "340px", "style") === "number", "a media query's length");
assert(kindOf("@media (max-width: 340px) { .a { top: 0 } }", ".a", "style") === "tag", "a selector inside @media");
assert(kindOf("html,\nbody {}", "body", "style") === "tag", "a selector list spans lines");
assert(kindOf("/* a\n b */ x {}", "b */", "style") === "comment", "a block comment spans lines");
assert(kindOf("x { top: 0 !important }", "!important", "style") === "keyword", "!important");

// --- html --------------------------------------------------------------------
{
  const html = '<!doctype html>\n<html lang="de">\n  <!-- note -->\n  <p class=big>a &amp; b</p>\n</html>';
  assert(kindOf(html, "<!doctype html>", "markup") === "tag", "the doctype");
  assert(kindOf(html, "<html", "markup") === "tag", "a tag name");
  assert(kindOf(html, "lang", "markup") === "attr", "an attribute name");
  assert(kindOf(html, '"de"', "markup") === "string", "a quoted value");
  assert(kindOf(html, "big", "markup") === "string", "an unquoted value is a value, not an attribute");
  assert(kindOf(html, "<!-- note -->", "markup") === "comment", "a comment");
  assert(kindOf(html, "&amp;", "markup") === "literal", "an entity");
  assert(kindOf(html, "a &", "markup") === "plain", "text between tags stays plain");
  assert(kindOf(html, "</p>", "markup") === "tag", "a closing tag");
}
{
  const page = "<style>\n  body { margin: 0; }\n</style>\n<script>\n  const x = 1;\n</script>";
  assert(kindOf(page, "margin", "markup") === "key", "a <style> body is read as css");
  assert(kindOf(page, "const", "markup") === "keyword", "a <script> body is read as script");
  assert(kindOf(page, "</script>", "markup") === "tag", "the closing tag after a script body");
}
assert(
  kindOf('<script src="a.js" /><p>const</p>', "const", "markup") === "plain",
  "a self-closing script tag has no body to read",
);
{
  const typing = '<div class="a\n<p>next</p>';
  assert(kindOf(typing, "<p", "markup") === "tag", "a tag being typed stops at the next tag");
}
for (const [source, language] of [
  ['<a href="x">y</a><script>let s = "</scr";</script>', "markup"],
  ["<style>x{", "markup"],
  ["<script>", "markup"],
  ["<", "markup"],
  ["a{b:c}d:e;", "style"],
  ["", "style"],
] as const) {
  assert(joined(tokenize(source, language)) === source, `tokens rejoin to the source: ${JSON.stringify(source)}`);
}

// --- what it declines to read ------------------------------------------------
// Which files are read at all is `highlightLanguage`'s, asserted with it in
// widgetWizardLogic.assert.ts.
{
  const huge = "x".repeat(HIGHLIGHT_LIMIT + 1);
  const tokens = tokenize(huge, "markup");
  assert(tokens.length === 1 && tokens[0]!.kind === "plain", "an oversized file renders plain");
  assert(joined(tokens) === huge, "an oversized file is still reproduced whole");
}

console.log("highlight.assert.ts ok");
