/**
 * CI guard: every extension's `i18n/<lang>.ts` is a catalog the host and the
 * widget can actually use.
 *
 * Each failure below is silent in the app. A translation with a key the source
 * does not have is never shown; a renamed `{placeholder}` renders literally; a
 * host key naming a widget, field or action that was renamed since leaves that
 * label in English with nothing saying why. Types catch some of it inside a
 * widget's own `t()` calls, none of it in a translation nobody imports.
 *
 * Rules (see `core/app/extension-host/localizeExtension.ts` for the key shapes):
 * - File names are locale tags: `en.ts`, `de.ts`, `pt-BR.ts`. Default export.
 * - `en.ts` is the source of the widget's own strings and holds no host keys —
 *   the English for those is already in `manifest.json` and the definition.
 * - Another locale's widget keys pass `catalogProblems` against `en.ts`; its
 *   host keys must each name something the extension declares.
 *
 * Run: npx tsx scripts/extensionCatalogs.assert.ts
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ExtensionManifest, WidgetActionParam } from "@sdk/contract/sdk";
import { catalogProblems, type Messages } from "@sdk/i18n";
import {
  HostMessages,
  isHostKey,
  localizeActions,
  localizeDefinition,
} from "../core/app/extension-host/localizeExtension";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const extensionsDir = join(repoRoot, "extensions");
const problems: string[] = [];
const LOCALE_FILE = /^[a-z]{2,3}(-[A-Z]{2})?\.ts$/;

type RawAction = { id: string; title: string; subtitle?: string; params?: WidgetActionParam[] };
const actionsOf = (value: unknown): RawAction[] =>
  Array.isArray(value)
    ? value.filter((a): a is RawAction => typeof a?.id === "string" && typeof a?.title === "string")
    : [];

const split = (catalog: Record<string, unknown>, host: boolean) =>
  Object.fromEntries(Object.entries(catalog).filter(([key]) => isHostKey(key) === host));

let checked = 0;
for (const entry of readdirSync(extensionsDir, { withFileTypes: true })) {
  const dir = join(extensionsDir, entry.name, "i18n");
  if (!entry.isDirectory() || !existsSync(dir)) continue;
  const where = `extensions/${entry.name}/i18n`;

  const files = readdirSync(dir).filter((file) => !file.endsWith(".assert.ts"));
  const catalogs = new Map<string, Record<string, unknown>>();
  for (const file of files) {
    if (!LOCALE_FILE.test(file)) {
      problems.push(`${where}/${file}: name it after a locale tag, e.g. en.ts or pt-BR.ts`);
      continue;
    }
    const module = await import(pathToFileURL(join(dir, file)).href);
    const catalog = module.default as unknown;
    if (typeof catalog !== "object" || catalog === null || Array.isArray(catalog)) {
      problems.push(`${where}/${file}: needs a default export of the catalog object`);
      continue;
    }
    catalogs.set(file.slice(0, -3), catalog as Record<string, unknown>);
  }

  const source = catalogs.get("en") ?? {};
  for (const problem of catalogProblems(source as Messages)) problems.push(`${where}/en.ts: ${problem}`);
  for (const key of Object.keys(source).filter(isHostKey)) {
    problems.push(`${where}/en.ts: "${key}" is a host key; its English lives in manifest.json or the definition`);
  }

  const definition = (await import(pathToFileURL(join(extensionsDir, entry.name, "extension.ts")).href))
    .default as ExtensionManifest;
  const manifest = JSON.parse(readFileSync(join(extensionsDir, entry.name, "manifest.json"), "utf8"));

  for (const [lang, catalog] of catalogs) {
    checked += 1;
    if (lang === "en") continue;
    const file = `${where}/${lang}.ts`;

    for (const problem of catalogProblems(source as Messages, split(catalog, false))) {
      problems.push(`${file}: ${problem}`);
    }

    const hostKeys = split(catalog, true);
    for (const problem of catalogProblems(hostKeys as Messages)) problems.push(`${file}: ${problem}`);
    const messages = new HostMessages(hostKeys);
    localizeDefinition(definition, messages);
    localizeActions(actionsOf(manifest.actions), "actions.", messages);
    for (const [name, widget] of Object.entries((manifest.widgets ?? {}) as Record<string, { actions?: unknown }>)) {
      localizeActions(actionsOf(widget.actions), `widgets.${name}.actions.`, messages);
    }
    for (const key of messages.unused()) {
      problems.push(`${file}: "${key}" names nothing this extension declares`);
    }
  }
}

if (problems.length > 0) {
  console.error(problems.map((p) => `  ${p}`).join("\n"));
  throw new Error(`extensionCatalogs.assert.ts: ${problems.length} problem(s)`);
}
console.log(`extensionCatalogs.assert.ts: ok (${checked} catalog file(s))`);
