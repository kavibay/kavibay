/**
 * CI guard: a shipping provider declares what its queries take, return and mean.
 *
 * `ProviderQuery.args` / `.result` / `.description` are optional in the contract
 * so the reference fixtures keep the exact shape `scenarios.assert.ts` pins. For
 * a provider under `extensions/`, they are not optional at all — they are what
 * the derived schema is built from, and what the Widget Wizard shows a model.
 * Optional-in-the-type plus required-here is the same split `extensionManifests`
 * already uses.
 *
 * Loading the definitions rather than parsing them is the point: `provider.ts`
 * is framework-free and `tsx` can run it, which is exactly the property the
 * contract keeps sections 1-7 free of Vue for.
 *
 * Run: npx tsx scripts/providerSchema.assert.ts
 */
import { readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ProviderDefinition } from "@sdk/contract/sdk";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const extensionsDir = join(repoRoot, "extensions");
const problems: string[] = [];

const folders = readdirSync(extensionsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(extensionsDir, entry.name, "provider.ts")))
  .map((entry) => entry.name)
  .sort();

for (const folder of folders) {
  const module: Record<string, unknown> = await import(
    pathToFileURL(join(extensionsDir, folder, "provider.ts")).href
  );

  const providers = Object.values(module).filter(
    (value): value is ProviderDefinition =>
      typeof value === "object" && value !== null && "queries" in value && "actions" in value,
  );

  if (providers.length === 0) {
    problems.push(`extensions/${folder}/provider.ts exports no provider definition`);
    continue;
  }

  for (const provider of providers) {
    const at = (message: string) => problems.push(`${folder}/${provider.name}: ${message}`);

    for (const [name, query] of Object.entries(provider.queries)) {
      if (typeof query.description !== "string" || query.description.trim() === "") {
        at(`query "${name}" has no description — the consent dialog and the model both read it`);
      }
      if (query.args === undefined) {
        at(`query "${name}" declares no args (use {} when it takes none, so "none" is stated rather than missing)`);
      }
      if (query.result === undefined) {
        at(
          `query "${name}" declares no result — without it a widget author, and a model, must guess field names against a live API`,
        );
      }
    }
  }
}

if (problems.length > 0) {
  throw new Error(`providerSchema: ${problems.length} problem(s):\n  ${problems.join("\n  ")}`);
}

console.log(`providerSchema.assert.ts: ok (${folders.length} provider extension(s))`);
