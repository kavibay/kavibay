/**
 * CI guard: for every bundled contract extension, what `manifest.json` declares
 * and what the widget definition implements are the same set of actions.
 *
 * The host already refuses a mismatch — `toActionDeclarations` throws in both
 * directions — but it refuses it in `bundledExtensions.ts`, which reaches for
 * `import.meta.glob` and therefore only ever runs under Vite. So the first
 * report of a mismatched action was a module-load error in the browser that
 * took the whole board down with it, exactly like a missing default export.
 *
 * This runs the host's own pairing function against the real extensions under
 * `tsx`, which `extension.ts` supports because a widget definition is
 * framework-free — the Vue half lives in `view.ts` and is never imported here.
 * That is the same property `providerSchema.assert.ts` relies on.
 *
 * Run: npx tsx scripts/extensionActions.assert.ts
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { toActionDeclarations } from "../core/app/extension-host/widgetActions";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const extensionsDir = join(repoRoot, "extensions");
const problems: string[] = [];

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const folders = readdirSync(extensionsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((folder) => {
    const path = join(extensionsDir, folder, "manifest.json");
    if (!existsSync(path)) return false;
    try {
      return JSON.parse(readFileSync(path, "utf8")).format === "contract";
    } catch {
      return false; // extensionManifests.assert.mjs owns malformed JSON.
    }
  })
  .sort();

let widgetsChecked = 0;
let actionsChecked = 0;

for (const folder of folders) {
  const dir = join(extensionsDir, folder);
  const manifest = asRecord(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")));

  let definition: Record<string, unknown>;
  try {
    const module = await import(pathToFileURL(join(dir, "extension.ts")).href);
    definition = asRecord(module.default);
  } catch (error) {
    problems.push(`extensions/${folder}/extension.ts failed to load — ${(error as Error).message.split("\n")[0]}`);
    continue;
  }

  /**
   * Standalone actions: declared at the top level of the manifest and
   * implemented in `contributes.actions`, for extensions that own no widget
   * (Confetti, Kill Port). Same pairing, same two silent failure modes, and
   * until this ran they were checked only by the Vite-only loader.
   */
  const standalone = asRecord(definition.contributes).actions as
    | Record<string, unknown>
    | undefined;
  if (manifest.actions !== undefined || standalone !== undefined) {
    try {
      const declared = toActionDeclarations(folder, "(standalone)", manifest.actions, standalone);
      actionsChecked += declared.length;
      for (const action of declared) {
        // An action with no widget instance to run against must say so: the
        // palette only builds a row for `needsInstance: false`, so the default
        // makes it declared, paired, and invisible.
        if (action.needsInstance !== false) {
          problems.push(
            `extensions/${folder}: standalone action "${action.id}" does not declare needsInstance: false — ` +
              "the palette only builds direct rows for actions that need no widget, so it would never appear",
          );
        }
      }
    } catch (error) {
      problems.push((error as Error).message);
    }
  }

  const contributed = (asRecord(definition.contributes).widgets ?? []) as Array<Record<string, unknown>>;
  const manifestWidgets = asRecord(manifest.widgets);

  for (const [name, entry] of Object.entries(manifestWidgets)) {
    const widget = contributed.find((w) => w.name === name);
    if (!widget) {
      // The host says the same thing at load; said here it names the file to fix.
      problems.push(
        `extensions/${folder}: manifest.json describes widget "${name}", which extension.ts does not contribute`,
      );
      continue;
    }
    widgetsChecked += 1;
    const handlers = widget.actions as Record<string, unknown> | undefined;
    try {
      actionsChecked += toActionDeclarations(
        folder,
        name,
        asRecord(entry).actions,
        handlers,
      ).length;
    } catch (error) {
      problems.push((error as Error).message);
    }
  }

  /**
   * The gap the host cannot report: a widget the definition contributes and the
   * manifest omits is never iterated, so its actions are never paired and its
   * catalog entry never exists. It does not fail — it is simply absent, which
   * is the hardest symptom to trace back to a missing manifest key.
   */
  for (const widget of contributed) {
    const name = String(widget.name);
    if (!(name in manifestWidgets)) {
      problems.push(
        `extensions/${folder}: extension.ts contributes widget "${name}", which manifest.json does not list — ` +
          "it will not appear in the catalog and its actions are never paired",
      );
    }
  }

  /** Standalone palette actions are paired by the same hard-error helper. */
  const manifestActions = manifest.actions;
  const contributedActions = asRecord(asRecord(definition.contributes).actions);
  if (manifestActions !== undefined || Object.keys(contributedActions).length > 0) {
    try {
      actionsChecked += toActionDeclarations(
        folder,
        "extension",
        manifestActions,
        contributedActions,
      ).length;
    } catch (error) {
      problems.push((error as Error).message);
    }
  }
}

if (problems.length > 0) {
  throw new Error(`extensionActions: ${problems.length} problem(s):\n  ${problems.join("\n  ")}`);
}

// Tripwire: a folder move that leaves this scanning nothing must fail loudly
// rather than report a green run over an empty set.
if (folders.length === 0 || (widgetsChecked === 0 && actionsChecked === 0)) {
  throw new Error(
    `extensionActions: scanned ${folders.length} contract extension(s), ${widgetsChecked} widget(s), and ${actionsChecked} action(s) — ` +
      "expected at least one contract widget or standalone action, so either extensions/ moved or the contract marker changed",
  );
}

console.log(
  `extensionActions.assert.ts: ok (${folders.length} contract extension(s), ${widgetsChecked} widget(s), ${actionsChecked} action(s))`,
);
