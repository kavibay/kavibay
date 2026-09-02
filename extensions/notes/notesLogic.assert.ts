/**
 * Quick checks for notes paste helpers (run: npx tsx extensions/notes/notesLogic.assert.ts).
 */
import {
  escapeHtmlText,
  plainTextWithBreaksToHtml,
  shouldPreferPlainTextLineBreaks,
} from "./notesLogic";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

assert(escapeHtmlText(`a <b> & "c"`) === "a &lt;b&gt; &amp; &quot;c&quot;", "escapeHtmlText escapes markup");

assert(
  plainTextWithBreaksToHtml("line one\nline two\nline three") ===
    "<p>line one</p><p>line two</p><p>line three</p>",
  "plainTextWithBreaksToHtml keeps single newlines as paragraphs",
);

assert(
  plainTextWithBreaksToHtml("a\r\nb\rc") === "<p>a</p><p>b</p><p>c</p>",
  "plainTextWithBreaksToHtml normalizes CRLF/CR",
);

assert(
  plainTextWithBreaksToHtml("a\n\nb") === "<p>a</p><p><br></p><p>b</p>",
  "plainTextWithBreaksToHtml keeps blank lines",
);

assert(
  shouldPreferPlainTextLineBreaks("a\nb", "<div>a\nb</div>") === true,
  "prefer plain text when HTML has newlines but no break tags",
);

assert(
  shouldPreferPlainTextLineBreaks("a\nb", "<p>a</p><p>b</p>") === false,
  "keep HTML paste when it already has paragraph breaks",
);

assert(
  shouldPreferPlainTextLineBreaks("a\nb", "line<br>two") === false,
  "keep HTML paste when it already has <br>",
);

assert(
  shouldPreferPlainTextLineBreaks("single line", "<div>single line</div>") === false,
  "do not intercept paste without newlines",
);

console.log("notesLogic.assert.ts: ok");
