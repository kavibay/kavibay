/**
 * Run: npx tsx src/core/runtime/manifestValidate.assert.ts
 */
import { isKnownRuntimePermission } from "./permissions";
import {
  assertSafePackageRelativePath,
  draftPreviewHost,
  isValidPackageId,
  withRealPathSeparators,
  validateRuntimeManifest,
} from "./manifestValidate";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

/** Minimal valid FE-only manifest for folder `demo`. */
function baseManifest(overrides: Record<string, unknown> = {}) {
  return {
    id: "demo",
    name: "Demo",
    version: "1.0.0",
    ui: {
      entry: "ui/index.html",
      defaultOffset: { x: 0, y: 0 },
    },
    commands: [] as string[],
    permissions: ["storage.instance"] as string[],
    ...overrides,
  };
}

// --- permission catalog ---
assert(isKnownRuntimePermission("storage.instance"), "storage.instance known");
assert(isKnownRuntimePermission("network.client"), "network.client known");
assert(isKnownRuntimePermission("backend.sidecar"), "backend.sidecar known");
assert(isKnownRuntimePermission("background.pop"), "background.pop known");
assert(!isKnownRuntimePermission("shell.exec"), "unknown permission not known");

// --- package ids ---
// An id becomes a storage namespace, a grant key and a url host, so the shape
// is constrained once rather than defended at each of those. It is also what
// keeps the wizard's `__draft__` preview host from ever naming a real package.
assert(isValidPackageId("demo"), "plain id");
assert(isValidPackageId("water-tracker"), "dashes allowed");
assert(isValidPackageId("a_b9"), "underscores and digits allowed");
assert(!isValidPackageId(""), "empty rejected");
assert(!isValidPackageId(".drafts"), "leading dot rejected");
assert(
  !isValidPackageId(draftPreviewHost("demo")),
  "the draft preview host is not an id",
);
assert(!isValidPackageId("-lead"), "leading dash rejected");
assert(!isValidPackageId("a/b"), "slash rejected");
assert(!isValidPackageId("a.b"), "dot rejected");
assert(!isValidPackageId("x".repeat(65)), "over-long id rejected");

{
  // Both sides must agree; the folder name is what the id is compared against,
  // so an unusable folder name must fail on the id rule, not silently pass.
  const bad = validateRuntimeManifest(
    "__draft__demo",
    baseManifest({ id: "__draft__demo" }),
  );
  assert(!bad.ok && bad.error === "invalid_package_id", "draft-shaped id refused");
}

// --- package URLs ---
// This is the bug that made every generated widget "render but do nothing":
// convertFileSrc encodes the separators, the document lands on a single URL
// segment, and every relative <script src="app.js"> resolves to the origin root
// instead of into the package. It never loaded, and nothing said so.
assert(
  withRealPathSeparators("http://kavibay-ext.localhost/demo%2Fui%2Findex.html") ===
    "http://kavibay-ext.localhost/demo/ui/index.html",
  "separators are restored so the document has a directory",
);
assert(
  withRealPathSeparators("http://kavibay-ext.localhost/demo%2fui%2findex.html") ===
    "http://kavibay-ext.localhost/demo/ui/index.html",
  "lowercase escapes too — encoders differ",
);
// Only the separators. Anything else stays encoded, because the protocol
// decodes it again before validating, and a space turned into a raw character
// here would change what safe_join sees.
assert(
  withRealPathSeparators("http://x/demo%2Fa%20b%2Fc.js") === "http://x/demo/a%20b/c.js",
  "other escapes are left alone",
);
assert(
  withRealPathSeparators("http://x/demo/ui/index.html") ===
    "http://x/demo/ui/index.html",
  "an already-plain URL is unchanged",
);

// --- path safety ---
assert(
  assertSafePackageRelativePath("ui/index.html") === null,
  "accept ui/index.html",
);
assert(
  assertSafePackageRelativePath("../evil.html") !== null,
  "reject ../evil.html",
);
assert(
  assertSafePackageRelativePath("/etc/passwd") !== null,
  "reject /etc/passwd",
);
assert(
  assertSafePackageRelativePath("C:\\Windows\\x") !== null,
  "reject C:\\Windows\\x",
);
assert(
  assertSafePackageRelativePath("//server/share") !== null,
  "reject UNC //",
);
assert(assertSafePackageRelativePath("") !== null, "reject empty path");
assert(
  assertSafePackageRelativePath("ui//index.html") !== null,
  "reject empty segments",
);

// --- happy path ---
{
  const r = validateRuntimeManifest("demo", baseManifest());
  assert(r.ok === true, "valid manifest ok");
  if (r.ok) {
    assert(r.manifest.id === "demo", "manifest id");
    assert(r.manifest.ui.entry === "ui/index.html", "manifest entry");
  }
}

// --- optional opening defaults (hideTitle / scale / size) ---
{
  const r = validateRuntimeManifest(
    "demo",
    baseManifest({
      ui: {
        entry: "ui/index.html",
        defaultOffset: { x: 0, y: 0 },
        defaultSize: { w: 240, h: 200 },
        defaultHideTitle: true,
        defaultScale: 1.5,
      },
    }),
  );
  assert(r.ok === true, "opening defaults ok");
  if (r.ok) {
    assert(r.manifest.ui.defaultHideTitle === true, "defaultHideTitle passed through");
    assert(r.manifest.ui.defaultScale === 1.5, "defaultScale passed through");
    assert(r.manifest.ui.defaultSize?.w === 240, "defaultSize passed through");
  }
}
{
  // A bad value must not kill the package — the host has a fallback for each.
  const r = validateRuntimeManifest(
    "demo",
    baseManifest({
      ui: {
        entry: "ui/index.html",
        defaultOffset: { x: 0, y: 0 },
        defaultSize: { w: 0, h: 200 },
        defaultScale: -1,
      },
    }),
  );
  assert(r.ok === true, "bad opening defaults still valid");
  if (r.ok) {
    assert(r.manifest.ui.defaultScale === undefined, "non-positive scale dropped");
    assert(r.manifest.ui.defaultSize === undefined, "non-positive size dropped");
  }
}

// --- optional icon ---
{
  const r = validateRuntimeManifest("demo", baseManifest({ icon: "icon.svg" }));
  assert(r.ok === true, "icon.svg ok");
  if (r.ok) assert(r.manifest.icon === "icon.svg", "icon passed through");
}
{
  const r = validateRuntimeManifest("demo", baseManifest({ icon: "../evil.svg" }));
  assert(r.ok === false, "reject unsafe icon");
}
{
  const r = validateRuntimeManifest("demo", baseManifest({ icon: "icon.gif" }));
  assert(r.ok === false, "reject non svg/png icon");
}

// --- id must match folderName ---
{
  const r = validateRuntimeManifest("other", baseManifest());
  assert(r.ok === false, "id≠folder → error");
  if (!r.ok) assert(r.error.length > 0, "id mismatch has message");
}

// --- reject unsafe ui.entry ---
{
  const r = validateRuntimeManifest(
    "demo",
    baseManifest({
      ui: { entry: "../evil.html", defaultOffset: { x: 0, y: 0 } },
    }),
  );
  assert(r.ok === false, "reject ../evil.html entry");
}
{
  const r = validateRuntimeManifest(
    "demo",
    baseManifest({
      ui: { entry: "/etc/passwd", defaultOffset: { x: 0, y: 0 } },
    }),
  );
  assert(r.ok === false, "reject /etc/passwd entry");
}
{
  const r = validateRuntimeManifest(
    "demo",
    baseManifest({
      ui: { entry: "C:\\Windows\\x", defaultOffset: { x: 0, y: 0 } },
    }),
  );
  assert(r.ok === false, "reject C:\\Windows\\x entry");
}

// --- missing ui.entry ---
{
  const r = validateRuntimeManifest(
    "demo",
    baseManifest({
      ui: { defaultOffset: { x: 0, y: 0 } },
    }),
  );
  assert(r.ok === false, "missing ui.entry → error");
}

// --- unknown permission ---
{
  const r = validateRuntimeManifest(
    "demo",
    baseManifest({ permissions: ["storage.instance", "shell.exec"] }),
  );
  assert(r.ok === false, "unknown permission → error");
}

// --- backend.sidecar not enableable in P1 ---
{
  const r = validateRuntimeManifest(
    "demo",
    baseManifest({ permissions: ["storage.instance", "backend.sidecar"] }),
  );
  assert(r.ok === false, "sidecar permission → ok:false");
  if (!r.ok) {
    assert(
      r.error.toLowerCase().includes("sidecar"),
      "sidecar error mentions sidecar",
    );
  }
}

// --- credentials are a first-party contract, never a package's ---
{
  const r = validateRuntimeManifest(
    "demo",
    baseManifest({ credentials: [{ type: "githubPat", required: true }] }),
  );
  assert(r.ok === false, "credential declaration → ok:false");
  if (!r.ok) {
    assert(
      r.error.includes("credentials"),
      "credential error names the offending field",
    );
  }
}

console.log("manifestValidate.assert.ts: ok");
