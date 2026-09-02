/**
 * Asserts for known-folder palette row builder (pure; no Tauri path calls).
 * Run: npx tsx core/app/palette/knownFolders.assert.ts
 */
import { buildFolderRows } from "./paletteResults";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const folders = [
  {
    id: "downloads",
    title: "Downloads",
    path: "C:\\Users\\x\\Downloads",
    aliases: ["downloads", "download", "dl", "herunterladen"],
  },
  {
    id: "desktop",
    title: "Desktop",
    path: "C:\\Users\\x\\Desktop",
    aliases: ["desktop", "schreibtisch"],
  },
  {
    id: "documents",
    title: "Documents",
    path: "C:\\Users\\x\\Documents",
    aliases: ["documents", "docs", "dokumente"],
  },
];

assert(buildFolderRows("", folders).length === 0, "empty query → []");
assert(
  buildFolderRows("down", folders)[0]?.title === "Downloads",
  "down → Downloads",
);
assert(
  buildFolderRows("dl", folders)[0]?.id === "folder:downloads",
  "alias dl → Downloads",
);
assert(
  buildFolderRows("desk", folders)[0]?.title === "Desktop",
  "desk → Desktop",
);
assert(
  buildFolderRows("dokumente", folders)[0]?.title === "Documents",
  "DE alias → Documents",
);
assert(buildFolderRows("zzz", folders).length === 0, "no match → []");

const row = buildFolderRows("downloads", folders)[0]!;
assert(row.kind === "folder", "kind folder");
assert(row.path.includes("Downloads"), "path kept");
assert(row.subtitle === "Folder", "subtitle");

console.log("knownFolders.assert.ts: ok");
