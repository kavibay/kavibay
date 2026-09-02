/**
 * Asserts for the palette folder catalog prefs (pure; no localStorage).
 * Run: npx tsx core/app/settings/folderPrefsLogic.assert.ts
 */
import {
  addCustomFolder,
  customFolderId,
  defaultFolderAliases,
  folderLeafName,
  folderPathKey,
  formatAliasInput,
  isBuiltinFolderEnabled,
  mergeFolderCatalog,
  normalizeFolderPrefs,
  parseAliasInput,
  removeCustomFolder,
  renameCustomFolder,
  setBuiltinFolderEnabled,
  setCustomFolderAliases,
  type FolderPrefs,
} from "./folderPrefsLogic";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const builtin = [
  {
    id: "desktop",
    title: "Desktop",
    path: "C:\\Users\\x\\Desktop",
    aliases: ["desktop", "schreibtisch"],
  },
  {
    id: "downloads",
    title: "Downloads",
    path: "C:\\Users\\x\\Downloads",
    aliases: ["downloads", "dl"],
  },
];

const empty: FolderPrefs = { disabledBuiltinIds: [], custom: [] };

// Path helpers
assert(folderPathKey("C:/Users/x/Dev\\") === "c:\\users\\x\\dev", "path key normalizes");
assert(folderLeafName("C:\\Users\\x\\Dev\\") === "Dev", "leaf name");
assert(folderLeafName("D:") === "D:\\", "bare drive keeps itself");
assert(customFolderId("C:/Dev") === "custom:c:\\dev", "custom id is path derived");

// Aliases
assert(
  defaultFolderAliases("Work", "C:\\Dev\\work").join(",") === "work",
  "duplicate default alias collapses",
);
assert(
  defaultFolderAliases("Projekte", "C:\\Dev\\work").join(",") === "projekte,work",
  "title + leaf as defaults",
);
assert(parseAliasInput(" Work, ,PROJEKTE ").join(",") === "work,projekte", "alias parse");
assert(formatAliasInput(["a", "b"]) === "a, b", "alias format");

// Built-in toggles
assert(isBuiltinFolderEnabled(empty, "desktop"), "built-ins enabled by default");
const noDesktop = setBuiltinFolderEnabled(empty, "desktop", false);
assert(!isBuiltinFolderEnabled(noDesktop, "desktop"), "disable sticks");
assert(isBuiltinFolderEnabled(noDesktop, "downloads"), "other built-in untouched");
assert(empty.disabledBuiltinIds.length === 0, "toggle is immutable");
assert(
  isBuiltinFolderEnabled(setBuiltinFolderEnabled(noDesktop, "desktop", true), "desktop"),
  "re-enable sticks",
);
assert(
  mergeFolderCatalog(builtin, noDesktop).map((f) => f.id).join(",") === "downloads",
  "disabled built-in leaves the catalog",
);

// Custom folders
const withDev = addCustomFolder(empty, "C:\\Dev\\kavibay");
assert(withDev.custom.length === 1, "folder added");
assert(withDev.custom[0]!.title === "kavibay", "title defaults to leaf");
assert(
  addCustomFolder(withDev, "c:/dev/kavibay/").custom.length === 1,
  "same path is not added twice",
);
assert(addCustomFolder(withDev, "   ").custom.length === 1, "blank path ignored");

const renamed = renameCustomFolder(withDev, withDev.custom[0]!.id, " Kavibay Repo ");
assert(renamed.custom[0]!.title === "Kavibay Repo", "rename trims");
assert(
  renameCustomFolder(renamed, renamed.custom[0]!.id, "  ").custom[0]!.title === "kavibay",
  "empty rename falls back to leaf",
);

const aliased = setCustomFolderAliases(renamed, renamed.custom[0]!.id, ["repo", "code"]);
assert(aliased.custom[0]!.aliases.join(",") === "repo,code", "aliases stored");

const merged = mergeFolderCatalog(builtin, aliased);
assert(merged.length === 3, "built-ins + custom");
assert(merged[2]!.title === "Kavibay Repo", "custom entry merged");
assert(merged[2]!.aliases.join(",") === "repo,code", "custom aliases kept");
assert(
  mergeFolderCatalog(builtin, renamed)[2]!.aliases.join(",") === "kavibay repo,kavibay",
  "no aliases → derived defaults",
);

// A user folder that duplicates a built-in path must not produce a second row.
const dupBuiltin = addCustomFolder(empty, "c:/users/x/downloads");
const dupMerged = mergeFolderCatalog(builtin, dupBuiltin);
assert(dupMerged.length === 2, "duplicate of a built-in path collapses");
assert(dupMerged[1]!.id === "downloads", "built-in wins the duplicate");

assert(
  removeCustomFolder(aliased, aliased.custom[0]!.id).custom.length === 0,
  "remove drops the folder",
);

// Normalization of persisted junk
const normalized = normalizeFolderPrefs({
  disabledBuiltinIds: ["desktop", "desktop", 7],
  custom: [
    { path: "C:\\Dev", title: "  ", aliases: ["A", " ", 3] },
    { path: "c:/dev" },
    { title: "no path" },
    "nonsense",
  ],
});
assert(normalized.disabledBuiltinIds.join(",") === "desktop", "disabled ids deduped");
assert(normalized.custom.length === 1, "custom deduped, junk dropped");
assert(normalized.custom[0]!.title === "Dev", "blank title → leaf");
assert(normalized.custom[0]!.aliases.join(",") === "a", "aliases normalized");
assert(
  normalizeFolderPrefs(null).custom.length === 0 &&
    normalizeFolderPrefs(null).disabledBuiltinIds.length === 0,
  "unknown shape → defaults",
);

console.log("folderPrefsLogic.assert.ts: ok");
