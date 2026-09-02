/**
 * Asserts for the second line of a file row.
 * Run: npx tsx core/app/palette/fileSearch.assert.ts
 */
import { fileEntriesToRows, type FileEntry } from "./fileSearch";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const BASE = "C:\\Users\\Alex\\Downloads";

const entries: FileEntry[] = [
  {
    name: "ChatGPT Installer.exe",
    path: `${BASE}\\ChatGPT Installer.exe`,
    isDir: false,
    modifiedMs: 1_700_000_000_000,
    size: 2_400_000,
  },
  {
    name: "CHANGELOG.md",
    path: `${BASE}\\vuexy-admin-6.0\\CHANGELOG.md`,
    isDir: false,
    modifiedMs: 1_600_000_000_000,
    size: 1_024,
  },
  {
    name: "vuexy-admin-6.0",
    path: `${BASE}\\vuexy-admin-6.0`,
    isDir: true,
    modifiedMs: 1_600_000_000_000,
    size: 0,
  },
  {
    name: "assets",
    path: `${BASE}\\vuexy-admin-6.0\\assets`,
    isDir: true,
    modifiedMs: 1_600_000_000_000,
    size: 0,
  },
];

const rows = fileEntriesToRows(entries, BASE);
const rowFor = (name: string) => rows.find((row) => row.title === name)!;

// `subtitle` is the size; `parentLabel` is the location and renders with a
// folder glyph, so the two must stay separate values.
assert(
  rowFor("ChatGPT Installer.exe").subtitle === "2.3 MB",
  `direct child shows size — got ${rowFor("ChatGPT Installer.exe").subtitle}`,
);
assert(
  rowFor("ChatGPT Installer.exe").parentLabel === undefined,
  "a direct child does not repeat the folder from the header",
);
assert(
  rowFor("CHANGELOG.md").subtitle === "1 KB" &&
    rowFor("CHANGELOG.md").parentLabel === "vuexy-admin-6.0",
  "a hit from a subfolder keeps size and location apart",
);
assert(
  rowFor("vuexy-admin-6.0").subtitle === "" &&
    rowFor("vuexy-admin-6.0").parentLabel === undefined,
  "a directory in the browsed folder shows neither",
);
assert(
  rowFor("assets").subtitle === "" && rowFor("assets").parentLabel === "vuexy-admin-6.0",
  "a nested directory shows its parent, never a size",
);

// Separators are not identity: the same folder written differently is still
// the browsed one, so it must not come back as a location hint.
const loose = fileEntriesToRows([entries[0]!], "c:/users/alex/downloads/");
assert(loose[0]!.parentLabel === undefined, "path compare ignores case and slashes");

assert(rows[0]!.modifiedMs === 1_700_000_000_000, "sort keys survive the mapping");
assert(rows[0]!.size === 2_400_000, "size survives the mapping");

console.log("fileSearch asserts passed");
