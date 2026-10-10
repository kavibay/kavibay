/**
 * Renders `docs/provider-schema.md` from the shipping providers.
 *
 * Derived, never hand-written: a document describing what a provider returns is
 * a second statement of what `fetch` and `result` already say, and this repo has
 * a findings list full of what happens when two statements of one fact drift.
 * Loading `provider.ts` rather than parsing it is possible because those files
 * are framework-free — the same property that lets the assert suite run widget
 * definitions under `tsx`.
 *
 * Write:  npx tsx scripts/providerSchemaDoc.ts
 * Check:  npx tsx scripts/providerSchemaDoc.assert.ts
 */
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ArgSpec, ProviderDefinition, ResultSchema } from "@sdk/contract/sdk";
import { describeProvider, type ProviderSchema } from "@sdk/contract/providerSchema";
import { schemaHasImage } from "@sdk/contract/imageUrls";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DOC_PATH = join(repoRoot, "docs", "provider-schema.md");
/**
 * The same facts, rendered for a model and embedded in the binary.
 *
 * NOT passed in from the webview: `wizard_complete` documents that the system
 * prompt is not a parameter, so a caller cannot loosen the rules the output is
 * validated against. A caller therefore names a provider and Rust splices the
 * block it already holds — the choice happens at runtime, the content does not
 * come from the choosing side.
 */
export const BLOCKS_PATH = join(repoRoot, "src-tauri", "src", "wizard", "provider-blocks.json");
/**
 * The catalog the MCP tool `list_widget_providers` answers with: names, never
 * schemas.
 *
 * A client lists providers to pick one. The complete blocks it used to receive
 * for that were most of 24 KB of arguments and fields, which it then fetched a
 * second time from `get_authoring_guide` — that tool appends the blocks of the
 * providers it is asked for, so the schema has exactly one place to come from.
 */
export const INDEX_PATH = join(repoRoot, "src-tauri", "src", "wizard", "provider-index.json");
/**
 * The compiled allowlist, generated from the same definitions.
 *
 * WHY GENERATING THIS IS NOT A WEAKENING. The property that matters about the
 * allowlist is that it is **compiled in and PR-reviewed** — a value the webview
 * supplies must not decide where a credential goes. Generating it from a
 * reviewed `provider.ts` keeps both halves of that: the source is in the repo
 * and the output is committed and checked. What it removes is the second
 * hand-maintained statement of one fact, which is what FINDINGS §21, §22 and
 * §26 are each about from a different angle.
 */
export const RUST_TABLE_PATH = join(repoRoot, "src-tauri", "src", "extensions", "generated.rs");

/**
 * The qualified id the registry will derive. Bundled extensions get the
 * `kavibay` namespace from their load source, never from a file.
 */
const providerId = (folder: string, providerName: string) => `kavibay.${folder}/${providerName}`;

export async function collectProviders(): Promise<{ folder: string; def: ProviderDefinition; schema: ProviderSchema }[]> {
  const extensionsDir = join(repoRoot, "extensions");
  const out: { folder: string; def: ProviderDefinition; schema: ProviderSchema }[] = [];

  const folders = readdirSync(extensionsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(extensionsDir, e.name, "provider.ts")))
    .map((e) => e.name)
    .sort();

  for (const folder of folders) {
    const module: Record<string, unknown> = await import(
      pathToFileURL(join(extensionsDir, folder, "provider.ts")).href
    );
    const seen = new Set<ProviderDefinition>();
    for (const [exportName, value] of Object.entries(module)) {
      // Providers conventionally have both a named export and a default
      // export. They are the same definition, not two providers to document.
      if (exportName === "default") continue;
      if (typeof value !== "object" || value === null) continue;
      if (!("queries" in value) || !("actions" in value)) continue;
      const def = value as ProviderDefinition;
      if (seen.has(def)) continue;
      seen.add(def);
      out.push({ folder, def, schema: describeProvider(providerId(folder, def.name), def) });
    }
  }
  return out;
}

/** `list of { id: string, temperature: number? }` — one line, no schema dialect to learn. */
function renderResult(schema: ResultSchema | undefined): string {
  if (!schema) return "—";
  switch (schema.type) {
    case "list":
      return `list of ${renderResult(schema.of)}${schema.nullable ? "?" : ""}`;
    case "object": {
      const fields = Object.entries(schema.fields)
        .map(([key, field]) => `${key}: ${renderResult(field)}`)
        .join(", ");
      return `{ ${fields} }${schema.nullable ? "?" : ""}`;
    }
    default:
      return schema.nullable ? `${schema.type}?` : schema.type;
  }
}

function renderArgs(args: Record<string, ArgSpec>): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return "none";
  return entries
    .map(([name, spec]) => {
      const optional = spec.required ? "" : "?";
      const from = spec.source ? ` (from \`${spec.source.query}\`)` : "";
      return `\`${name}${optional}: ${spec.type}\`${from}`;
    })
    .join(", ");
}

const minutes = (ms: number | undefined) =>
  ms === undefined ? "—" : ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 1000)} s`;

export function render(providers: { folder: string; def: ProviderDefinition; schema: ProviderSchema }[]): string {
  const lines: string[] = [
    "# Provider schema",
    "",
    "**Generated — do not edit.** Written by `scripts/providerSchemaDoc.ts` from the",
    "shipping providers under `extensions/*/provider.ts`; `providerSchemaDoc.assert.ts`",
    "fails the build when this file and the code disagree.",
    "",
    "What a query returns is the provider's own shape, not the vendor's JSON. That is",
    "the point of the `result` column: a widget — including a generated one — reads",
    "these fields and never learns how the upstream API nests things.",
    "",
  ];

  if (providers.length === 0) {
    lines.push("No provider ships yet.", "");
    return lines.join("\n");
  }

  for (const { folder, def, schema } of providers) {
    lines.push(
      `## ${schema.displayName}`,
      "",
      `\`${schema.id}\` · \`extensions/${folder}/provider.ts\``,
      "",
      schema.requiresCredential
        ? "Needs a connected account. The widget gate shows a connect prompt until then."
        : "Needs no credential.",
      "",
      "| Query | Reads | Arguments | Returns | Refresh |",
      "|---|---|---|---|---|",
    );
    for (const query of schema.queries) {
      lines.push(
        `| \`${query.name}\` | ${query.description ?? "—"} | ${renderArgs(query.args)} | \`${renderResult(query.result)}\` | ${minutes(query.staleTime)} |`,
      );
    }
    lines.push("");

    const actions = Object.keys(def.actions);
    lines.push(
      actions.length === 0
        ? "No actions — this provider is read-only."
        : `Actions: ${actions
            .map((name) => `\`${name}\` (${def.actions[name].effect})`)
            .join(", ")}.`,
      "",
    );
  }
  return lines.join("\n");
}



/**
 * One provider as the model should read it.
 *
 * Deliberately not the human table: a model needs the exact field names it may
 * read or pass, and the action names the host will actually run.
 */
export function renderPromptBlock(schema: ProviderSchema): string {
  const lines: string[] = [
    `The widget uses **${schema.displayName}** (\`${schema.id}\`).`,
    "",
    "Use only the queries and actions below, by exactly these names, and read only",
    "the fields listed. These are the provider's own shape — it has already flattened",
    "whatever the upstream API sends, so do not reach for nested objects that are not here.",
    "",
  ];
  for (const query of schema.queries) {
    lines.push(
      `- \`${query.name}\`${query.description ? ` — ${query.description}` : ""}`,
      `  - arguments: ${renderArgs(query.args)}`,
      `  - returns: \`${renderResult(query.result)}\``,
    );
  }
  if (schema.actions.length > 0) {
    lines.push(
      "",
      "Actions — call with `ctx.providers[id].action(name, args)`. They run on the",
      "person's connected account.",
    );
    for (const action of schema.actions) {
      lines.push(
        `- \`${action.name}\`${action.description ? ` — ${action.description}` : ""} (${action.effect})`,
        `  - arguments: ${renderArgs(action.args)}`,
      );
    }
  }
  lines.push(
    "",
    "A field marked `?` can be null: render a dash, never the word null.",
    "",
    `Name this account in \`requires.providers\` as an entry with id \`${schema.id}\`,`,
    schema.actions.length > 0
      ? "the queries the widget reads and, if it changes anything, the actions it calls:"
      : "and the queries the widget reads:",
    "",
    "```json",
    schema.actions.length > 0
      ? `{ "id": "${schema.id}", "queries": ["${schema.queries[0]?.name ?? "…"}"], "actions": ["${schema.actions[0]!.name}"] }`
      : `{ "id": "${schema.id}", "queries": ["${schema.queries[0]?.name ?? "…"}"] }`,
    "```",
    "",
    "Approving the account lets the widget read every query above; `queries` is what",
    "the person is shown, so list exactly the ones you call.",
    ...(schema.actions.length > 0
      ? ["The person approves the actions separately, and the host refuses one that is not listed."]
      : []),
  );
  return lines.join("\n");
}

/**
 * `[{ id, displayName, description, queries, actions }]`, sorted by id.
 *
 * The description is the shipping extension's own manifest line. A provider
 * definition carries none, and writing a second statement of what an
 * extension is would be the drift this generator exists to prevent.
 */
export function renderIndex(providers: { folder: string; schema: ProviderSchema }[]): string {
  const rows = providers
    .map(({ folder, schema }) => {
      const manifest = JSON.parse(
        readFileSync(join(repoRoot, "extensions", folder, "manifest.json"), "utf8"),
      ) as { description?: string };
      return {
        id: schema.id,
        displayName: schema.displayName,
        description: manifest.description ?? "",
        queries: schema.queries.map((query) => query.name),
        actions: schema.actions.map((action) => action.name),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify(rows, null, 2) + "\n";
}

/** `{ providerId: block }` — what Rust embeds and picks from by id. */
export function renderBlocks(providers: { schema: ProviderSchema }[]): string {
  const map: Record<string, string> = {};
  for (const { schema } of providers) map[schema.id] = renderPromptBlock(schema);
  return JSON.stringify(map, null, 2) + "\n";
}


/**
 * The Rust allowlist: one entry per shipping provider.
 *
 * Sorted by id so the file is stable across runs — a generated file that
 * reorders itself turns every unrelated change into a diff nobody can read.
 */
export function renderRustTable(
  providers: { folder: string; def: ProviderDefinition }[],
): string {
  const rows = providers
    .map(({ folder, def }) => ({
      id: providerId(folder, def.name),
      hostRule: rustHostRule(def),
      credentialType: def.credentialType,
      requiresCredential: def.requiresCredential,
      imageHosts: rustImageHosts(def),
      linkHosts: rustHostList(def, "linkHosts", def.linkHosts ?? []),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const row of rows) {
    // Caught here rather than in Rust: the two fields are one fact stated
    // twice, and the file that states them is the one to fail.
    if (row.requiresCredential !== (row.credentialType !== undefined)) {
      throw new Error(
        `${row.id}: requiresCredential is ${row.requiresCredential} but credentialType is ${row.credentialType ?? "absent"}`,
      );
    }
  }

  const body = rows
    .map(
      (row) => `    ProviderDef {
        id: ${JSON.stringify(row.id)},
        host_rule: ${row.hostRule},
        credential_type: ${row.credentialType ? `Some(${JSON.stringify(row.credentialType)})` : "None"},
        image_hosts: ${row.imageHosts},
        link_hosts: ${row.linkHosts},
    },`,
    )
    .join("\n");

  return `//! GENERATED by \`npm run build:provider-doc\`. Do not edit.
//!
//! Source: \`extensions/*/provider.ts\`. Checked by
//! \`scripts/providerSchemaDoc.assert.ts\`, which fails the build when this file
//! and the definitions disagree — so a provider added in TypeScript and
//! forgotten here cannot ship, and neither can a host added here and to nothing
//! else.
//!
//! Compiled in and PR-reviewed, exactly as when it was written by hand. What
//! changed is that one fact is now stated once.

use crate::extension_providers::{HostRule, ProviderDef};

pub const PROVIDERS: &[ProviderDef] = &[
${body}
];
`;
}

/**
 * Compiled picture hosts, which are checked but never given the credential.
 *
 * A provider with none gets an empty slice rather than an option: "this
 * provider serves no pictures" and "somebody forgot" then look the same in
 * Rust, and the one that matters is that the list is checked either way.
 */
function rustImageHosts(def: ProviderDefinition): string {
  const hosts = def.imageHosts ?? [];
  /**
   * The two halves of one fact, checked against each other here because nothing
   * else can see both. A field marked `image: true` whose provider declares no
   * host is refused at fetch time and shows a placeholder — with no error, in
   * the one build where nobody is watching. A declared host nobody points at is
   * an allowlist entry that outlived its reason.
   */
  const marked = Object.entries(def.queries).some(
    ([, query]) => query.result !== undefined && schemaHasImage(query.result),
  );
  if (marked && hosts.length === 0) {
    throw new Error(`${def.name}: a result marks image: true but the provider declares no imageHosts`);
  }
  if (!marked && hosts.length > 0) {
    throw new Error(`${def.name}: declares imageHosts but no result marks image: true`);
  }
  return rustHostList(def, "imageHosts", hosts);
}

/**
 * One compiled host slice, formatted the way `cargo fmt` would leave it.
 *
 * Shared by `imageHosts` and `linkHosts`: both are exact-hostname allowlists
 * reached with a url the vendor chose, so both refuse a wildcard for the same
 * reason — a wildcard is how an allowlist quietly stops being one.
 */
function rustHostList(def: ProviderDefinition, field: string, hosts: string[]): string {
  for (const host of hosts) {
    if (host.includes("*") || host.includes("/")) {
      throw new Error(`${def.name}: ${field} must be exact hostnames, got ${host}`);
    }
  }
  if (hosts.length === 0) return "&[]";
  /**
   * One host per line once the list is long enough that `cargo fmt` would wrap
   * it anyway. The output is committed and `cargo fmt --check` runs in CI, so a
   * generator that emits something rustfmt then reformats makes every build
   * fail the staleness check the *next* time it runs — which is a confusing way
   * to learn about line width.
   */
  const inline = `&[${hosts.map((host) => JSON.stringify(host)).join(", ")}]`;
  if (`        image_hosts: ${inline},`.length <= 100) return inline;
  const indented = hosts.map((host) => `            ${JSON.stringify(host)},`).join("\n");
  return `&[\n${indented}\n        ]`;
}

/** Compiled host rule: exact list, or the credential field that holds the origin. */
function rustHostRule(def: ProviderDefinition): string {
  if (Array.isArray(def.hosts)) {
    if (def.hosts.length === 0) {
      throw new Error(`${def.name}: declares no hosts`);
    }
    return `HostRule::Exact(&[${def.hosts.map((h) => JSON.stringify(h)).join(", ")}])`;
  }
  const field = def.hosts.fromCredential?.trim();
  if (!field) {
    throw new Error(`${def.name}: fromCredential is empty`);
  }
  return `HostRule::FromCredential { field: ${JSON.stringify(field)} }`;
}
