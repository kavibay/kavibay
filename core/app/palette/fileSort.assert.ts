/**
 * Asserts for file listing sort orders.
 * Run: npx tsx core/app/palette/fileSort.assert.ts
 */
import {
  DEFAULT_FILE_SORT,
  formatModified,
  formatSize,
  nextSortMode,
  parseSortMode,
  sortFileRows,
  sortModeLabel,
  type SortableFileRow,
} from "./fileSort";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const rows: SortableFileRow[] = [
  { title: "old.txt", isDir: false, modifiedMs: 1_000, size: 900 },
  { title: "newest.pdf", isDir: false, modifiedMs: 9_000, size: 10 },
  { title: "Archive", isDir: true, modifiedMs: 5_000, size: 0 },
  { title: "unstattable.bin", isDir: false, modifiedMs: null, size: 5_000 },
];

const names = (list: SortableFileRow[]) => list.map((row) => row.title);

const byModified = sortFileRows(rows, "modified");
assert(
  names(byModified).join() === "newest.pdf,Archive,old.txt,unstattable.bin",
  `newest first, unknown last — got ${names(byModified).join()}`,
);

const byName = sortFileRows(rows, "name");
assert(
  names(byName).join() === "Archive,newest.pdf,old.txt,unstattable.bin",
  `name order groups directories first — got ${names(byName).join()}`,
);

const bySize = sortFileRows(rows, "size");
assert(
  names(bySize).join() === "unstattable.bin,old.txt,newest.pdf,Archive",
  `largest first, directories last — got ${names(bySize).join()}`,
);

assert(sortFileRows(rows, "name") !== rows, "returns a copy, never sorts in place");
assert(names(rows)[0] === "old.txt", "input order untouched");

assert(nextSortMode("modified") === "name", "cycle steps forward");
assert(nextSortMode("size") === "modified", "cycle wraps");

assert(parseSortMode("size") === "size", "known mode survives a round trip");
assert(parseSortMode("bogus") === DEFAULT_FILE_SORT, "unknown falls back");
assert(parseSortMode(null) === DEFAULT_FILE_SORT, "missing falls back");

assert(sortModeLabel("modified").includes("↓"), "label carries the direction");

const now = Date.UTC(2026, 7, 4, 12, 0, 0);
assert(formatModified(now - 10_000, now) === "now", "seconds ago");
assert(formatModified(now - 5 * 60_000, now) === "5m", "minutes");
assert(formatModified(now - 3 * 3_600_000, now) === "3h", "hours");
assert(formatModified(now - 2 * 86_400_000, now) === "2d", "days");
assert(
  /\d/.test(formatModified(now - 30 * 86_400_000, now)),
  "older than a week becomes a date",
);
assert(formatModified(null, now) === "", "unknown timestamp has no label");
assert(formatModified(0, now) === "", "epoch zero is unknown, not 1970");

assert(formatSize(0) === "", "zero bytes has no label");
assert(formatSize(512) === "512 B", "bytes");
assert(formatSize(2.4 * 1024 * 1024) === "2.4 MB", "one decimal below ten");
assert(formatSize(240 * 1024 * 1024) === "240 MB", "no decimal above ten");

console.log("fileSort asserts passed");
