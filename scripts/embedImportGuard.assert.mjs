/**
 * CI guard: the embed package — and anything landing/ loads — must not import
 * the catalog magnet, Tauri, or the landing site itself.
 *
 * The failure this exists to catch is the one the landing-demo plan measured:
 * bundledExtensions.ts eagerly globs every extension.ts and view.ts under
 * extensions/<id>/, which pulls all 32 extensions and about 1 MB of tiptap
 * into the bundle. Blocking only core/app/extensions/ is not enough; an
 * earlier draft of that plan believed it was. Walk the import graph so a
 * transitive reach through cockpit.ts or widgetViews.ts fails the same way.
 *
 * Tauri is refused outright in files this package owns. App components it
 * reuses are a different case: `WidgetCard.vue` legitimately reports its
 * interactive rectangles to Rust, and forking the card to hide that would give
 * up the reuse this package exists for. Those specifiers must instead be
 * aliased away in `vite.embed.config.ts`, and the emitted bundle is checked for
 * the IPC hook so the alias cannot silently stop working.
 *
 * Run: node scripts/embedImportGuard.assert.mjs
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const siteRoot = join(repoRoot, "../www.kavibay.com");
const SOURCE = /\.(ts|mts|tsx|vue|js|mjs)$/;
const posix = (path) => path.split(sep).join("/");
const siteRel = (file) => posix(relative(siteRoot, file));
const isSiteFile = (file) => !posix(relative(siteRoot, file)).startsWith("..");

/**
 * Tauri specifiers the embed build replaces with `core/embed/tauriAbsent.ts`.
 * Read from the config rather than repeated here, so the two cannot drift.
 */
const ALIASED_AWAY = new Set(
  [...readFileSync(join(repoRoot, "vite.embed.config.ts"), "utf8")
    .matchAll(/"(@tauri-apps\/[^"]+)":\s*path\.resolve/g)].map((match) => match[1]),
);

function collect(dir, found = []) {
  if (!existsSync(dir)) return found;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", "target"].includes(entry.name)) continue;
      // Built output, not source. Walking it would match minified Vue, not our imports.
      if (posix(relative(siteRoot, full)) === "embed") continue;
      collect(full, found);
    } else if (SOURCE.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

function skipLandingBuildOutput(file) {
  return siteRel(file).startsWith("embed/");
}

/**
 * Type-only statements, dropped before anything is scanned.
 *
 * `import type { PaletteRow } from "./paletteResults"` emits no code: with
 * `isolatedModules` the bundler erases the whole statement, so the module on
 * the other end is never fetched, never bundled, never run. This guard exists
 * to keep weight (the catalog magnet, tiptap) and Tauri IPC out of a browser
 * bundle, and a type import carries neither.
 *
 * It matters because refusing them pushes the embed package into rewriting
 * rules the app already owns — `folderScope.ts` is pure path arithmetic and
 * imports `PaletteRow` for one predicate's signature. Refusing it bought no
 * safety and would have cost a second, drifting copy of the folder stack.
 */
function withoutTypeOnlyImports(source) {
  return source
    .replace(/\bimport\s+type\s+[^;]*?\bfrom\s*["'][^"']+["']/g, "")
    .replace(/\bexport\s+type\s+\{[^}]*\}\s*from\s*["'][^"']+["']/g, "");
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

const EXTENSIONS = [".ts", ".tsx", ".vue", ".js", ".mjs", ".mts"];

function resolveSpecifier(fromFile, specifier) {
  if (specifier.startsWith("@tauri-apps/")) return { kind: "tauri", specifier };
  if (specifier === "vue" || specifier.startsWith("vue/")) return { kind: "package", specifier };

  let resolved;
  if (specifier === "@sdk" || specifier.startsWith("@sdk/")) {
    const rest = specifier === "@sdk" ? "" : specifier.slice("@sdk/".length);
    resolved = rest
      ? resolve(repoRoot, "sdk/extension", rest)
      : resolve(repoRoot, "sdk/extension/index.ts");
  } else if (specifier.startsWith(".")) {
    resolved = resolve(dirname(fromFile), specifier);
  } else {
    return { kind: "package", specifier };
  }

  const candidates = [];
  if (SOURCE.test(resolved)) candidates.push(resolved);
  else {
    for (const ext of EXTENSIONS) candidates.push(resolved + ext);
    for (const ext of EXTENSIONS) candidates.push(join(resolved, "index" + ext));
  }

  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return { kind: "file", path: candidate, specifier };
    }
  }
  return { kind: "unresolved", specifier, attempted: posix(relative(repoRoot, resolved)) };
}

function isRefused(filePath, fromFile) {
  const rel = posix(relative(repoRoot, filePath));
  if (rel === "core/app/extension-host/bundledExtensions.ts") return "bundledExtensions.ts is the catalog magnet";
  if (rel === "core/app/extension-host/widgetViews.ts") return "widgetViews.ts is built from bundledExtensions";
  if (rel === "core/app/extension-host/cockpit.ts") return "cockpit.ts imports the magnet and tauriProviderTransport";
  /**
   * The entry point, not the folder.
   *
   * `loadExtensions.ts` imports `extensionHostWidgets` from cockpit.ts, which
   * imports the magnet — so it and `registry.ts`, which re-exports it, are
   * refused. The rest of that folder is pure (`initialSize.ts`,
   * `extensionIcon.ts`), and refusing it wholesale would push this package into
   * reimplementing rules the app already owns, which is the drift this whole
   * guard exists to prevent. Anything in there that *does* reach the magnet is
   * caught by the walk, with the chain named.
   */
  if (rel === "core/app/extensions/loadExtensions.ts") return "loadExtensions.ts reaches cockpit.ts, and through it the catalog magnet";
  if (rel === "core/app/palette/paletteResults.ts") return "paletteResults.ts expects catalog rows and reaches the registry";
  if (isSiteFile(filePath) && !isSiteFile(fromFile)) {
    return "the embed package must not import from the public site";
  }
  return null;
}

function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function touchesMetadata(source, fileRelative) {
  const code = withoutComments(source);
  const hits = [];
  if (/\bdocument\.title\b/.test(code)) hits.push(`${fileRelative} writes document.title`);
  if (/\bdocument\.head\b/.test(code)) hits.push(`${fileRelative} touches document.head`);
  if (/\bcreateElement\s*\(\s*["']meta["']/.test(code)) hits.push(`${fileRelative} creates a <meta>`);
  if (/\bcreateElement\s*\(\s*["']title["']/.test(code)) hits.push(`${fileRelative} creates a <title>`);
  if (/\bquerySelector(All)?\s*\(\s*["']\s*(meta|title|link\s*\[rel)/i.test(code)) {
    hits.push(`${fileRelative} queries a meta/title/canonical node`);
  }
  if (/\bsetAttribute\s*\(\s*["']rel["']/.test(code)) hits.push(`${fileRelative} sets a rel attribute`);
  return hits;
}

const problems = [];
const seen = new Set();
const queue = [];

for (const file of collect(join(repoRoot, "core/embed"))) {
  queue.push(file);
}
for (const file of collect(siteRoot)) {
  if (skipLandingBuildOutput(file)) continue;
  queue.push(file);
}

while (queue.length > 0) {
  const file = queue.shift();
  const rel = posix(relative(repoRoot, file));
  if (seen.has(rel)) continue;
  seen.add(rel);

  const source = readFileSync(file, "utf8");
  // Metadata is a landing/embed invariant. App files the graph walks into
  // (fuzzy.ts today, SandboxedWidgetFrame later) are allowed to be app code.
  if (rel.startsWith("core/embed/") || isSiteFile(file)) {
    problems.push(...touchesMetadata(source, isSiteFile(file) ? siteRel(file) : rel));
  }

  for (const specifier of importsIn(withoutTypeOnlyImports(source))) {
    const resolved = resolveSpecifier(file, specifier);
    if (resolved.kind === "tauri") {
      // Files this package owns may not reach for Tauri at all.
      if (rel.startsWith("core/embed/") || isSiteFile(file)) {
        problems.push(
          `${rel}\n    imports "${specifier}"\n    the embed package itself may never reference @tauri-apps/*`,
        );
      } else if (!ALIASED_AWAY.has(specifier)) {
        // A reused app component is allowed to be app code — but only through
        // a specifier the embed build replaces, so no IPC reaches the browser.
        problems.push(
          `${rel}\n    imports "${specifier}"\n` +
            `    add it to resolve.alias in vite.embed.config.ts, or stop reusing this file`,
        );
      }
      continue;
    }
    if (resolved.kind !== "file") continue;

    const reason = isRefused(resolved.path, file);
    if (reason) {
      problems.push(`${rel}\n    imports "${specifier}" → ${posix(relative(repoRoot, resolved.path))}\n    ${reason}`);
      continue;
    }

    const nextRel = posix(relative(repoRoot, resolved.path));
    // Follow into app/sdk code so a transitive magnet still fails. Stop at
    // node_modules; Vue is a package, not a path we own.
    if (nextRel.startsWith("..")) continue;
    if (!seen.has(nextRel)) queue.push(resolved.path);
  }
}

/**
 * The alias is the mechanism; this is the proof it worked. A build that ships
 * the IPC hook has either lost an alias or gained a new Tauri import through a
 * path the walk above cannot see.
 */
const built = join(siteRoot, "embed/kavibay-embed.js");
if (existsSync(built)) {
  const output = readFileSync(built, "utf8");
  /**
   * `transformCallback` is the IPC bridge's own callback registry — it exists
   * only inside `@tauri-apps/api`, so its presence means the alias stopped
   * working.
   *
   * Deliberately NOT `__TAURI_INTERNALS__`: that string is in the bundle on
   * purpose. It is what `hasTauri()` tests in `clickThrough.ts` and
   * `onboardingSession.ts`, and those guards are the reason the app's real
   * card can be reused unchanged. Matching on it would fail the build for
   * doing the right thing.
   */
  /**
   * The Widget Wizard stays in its own chunk.
   *
   * It is 350 KB of source that most pages never show, and it is only out of
   * the entry because `main.ts` imports it dynamically. A stray static import
   * anywhere would pull it back in silently — the bundle would simply grow by
   * about 44 KB gzip and nothing would fail. This is the alarm for that.
   *
   * Matched on the composer's placeholder, which only the component contains.
   * Function names do not survive minification, and the first marker chosen —
   * "Describe a widget" — was the Wizard's *manifest* description, which the
   * Gallery legitimately pulls into the entry: it globs every manifest to list
   * the catalog. The guard fired on metadata while the code was correctly
   * split. Match on something only the code has.
   */
  if (output.includes("drop a screenshot")) {
    problems.push(
      [
        "www.kavibay.com/embed/kavibay-embed.js",
        "    contains the Widget Wizard's own markup",
        "    it belongs in kavibay-embed-lazyWizard.js; something imports it statically",
      ].join("\n"),
    );
  }

  if (output.includes("transformCallback")) {
    problems.push(
      [
        "www.kavibay.com/embed/kavibay-embed.js",
        "    contains transformCallback, which only @tauri-apps/api defines",
        "    the built browser bundle carries Tauri IPC; check resolve.alias in vite.embed.config.ts",
      ].join("\n"),
    );
  }
}

if (problems.length > 0) {
  throw new Error(`embedImportGuard: ${problems.length} violation(s):\n\n  ${problems.join("\n\n  ")}\n`);
}

console.log("embedImportGuard.assert.mjs: ok");
