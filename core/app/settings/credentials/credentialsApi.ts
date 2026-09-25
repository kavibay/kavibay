/**
 * Typed wrappers around the generic credential commands.
 *
 * The backend never returns secret values: `values` holds non-secret text
 * fields only, `secretsSet` names password fields that have a stored value.
 */
import { invoke } from "@tauri-apps/api/core";

export type CredentialFieldKind = "text" | "password";
export type CredentialAuthKind = "static" | "oauth2AuthCode" | "oauth2DeviceCode";
export type CredentialState = "unconfigured" | "connected" | "needsReauth";

export interface CredentialFieldSchema {
  key: string;
  label: string;
  kind: CredentialFieldKind;
  required: boolean;
  placeholder: string | null;
  help: string | null;
}

export interface CredentialTypeSchema {
  id: string;
  displayName: string;
  description: string;
  docsUrl: string | null;
  authKind: CredentialAuthKind;
  fields: CredentialFieldSchema[];
  supportsTest: boolean;
}

export interface CredentialSummary {
  id: string;
  typeId: string;
  name: string;
  accountLabel: string | null;
  state: CredentialState;
  /** True while a sign-in flow is waiting for the user. */
  pending: boolean;
  /** Why the last sign-in attempt failed (device sign-ins fail in the background). */
  error: string | null;
  /** Non-secret field values, keyed by field key. */
  values: Record<string, string>;
  /** Password fields that currently hold a value. */
  secretsSet: string[];
  /** Required field keys that are still empty. */
  missing: string[];
  metadata: Record<string, unknown>;
  updatedAt: number;
}

export interface CredentialTestResult {
  ok: boolean;
  message: string;
}

export function listCredentialTypes(): Promise<CredentialTypeSchema[]> {
  return invoke<CredentialTypeSchema[]>("credential_types_list");
}

export function listCredentials(): Promise<CredentialSummary[]> {
  return invoke<CredentialSummary[]>("credentials_list");
}

export function credentialStatus(id: string): Promise<CredentialSummary | null> {
  return invoke<CredentialSummary | null>("credentials_status", { id });
}

/** Creates or updates the credential of `typeId`; returns its id. */
export function saveCredential(
  typeId: string,
  fields: Record<string, string>,
  id?: string,
  name?: string,
): Promise<string> {
  return invoke<string>("credentials_save", { typeId, id: id ?? null, name: name ?? null, fields });
}

export function deleteCredential(id: string): Promise<void> {
  return invoke<void>("credentials_delete", { id });
}

export function testCredential(id: string): Promise<CredentialTestResult> {
  return invoke<CredentialTestResult>("credentials_test", { id });
}

/** What the user must do for a device-code sign-in. */
export interface DeviceVerification {
  verificationUriComplete: string;
  userCode: string;
  expiresIn: number;
  interval: number;
}

/**
 * Starts the sign-in flow. Browser flows resolve to `null` (the consent screen
 * is already open); device flows return the code and URL to visit.
 */
export function connectCredential(id: string): Promise<DeviceVerification | null> {
  return invoke<DeviceVerification | null>("credentials_connect", { id });
}

/** Stops waiting for a sign-in; stored tokens are untouched. */
export function cancelConnect(id: string): Promise<void> {
  return invoke<void>("credentials_cancel_connect", { id });
}

/**
 * Runtime packages currently allowed to have this exact connection injected into
 * their declared requests. They never receive the secret itself, and a grant is
 * per connection: allowing the work workspace does not allow a personal one.
 */
export function credentialUsers(credentialId: string): Promise<string[]> {
  return invoke<string[]>("runtime_extensions_credential_users", { credentialId });
}

/** Withdraws one package's access to this one connection. */
export function revokeCredentialUse(id: string, credentialId: string): Promise<void> {
  return invoke<void>("runtime_extensions_revoke_credential", { id, credentialId });
}

/** Removes the connected account but keeps the entered fields. */
export function disconnectCredential(id: string): Promise<void> {
  return invoke<void>("credentials_disconnect", { id });
}
