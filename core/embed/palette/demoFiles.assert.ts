/**
 * The invented disk answers the two questions the palette asks it.
 * Run: npx tsx core/embed/palette/demoFiles.assert.ts
 *
 * The listing itself is data and cannot really be wrong, so this checks the
 * three places where data becomes behaviour, and where the launcher script
 * would otherwise fail silently on a page nobody is watching: that the folders
 * the script walks into exist, that a search inside one reaches subfolders,
 * and that a hit from a subfolder is labelled with the folder it came from —
 * the label being the whole point of searching a folder rather than listing it.
 */
import {
  DEMO_HOME,
  demoFileRows,
  listDemoFolder,
  searchDemoFolder,
} from "./demoFiles";
import { DEMO_ROWS } from "./demoRows";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const documents = `${DEMO_HOME}\\Documents`;
const invoices = `${documents}\\Invoices`;

/* ── The path the launcher script takes ─────────────────────────────────── */

for (const row of DEMO_ROWS.filter((candidate) => candidate.kind === "folder")) {
  assert(row.path, `folder row ${row.id} has no path`);
  assert(
    listDemoFolder(row.path).length > 0,
    `folder row ${row.id} points at an empty folder — Tab on it shows nothing`,
  );
}

assert(
  listDemoFolder(documents).some((entry) => entry.name === "Invoices" && entry.isDir),
  "the script walks Documents → Invoices; that folder has to be in the listing",
);
assert(listDemoFolder(invoices).length > 0, "Invoices is empty");
assert(listDemoFolder("C:\\nope").length === 0, "an unknown path lists nothing");

/* ── Order: directories first, then by name ─────────────────────────────── */

const listed = listDemoFolder(documents);
const lastDir = listed.map((entry) => entry.isDir).lastIndexOf(true);
const firstFile = listed.findIndex((entry) => !entry.isDir);
assert(lastDir < firstFile, "directories come first, the way browse_folder returns them");

/* ── Search reaches into subfolders ─────────────────────────────────────── */

const hits = searchDemoFolder(documents, "northwind");
assert(hits.length >= 2, "northwind is in two subfolders of Documents");
assert(
  hits.every((entry) => entry.path.startsWith(documents)),
  "a scoped search stays inside the folder it was given",
);
assert(
  searchDemoFolder(documents, "carina").length === 0,
  "a file in Downloads is not a hit inside Documents",
);
assert(
  searchDemoFolder(documents, "   ").length === listDemoFolder(documents).length,
  "a blank search is a listing, as it is in the app",
);

/* ── Rows carry the two labels a browsed row has ────────────────────────── */

const nested = demoFileRows(hits, documents);
assert(
  nested.every((row) => row.folderLabel),
  "hits from a subfolder name the subfolder — otherwise two rows read alike",
);

const direct = demoFileRows(listDemoFolder(invoices), invoices);
assert(
  direct.every((row) => !row.folderLabel),
  "a direct child does not repeat the folder named in the breadcrumb above it",
);

const file = direct.find((row) => row.kind === "file");
const folder = demoFileRows(listDemoFolder(documents), documents).find(
  (row) => row.kind === "folder",
);
assert(file?.sizeLabel, "a file row shows its size");
assert(file?.meta, "a file row shows when it was last written");
assert(folder?.sizeLabel === "", "a directory has no size worth printing");

console.log("demoFiles asserts passed");
