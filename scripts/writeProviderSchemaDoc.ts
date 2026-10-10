/** Entry point: `npm run build:provider-doc`. Kept apart so the renderers stay importable. */
import { writeFileSync } from "node:fs";
import {
  collectProviders, render, renderBlocks, renderIndex, renderRustTable,
  DOC_PATH, BLOCKS_PATH, INDEX_PATH, RUST_TABLE_PATH,
} from "./providerSchemaDoc";

const providers = await collectProviders();
writeFileSync(DOC_PATH, render(providers), "utf8");
writeFileSync(BLOCKS_PATH, renderBlocks(providers), "utf8");
writeFileSync(INDEX_PATH, renderIndex(providers), "utf8");
writeFileSync(RUST_TABLE_PATH, renderRustTable(providers), "utf8");
console.log(`providerSchemaDoc: wrote ${DOC_PATH}, ${BLOCKS_PATH}, ${INDEX_PATH} and ${RUST_TABLE_PATH}`);
