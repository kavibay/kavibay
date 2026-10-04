/**
 * Run: npx tsx src/core/runtime/runtimeInstallLogic.assert.ts
 */
import {
  canEnableRuntimeExt,
  contractGrantFrom,
  consentLinesFor,
  needsReconsent,
  needsReviewBeforeEnable,
  runtimeExtVisible,
  grantablePermissionsFromManifest,
  normalizeRuntimeInstalls,
} from "./runtimeInstallLogic";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function assertEq(actual: unknown, expected: unknown, msg: string) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${msg}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`,
  );
}

// --- runtimeExtVisible ---
// The palette, resolveExtension and the scan all ask this one function. They
// used to each spell the rule out, and a widget the wizard had just enabled
// stayed invisible because two of the three were updated and one was not.
assert(
  runtimeExtVisible({ developerExtensionsEnabled: false, origin: "custom" }) === true,
  "your own widgets are visible without developer mode",
);
assert(
  runtimeExtVisible({ developerExtensionsEnabled: false, origin: "installed" }) === false,
  "a folder drop-in still needs developer mode",
);
assert(
  runtimeExtVisible({ developerExtensionsEnabled: true, origin: "installed" }) === true,
  "developer mode shows installed packages",
);
assert(
  runtimeExtVisible({ developerExtensionsEnabled: false }) === false,
  "an unknown origin is treated as installed",
);

// --- needsReviewBeforeEnable ---
// The wizard may enable a widget it just built, but not hand out the two things
// the consent screen exists for.
assert(
  needsReviewBeforeEnable({ permissions: ["storage.instance"], apiEndpoints: [] }) === false,
  "storage alone needs no review",
);
assert(
  needsReviewBeforeEnable({ permissions: [], apiEndpoints: [] }) === false,
  "a package that asks for nothing needs no review",
);
assert(
  needsReviewBeforeEnable({ permissions: ["network.declared"], apiEndpoints: [] }) === true,
  "network permission needs review",
);
assert(
  needsReviewBeforeEnable({ permissions: ["background.pop"], apiEndpoints: [] }) === true,
  "running hidden and taking focus needs review",
);
assert(
  needsReviewBeforeEnable({ permissions: [], apiEndpoints: [{}] }) === true,
  "a declared endpoint needs review even without the permission listed",
);
assert(needsReviewBeforeEnable({}) === false, "an empty row needs no review");

// --- canEnableRuntimeExt ---
// A custom package was built in the app, so the developer flag — which gates
// folder drop-ins — must not stand in front of it.
assert(
  canEnableRuntimeExt({
    developerExtensionsEnabled: false,
    scanStatus: "ready",
    origin: "custom",
  }) === true,
  "custom package enables without developer mode",
);
assert(
  canEnableRuntimeExt({
    developerExtensionsEnabled: false,
    scanStatus: "ready",
    origin: "installed",
  }) === false,
  "installed package still needs developer mode",
);
assert(
  canEnableRuntimeExt({
    developerExtensionsEnabled: true,
    scanStatus: "error",
    origin: "custom",
  }) === false,
  "a broken package is never enabled, whatever its origin",
);

assert(
  canEnableRuntimeExt({
    developerExtensionsEnabled: true,
    scanStatus: "ready",
  }) === true,
  "dev on + ready → can enable",
);
assert(
  canEnableRuntimeExt({
    developerExtensionsEnabled: false,
    scanStatus: "ready",
  }) === false,
  "dev off → cannot enable",
);
assert(
  canEnableRuntimeExt({
    developerExtensionsEnabled: true,
    scanStatus: "error",
  }) === false,
  "error status → cannot enable",
);
assert(
  canEnableRuntimeExt({
    developerExtensionsEnabled: false,
    scanStatus: "error",
  }) === false,
  "dev off + error → cannot enable",
);

// --- normalizeRuntimeInstalls ---
assert(
  Array.isArray(normalizeRuntimeInstalls(null)) &&
    normalizeRuntimeInstalls(null).length === 0,
  "null → empty list",
);
assert(
  normalizeRuntimeInstalls({}).length === 0,
  "non-array → empty list",
);

{
  const rows = normalizeRuntimeInstalls([
    {
      id: "demo",
      enabled: true,
      grantedPermissions: ["storage.instance", "shell.exec", "network.declared"],
    },
    { id: "", enabled: true, grantedPermissions: [] },
    { id: "bad", enabled: "yes", grantedPermissions: "nope" },
    null,
    {
      id: "demo",
      enabled: false,
      grantedPermissions: ["storage.instance"],
    },
  ]);
  assert(rows.length === 2, "keeps two valid rows (dedupe by last id)");
  const demo = rows.find((r) => r.id === "demo");
  assert(demo != null, "demo present");
  assert(demo!.enabled === false, "later demo wins (enabled false)");
  assert(
    JSON.stringify(demo!.grantedPermissions) ===
      JSON.stringify(["storage.instance"]),
    "demo permissions from last record; unknown perms stripped",
  );
  const bad = rows.find((r) => r.id === "bad");
  assert(bad != null, "bad id kept with defaults");
  assert(bad!.enabled === false, "non-boolean enabled → false");
  assert(bad!.grantedPermissions.length === 0, "invalid perms → []");
}

// --- grantablePermissionsFromManifest ---
// `network.client` (raw fetch) is reserved and unimplemented: packages reach the
// network only through declared endpoints, so it must never be granted.
assert(
  JSON.stringify(
    grantablePermissionsFromManifest([
      "storage.instance",
      "network.declared",
      "background.pop",
      "network.client",
      "backend.sidecar",
      "shell.exec",
    ]),
  ) === JSON.stringify(["storage.instance", "network.declared", "background.pop"]),
  "grant only storage.instance + network.declared + background.pop",
);

// --- re-consent when the declaration changed under a granted package ---
assert(
  needsReconsent({ enabled: true, apiHash: "abc" }, "abc") === false,
  "unchanged declaration needs no review",
);
assert(
  needsReconsent({ enabled: true, apiHash: "abc" }, "def") === true,
  "an edited declaration needs review",
);
assert(
  needsReconsent({ enabled: true, apiHash: null }, "abc") === true,
  "a package that gained endpoints needs review",
);
assert(
  needsReconsent({ enabled: true, apiHash: "abc" }, null) === true,
  "a package that dropped its declaration needs review",
);
// A disabled package is not calling anything, so there is nothing to review.
assert(
  needsReconsent({ enabled: false, apiHash: "abc" }, "def") === false,
  "disabled packages need no review",
);
assert(needsReconsent(undefined, "abc") === false, "never enabled, never stale");

// --- consent lines ---------------------------------------------------------
//
// Rendered in two places now (Settings and the wizard bubble), and a grant is
// only honest if the line describing it is. These pin the wording that carries
// meaning; the prose around it may change.

assertEq(
  consentLinesFor({ permissions: ["storage.instance"], apiEndpoints: [] }),
  ["Store its own settings for each widget instance"],
  "a permission becomes a plain sentence",
);
assertEq(
  consentLinesFor({ permissions: ["shell.exec"], apiEndpoints: [] }),
  ["shell.exec"],
  "an unknown permission still shows, as its id — never silently dropped",
);

const githubLines = consentLinesFor({
  permissions: ["network.declared"],
  apiEndpoints: [
    {
      description: "Reads the open pull requests of one repository.",
      method: "GET",
      hosts: ["api.github.com"],
      credential: "githubPat",
    },
  ],
});
assert(githubLines.length === 2, "one line per permission plus one per endpoint");
assert(githubLines[1].includes("GET api.github.com"), "the target is named");
assert(githubLines[1].includes("githubPat"), "the credential is named");
assert(
  githubLines[1].includes("never sees"),
  "naming the credential without the reassurance reads as handing the token over",
);

// Fallback hosts are reachable too, so all of them are listed.
assert(
  consentLinesFor({
    apiEndpoints: [
      { description: "Quote.", method: "GET", hosts: ["a.example", "b.example"] },
    ],
  })[0].includes("a.example, b.example"),
  "every reachable host appears",
);
assertEq(consentLinesFor({}), [], "nothing declared, nothing claimed");

assertEq(
  contractGrantFrom({ providers: ["kavibay.tado/tado"], actions: {} }),
  { approved: ["kavibay.tado/tado"] },
  "a grant to read only stores no actions key, like records written before actions existed",
);
assertEq(
  contractGrantFrom({
    providers: ["kavibay.tado/tado"],
    actions: { "kavibay.tado/tado": ["setTemperature"], "kavibay.linear/linear": [] },
  }),
  { approved: ["kavibay.tado/tado"], actions: { "kavibay.tado/tado": ["setTemperature"] } },
  "approved actions are stored, and a provider with none is left out",
);

console.log("runtimeInstallLogic.assert.ts: ok");
