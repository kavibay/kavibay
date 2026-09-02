/**
 * Which mark a file row gets.
 * Run: npx tsx core/embed/palette/fileMarks.assert.ts
 *
 * The drawing is a matter of taste; the *mapping* is not. Every extension on
 * the invented disk has to reach a mark, or a listing quietly turns into five
 * identical grey sheets — which is the state this file exists to leave behind.
 */
import { DEMO_HOME, listDemoFolder } from "./demoFiles";
import { fileExtension, fileMarkFor } from "./fileMarks";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

assert(fileExtension("Invoice.pdf") === "pdf", "extension is the tail");
assert(fileExtension("timesheet-2026.xlsx") === "xlsx", "dots in the stem do not confuse it");
assert(fileExtension("README") === "", "a file without one has none");
assert(fileExtension(".gitignore") === "", "a dotfile is not an extension");
assert(fileExtension("archive.TAR") === "tar", "the key is lowercased, like the app's cache key");

/** Colour is what separates two rows before either name is read. */
assert(fileMarkFor("a.pdf").color !== fileMarkFor("a.xlsx").color, "a PDF is not a spreadsheet");
assert(fileMarkFor("a.jpg").color !== fileMarkFor("a.mp4").color, "a photo is not a video");
assert(fileMarkFor("a.md").color === fileMarkFor("a.txt").color, "plain text shares one mark");
assert(fileMarkFor("a.unknown").glyph.length > 0, "an unlisted type still gets a sheet");

/**
 * Every file the demo can show, walked from the roots. A new entry in
 * `demoFiles.ts` with an unlisted extension fails here rather than rendering
 * as the grey default and being noticed by nobody.
 */
const seen = new Set<string>();
const walk = (dir: string) => {
  for (const entry of listDemoFolder(dir)) {
    if (entry.isDir) walk(entry.path);
    else seen.add(fileExtension(entry.name));
  }
};
walk(DEMO_HOME);

assert(seen.size > 0, "the invented disk has files to draw");
const grey = fileMarkFor("x.unlisted");
const plain = [...seen].filter((ext) => fileMarkFor(`x.${ext}`) === grey && ext !== "md" && ext !== "txt");
assert(
  plain.length === 0,
  `these extensions on the demo disk have no mark of their own: ${plain.join(", ")}`,
);

console.log("fileMarks asserts passed");
