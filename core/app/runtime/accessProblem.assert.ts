/**
 * Run: npx tsx core/app/runtime/accessProblem.assert.ts
 */
import { accessProblemFor, packageIdBehind } from "./accessProblem";

function eq(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: got ${JSON.stringify(actual)}`);
  }
}

eq(accessProblemFor("permission_denied"), "enable", "a draft never enabled is not an account problem");
eq(accessProblemFor("needs_review"), "enable", "needs_review");
eq(accessProblemFor("consent_stale"), "enable", "consent_stale");
eq(accessProblemFor("credential_not_configured"), "account", "credential_not_configured");
eq(accessProblemFor("credential_not_granted"), "account", "credential_not_granted");
eq(accessProblemFor("credential_needs_reauth"), "reconnect", "credential_needs_reauth");
eq(accessProblemFor("http_error"), null, "an upstream failure stays the widget's to show");
eq(accessProblemFor(null), null, "no code");

eq(packageIdBehind("__draft__notion-db"), { id: "notion-db", draft: true }, "draft preview id");
eq(packageIdBehind("notion-db"), { id: "notion-db", draft: false }, "kept id");

console.log("accessProblem.assert.ts: ok");
