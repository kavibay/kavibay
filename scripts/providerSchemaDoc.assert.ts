/**
 * CI guard: every file generated from the providers still describes the code.
 *
 * Same shape as `contractGuestArtifact.assert.mjs` — a generated file is
 * committed so it is readable in a PR and on the web, and a guard makes
 * staleness a build failure rather than a document that quietly starts lying.
 *
 * `generated.rs` is the one that matters most and reads least like a document.
 * It is the compiled provider allowlist: which hosts may receive which
 * credential. Generating it removed the second, hand-written statement of a
 * fact `provider.ts` already made — and this check is what keeps "generated"
 * from meaning "regenerated whenever somebody remembers". A provider added in
 * TypeScript and not regenerated fails here rather than shipping as an
 * extension the broker refuses at runtime.
 *
 * Run: npx tsx scripts/providerSchemaDoc.assert.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { relative } from "node:path";
import {
  collectProviders, render, renderBlocks, renderIndex, renderPromptBlock, renderRustTable,
  repoRoot, DOC_PATH, BLOCKS_PATH, INDEX_PATH, RUST_TABLE_PATH,
} from "./providerSchemaDoc";

const providers = await collectProviders();

const outputs: { path: string; expected: string; stale: string }[] = [
  {
    path: DOC_PATH,
    expected: render(providers),
    stale: "a provider's queries, arguments or result changed since it was written",
  },
  {
    path: BLOCKS_PATH,
    expected: renderBlocks(providers),
    stale: "the Wizard would describe providers to the model as they used to be",
  },
  {
    path: INDEX_PATH,
    expected: renderIndex(providers),
    stale: "an MCP client would list providers, queries or actions that are not the shipping ones",
  },
  {
    path: RUST_TABLE_PATH,
    expected: renderRustTable(providers),
    stale: "the compiled allowlist and the provider definitions disagree",
  },
];

for (const { path, expected, stale } of outputs) {
  const shown = relative(repoRoot, path).split("\\").join("/");
  if (!existsSync(path)) {
    throw new Error(`${shown} is missing. Run \`npm run build:provider-doc\`.`);
  }
  const actual = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  if (actual.trimEnd() !== expected.trimEnd()) {
    throw new Error(`${shown} is stale: ${stale}. Run \`npm run build:provider-doc\`.`);
  }
}

{
  const spotify = providers.find((row) => row.schema.id === "kavibay.spotify/spotify");
  if (!spotify) throw new Error("spotify provider missing from collectProviders");
  const block = renderPromptBlock(spotify.schema);
  if (!block.includes("`playlists`")) {
    throw new Error("the Wizard prompt must offer playlists");
  }
  if (!block.includes("`play`")) {
    throw new Error("the Wizard prompt must offer play so a list widget can start a playlist on the active device");
  }
}

console.log(`providerSchemaDoc.assert.ts: ok (${outputs.length} generated files)`);
