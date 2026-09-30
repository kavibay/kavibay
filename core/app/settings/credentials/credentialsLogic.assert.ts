/**
 * Credential editor form logic.
 * Run: npx tsx core/app/settings/credentials/credentialsLogic.assert.ts
 */
import type { CredentialSummary, CredentialTypeSchema } from "./credentialsApi";
import {
  buildFormValues,
  canConnect,
  canSave,
  fieldPlaceholder,
  hasStoredSecret,
  statusLabel,
  statusTone,
  submittableValues,
} from "./credentialsLogic";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const type: CredentialTypeSchema = {
  id: "cloudflareWorkersAi",
  displayName: "Cloudflare Workers AI",
  description: "d",
  docsUrl: null,
  authKind: "static",
  supportsTest: true,
  fields: [
    {
      key: "accountId",
      label: "Account ID",
      kind: "text",
      required: true,
      placeholder: "acc",
      help: null,
    },
    {
      key: "apiToken",
      label: "API Token",
      kind: "password",
      required: true,
      placeholder: null,
      help: null,
    },
  ],
};

const configured: CredentialSummary = {
  id: "c1",
  typeId: type.id,
  name: "Cloudflare",
  accountLabel: null,
  state: "connected",
  pending: false,
  error: null,
  values: { accountId: "acc-1" },
  secretsSet: ["apiToken"],
  missing: [],
  metadata: {},
  updatedAt: 1,
};

// Text values prefill, secrets never do.
const form = buildFormValues(type, configured);
assert(form.accountId === "acc-1", "text field prefilled");
assert(form.apiToken === "", "secret never prefilled");
assert(buildFormValues(type, null).accountId === "", "empty form without a credential");

// A stored secret satisfies its required field, so Save works after editing
// only the account id.
assert(hasStoredSecret(type.fields[1], configured), "stored secret detected");
assert(canSave(type, form, configured), "save enabled with stored secret");
assert(!canSave(type, buildFormValues(type, null), null), "save blocked when empty");
assert(
  canSave(type, { accountId: "a", apiToken: "t" }, null),
  "save enabled once both typed",
);
assert(
  !canSave(type, { accountId: "  ", apiToken: "t" }, null),
  "whitespace is not a value",
);

// Empty secret input means "keep stored", so it must not be submitted.
const submitted = submittableValues(type, { accountId: " acc-2 ", apiToken: "" });
assert(submitted.accountId === "acc-2", "text values trimmed");
assert(!("apiToken" in submitted), "empty secret omitted");
assert(
  submittableValues(type, { accountId: "a", apiToken: " tok " }).apiToken === "tok",
  "typed secret trimmed and submitted",
);
// Clearing a text field is a real change and must be submitted.
assert(submittableValues(type, { accountId: "", apiToken: "" }).accountId === "", "text clears");

assert(fieldPlaceholder(type.fields[1], configured).includes("replace"), "masked placeholder");
assert(fieldPlaceholder(type.fields[0], configured) === "acc", "schema placeholder kept");

assert(statusLabel(null) === "Not configured", "no credential");
assert(statusLabel(configured) === "Connected", "configured without account label");
assert(
  statusLabel({ ...configured, accountLabel: "alex@example.com" }).includes("alex@"),
  "account label shown",
);
assert(statusLabel({ ...configured, state: "needsReauth" }) === "Reconnect required", "reauth");
assert(
  statusLabel({ ...configured, state: "unconfigured", missing: ["apiToken"] }) === "Incomplete",
  "partially filled",
);

assert(statusTone(null) === "idle", "idle tone");
assert(statusTone(configured) === "ok", "ok tone");
assert(statusTone({ ...configured, state: "needsReauth" }) === "warn", "warn tone");

// A pending sign-in outranks the stored state in both label and tone.
assert(statusLabel({ ...configured, pending: true }).includes("Waiting"), "pending label");
assert(statusTone({ ...configured, pending: true }) === "warn", "pending tone");

// Static types never show a Connect button; OAuth types only once their
// required fields (the app's client details) are saved.
const oauthType: CredentialTypeSchema = {
  ...type,
  id: "googleCalendarOAuth2",
  authKind: "oauth2AuthCode",
};
assert(!canConnect(type, configured), "static types do not connect");
assert(!canConnect(oauthType, null), "required fields but no credential yet");
// A provider-published client (no fields) connects without a saved credential.
assert(
  canConnect({ ...oauthType, fields: [] }, null),
  "fieldless oauth types can connect immediately",
);
assert(
  !canConnect(oauthType, { ...configured, typeId: oauthType.id, missing: ["clientId"] }),
  "missing client details block connect",
);
assert(
  canConnect(oauthType, { ...configured, typeId: oauthType.id, missing: [] }),
  "connect once fields are saved",
);

console.log("credentialsLogic.assert.ts: ok");
