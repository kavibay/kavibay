/**
 * CI guard: no reference fixture the app registers claims an id that a real
 * extension under `extensions/` already owns.
 *
 * `ExtensionRegistry.load` refuses the second claimant of an id and records the
 * reason in `registry.errors` — it does not throw, and the extension that lost
 * is not half-loaded, it is absent. No view, no catalog entry, no actions. That
 * is indistinguishable from a widget nobody wrote.
 *
 * It happened: `fixtures/todo` was registered in `cockpit.ts` from before
 * `extensions/todo` existed, and after the port it took `kavibay.todo` first.
 * The shipped Todo widget silently left the catalog. The fixtures are fine in
 * `scenarios.assert.ts`, the dev board and the sandbox host, which each build
 * their own registry — the clash only exists in the one registry the app runs
 * on, so this checks that one: which fixtures `cockpit.ts` actually loads.
 *
 * Run: npx tsx scripts/extensionIdClash.assert.ts
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const hostDir = join(repoRoot, "core", "app", "extension-host");
const extensionsDir = join(repoRoot, "extensions");
const problems: string[] = [];

/** Extension names owned by a folder, from the definition rather than the manifest. */
const owned = new Map<string, string>();
for (const entry of readdirSync(extensionsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const file = join(extensionsDir, entry.name, "extension.ts");
  if (!existsSync(file)) continue;
  const module = await import(pathToFileURL(file).href);
  const name = (module.default as { name?: string } | undefined)?.name;
  if (typeof name === "string") owned.set(name, `extensions/${entry.name}`);
}

/**
 * Which fixtures the app's registry loads. Read out of the source because that
 * is the fact in question — `cockpit.ts` cannot be imported here, it reaches
 * for `import.meta.glob` and only runs under Vite.
 */
const cockpit = readFileSync(join(hostDir, "cockpit.ts"), "utf8");
const loadedSymbols = [...cockpit.matchAll(/registry\.load\(\s*([A-Za-z_$][\w$]*)\s*,/g)].map((m) => m[1]!);

const fixtureFiles = readdirSync(join(hostDir, "fixtures"))
  .filter((name) => name.endsWith(".ts"))
  .sort();

let checked = 0;
for (const file of fixtureFiles) {
  const module: Record<string, unknown> = await import(
    pathToFileURL(join(hostDir, "fixtures", file)).href
  );
  for (const [symbol, value] of Object.entries(module)) {
    if (!loadedSymbols.includes(symbol)) continue;
    const name = (value as { name?: string } | null)?.name;
    if (typeof name !== "string") continue;
    checked += 1;
    const folder = owned.get(name);
    if (folder) {
      problems.push(
        `cockpit.ts registers the fixture \`${symbol}\` (fixtures/${file}), which claims the id "${name}" — ` +
          `${folder} owns it, and whichever loads second is refused and vanishes from the catalog. ` +
          "Drop the fixture from cockpit.ts; the assert suite, dev board and sandbox host load it into their own registries.",
      );
    }
  }
}

if (problems.length > 0) {
  throw new Error(`extensionIdClash: ${problems.length} problem(s):\n  ${problems.join("\n  ")}`);
}

// A fully ported app legitimately has no fixture registrations left. Keep a
// tripwire for the half-moved case, but do not force a test fixture into the
// running catalog merely to keep this assertion non-empty.
if (loadedSymbols.length !== checked) {
  throw new Error(
    `extensionIdClash: found ${loadedSymbols.length} registry.load call(s) in cockpit.ts and resolved ${checked} fixture(s) — ` +
      "the fixture registration and its resolved symbol count disagree",
  );
}

console.log(
  `extensionIdClash.assert.ts: ok (${owned.size} extension id(s), ${checked} app-registered fixture(s))`,
);
