/**
 * CI guard: every first-party extension under `extensions/<id>/` has a manifest
 * the host can actually load.
 *
 * This exists for one newcomer mistake in particular: the folder name must equal
 * `manifest.id`, and when it doesn't the widget simply never appears in the
 * palette — no error, nothing to search for. Here it fails with a sentence
 * saying what to rename.
 *
 * Run: node scripts/extensionManifests.assert.mjs
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hasContractSurface } from "./contractSurface.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const extensionsDir = join(repoRoot, "extensions");

const problems = [];
const seenIds = new Map();
/** Catalog ids claimed via a contract manifest's `replaces`, to catch two claimants. */
const seenReplaces = new Map();
let contractCount = 0;

const folders = readdirSync(extensionsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

if (folders.length === 0) problems.push("extensions/ contains no extension folders");

for (const folder of folders) {
  const dir = join(extensionsDir, folder);
  const at = (msg) => problems.push(`extensions/${folder}: ${msg}`);

  const manifestPath = join(dir, "manifest.json");
  if (!existsSync(manifestPath)) {
    at("no manifest.json");
    continue;
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (err) {
    at(`manifest.json is not valid JSON — ${err.message}`);
    continue;
  }

  /**
   * Contract extensions share this folder and are a different shape: their
   * identity, version and engine range are compiled into `extension.ts` rather
   * than parsed, and the manifest carries presentation only. Checked against
   * their own rules instead of being exempted, because the mistakes are the
   * same kind — a widget that loads and then quietly is not in the palette.
   */
  if (manifest.format === "contract") {
    contractCount += 1;

    /**
     * The identity block, in the same shape a widget package states it — that
     * is the point of the format, so it is checked rather than assumed.
     * `extension.ts` reads these fields back out of this file, so they cannot
     * drift; what they can be is missing, and the symptom is a TypeScript
     * error a long way from here.
     */
    if (manifest.name !== folder) {
      at(`manifest.name is "${manifest.name}" but the folder is "${folder}" — the host matches them by name, so rename one to match the other`);
    }
    if (seenIds.has(manifest.name)) at(`duplicate name, also used by extensions/${seenIds.get(manifest.name)}`);
    else seenIds.set(manifest.name, folder);

    for (const field of ["version", "displayName"]) {
      if (typeof manifest[field] !== "string" || manifest[field].trim() === "") {
        at(`manifest.${field} is required and must be a non-empty string`);
      }
    }
    if (typeof manifest.engines?.kavibay !== "string" || manifest.engines.kavibay.trim() === "") {
      at('manifest.engines.kavibay is required (a semver range this app satisfies, e.g. "^0.1")');
    }
    /**
     * Both files are discovered by their default export, and leaving it off is
     * invisible everywhere it could be caught: named exports typecheck, lint
     * and pass the assert suite, and the failure is a module-load error in the
     * browser that takes the whole board down with it.
     */
    for (const [file, what] of [
      ["extension.ts", "the extension manifest from defineExtension"],
      ["view.ts", "an ExtensionViews map"],
    ]) {
      const path = join(dir, file);
      if (!existsSync(path)) {
        if (file === "extension.ts") {
          at('format is "contract" but there is no extension.ts (the host globs extension.ts to discover it)');
        }
        continue;
      }
      if (!/^\s*export\s+default\s/m.test(readFileSync(path, "utf8"))) {
        at(`${file} has no default export — the host globs it with { import: "default" } and expects ${what}`);
      }
    }

    const widgets = manifest.widgets;
    const hasWidgets = widgets && typeof widgets === "object" && Object.keys(widgets).length > 0;
    const hasActions = Array.isArray(manifest.actions) && manifest.actions.length > 0;
    const hasProvider = existsSync(join(dir, "provider.ts"));
    if (!hasContractSurface({ hasWidgets, hasActions, hasProvider })) {
      at("must contribute a widget, a standalone action, or a provider.ts");
      continue;
    }
    if (hasWidgets && !existsSync(join(dir, "view.ts"))) {
      at("declares widgets but has no view.ts, so every one of them renders the broken-widget placeholder");
    }

    if (!hasWidgets) continue;

    for (const [name, entry] of Object.entries(widgets)) {
      if (!entry || typeof entry !== "object") {
        at(`manifest.widgets["${name}"] must be an object`);
        continue;
      }
      if (entry.replaces !== undefined) {
        if (typeof entry.replaces !== "string" || entry.replaces.trim() === "") {
          at(`manifest.widgets["${name}"].replaces must be a non-empty catalog id`);
        } else if (seenReplaces.has(entry.replaces)) {
          at(
            `widget "${name}" replaces catalog id "${entry.replaces}", already claimed by ${seenReplaces.get(entry.replaces)} — ` +
              "two widgets on one catalog id means the layout resolves placed tiles to whichever loaded last",
          );
        } else {
          seenReplaces.set(entry.replaces, `extensions/${folder}`);
        }
      }
      /**
       * The catalog's fresh-profile default. Checked here because the value is
       * read once at first boot and never again: a `"false"` string would be
       * truthy, ship an extension enabled that was meant to be off, and leave
       * no trace once the profile has a stored record.
       */
      if (entry.enabledByDefault !== undefined && typeof entry.enabledByDefault !== "boolean") {
        at(`manifest.widgets["${name}"].enabledByDefault must be a boolean (omit it for the "on" default)`);
      }
      const ui = entry.ui ?? {};
      const pair = (value, keys) =>
        value === undefined ||
        (value && typeof value === "object" && keys.every((key) => typeof value[key] === "number"));
      if (!pair(ui.defaultSize, ["w", "h"])) {
        at(`manifest.widgets["${name}"].ui.defaultSize must be { w, h } numbers (CSS px)`);
      }
      if (!pair(ui.defaultOffset, ["x", "y"])) {
        at(`manifest.widgets["${name}"].ui.defaultOffset must be { x, y } numbers`);
      }
    }

    /**
     * Search keywords are read per widget, never from the top level.
     *
     * The top-level list only reaches the catalog for an extension that
     * contributes actions and no widget; for a widget it is read by nothing and
     * says so nowhere. The Widget Wizard shipped like this and could not be
     * found by "ai" or "generate" — a palette row silently carrying no keywords
     * is invisible in review and invisible in the UI, which is what makes this
     * worth a guard rather than a convention.
     */
    const topLevelKeywords = Array.isArray(manifest.keywords) ? manifest.keywords : [];
    const widgetKeywords = Object.values(widgets).some(
      (entry) => Array.isArray(entry?.keywords) && entry.keywords.length > 0,
    );
    if (topLevelKeywords.length > 0 && !widgetKeywords) {
      at(
        'manifest.keywords is set but no widget declares any — a widget row reads manifest.widgets["<name>"].keywords, ' +
          "so these reach nothing. Copy them onto the widget entry.",
      );
    }

    continue;
  }

  if (!existsSync(join(dir, "index.ts"))) at("no index.ts (the host globs index.ts to discover it)");

  if (manifest.id !== folder) {
    at(`manifest.id is "${manifest.id}" but the folder is "${folder}" — the host matches them by name, so rename one to match the other`);
  }
  if (seenIds.has(manifest.id)) at(`duplicate id, also used by extensions/${seenIds.get(manifest.id)}`);
  else seenIds.set(manifest.id, folder);

  for (const field of ["name", "description", "version"]) {
    if (typeof manifest[field] !== "string" || manifest[field].trim() === "") {
      at(`manifest.${field} is required and must be a non-empty string`);
    }
  }

  const ui = manifest.ui ?? {};
  const isNumberPair = (value, keys) =>
    value && typeof value === "object" && keys.every((key) => typeof value[key] === "number");
  if (!isNumberPair(ui.defaultSize, ["w", "h"])) at("manifest.ui.defaultSize { w, h } is required (CSS px)");
  if (!isNumberPair(ui.defaultOffset, ["x", "y"])) at("manifest.ui.defaultOffset { x, y } is required");

  if (manifest.icon && !existsSync(join(dir, manifest.icon))) {
    at(`manifest.icon points at "${manifest.icon}", which does not exist`);
  }
}

if (problems.length > 0) {
  throw new Error(`extensionManifests: ${problems.length} problem(s):\n  ${problems.join("\n  ")}`);
}

console.log(
  `extensionManifests.assert.mjs: ok (${folders.length} extensions, ${contractCount} on the contract)`,
);
