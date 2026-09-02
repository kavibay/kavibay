/**
 * Asserts for the palette's folder-scope helpers.
 * Run: npx tsx core/app/palette/folderScope.assert.ts
 */
import {
  currentFolder,
  enterFolder,
  folderTitle,
  isBrowsableRow,
  leaveFolder,
  parentFolder,
  samePath,
  scopePlaceholder,
  type FolderScopeEntry,
} from "./folderScope";
import type { PaletteRow } from "./paletteResults";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const folderRow: PaletteRow = {
  kind: "folder",
  id: "folder:downloads",
  title: "Downloads",
  subtitle: "Folder",
  keywords: ["Downloads"],
  path: "C:\\Users\\Alex\\Downloads",
  rankScore: 10,
};
const dirRow: PaletteRow = {
  kind: "path",
  id: "path:x",
  title: "nested",
  subtitle: "Folder",
  keywords: ["nested"],
  path: "C:\\Users\\Alex\\Downloads\\nested",
  isDir: true,
  rankScore: 10,
};
const fileRow: PaletteRow = { ...dirRow, id: "path:y", isDir: false };
const appRow: PaletteRow = {
  kind: "app",
  id: "app:z",
  title: "Chrome",
  subtitle: "App",
  keywords: ["Chrome"],
  path: "C:\\chrome.exe",
  pinned: false,
  usageBoost: 0,
  rankScore: 1,
};

assert(isBrowsableRow(folderRow), "folder row browsable");
assert(isBrowsableRow(dirRow), "directory path row browsable");
assert(!isBrowsableRow(fileRow), "file row not browsable");
assert(!isBrowsableRow(appRow), "app row not browsable");
assert(!isBrowsableRow(undefined), "no row not browsable");

assert(folderTitle("C:\\Users\\Alex\\Downloads") === "Downloads", "leaf name");
assert(folderTitle("C:/Users/Alex/Downloads/") === "Downloads", "trailing sep + slashes");
assert(folderTitle("C:\\") === "C:\\", "drive root");

assert(parentFolder("C:\\Users\\Alex\\Downloads") === "C:\\Users\\Alex", "parent");
assert(parentFolder("C:\\Users") === "C:\\", "parent is drive root");
assert(parentFolder("C:\\") === null, "no parent above drive root");

assert(samePath("C:\\Dev\\", "c:/dev"), "case + separator insensitive");
assert(!samePath("C:\\Dev", "C:\\Dev2"), "different folders");

let stack: FolderScopeEntry[] = [];
assert(currentFolder(stack) === null, "empty stack has no folder");

stack = enterFolder(stack, "C:\\Users\\Alex\\Downloads");
assert(stack.length === 1 && currentFolder(stack)?.title === "Downloads", "entered");

stack = enterFolder(stack, "C:/Users/Alex/Downloads/");
assert(stack.length === 1, "re-entering the same folder is a no-op");

stack = enterFolder(stack, "C:\\Users\\Alex\\Downloads\\nested");
assert(stack.length === 2 && currentFolder(stack)?.title === "nested", "descended");
assert(
  scopePlaceholder(currentFolder(stack)) === "Search in nested",
  "placeholder names the folder",
);

stack = leaveFolder(stack);
assert(stack.length === 1 && currentFolder(stack)?.title === "Downloads", "back up");
stack = leaveFolder(stack);
assert(stack.length === 0, "leaving the last level exits scope");

assert(enterFolder([], "   ").length === 0, "blank path ignored");

console.log("folderScope asserts passed");
