/**
 * CI guard: every catalog id that core names by hand still exists.
 *
 * Core is meant not to know what is in `extensions/`, and two facts break that
 * on purpose — `GALLERY_WIDGET_ID` and `WIDGET_WIZARD_ID` in
 * `core/app/host/builtinWidgetIds.ts`, because those two widgets exist to serve
 * core features rather than the other way round.
 *
 * A hardcoded id is only safe while something checks it. This project has the
 * counter-example: `DEFAULT_EXTENSIONS_PREFS` carried `"github-actions"` long
 * after that extension stopped existing, and it could not be noticed from
 * inside the app — a disabled id matching nothing looks exactly like one
 * matching something the user turned off. The same silence would hide a renamed
 * gallery: the palette's "Widget Gallery" command would create an instance of a
 * type nobody ships, and the tour would wait forever on step 3.
 *
 * Catalog ids are derived the way the app derives them — `replaces` when a
 * widget claims one, else the bundled definition id — because that mapping is
 * the thing a rename would move.
 *
 * Run: npx tsx scripts/coreWidgetIds.assert.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const extensionsDir = join(repoRoot, "extensions");
const problems: string[] = [];

interface WidgetEntry {
  replaces?: unknown;
}
interface Manifest {
  name?: unknown;
  widgets?: Record<string, WidgetEntry>;
}

/** Every catalog id the shipped extensions claim, with the folder that owns it. */
const catalog = new Map<string, string>();
for (const entry of readdirSync(extensionsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  let manifest: Manifest;
  try {
    manifest = JSON.parse(
      readFileSync(join(extensionsDir, entry.name, "manifest.json"), "utf8"),
    ) as Manifest;
  } catch {
    continue;
  }
  const name = typeof manifest.name === "string" ? manifest.name : entry.name;
  for (const [widget, row] of Object.entries(manifest.widgets ?? {})) {
    const id =
      typeof row?.replaces === "string" && row.replaces.trim() !== ""
        ? row.replaces
        : `kavibay.${name}/${widget}`;
    catalog.set(id, `extensions/${entry.name}`);
  }
}

if (catalog.size === 0) {
  throw new Error("coreWidgetIds: no catalog ids found — did extensions/ move?");
}

/**
 * The ids as core states them. Read from the source rather than imported: the
 * module is plain TypeScript and would import fine, but reading it is what
 * makes a constant renamed out of the file a failure instead of a silent pass.
 */
const source = readFileSync(
  join(repoRoot, "core", "app", "host", "builtinWidgetIds.ts"),
  "utf8",
);
const declared = [...source.matchAll(/export const (\w+) = "([^"]+)";/g)].map((m) => ({
  constant: m[1]!,
  id: m[2]!,
}));

const expected = ["GALLERY_WIDGET_ID", "WIDGET_WIZARD_ID"];
for (const constant of expected) {
  if (!declared.some((row) => row.constant === constant)) {
    problems.push(
      `builtinWidgetIds.ts no longer exports ${constant} — if core stopped driving that widget, drop it from this guard too`,
    );
  }
}

for (const { constant, id } of declared) {
  const owner = catalog.get(id);
  if (!owner) {
    problems.push(
      `${constant} names catalog id "${id}", which no extension claims — ` +
        `core would open a widget nobody ships (known ids: ${[...catalog.keys()].sort().join(", ")})`,
    );
  }
}

if (problems.length > 0) {
  throw new Error(`coreWidgetIds: ${problems.length} problem(s):\n  ${problems.join("\n  ")}`);
}

console.log(
  `coreWidgetIds.assert.ts: ok (${declared.length} core-named ids, ${catalog.size} catalog ids)`,
);
