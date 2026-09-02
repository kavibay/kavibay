/**
 * An invented filesystem for the launcher demo — the one thing on the landing
 * page that cannot be the real article.
 *
 * WHY IT IS MADE UP AND NOT MOCKED AT THE SEAM:
 *
 * In the app, `fileSearch.ts` asks Rust for "what is in this folder" and "what
 * in this folder matches this". A browser has neither the commands nor a disk
 * to point them at, and the embed package may not import `@tauri-apps/*` at
 * all. So the folder listing is data, the way `wizardFixture.ts` is data for
 * the Wizard's conversation.
 *
 * Everything *around* the data stays the app's own code: `folderScope.ts` owns
 * the path arithmetic and the stack, `fileSort.ts` the order and the size and
 * date labels, `fuzzy.ts` the matching. That split is deliberate — the parts a
 * visitor judges the product by are the real ones, and only the bytes on the
 * invented disk are ours.
 *
 * Times are minutes before page load rather than fixed dates: the rows say
 * "24m" and "3d" like a machine somebody actually uses, on any day the page is
 * opened, and a fixed date would age into "8/28/2026" within a week.
 */
import { fuzzyMatch } from "../../app/palette/fuzzy";
import { formatModified, formatSize } from "../../app/palette/fileSort";
import { parentFolder, samePath } from "../../app/palette/folderScope";
import { pathParentLabel } from "../../app/palette/pathQuery";
import type { DemoRow } from "./demoRows";

/** The user this desktop belongs to. Windows-shaped, like the app's paths. */
export const DEMO_HOME = "C:\\Users\\Alex";

/** One filesystem hit, shaped like `FileEntry` from `fileSearch.ts`. */
export interface DemoFileEntry {
  name: string;
  path: string;
  isDir: boolean;
  modifiedMs: number;
  size: number;
}

interface TreeNode {
  name: string;
  /** Minutes before page load. */
  ago: number;
  /** Bytes. Folders leave it out; the app shows no size for a directory. */
  size?: number;
  children?: TreeNode[];
}

const MINUTE = 60_000;
const HOUR = 60;
const DAY = 24 * HOUR;

/**
 * The desk of somebody who invoices two clients and keeps their contracts.
 *
 * Small on purpose: every folder in here is one the demo, or a visitor poking
 * around after it, can actually open, and a listing nobody reaches is only a
 * bigger bundle. The names carry the story the section is making — a file you
 * would otherwise go hunting for in Explorer is four keystrokes away.
 */
const TREE: TreeNode[] = [
  {
    name: "Desktop",
    ago: 24,
    children: [
      { name: "timesheet-2026.xlsx", ago: 24, size: 28_400 },
      { name: "Recording-2026-08-27.mp4", ago: 1 * DAY + 3 * HOUR, size: 412_000_000 },
      { name: "scratch.txt", ago: 3 * DAY, size: 1_180 },
    ],
  },
  {
    name: "Documents",
    ago: 2 * HOUR,
    children: [
      {
        name: "Invoices",
        ago: 2 * HOUR,
        children: [
          { name: "Invoice-2026-08 Northwind.pdf", ago: 2 * HOUR, size: 184_320 },
          { name: "Invoice-2026-08 Contoso.pdf", ago: 6 * DAY, size: 171_008 },
          { name: "Invoice-2026-07 Northwind.pdf", ago: 33 * DAY, size: 180_224 },
        ],
      },
      {
        name: "Contracts",
        ago: 12 * DAY,
        children: [
          { name: "Northwind-MSA-signed.pdf", ago: 12 * DAY, size: 962_560 },
          { name: "Freelance-Agreement.docx", ago: 74 * DAY, size: 46_080 },
        ],
      },
      { name: "Roadmap.md", ago: 41, size: 6_240 },
      { name: "README.md", ago: 5 * DAY, size: 3_120 },
      { name: "Tax-2025.pdf", ago: 60 * DAY, size: 1_310_720 },
    ],
  },
  {
    name: "Downloads",
    ago: 3 * HOUR,
    children: [
      { name: "kavibay-0.9.4-setup.exe", ago: 3 * HOUR, size: 77_594_624 },
      { name: "carina-nebula.jpg", ago: 2 * DAY, size: 6_397_952 },
      { name: "invoice-template.xlsx", ago: 21 * DAY, size: 32_768 },
    ],
  },
  {
    name: "Projects",
    ago: 18,
    children: [
      {
        name: "kavibay",
        ago: 18,
        children: [
          { name: "README.md", ago: 18, size: 8_960 },
          { name: "package.json", ago: 4 * HOUR, size: 2_048 },
          { name: "vite.config.ts", ago: 9 * DAY, size: 1_536 },
        ],
      },
    ],
  },
];

const LOADED_AT = Date.now();

/** Map key for a path — the comparison `samePath` makes, as a string. */
function key(path: string): string {
  return path.trim().replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}

/**
 * Every folder's direct children, indexed once at load.
 *
 * Directories first and then by name, which is the order `browse_folder`
 * returns; the sort mode is applied on top of it by the palette, exactly as it
 * is applied to the backend's answer in the app.
 */
const contents = new Map<string, DemoFileEntry[]>();

function indexNodes(nodes: readonly TreeNode[], dir: string): void {
  const entries: DemoFileEntry[] = nodes.map((node) => ({
    name: node.name,
    path: `${dir}\\${node.name}`,
    isDir: Array.isArray(node.children),
    modifiedMs: LOADED_AT - node.ago * MINUTE,
    size: node.size ?? 0,
  }));

  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  contents.set(key(dir), entries);

  for (const node of nodes) {
    if (node.children) indexNodes(node.children, `${dir}\\${node.name}`);
  }
}

indexNodes(TREE, DEMO_HOME);

/** Direct children of a folder; an unknown path is an empty folder. */
export function listDemoFolder(path: string): DemoFileEntry[] {
  return contents.get(key(path)) ?? [];
}

/**
 * Recursive name search below `path`, like `search_folder`.
 *
 * Recursive is the part worth demonstrating: a hit two folders down still
 * carries the folder it came from, which is what the parent label on the row
 * is for. Scored with the palette's own `fuzzyMatch` so "northwind" and "nrth"
 * behave here the way they behave everywhere else in this demo.
 */
export function searchDemoFolder(path: string, query: string, limit = 40): DemoFileEntry[] {
  const term = query.trim();
  if (!term) return listDemoFolder(path);

  const hits: { entry: DemoFileEntry; score: number }[] = [];
  const walk = (dir: string) => {
    for (const entry of listDemoFolder(dir)) {
      const match = fuzzyMatch(term, entry.name);
      if (match.matched) hits.push({ entry, score: match.score });
      if (entry.isDir) walk(entry.path);
    }
  };
  walk(path);

  hits.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name));
  return hits.slice(0, limit).map((hit) => hit.entry);
}

/**
 * A browsed row keeps the three values the sort reads.
 *
 * The app's `PalettePathRow` carries them for the same reason: it sorts the
 * *rows* it already has in memory rather than re-asking the backend, which is
 * what makes switching the order instant instead of a reload.
 */
export interface DemoFileRow extends DemoRow {
  isDir: boolean;
  modifiedMs: number;
  size: number;
}

/**
 * Entries as palette rows — the demo's half of `fileEntriesToRows`.
 *
 * Same two decisions that function makes: the second line is the file's size,
 * and the containing folder is named only when it is not the one being
 * browsed, which is what tells two hits of a recursive search apart.
 */
export function demoFileRows(entries: readonly DemoFileEntry[], baseDir: string): DemoFileRow[] {
  return entries.map((entry) => {
    const parent = parentFolder(entry.path);
    const nested = Boolean(parent && !samePath(parent, baseDir));
    return {
      id: `path:${entry.path}`,
      kind: entry.isDir ? ("folder" as const) : ("file" as const),
      title: entry.name,
      keywords: [entry.name],
      path: entry.path,
      isDir: entry.isDir,
      modifiedMs: entry.modifiedMs,
      size: entry.size,
      // Directories have no size worth showing; the app leaves the line empty.
      sizeLabel: entry.isDir ? "" : formatSize(entry.size),
      meta: formatModified(entry.modifiedMs),
      ...(nested ? { folderLabel: pathParentLabel(entry.path) } : {}),
    };
  });
}
