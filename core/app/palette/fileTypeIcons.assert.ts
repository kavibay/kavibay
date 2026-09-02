/**
 * Asserts for file-type icon keys.
 * Run: npx tsx core/app/palette/fileTypeIcons.assert.ts
 */
import { fileTypeIconKey } from "./fileTypeIcons";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(fileTypeIconKey("report.pdf", false) === "pdf", "plain extension");
assert(fileTypeIconKey("Clip.MP4", false) === "mp4", "lowercased");
assert(
  fileTypeIconKey("Rechnung 2026-01-01.tar.gz", false) === "gz",
  "last extension wins",
);
assert(fileTypeIconKey("LICENSE", false) === "file", "no extension");
assert(fileTypeIconKey(".gitignore", false) === "file", "dotfile is not an extension");
assert(fileTypeIconKey("archive.", false) === "file", "trailing dot");
assert(fileTypeIconKey("Downloads", true) === null, "directories keep the drawn mark");
assert(
  fileTypeIconKey("ElsterLohn-Bescheinigung 2023 (1).pdf", true) === null,
  "a directory named like a file is still a directory",
);

console.log("fileTypeIcons asserts passed");
