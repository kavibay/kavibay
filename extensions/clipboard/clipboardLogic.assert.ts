import { displayText, fileName, normalizeEntry } from "./clipboardLogic";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const base = {
  id: "entry-1",
  kind: "image",
  imagePath: "C:\\clipboard\\entry.png",
  hash: "abc",
  createdAt: 1,
  revealed: true,
};

const sourced = normalizeEntry({
  ...base,
  sourceApp: { name: "Code", path: "C:\\Program Files\\Microsoft VS Code\\Code.exe" },
});
assert(sourced?.sourceApp?.name === "Code", "valid source app metadata is preserved");
assert(sourced.sourceApp.path.endsWith("Code.exe"), "source executable path is preserved");

const legacy = normalizeEntry(base);
assert(legacy != null && legacy.sourceApp == null, "entries without source metadata remain valid");

const malformed = normalizeEntry({ ...base, sourceApp: { name: "Code", path: "" } });
assert(malformed != null && malformed.sourceApp == null, "malformed source metadata is ignored");

const files = normalizeEntry({
  id: "entry-files",
  kind: "file",
  filePaths: ["C:\\Users\\Alex\\report.pdf", "C:\\Users\\Alex\\photo.png"],
  hash: "files-hash",
  createdAt: 2,
  revealed: true,
});
assert(files?.kind === "file", "file references are normalized as a file entry");
assert(files.filePaths?.length === 2, "all copied file references are preserved");
assert(displayText(files) === "report.pdf +1", "multiple files get a compact list summary");
assert(fileName("C:\\Users\\Alex\\report.pdf") === "report.pdf", "Windows file names are extracted");

const screenshot = normalizeEntry({
  id: "entry-screenshot",
  kind: "file",
  filePaths: ["/Users/alex/Library/Application Support/CleanShot/media/CleanShot.png"],
  imagePath: "/Users/alex/.kavibay/clipboard-widget/images/entry-screenshot.png",
  hash: "screenshot-hash",
  createdAt: 3,
  revealed: true,
});
assert(
  screenshot?.imagePath === "/Users/alex/.kavibay/clipboard-widget/images/entry-screenshot.png",
  "a copied picture file keeps its preview",
);

const missingFiles = normalizeEntry({ ...base, kind: "file", imagePath: undefined, filePaths: [] });
assert(missingFiles == null, "empty file-reference entries are rejected");

console.log("clipboardLogic.assert.ts: ok");
