/**
 * CI guard: finding 8, pinned.
 *
 * `ProviderHostContext.credentials` used to expose `getAccessToken()` and
 * `getApiKey()`. Provider code is TypeScript in the webview, so that put the
 * token there — and made "secrets never cross the wire" a rule authors had to
 * keep rather than a property of the system. It is now `isConnected()` alone,
 * and the Rust broker attaches auth host-side.
 *
 * The evidence used to be a grep of the built bundle. That only works while the
 * extension host actually ships something, which it deliberately does not yet
 * (see cockpit.ts). Source is the durable place for this check: it holds
 * whether or not a widget has migrated, and it fails on the commit that
 * reintroduces the getter rather than on the release that ships it.
 *
 * Deliberately narrow. `extension-host/credentials.ts` is the in-process vault
 * the assert suite uses when no transport is injected, and it necessarily names
 * these fields — exempting it would empty the guard, so it is not scanned and
 * not the thing being guarded. What is guarded is the contract every provider
 * compiles against, and the wire that reaches the host process.
 *
 * Run: node scripts/extensionHostSecrets.assert.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Files that must never mention a way to obtain a credential value. */
const GUARDED = [
  "sdk/extension/contract",
  "core/app/extension-host/providerTransport.ts",
  "core/app/extension-host/tauriProviderTransport.ts",
];

/**
 * Identifiers that would mean a credential value is reachable from this side.
 * `isConnected` is the one permitted answer about a credential, and it carries
 * no value.
 */
const FORBIDDEN = [
  "getAccessToken",
  "getApiKey",
  "accessToken",
  "refreshToken",
  "apiKey",
  "clientSecret",
  "client_secret",
];

const SOURCE = /\.(ts|vue)$/;

/**
 * Strips comments before scanning. The contract documents finding 8 by naming
 * the getters it removed, so a guard that reads prose would fail on the very
 * explanation of the rule it enforces — and the obvious fix, exempting that
 * file, would switch the guard off entirely.
 *
 * `//` is only treated as a comment when it is not preceded by a colon, so
 * `https://` inside a string survives and a credential smuggled into a URL
 * literal is still caught.
 */
function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function collect(target, found = []) {
  const absolute = join(repoRoot, target);
  let entries;
  try {
    entries = readdirSync(absolute, { withFileTypes: true });
  } catch {
    found.push(absolute); // a file path, not a directory
    return found;
  }
  for (const entry of entries) {
    const child = join(target, entry.name);
    if (entry.isDirectory()) collect(child, found);
    else if (SOURCE.test(entry.name)) found.push(join(repoRoot, child));
  }
  return found;
}

const problems = [];
let scanned = 0;

for (const target of GUARDED) {
  for (const file of collect(target)) {
    scanned += 1;
    const lines = withoutComments(readFileSync(file, "utf8")).split(/\r?\n/);
    const source = lines.join("\n");
    for (const identifier of FORBIDDEN) {
      if (!source.includes(identifier)) continue;
      const line = lines.findIndex((text) => text.includes(identifier)) + 1;
      problems.push(`${relative(repoRoot, file).split(sep).join("/")}:${line} mentions "${identifier}"`);
    }
  }
}

if (problems.length > 0) {
  throw new Error(
    `extensionHostSecrets: ${problems.length} violation(s) of finding 8 — provider code and the ` +
      `wire must not be able to obtain a credential value:\n  ${problems.join("\n  ")}\n\n` +
      `If a provider genuinely needs credential-derived context (a home id, an account id), that ` +
      `is finding 13: template it into the url and let the broker substitute it host-side.`,
  );
}

console.log(`extensionHostSecrets.assert.mjs: ok (${scanned} files)`);
