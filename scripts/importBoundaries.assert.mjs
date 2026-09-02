/**
 * CI guard: the folder license boundaries from AGENTS.md, checked mechanically.
 *
 *   extensions/<id>/  may reach out to packages (@sdk, vue, @tauri-apps/*, npm),
 *                     but a *relative* import must stay inside its own folder —
 *                     that one rule covers both "no core internals" and
 *                     "no cross-extension imports".
 *   sdk/              is MIT and self-contained: no relative import may leave it.
 *
 * Written as a guard script rather than an ESLint rule because the real rule is an
 * allowlist, and `no-restricted-imports` can only express denylists of globs.
 *
 * Run: node scripts/importBoundaries.assert.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = /\.(ts|mts|tsx|vue|js|mjs)$/;

/**
 * Known boundary debt, pinned so it cannot grow.
 *
 * Each entry means "extensions need this and the SDK doesn't offer it yet", not
 * "importing host code is fine". `WidgetProps` was the fourth entry and is gone:
 * it moved to `@sdk/types` where it always belonged.
 *
 * The rest are not pure types, so moving them means relicensing working code
 * GPL→MIT — a maintainer decision with strategic weight, not a refactor. Until
 * then the line sits here. Deleting entries is progress; adding one needs a reason
 * in the PR.
 */
const ALLOWED_ESCAPES = [
  "core/app/system/clickThrough",
  "core/app/audio/sessionEndBeep",
  "core/app/settings/useSettingsModal",
];

/**
 * The Widget Wizard renders the host's own runtime-package preview, so it needs
 * core/runtime internals by design. The documented exception, kept visible.
 */
const EXEMPT_DIRS = ["extensions/widget-wizard"];

function collect(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!["node_modules", "dist", "target"].includes(entry.name)) collect(join(dir, entry.name), found);
    } else if (SOURCE.test(entry.name)) {
      found.push(join(dir, entry.name));
    }
  }
  return found;
}

/** Static `from "x"`, bare `import "x"`, and dynamic `import("x")`. */
function importsIn(source) {
  const specifiers = [];
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
}

const posix = (path) => path.split(sep).join("/");
const problems = [];

/** @param {string} boundaryDir repo-relative dir a relative import may not leave */
function check(boundaryDir, label) {
  const absolute = join(repoRoot, boundaryDir);
  for (const file of collect(absolute)) {
    const fileRelative = posix(relative(repoRoot, file));
    if (EXEMPT_DIRS.some((dir) => fileRelative.startsWith(`${dir}/`))) continue;

    for (const specifier of importsIn(readFileSync(file, "utf8"))) {
      if (!specifier.startsWith(".")) continue; // a package, not a boundary crossing
      const target = posix(relative(repoRoot, resolve(dirname(file), specifier)));
      if (target.startsWith(`${posix(relative(repoRoot, absolute))}/`)) continue; // stayed inside

      const bare = target.replace(/\.(ts|vue|js|mjs)$/, "");
      if (ALLOWED_ESCAPES.includes(bare)) continue;

      problems.push(`${fileRelative}\n    imports "${specifier}" → ${target}\n    ${label}`);
    }
  }
}

for (const entry of readdirSync(join(repoRoot, "extensions"), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  check(
    `extensions/${entry.name}`,
    "An extension may import its own folder, @sdk, vue, @tauri-apps/* and npm packages — " +
      "not host code and not another extension. Needs something from core? Add it to sdk/ " +
      "(that is a licensing decision — flag it in the PR).",
  );
}

check("sdk", "sdk/ is MIT and must stay self-contained: never import core/ or extensions/. Move the helper into sdk/ instead.");

if (problems.length > 0) {
  throw new Error(`importBoundaries: ${problems.length} violation(s):\n\n  ${problems.join("\n\n  ")}\n`);
}

console.log("importBoundaries.assert.mjs: ok");
