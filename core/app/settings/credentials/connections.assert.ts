/**
 * Run: npx tsx core/app/settings/credentials/connections.assert.ts
 */
import { awaitConnectionCopy, copyConnections } from "./connections";

// No Tauri under tsx, so the copy fails — which is the case under test.
await copyConnections("source", "target").catch(() => {});
await new Promise((resolve) => setTimeout(resolve, 0));

let threw: unknown;
try {
  await awaitConnectionCopy("target");
} catch (error) {
  threw = error;
}
if (threw !== undefined) {
  throw new Error(`a failed copy must not be replayed to every later wait: ${String(threw)}`);
}

console.log("connections.assert.ts: ok");
