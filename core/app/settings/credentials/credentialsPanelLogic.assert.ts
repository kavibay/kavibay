/**
 * Credentials panel list: search, status filter, selection.
 * Run: npx tsx core/app/settings/credentials/credentialsPanelLogic.assert.ts
 */
import type { CredentialSummary, CredentialTypeSchema } from "./credentialsApi";
import {
  ALL_STATUSES,
  CREDENTIAL_STATUS_FILTERS,
  filterCredentialTypes,
  resolveSelectedTypeId,
  rowStatusLabel,
  summaryForType,
  applyCredentialFocus,
  typeMatchesQuery,
  typeMatchesStatus,
} from "./credentialsPanelLogic";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function type(over: Partial<CredentialTypeSchema> & { id: string; displayName: string }): CredentialTypeSchema {
  return {
    description: "d",
    docsUrl: null,
    authKind: "static",
    supportsTest: false,
    fields: [],
    ...over,
  };
}

function summary(
  over: Partial<CredentialSummary> & { id: string; typeId: string },
): CredentialSummary {
  return {
    name: over.typeId,
    accountLabel: null,
    state: "unconfigured",
    pending: false,
    error: null,
    values: {},
    secretsSet: [],
    missing: [],
    metadata: {},
    updatedAt: 1,
    ...over,
  };
}

const types: CredentialTypeSchema[] = [
  type({ id: "githubPat", displayName: "GitHub Personal Access Token", description: "Actions read" }),
  type({ id: "anthropicApi", displayName: "Anthropic (Claude) API", description: "Messages API" }),
  type({ id: "openaiApi", displayName: "OpenAI API", description: "chat completions" }),
  type({
    id: "tadoOAuth2",
    displayName: "tado° Account",
    description: "Sign in at tado.com",
    authKind: "oauth2DeviceCode",
  }),
];

const credentials: CredentialSummary[] = [
  summary({ id: "c-gh", typeId: "githubPat", state: "connected", secretsSet: ["token"] }),
  summary({ id: "c-tado", typeId: "tadoOAuth2", state: "needsReauth", pending: true }),
];

assert(summaryForType(credentials, "githubPat")?.id === "c-gh", "lookup by type");
assert(summaryForType(credentials, "openaiApi") === null, "missing type is null");

assert(rowStatusLabel(null) === "Not set up", "empty row");
assert(rowStatusLabel(summaryForType(credentials, "githubPat")) === "Set up", "connected, no account");
assert(
  rowStatusLabel({
    ...credentials[0],
    accountLabel: "alex@example.com",
  }) === "alex@example.com",
  "account label is the row status when connected",
);
assert(rowStatusLabel(summaryForType(credentials, "tadoOAuth2")) === "Waiting…", "pending outranks reauth");

assert(typeMatchesQuery(types[0], ""), "empty query matches");
assert(typeMatchesQuery(types[0], "git"), "name match");
assert(typeMatchesQuery(types[1], "CLAUDE"), "case-insensitive name");
assert(typeMatchesQuery(types[1], "messages"), "description match");
assert(typeMatchesQuery(types[0], "githubPat"), "id match");
assert(!typeMatchesQuery(types[0], "openai"), "unrelated query misses");

const gh = summaryForType(credentials, "githubPat");
const tado = summaryForType(credentials, "tadoOAuth2");
assert(typeMatchesStatus(gh, "all"), "all includes ready");
assert(typeMatchesStatus(gh, "ready"), "connected is set up");
assert(!typeMatchesStatus(gh, "unset"), "connected is not unset");
assert(typeMatchesStatus(tado, "attention"), "pending reauth needs attention");
assert(typeMatchesStatus(null, "unset"), "no row is not set up");
assert(!typeMatchesStatus(null, "ready"), "no row is not set up");
assert(!typeMatchesStatus(null, "attention"), "no row does not need attention");

const all = filterCredentialTypes(types, credentials, "", ALL_STATUSES);
assert(all.map((entry) => entry.id).join() === "githubPat,anthropicApi,openaiApi,tadoOAuth2", "registry order kept");

const searched = filterCredentialTypes(types, credentials, "api", ALL_STATUSES);
assert(
  searched.map((entry) => entry.id).join() === "anthropicApi,openaiApi",
  `search should keep registry order, got ${searched.map((entry) => entry.id).join()}`,
);

const ready = filterCredentialTypes(types, credentials, "", "ready");
assert(ready.map((entry) => entry.id).join() === "githubPat", "only set-up types");

const attention = filterCredentialTypes(types, credentials, "", "attention");
assert(attention.map((entry) => entry.id).join() === "tadoOAuth2", "only types waiting on the user");

const unset = filterCredentialTypes(types, credentials, "", "unset");
assert(unset.map((entry) => entry.id).join() === "anthropicApi,openaiApi", "types never saved");

assert(
  filterCredentialTypes(types, credentials, "nope", ALL_STATUSES).length === 0,
  "no matches",
);

assert(resolveSelectedTypeId([], credentials, "githubPat") === null, "empty list has no selection");
assert(
  resolveSelectedTypeId(all, credentials, "openaiApi") === "openaiApi",
  "a still-visible selection is kept across reloads",
);
assert(
  resolveSelectedTypeId(ready, credentials, "openaiApi") === "githubPat",
  "a filtered-out selection falls back to the first visible",
);
assert(
  resolveSelectedTypeId(all, credentials, null) === "tadoOAuth2",
  "first paint prefers a type waiting on the user",
);
assert(
  resolveSelectedTypeId(unset, credentials, null) === "anthropicApi",
  "with nothing waiting, first visible wins",
);

assert(
  CREDENTIAL_STATUS_FILTERS.map((entry) => entry.value).join() === "all,ready,attention,unset",
  "filter order",
);

{
  const focus = applyCredentialFocus(types, "githubPat");
  assert(focus.selectedId === "githubPat", "a known type is selected");
  assert(focus.resetFilters, "filters that might hide it are cleared");
  assert(applyCredentialFocus(types, "nope").selectedId === null, "unknown type is ignored");
  assert(!applyCredentialFocus(types, null).resetFilters, "no focus leaves the list alone");
}

console.log("credentialsPanelLogic.assert.ts: ok");
