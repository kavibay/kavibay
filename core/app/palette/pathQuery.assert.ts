/**
 * Asserts for path-query parse helpers.
 * Run: npx tsx core/app/palette/pathQuery.assert.ts
 */
import {
  expandHomePrefix,
  looksLikePathQuery,
  parsePathQuery,
  pathParentLabel,
} from "./pathQuery";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(!looksLikePathQuery(""), "empty");
assert(!looksLikePathQuery("chrome"), "app name");
assert(!looksLikePathQuery("dev"), "relative");
assert(looksLikePathQuery("c:"), "bare drive");
assert(looksLikePathQuery("c:/dev"), "forward slash path");
assert(looksLikePathQuery("C:\\Users"), "back slash path");
assert(looksLikePathQuery("~/Downloads"), "home path");
assert(!looksLikePathQuery("\\\\server\\share"), "UNC not yet");

assert(expandHomePrefix("~", null) === null, "~ needs home");
assert(
  expandHomePrefix("~", "C:\\Users\\Alex") === "C:\\Users\\Alex",
  "~ alone",
);
assert(
  expandHomePrefix("~/Downloads", "C:\\Users\\Alex") ===
    "C:\\Users\\Alex\\Downloads",
  "~/child",
);

const a = parsePathQuery("c:/dev", null);
assert(a != null && a.dir.toLowerCase() === "c:\\" && a.prefix === "dev", "c:/dev");

const b = parsePathQuery("c:/dev/", null);
assert(
  b != null && b.dir.toLowerCase() === "c:\\dev\\" && b.prefix === "",
  "c:/dev/",
);

const c = parsePathQuery("C:", null);
assert(c != null && c.dir.toLowerCase() === "c:\\" && c.prefix === "", "C:");

assert(parsePathQuery("c:/foo/../evil", null) === null, "reject ..");
assert(parsePathQuery("chrome", null) === null, "non-path");

assert(
  parsePathQuery("~/dl", "C:\\Users\\Alex")?.dir.toLowerCase() ===
    "c:\\users\\alex\\" &&
    parsePathQuery("~/dl", "C:\\Users\\Alex")?.prefix === "dl",
  "~/dl",
);

assert(pathParentLabel("C:\\dev\\project") === "dev", "parent leaf");
assert(pathParentLabel("C:\\dev") === "C:", "parent drive");

console.log("pathQuery.assert.ts: ok");
