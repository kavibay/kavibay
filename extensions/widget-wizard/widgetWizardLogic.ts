/**
 * Pure logic for the Widget Wizard: turning a described widget into a package
 * id, turning a model's answer into files, and turning an error code into
 * something a non-technical person can act on.
 *
 * No Tauri, no DOM — run it with:
 *   npx tsx extensions/widget-wizard/widgetWizardLogic.assert.ts
 */

import type { ArgSpec, ResultSchema } from "@sdk/contract/sdk";
import type { Language } from "./highlight";
import { parseWizardSuggestions, type WizardSuggestion } from "./wizardSuggestions";
import type { PreviewElementReference } from "./wizardPointAndPrompt";

/** Consent-facing endpoint shape returned by the host package scanner. */
export interface ConsentEndpoint {
  description: string;
  method: string;
  hosts: string[];
  credential?: string | null;
}

/** Provider details supplied by the reviewed wizard host capability. */
export interface WizardProviderSchema {
  id: string;
  displayName: string;
  requiresCredential: boolean;
  /** Registry type id, so "not connected" can open Settings on that row. */
  credentialType?: string;
  queries: Array<{
    name: string;
    description?: string;
    args?: Record<string, ArgSpec>;
    result?: ResultSchema;
  }>;
  /** Writes. A widget calls one only after declaring it in its provider entry's `actions`. */
  actions?: Array<{
    name: string;
    effect?: "write" | "destructive" | "sensitive";
    description?: string;
    args?: Record<string, ArgSpec>;
  }>;
}

export interface WizardPermissionChoice {
  provider: string;
  /** "tado°", not "kavibay.tado/tado". */
  providerName: string;
  /** What reading from it gets the widget, in the provider's own words. */
  summary: string;
  granted: boolean;
  /**
   * The changes the package asks to make on this account. The same shape as the
   * host dialog's `ActionChoice`, because that dialog is what renders it.
   */
  actions?: { names: string[]; summary: string; granted: boolean };
}

export interface WizardPermissionRequest {
  choices: WizardPermissionChoice[];
  /** Named by the package, not installed here. */
  refused: string[];
}

export interface WizardApprovedGrant {
  providers: string[];
  /** Per approved provider, the actions it may call. Empty means none. */
  actions: Partial<Record<string, readonly string[]>>;
}

const NO_GRANT: WizardApprovedGrant = { providers: [], actions: {} };

/**
 * What "approve automatically" grants: exactly what the package asked for.
 *
 * Everything the request offers, and nothing else — a bypass that reached past
 * the request would be granting access the widget never declared, which is a
 * different and much larger thing than skipping a click.
 *
 * `refused` is not in it and cannot be: those are providers the package named
 * that this machine does not have, so there is nothing to grant.
 */
export function autoApprovedGrant(request: WizardPermissionRequest): WizardApprovedGrant {
  return {
    providers: request.choices.map((choice) => choice.provider),
    actions: Object.fromEntries(
      request.choices
        .filter((choice) => choice.actions)
        .map((choice) => [choice.provider, [...(choice.actions?.names ?? [])]]),
    ),
  };
}

/**
 * Whether skipping the dialog produces the same outcome as answering it.
 *
 * Auto-approve is permission to skip a click, not permission to reach a
 * different result quietly. Two cases must still be shown, because in both the
 * widget is about to be enabled *without* what it asked for:
 *
 * - a provider the package named that this machine does not have (`refused`).
 *   Granting is impossible, and the widget will run and fail — with its own
 *   error, which is the one thing nobody can act on from the preview.
 * - nothing to grant at all, which is the same situation arriving as silence.
 *
 * This was found the hard way: the first version applied the grant whatever the
 * request contained, so a package whose provider id did not resolve was enabled
 * with an empty grant and rendered "permission needed" in the preview — with no
 * dialog, no note and nothing that said what had been decided.
 */
/**
 * Providers a saved contract widget declared but still cannot read.
 *
 * Either never granted, or named and not installed here. Both end the same way
 * for the widget — its query is refused — and the preview has to say so, or the
 * package says it instead: `contract-packages.md` tells authors to ignore
 * `error` because "the host is already showing it, outside your frame", and a
 * host that shows nothing here turns that into a cheque it does not cash. A
 * model then writes its own red panel, which is exactly the inconsistent error
 * UI the contract exists to prevent.
 */
export function unmetProviders(
  request: WizardPermissionRequest,
  granted: readonly string[] | null | undefined,
): string[] {
  const has = new Set(granted ?? []);
  return [
    ...request.choices.filter((choice) => !has.has(choice.provider)).map((c) => c.providerName),
    ...request.refused,
  ];
}

export function canAutoApprove(request: WizardPermissionRequest): boolean {
  return request.refused.length === 0 && request.choices.length > 0;
}

/** Same wording as Settings, kept local so the MIT extension has no core import. */
function permissionLabel(permission: string): string {
  switch (permission) {
    case "storage.instance":
      return "Store its own settings for each widget instance";
    case "network.declared":
      return "Call the endpoints listed below (the host makes the requests)";
    default:
      return permission;
  }
}

export function consentLinesFor(row: {
  permissions?: readonly string[];
  apiEndpoints?: readonly ConsentEndpoint[];
}): string[] {
  const lines = (row.permissions ?? []).map(permissionLabel);
  for (const endpoint of row.apiEndpoints ?? []) {
    const target = `${endpoint.method} ${endpoint.hosts.join(", ")}`;
    const credential = endpoint.credential
      ? ` — using your ${endpoint.credential} credential, which the package never sees`
      : "";
    lines.push(`${endpoint.description} (${target})${credential}`);
  }
  return lines;
}

export function needsReviewBeforeEnable(row: {
  permissions?: readonly string[];
  apiEndpoints?: readonly unknown[];
}): boolean {
  return (
    (row.apiEndpoints?.length ?? 0) > 0 ||
    (row.permissions ?? []).some((permission) => permission !== "storage.instance")
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * `widget.requires.providers` as the manifest states it: each entry a bare id,
 * or `{ id, queries, actions }`. Read leniently, because this only decides what
 * the Wizard shows; anything malformed reads as nothing, and the host's own
 * reader is the one that refuses it.
 */
function requestedContractEntries(raw: unknown): { id: string; queries: string[]; actions: string[] }[] {
  const value = asRecord(asRecord(asRecord(raw)?.widget)?.requires)?.providers;
  if (!Array.isArray(value)) return [];
  const strings = (list: unknown) =>
    Array.isArray(list) ? list.filter((name): name is string => typeof name === "string") : [];
  return value.flatMap((entry) => {
    if (typeof entry === "string") return [{ id: entry, queries: [], actions: [] }];
    const object = asRecord(entry);
    return typeof object?.id === "string"
      ? [{ id: object.id, queries: strings(object.queries), actions: strings(object.actions) }]
      : [];
  });
}

function requestedContractNames(raw: unknown, field: "actions" | "queries"): Record<string, string[]> {
  return Object.fromEntries(
    requestedContractEntries(raw)
      .filter((entry) => entry[field].length > 0)
      .map((entry) => [entry.id, entry[field]]),
  );
}

function requestedContractProviders(raw: unknown): string[] {
  return requestedContractEntries(raw).map((entry) => entry.id);
}

/**
 * What the person is asked: which accounts this widget may use.
 *
 * Not which queries — FINDINGS §27. The finer question was one people clicked
 * through, and a dialog people click through protects nothing.
 */
export function buildWizardPermissionRequest(
  raw: unknown,
  providers: readonly WizardProviderSchema[],
  alreadyGranted: WizardApprovedGrant = NO_GRANT,
): WizardPermissionRequest {
  const choices: WizardPermissionChoice[] = [];
  const refused: string[] = [];
  const asked = requestedContractNames(raw, "actions");
  const reads = requestedContractNames(raw, "queries");

  for (const pid of requestedContractProviders(raw)) {
    const provider = providers.find((entry) => entry.id === pid);
    if (!provider) {
      refused.push(pid);
      continue;
    }
    const has = (name: string) => provider.actions?.some((action) => action.name === name) ?? false;
    const declared = asked[pid] ?? [];
    const names = declared.filter(has);
    refused.push(...declared.filter((name) => !has(name)).map((name) => `${pid}.${name}`));
    const approved = alreadyGranted.actions[pid] ?? [];
    choices.push({
      provider: pid,
      providerName: provider.displayName,
      summary: readSummary(provider, reads[pid] ?? []),
      granted: alreadyGranted.providers.includes(pid),
      ...(names.length > 0
        ? {
            actions: {
              names,
              summary: names
                .map((name) => provider.actions?.find((action) => action.name === name)?.description ?? name)
                .join("; "),
              granted: names.every((name) => approved.includes(name)),
            },
          }
        : {}),
    });
  }

  return { choices, refused };
}

/**
 * The host dialog's sentence under an account, built the same way: the declared
 * queries when the package names them, else the first two of the account's.
 */
function readSummary(provider: WizardProviderSchema, declared: readonly string[]): string {
  const describe = (name: string) =>
    provider.queries.find((query) => query.name === name)?.description ?? name;
  const known = declared.filter((name) => provider.queries.some((query) => query.name === name));
  if (known.length > 0) return known.map(describe).join("; ");
  const sentences = provider.queries.map((query) => query.description ?? query.name);
  if (sentences.length === 0) return "Reads nothing yet";
  if (sentences.length <= 2) return sentences.join("; ");
  return `${sentences.slice(0, 2).join("; ")}, and ${sentences.length - 2} more`;
}

/** A provider the package reads from. `schema` is null when this Kavibay has none by that id. */
export interface ProviderUse {
  id: string;
  schema: WizardProviderSchema | null;
  /** What this provider's entry lists under `actions`. */
  declaredActions: string[];
  /** What this provider's entry lists under `queries`. */
  declaredQueries: string[];
}

/** The providers `manifest.json` asks for, matched against what the host offers. */
export function providersUsedBy(
  files: readonly GeneratedFile[],
  providers: readonly WizardProviderSchema[],
): ProviderUse[] {
  const manifest = files.find((file) => file.path === "manifest.json");
  if (!manifest) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifest.contents);
  } catch {
    return [];
  }
  const actions = requestedContractNames(parsed, "actions");
  const queries = requestedContractNames(parsed, "queries");
  return requestedContractProviders(parsed).map((id) => ({
    id,
    schema: providers.find((provider) => provider.id === id) ?? null,
    declaredActions: actions[id] ?? [],
    declaredQueries: queries[id] ?? [],
  }));
}

/** The provider queries and actions a package's code names, by name. */
export interface ProviderCalls {
  queries: string[];
  actions: string[];
}

const PROVIDER_CALL = /\.(query|subscribe|action)\(\s*(["'`])([\w-]+)\2/g;
const SCRIPT_FILE = /\.(m?js|html?)$/i;

/**
 * What the code calls, read off the source rather than off a run.
 *
 * A literal first argument is the only form counted: `ctx.providers[id]
 * .query("forecast", …)` is, a name built at runtime is not. That is enough for
 * what the API tab shows, which is transparency about a package somebody is
 * about to approve — and a call it cannot see is simply not marked, never
 * marked wrongly.
 */
export function providerCallsIn(files: readonly GeneratedFile[]): ProviderCalls {
  const queries = new Set<string>();
  const actions = new Set<string>();
  for (const file of files) {
    if (!SCRIPT_FILE.test(file.path)) continue;
    for (const match of file.contents.matchAll(PROVIDER_CALL)) {
      (match[1] === "action" ? actions : queries).add(match[3]!);
    }
  }
  return { queries: [...queries].sort(), actions: [...actions].sort() };
}

/** One provider query as the API tab lists it. */
export interface QueryUse {
  name: string;
  description?: string;
  args?: Record<string, ArgSpec>;
  result?: ResultSchema;
  declared: boolean;
  called: boolean;
  /** False for a declared name the provider does not have: a false statement. */
  known: boolean;
}

/**
 * Every query the provider offers, plus any declared name it does not have.
 *
 * All of them rather than only the used ones: the tab is where somebody reads
 * what the account could give the widget, and the marks say which part this
 * widget takes. Nothing here is enforced — reading is the account's grant —
 * so an undeclared read is a gap in what the person was told, not a failure.
 */
export function queryUses(use: ProviderUse, calls: ProviderCalls): QueryUse[] {
  const offered = use.schema?.queries ?? [];
  const unknown = use.declaredQueries.filter((name) => !offered.some((query) => query.name === name));
  return [
    ...offered.map((query) => ({
      name: query.name,
      ...(query.description ? { description: query.description } : {}),
      ...(query.args ? { args: query.args } : {}),
      ...(query.result ? { result: query.result } : {}),
      declared: use.declaredQueries.includes(query.name),
      called: calls.queries.includes(query.name),
      known: true,
    })),
    ...unknown.map((name) => ({ name, declared: true, called: calls.queries.includes(name), known: false })),
  ];
}

/** One provider action as the API tab lists it. */
export interface ActionUse {
  name: string;
  description?: string;
  args?: Record<string, ArgSpec>;
  declared: boolean;
  called: boolean;
}

/**
 * The actions worth showing for one provider: the declared ones, and any the
 * code calls that the provider has. A called one that is not declared is the
 * case to flag, because the host will refuse it the first time it runs.
 */
export function actionUses(use: ProviderUse, calls: ProviderCalls): ActionUse[] {
  const known = use.schema?.actions ?? [];
  const names = [
    ...use.declaredActions,
    ...calls.actions.filter(
      (name) => !use.declaredActions.includes(name) && known.some((action) => action.name === name),
    ),
  ];
  return names.map((name) => {
    const action = known.find((entry) => entry.name === name);
    return {
      name,
      ...(action?.description ? { description: action.description } : {}),
      ...(action?.args ? { args: action.args } : {}),
      declared: use.declaredActions.includes(name),
      called: calls.actions.includes(name),
    };
  });
}

export type ProviderUseState = "missing" | "free" | "connected" | "disconnected";

export function providerUseState(use: ProviderUse, connected: boolean): ProviderUseState {
  if (!use.schema) return "missing";
  if (!use.schema.requiresCredential) return "free";
  return connected ? "connected" : "disconnected";
}

/** `location, days?`: the arguments a query takes, optional ones marked. */
export function argSignature(args: Record<string, ArgSpec> | undefined): string {
  return Object.entries(args ?? {})
    .map(([name, spec]) => (spec.required ? name : `${name}?`))
    .join(", ");
}

/**
 * What a query answers with, one level deep: `list of { id, name }`.
 *
 * Field names rather than the whole tree, because the question here is what
 * to write `data.` against, and a nested schema printed in full is a second
 * file to read.
 */
export function describeResultShape(result: ResultSchema): string {
  const shape =
    result.type === "list"
      ? `list of ${describeResultShape(result.of)}`
      : result.type === "object"
        ? `{ ${Object.keys(result.fields).join(", ")} }`
        : result.type;
  return result.nullable ? `${shape} or null` : shape;
}

export function askedNothingNew(
  request: WizardPermissionRequest,
  granted: WizardApprovedGrant | null | undefined,
): boolean {
  if (!granted) return false;
  return request.choices.every(
    (choice) =>
      granted.providers.includes(choice.provider) &&
      (choice.actions?.names ?? []).every((name) => (granted.actions[choice.provider] ?? []).includes(name)),
  );
}

/** One file of a generated package. */
export interface GeneratedFile {
  path: string;
  contents: string;
}

/** A known MCP client reported by the host's initialization handshake. */
export type DraftClient = "codex" | "claude" | null;

/** Who wrote a draft last, or `null` when the host no longer knows. */
export type DraftAuthor = "wizard" | "mcp" | "codex" | "claude" | null;

/** Combine the stable MCP origin with its optional known client. */
export function draftAuthorOf(
  writer: DraftAuthor | undefined,
  client: DraftClient | undefined,
): DraftAuthor {
  if (writer === "codex" || writer === "claude") return writer;
  if (writer === "wizard") return "wizard";
  if (writer === "mcp") return client ?? "mcp";
  return null;
}

/** Recognize persisted handshake names when an older event stored no kind. */
export function draftClientFromName(name?: string | null): DraftClient {
  const normalized = name?.trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (
    normalized === "codex" ||
    normalized === "codex-cli" ||
    normalized === "codex-mcp" ||
    normalized === "codex-mcp-client" ||
    normalized === "openai-codex" ||
    normalized === "openai-codex-cli"
  ) {
    return "codex";
  }
  if (
    normalized === "claude" ||
    normalized === "claude-code" ||
    normalized === "claude-desktop" ||
    normalized === "anthropic-claude" ||
    normalized === "anthropic-claude-code"
  ) {
    return "claude";
  }
  return null;
}

/** Resolve a branded source for checkpoints persisted before kind detection. */
export function draftAuthorWithClientName(
  author: DraftAuthor | undefined,
  clientName?: string | null,
): DraftAuthor {
  return draftAuthorOf(author, draftClientFromName(clientName));
}

/** Ephemeral host activity; it is never part of a saved conversation. */
export interface WizardDraftPresence {
  id: string;
  client: DraftClient;
  clientName: string | null;
  tool: string;
  active: boolean;
  lastSeen: number;
  expiresAt: number;
}

function presenceClientKey(presence: WizardDraftPresence): string {
  return presence.clientName ?? presence.client ?? "mcp";
}

/** Replace one client's presence without disturbing another client on the same widget. */
export function applyDraftPresence(
  current: readonly WizardDraftPresence[],
  incoming: WizardDraftPresence,
): WizardDraftPresence[] {
  const key = presenceClientKey(incoming);
  return [
    ...current.filter(
      (presence) => presence.id !== incoming.id || presenceClientKey(presence) !== key,
    ),
    incoming,
  ];
}

/** Prefer an exact active request, then the most recent unexpired client. */
export function presenceForWidget(
  rows: readonly WizardDraftPresence[],
  id: string | null | undefined,
  now: number,
): WizardDraftPresence | null {
  if (!id) return null;
  return (
    rows
      .filter((presence) => presence.id === id && (presence.active || presence.expiresAt > now))
      .sort(
        (left, right) =>
          Number(right.active) - Number(left.active) || right.lastSeen - left.lastSeen,
      )[0] ?? null
  );
}

/** Honest copy: exact while a request runs, explicitly recent between calls. */
export function describeDraftPresence(presence: WizardDraftPresence): string {
  const author = draftAuthorWithClientName(presence.client ?? "mcp", presence.clientName);
  const who =
    author === "codex"
      ? "Codex"
      : author === "claude"
        ? "Claude Code"
        : presence.clientName || "An MCP client";
  return presence.active
    ? `${who} is working on this widget right now`
    : `${who} was active on this widget just now`;
}

/** Full text returned by the shared draft service for one draft. */
export interface WizardDraftSnapshot {
  id: string;
  files: GeneratedFile[];
  revision: string;
  error: string | null;
  lastWriter?: DraftAuthor;
  lastClient?: DraftClient;
  /** Exact, sanitized MCP clientInfo.name for transparent hover attribution. */
  lastClientName?: string | null;
  updatedAt?: number | null;
}

/**
 * How a change is attributed on screen.
 *
 * "You" is deliberately not "the Wizard": from where the person is sitting,
 * the Wizard is the thing they are typing into, and a change it announces as
 * coming from the Wizard reads as a third party. Only the other client needs
 * naming — and an unattributed change says so rather than guessing.
 */
export function describeDraftAuthor(author: DraftAuthor): string {
  if (author === "codex") return "Codex";
  if (author === "claude") return "Claude Code";
  if (author === "mcp") return "an MCP client";
  if (author === "wizard") return "you";
  return "somebody";
}

/** Detailed byline shown on hover, including an unrecognized MCP name. */
export function describeDraftClient(author: DraftAuthor, clientName?: string | null): string {
  const name = clientName?.trim();
  const effectiveAuthor = draftAuthorWithClientName(author, clientName);
  if (name) {
    const label =
      effectiveAuthor === "codex"
        ? "Codex"
        : effectiveAuthor === "claude"
          ? "Claude Code"
          : "MCP client";
    return `${label} (clientInfo: ${name})`;
  }
  if (effectiveAuthor === "mcp") return "MCP client (clientInfo unavailable)";
  return describeDraftAuthor(effectiveAuthor);
}

/**
 * The checkpoint line for a change this conversation did not make.
 *
 * Short, because it is a version label in a list of version labels — the
 * sentence explaining it belongs in the banner, which is where a decision is
 * being asked for.
 */
export function describeDraftUpdate(author: DraftAuthor): string {
  if (author === "codex") return "Updated via Codex";
  if (author === "claude") return "Updated via Claude Code";
  if (author === "mcp") return "Updated via MCP";
  if (author === "wizard") return "Updated in another Wizard card";
  return "Updated externally";
}

/**
 * What opening a widget from the sidebar says in the transcript.
 *
 * Three cases and not one, because they differ in what the person is looking
 * at. A checkout shows the widget that is on their desk. An own draft is where
 * they left off. Somebody else's draft is work they have not seen, sitting on
 * top of the widget that is still running — and that is the one sentence worth
 * reading before typing the next request.
 */
export function describeDraftOpen(id: string, existing: boolean, author: DraftAuthor): string {
  if (!existing) return `Editing "${id}". Describe what you want changed.`;
  if (author === "wizard") return `Continuing your unsaved changes to "${id}".`;
  return `Opened unsaved changes to "${id}" from ${describeDraftAuthor(author)}. The saved widget is unchanged until you press Save.`;
}

/** The identity-only event delivered by the host transport. */
export interface DraftSyncEvent {
  id: string;
  revision: string | null;
  kind: "written" | "discarded" | "promoted";
  origin: "wizard" | "mcp";
  client?: DraftClient;
  clientName?: string | null;
  /** The id the package answered to until this event, when it was renamed. */
  renamedFrom?: string;
}

export type DraftSyncDecision = "other" | "ignore" | "apply" | "conflict";

export interface DraftSyncContext {
  activeId: string | null;
  activeRevision?: string;
  busy: boolean;
  editorDirty: boolean;
}

/**
 * The event's subject, as this conversation knows it.
 *
 * A rename arrives under the *new* id, so an event about the draft on screen no
 * longer matches it by id — and matching by id alone filed it as somebody
 * else's draft, leaving this conversation pointed at a folder that had moved.
 */
export function eventTargetsActive(event: DraftSyncEvent, activeId: string | null): boolean {
  if (!activeId) return false;
  return event.id === activeId || event.renamedFrom === activeId;
}

/** Decide without touching session state whether an event may be applied. */
export function draftSyncDecision(
  event: DraftSyncEvent,
  context: DraftSyncContext,
): DraftSyncDecision {
  if (!eventTargetsActive(event, context.activeId)) return "other";
  if (event.revision !== null && event.revision === context.activeRevision) return "ignore";
  // A Wizard write emits before its invoke promise resolves. Treat that event
  // as local while the write is pending; the returned summary supplies the
  // authoritative revision and prevents a feedback loop.
  if (event.origin === "wizard" && context.busy) return "ignore";
  if (context.busy || context.editorDirty || event.kind !== "written") return "conflict";
  return "apply";
}

/** State changes that an immediate external apply must make atomically. */
export function applyDraftSnapshot(snapshot: WizardDraftSnapshot): {
  draftFiles: GeneratedFile[];
  draftRevision: string;
  knownFiles: undefined;
} {
  return {
    draftFiles: snapshot.files.map((file) => ({ ...file })),
    draftRevision: snapshot.revision,
    knownFiles: undefined,
  };
}

export interface DraftConflict {
  id: string;
  external: WizardDraftSnapshot | null;
  externalRevision: string | null;
  localFiles: GeneratedFile[];
  reason: "busy" | "dirty" | "external";
}

/** Keep a queued external snapshot until the person explicitly resolves it. */
export function queueDraftConflict(
  current: DraftConflict | null,
  next: DraftConflict,
): DraftConflict {
  if (
    current &&
    current.id === next.id &&
    current.externalRevision === next.externalRevision
  ) {
    return { ...current, localFiles: next.localFiles };
  }
  return next;
}

/** Keep-mine is still optimistic: the exact external revision is its precondition. */
export function keepMineExpectedRevision(conflict: DraftConflict): string | null {
  return conflict.externalRevision;
}

/** What one model reply contained. */
export interface ParsedReply {
  /** The model's explanation, with the file blocks removed. */
  prose: string;
  files: GeneratedFile[];
  /**
   * Path of a block that was opened and never closed, or `null`.
   *
   * Kept apart from `files` because the two failures need different advice: a
   * reply with no blocks at all was never going to produce a widget, while an
   * unterminated one stopped mid-file and is worth simply asking for again.
   */
  unterminated: string | null;
  /**
   * Paths the answer asked to remove, marked `deleted=true` on the fence.
   *
   * Explicit, because omission stopped meaning deletion the moment a reply was
   * allowed to be partial — and the host cannot tell "I did not touch it" from
   * "I meant to remove it". Silence keeps the file, which is the recoverable
   * direction: a stale file is visible in the Files tab, a deleted one is gone.
   */
  removed: string[];
  /**
   * Search/replace edits to files the package already has, in reply order.
   *
   * The output saving for a large file: a follow-up turn may return a whole
   * file it changed, but for a one-line change in a few hundred lines of
   * `app.js` that is still the slow part. An ```edit path=…``` block carries
   * only the change. See `applyReplyEdits`.
   */
  edits?: ReplyEdit[];
  /** Paths of edit blocks whose SEARCH/REPLACE markers could not be read. */
  malformedEdits?: string[];
  /** Follow-up metadata, never part of the generated package. */
  suggestions?: WizardSuggestion[];
}

/** One SEARCH/REPLACE pair from an ```edit path=…``` block. */
export interface ReplyEdit {
  path: string;
  search: string;
  replace: string;
}

/** One image attached to a turn. Base64, with no `data:` prefix. */
export interface WizardAttachment {
  mediaType: string;
  data: string;
}

/** A chat turn as the backend expects it. */
export interface WizardTurn {
  role: "user" | "assistant";
  content: string;
  images?: WizardAttachment[];
}

/**
 * Package id derived from what the person asked for.
 *
 * Lowercased ASCII words joined by dashes, because the id is a directory name,
 * a storage namespace and a url host. Anything the rule cannot rescue falls
 * back to a fixed name rather than producing an id the backend would reject.
 */
/**
 * Cuts at a word, not at a character.
 *
 * The id is a directory name and a url host, and it is permanent — so
 * `erstelle-ein-hello-widget-einfach-nur-he` is not merely ugly, it is the name
 * of a folder forever. A hard `slice` lands wherever the fortieth character
 * falls, which is usually the middle of a word.
 *
 * Falls back to the hard cut only when the first word is longer than the whole
 * budget, where there is no boundary to find.
 */
function clipToWord(slug: string, max: number): string {
  if (slug.length <= max) return slug;
  const cut = slug.slice(0, max);
  const lastDash = cut.lastIndexOf("-");
  return (lastDash > 0 ? cut.slice(0, lastDash) : cut).replace(/-+$/g, "");
}

/**
 * The folder-name rule, as `is_valid_package_id` in Rust states it.
 *
 * Duplicated deliberately and narrowly: the model now proposes the id, and a
 * proposal has to be judged before it becomes a directory. Rust remains the
 * authority — this only decides whether to accept the model's word or fall
 * back to a slug of the request.
 */
export function isValidPackageId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id) && id.length <= 64;
}

/**
 * The first free id at or after `wanted`.
 *
 * A name the model chose can collide with a draft or a saved widget, and the
 * collision used to arrive as a package problem — the wizard told the model its
 * answer was broken and spent a repair turn asking it to fix a name that was
 * perfectly good. It is not a problem with the answer; it is a fact about this
 * machine, and the wizard is the only party that knows it.
 *
 * The suffix is appended to the **whole** id rather than replacing a trailing
 * number: `gpt-5` taken becomes `gpt-5-2`, not `gpt-6`. Uglier in the rare case
 * and never a different meaning — counting up through a number that is part of
 * the name renames the widget to something else.
 *
 * Starts at 2, because the one already there is the first.
 */
export function freePackageId(wanted: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(wanted)) return wanted;
  for (let n = 2; n < 1000; n += 1) {
    const suffix = `-${n}`;
    // The host caps an id at 64 characters, so a long name gives up its tail
    // rather than the number that makes it unique.
    const base = wanted.slice(0, 64 - suffix.length).replace(/-+$/, "");
    const candidate = `${base}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  return wanted;
}

/**
 * The id a generated manifest claims for itself, when it is a usable one.
 *
 * The two formats spell it differently — a runtime package has `id`, a contract
 * package has `name` — and reading the wrong one rejects a correct package.
 */
export function declaredPackageId(
  files: GeneratedFile[],
  format: WidgetFormat,
): string | null {
  const manifest = files.find((file) => file.path === "manifest.json");
  if (!manifest) return null;
  try {
    const parsed = JSON.parse(manifest.contents) as Record<string, unknown>;
    const declared = parsed[format === "contract-package" ? "name" : "id"];
    return typeof declared === "string" && isValidPackageId(declared) ? declared : null;
  } catch {
    return null;
  }
}

/** The human name a generated manifest gives itself, if it gave one. */
export function declaredDisplayName(files: GeneratedFile[]): string | null {
  const manifest = files.find((file) => file.path === "manifest.json");
  if (!manifest) return null;
  try {
    const parsed = JSON.parse(manifest.contents) as Record<string, unknown>;
    for (const field of ["displayName", "name"]) {
      const value = parsed[field];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return null;
  } catch {
    return null;
  }
}

export function slugifyPackageId(text: string): string {
  const slug = text
    .toLowerCase()
    // Transliterate rather than strip: a German widget name should become
    // "muesli-zaehler", not "m-sli-z-hler".
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return /^[a-z0-9]/.test(clipToWord(slug, 40)) ? clipToWord(slug, 40) : "my-widget";
}

/**
 * Opening line of a fenced file block: ```` ```lang path=ui/index.html ````.
 *
 * The `path=` attribute is what makes a block a file rather than an example, so
 * a fence without one is left in the prose untouched. Everything *else* about
 * the line is tolerated, because a model that spells the fence unusually is not
 * asking for a different outcome: leading indentation (the block sat in a list),
 * four or more backticks (the file itself contains a fence), a missing language,
 * a missing space, a quoted path and trailing attributes all still mean "this is
 * a file". Strictness here did not reject a bad file, it dropped a good answer
 * and reported it as "no files".
 *
 * No alias for `path=` on purpose. `title=` is the tempting one, but it is also
 * how a model labels an *illustrative* block — accepting it would write example
 * code to disk as a real file, and a false positive here is worse than a miss.
 */
const FILE_FENCE = /^(\s*)(`{3,})[^\s`]*\s*path=("[^"]*"|'[^']*'|\S+)/;

/** A file fence that follows text on the same line: the text, then the fence. */
const GLUED_FILE_FENCE = /^(.*[^`\s])[ \t]*(`{3,}[^\s`]*\s*path=.*)$/;

/**
 * `deleted=true` on the same info string: this file should be removed.
 *
 * An attribute rather than a convention about an empty body, because an empty
 * file is a legitimate thing to write and the two must not be the same signal.
 * Tolerant about the spelling for the same reason `FILE_FENCE` is — a model
 * that writes bare `deleted` means the same thing, and being strict here would
 * turn a deletion into a mysteriously empty file.
 */
const DELETED_ATTR = /\bdeleted(=(true|"true"|'true'))?(\s|$)/i;

/** A file fence whose language is `edit`: SEARCH/REPLACE pairs, not contents. */
const EDIT_FENCE = /^\s*`{3,}edit\s/i;

/**
 * The SEARCH/REPLACE pairs of one edit block, or `null` when its markers do
 * not line up. Markers stand on their own lines, as models already write them:
 *
 *     <<<<<<< SEARCH
 *     old text
 *     =======
 *     new text
 *     >>>>>>> REPLACE
 */
export function parseEditBody(path: string, body: string[]): ReplyEdit[] | null {
  const edits: ReplyEdit[] = [];
  let phase: "outside" | "search" | "replace" = "outside";
  let search: string[] = [];
  let replace: string[] = [];
  for (const line of body) {
    if (/^<{5,}\s*SEARCH\s*$/.test(line)) {
      if (phase !== "outside") return null;
      phase = "search";
      search = [];
    } else if (/^={5,}\s*$/.test(line) && phase === "search") {
      phase = "replace";
      replace = [];
    } else if (/^>{5,}\s*REPLACE\s*$/.test(line)) {
      if (phase !== "replace") return null;
      edits.push({ path, search: search.join("\n"), replace: replace.join("\n") });
      phase = "outside";
    } else if (phase === "search") {
      search.push(line);
    } else if (phase === "replace") {
      replace.push(line);
    } else if (line.trim() !== "") {
      return null;
    }
  }
  return phase === "outside" && edits.length > 0 ? edits : null;
}

/**
 * Apply a reply's edits to a file set, each exactly once.
 *
 * The SEARCH text must occur exactly once in its file: an edit that matches
 * nowhere or in two places is reported rather than guessed at, and the whole
 * set is refused, because a half-applied change is a package nobody asked for.
 */
export function applyReplyEdits(
  files: GeneratedFile[],
  edits: ReplyEdit[],
): { files: GeneratedFile[]; problems: string[] } {
  if (edits.length === 0) return { files, problems: [] };
  const next = files.map((file) => ({ ...file }));
  const problems: string[] = [];
  for (const edit of edits) {
    const file = next.find((candidate) => candidate.path === edit.path);
    if (!file) {
      problems.push(`An edit names ${edit.path}, which the widget does not have. Send the whole file instead.`);
      continue;
    }
    const at = edit.search === "" ? -1 : file.contents.indexOf(edit.search);
    if (at < 0) {
      problems.push(
        `An edit for ${edit.path} did not match: its SEARCH text must be copied exactly from the current file, whitespace included.`,
      );
      continue;
    }
    if (file.contents.indexOf(edit.search, at + 1) >= 0) {
      problems.push(
        `An edit for ${edit.path} matched more than once: include enough surrounding lines to make its SEARCH text unique.`,
      );
      continue;
    }
    file.contents = file.contents.slice(0, at) + edit.replace + file.contents.slice(at + edit.search.length);
  }
  return problems.length > 0 ? { files, problems } : { files: next, problems };
}

/**
 * True when `line` closes a block opened with `ticks` backticks.
 *
 * Markdown's rule: the closing run must be at least as long as the opening one,
 * so a file containing ```` ``` ```` can be fenced in four and stay intact.
 */
function closesFence(line: string, ticks: number): boolean {
  const match = /^\s*(`{3,})\s*$/.exec(line);
  return match !== null && match[1].length >= ticks;
}

/**
 * The path as the host names it: unquoted, and without a leading `./`.
 *
 * `./manifest.json` is the same file as `manifest.json`, but only the second
 * spelling satisfies the manifest check — the first used to surface as "the
 * answer had no manifest.json", which sends the person looking for the wrong
 * problem. `../` is deliberately left alone: it is not a spelling of anything
 * legitimate, and `safe_join` on the Rust side refuses it.
 */
function normalizePath(raw: string): string {
  const quoted = /^"(.*)"$|^'(.*)'$/.exec(raw);
  const path = quoted ? (quoted[1] ?? quoted[2]) : raw;
  return path.startsWith("./") ? path.slice(2) : path;
}

/**
 * Removes the fence's own indentation from a body line.
 *
 * An indented block indents its contents too; writing that through verbatim
 * would put four spaces in front of every line of the file.
 */
function stripIndent(line: string, indent: string): string {
  if (indent === "") return line;
  let cut = 0;
  while (cut < indent.length && cut < line.length && /\s/.test(line[cut])) cut += 1;
  return line.slice(cut);
}

/**
 * Splits a model reply into explanation and files.
 *
 * Line-based rather than a single regex: package files are HTML and JavaScript
 * full of quotes, braces and blank lines, and a greedy pattern across the whole
 * reply gets the boundaries wrong exactly when the widget is interesting.
 */
export function parseGeneratedFiles(text: string): ParsedReply {
  const lines = text.split(/\r?\n/);
  const files: GeneratedFile[] = [];
  const prose: string[] = [];
  let suggestions: WizardSuggestion[] = [];
  let suggestionBlock: { ticks: number; body: string[] } | null = null;

  const removed: string[] = [];
  const edits: ReplyEdit[] = [];
  const malformedEdits: string[] = [];
  let current: {
    path: string;
    indent: string;
    ticks: number;
    body: string[];
    deleted: boolean;
    edit: boolean;
  } | null = null;

  for (let line of lines) {
    if (current) {
      if (closesFence(line, current.ticks)) {
        if (current.edit) {
          const pairs = parseEditBody(current.path, current.body);
          if (pairs) edits.push(...pairs);
          else malformedEdits.push(current.path);
        } else if (current.deleted) removed.push(current.path);
        else files.push({ path: current.path, contents: current.body.join("\n") });
        current = null;
      } else {
        current.body.push(stripIndent(line, current.indent));
      }
      continue;
    }

    if (suggestionBlock) {
      if (closesFence(line, suggestionBlock.ticks)) {
        suggestions = parseWizardSuggestions(suggestionBlock.body.join("\n"));
        suggestionBlock = null;
      } else {
        suggestionBlock.body.push(line);
      }
      continue;
    }

    const suggestionOpening = /^\s*(`{3,})kavibay-suggestions\s*$/.exec(line);
    if (suggestionOpening) {
      suggestionBlock = { ticks: suggestionOpening[1].length, body: [] };
      continue;
    }

    // A model sometimes glues the fence to the end of its sentence. Split it
    // off, or the whole file is shown in the chat as prose.
    const glued = GLUED_FILE_FENCE.exec(line);
    if (glued) {
      prose.push(glued[1]);
      line = glued[2];
    }
    const opening = FILE_FENCE.exec(line);
    if (opening) {
      current = {
        path: normalizePath(opening[3]),
        indent: opening[1],
        ticks: opening[2].length,
        body: [],
        deleted: DELETED_ATTR.test(line),
        edit: EDIT_FENCE.test(line),
      };
    } else {
      prose.push(line);
    }
  }

  // An unterminated block means the reply stopped mid-file. Keeping the partial
  // file would write a truncated widget to disk and blame the person for it —
  // so it is dropped, but reported as itself rather than as an empty answer.
  return {
    prose: prose.join("\n").trim(),
    files,
    removed,
    edits,
    malformedEdits,
    unterminated: current ? current.path : null,
    suggestions,
  };
}

/**
 * Why a file set cannot be written yet, or `null` when it can.
 *
 * Checked here rather than only in Rust so the wizard can say what is missing
 * without a round trip — the backend refuses the same cases regardless.
 */
/**
 * Blanks out comments and the insides of strings, templates and regex literals,
 * keeping every offset. So a scan can look for code without tripping over the
 * word it is looking for appearing in a comment that explains it — which is
 * exactly what the doc-following widgets write.
 *
 * Not a parser and not trying to be. It is deliberately biased towards leaving
 * text alone when it cannot tell: this feeds a *refusal*, and a refusal that
 * fires on a correct package costs a repair round and reads to the person as
 * the model failing.
 */
function maskLiterals(source: string): string {
  const out = source.split("");
  const NEWLINE = "\n";
  let index = 0;
  const blank = (from: number, to: number) => {
    for (let i = from; i < to && i < out.length; i += 1) if (out[i] !== NEWLINE) out[i] = " ";
  };
  while (index < source.length) {
    const two = source.slice(index, index + 2);
    if (two === "//") {
      const end = source.indexOf(NEWLINE, index);
      const stop = end === -1 ? source.length : end;
      blank(index, stop);
      index = stop;
      continue;
    }
    if (two === "/*") {
      const end = source.indexOf("*/", index + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(index, stop);
      index = stop;
      continue;
    }
    const quote = source[index];
    if (quote === '"' || quote === "'" || quote === "`") {
      let cursor = index + 1;
      while (cursor < source.length) {
        if (source[cursor] === "\\") {
          cursor += 2;
          continue;
        }
        if (source[cursor] === quote) break;
        cursor += 1;
      }
      // A template can hold `${ctx.something}`, which is code and must stay
      // readable. Blanking a template wholesale would hide the very call this
      // check exists to find.
      if (quote !== "`") blank(index + 1, cursor);
      index = cursor + 1;
      continue;
    }
    index += 1;
  }
  return out.join("");
}

/** The body of the `render(...) { ... }` method, or null when it is not there. */
function renderBody(masked: string): string | null {
  const head = /(^|[{,;\s])(async\s+)?render\s*\(/m.exec(masked);
  if (!head) return null;
  const open = masked.indexOf("{", head.index + head[0].length);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < masked.length; i += 1) {
    if (masked[i] === "{") depth += 1;
    else if (masked[i] === "}") {
      depth -= 1;
      if (depth === 0) return masked.slice(open, i + 1);
    }
  }
  return null;
}

/**
 * The one thing a contract widget can write that looks right and cannot run.
 *
 * `render(model, root)` takes two parameters. A handler installed inside it
 * that reaches for `ctx` throws a `ReferenceError` **in the handler**: the
 * widget paints, the button does nothing, and no panel anywhere says why. It is
 * documented in `docs/contract-packages.md`, and prose was not enough — an edit
 * turn follows the rule in the lines it rewrites and carries the broken line
 * over untouched, which is how the same bug came back twice on one widget.
 *
 * So it is a refusal instead. A refusal reads the *merged* package, which is
 * the only view that includes what the answer copied rather than wrote.
 */
export function renderReachesForCtx(widgetJs: string): boolean {
  const body = renderBody(maskLiterals(widgetJs));
  if (!body) return false;
  // A widget that declares its own `ctx` in there means its own `ctx` — a
  // canvas widget writes `const ctx = canvas.getContext("2d")` and is entirely
  // correct. Refusing that would send a working package back for repair, which
  // is a worse failure than the one being caught: the person watches a good
  // answer be rejected and has no way to argue with it.
  if (/(^|[^.\w$])(const|let|var)\s+ctx\b/.test(body)) return false;
  // `ctx` as a value of its own. `foo.ctx` and `ctx:` are somebody's property
  // and not this mistake; flagging them would refuse a working widget.
  return /(^|[^.\w$])ctx\s*[.[]/.test(body);
}

export function fileSetProblem(
  files: GeneratedFile[],
  packageId: string,
  format: WidgetFormat = "runtime-package",
): string | null {
  if (files.length === 0) {
    // The common cause is a model that wrote its explanation and stopped, so the
    // fix is one short follow-up — say it here rather than leaving a dead end.
    return 'The answer contained no files. Reply "Emit the files now." to ask for them.';
  }
  const manifest = files.find((file) => file.path === "manifest.json");
  if (!manifest) {
    return "The answer had no manifest.json.";
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(manifest.contents);
  } catch {
    return "The manifest.json is not valid JSON.";
  }

  /**
   * Both formats identify the package; they spell the field differently. A
   * runtime package has `id`, a contract package has `name`.
   *
   * Checking the wrong one rejects a correct package before a single byte is
   * written, and says the manifest claims `undefined` — which reads like the
   * model failed. It was the first thing the contract format hit in real use.
   */
  const field = format === "contract-package" ? "name" : "id";
  const declared = (parsed as Record<string, unknown> | null)?.[field];
  /**
   * On the first turn the model chose the id, so there is nothing to compare it
   * against — only something to check it *is* a name a folder can carry.
   */
  if (!packageId) {
    return typeof declared === "string" && isValidPackageId(declared)
      ? null
      : `The manifest must give this widget a short ${field} like "water-tracker", not "${String(declared)}".`;
  }
  if (declared !== packageId) {
    return `The manifest says ${field} "${String(declared)}" but this widget is "${packageId}".`;
  }

  // Contract packages only: a runtime package has no `render(model, root)` and
  // no `ctx`, so the same scan there could only produce false refusals.
  if (format === "contract-package") {
    const widgetJs = files.find((file) => file.path === "widget.js");
    if (widgetJs && renderReachesForCtx(widgetJs.contents)) {
      return (
        "widget.js reaches for `ctx` inside `render`, which is called as " +
        "`render(model, root)` — that throws in the handler and the widget " +
        "silently stops responding. Return what the interaction needs from " +
        "`setup` on the model instead, and call it through `model`."
      );
    }
  }
  return null;
}

/**
 * Why a whole reply cannot be written yet, or `null` when it can.
 *
 * Wraps `fileSetProblem` so the one failure it cannot see — a block the model
 * opened and never closed — is named as itself. Both end in zero usable files,
 * but only one of them is worth simply asking for again.
 */
/**
 * What an answer did, when it did not say.
 *
 * A model that returns files and no prose used to render as "(no explanation)",
 * which is a complaint about the model dressed up as a message — it tells the
 * reader nothing about their widget and cannot be acted on. The files are right
 * there, and "Changed widget.js" is the sentence the missing prose would most
 * likely have been.
 *
 * Counted rather than listed past three: a message whose whole point is to be
 * glanceable must not turn into a directory listing.
 */
export function describeReply(reply: ParsedReply, before: GeneratedFile[]): string {
  const known = new Set(before.map((file) => file.path));
  const added = reply.files.filter((file) => !known.has(file.path)).map((file) => file.path);
  const changed = [
    ...new Set([
      ...reply.files.filter((file) => known.has(file.path)).map((file) => file.path),
      ...(reply.edits ?? []).map((edit) => edit.path),
    ]),
  ];

  const name = (paths: string[], verb: string) => {
    if (paths.length === 0) return null;
    if (paths.length > 3) return `${verb} ${paths.length} files`;
    return `${verb} ${paths.join(", ")}`;
  };

  const parts = [
    name(added, "Added"),
    name(changed, "Changed"),
    name([...reply.removed], "Removed"),
  ].filter((part): part is string => part !== null);

  // An answer with no files at all is already reported as a problem, so this is
  // only reached when there is something to name.
  return parts.length > 0 ? `${parts.join(" · ")}.` : "No changes.";
}

/**
 * The package after one answer is applied to it.
 *
 * WHY AN ANSWER MAY NOW BE PARTIAL. The model used to rewrite every file on
 * every turn, and output is billed at five times input — so "make the
 * background transparent" cost a full package in tokens to change one line. A
 * follow-up turn is now told it may return only what it changed, and this is
 * what puts that back together.
 *
 * The merge is the same operation either way: a complete answer replaces
 * everything, a partial one replaces what it names. Nothing here has to know
 * which kind it was handed, which is the point — the model deciding to send
 * more than it needed is not a failure mode.
 *
 * Order follows the current package, with anything new appended, so a file does
 * not move around in the Files tab because a turn happened to touch it.
 */
export function mergeGeneratedFiles(
  current: GeneratedFile[],
  reply: ParsedReply,
): GeneratedFile[] {
  const replacements = new Map(reply.files.map((file) => [file.path, file]));
  const gone = new Set(reply.removed);

  const merged = current
    .filter((file) => !gone.has(file.path))
    .map((file) => replacements.get(file.path) ?? file);

  const seen = new Set(merged.map((file) => file.path));
  for (const file of reply.files) {
    // A path the answer both writes and deletes is a contradiction; the write
    // wins, because keeping a file somebody described is recoverable and
    // deleting one they wrote is not.
    if (!seen.has(file.path)) merged.push(file);
  }
  return merged;
}

/** The format a manifest is written in, by the host's rule: a `widget` object. */
function manifestFormat(files: GeneratedFile[]): WidgetFormat | null {
  const manifest = files.find((file) => file.path === "manifest.json");
  if (!manifest) return null;
  try {
    const widget = (JSON.parse(manifest.contents) as Record<string, unknown>).widget;
    return widget !== null && typeof widget === "object" ? "contract-package" : "runtime-package";
  } catch {
    return null;
  }
}

/** Read by both formats, so never left over from one of them. */
const SHARED_FILES = new Set(["manifest.json", "api.json"]);

/**
 * The merged package without what only the other format reads.
 *
 * A file the answer does not mention is kept, which is right within a format
 * and wrong across one. A water tracker moved to the contract format kept its
 * `ui/` folder next to the new `index.html` and `widget.js`: never loaded,
 * still in the Files tab, still offered to the model to edit. When the
 * manifest changed format, files of the old package that the answer did not
 * write go. A contract manifest also loses the `ui` block, which it ignores.
 */
export function withoutOtherFormat(
  before: GeneratedFile[],
  merged: GeneratedFile[],
): GeneratedFile[] {
  const from = manifestFormat(before);
  const to = manifestFormat(merged);
  const previous = new Map(before.map((file) => [file.path, file]));
  const kept =
    from === null || to === null || from === to
      ? merged
      : merged.filter(
          (file) => SHARED_FILES.has(file.path) || previous.get(file.path) !== file,
        );
  if (to !== "contract-package") return kept;
  return kept.map((file) => {
    if (file.path !== "manifest.json") return file;
    const parsed = JSON.parse(file.contents) as Record<string, unknown>;
    if (!("ui" in parsed)) return file;
    delete parsed.ui;
    return { ...file, contents: `${JSON.stringify(parsed, null, 2)}\n` };
  });
}

/**
 * What is wrong with an answer, if anything.
 *
 * Takes the **merged** package rather than the reply, because a partial answer
 * legitimately has no `manifest.json` in it — the manifest is in the package it
 * is being applied to. Checking the reply alone would reject exactly the answers
 * the partial form exists to allow.
 */
export function replyProblem(
  reply: ParsedReply,
  merged: GeneratedFile[],
  packageId: string,
  format: WidgetFormat = "runtime-package",
): string | null {
  if (reply.unterminated !== null) {
    return `The answer stopped inside "${reply.unterminated}" — the file was never finished. Ask again, or for a smaller widget.`;
  }
  // The merged set can be perfectly valid while the answer did nothing at all —
  // that is the "wrote its explanation and stopped" case, and it still needs
  // the same one-line follow-up.
  if (reply.malformedEdits?.length) {
    return `The edit block for ${reply.malformedEdits[0]} is not in SEARCH/REPLACE form. Send the whole file instead.`;
  }
  if (reply.files.length === 0 && reply.removed.length === 0 && !reply.edits?.length) {
    return 'The answer contained no files. Reply "Emit the files now." to ask for them.';
  }
  return fileSetProblem(merged, packageId, format);
}

/** Language hint for a fenced block, from the file extension. */
function fenceLang(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return { json: "json", html: "html", js: "js", css: "css", svg: "xml" }[ext] ?? "";
}

/**
 * Whether a generated file set is a contract package.
 *
 * The manifest's `widget` object, which is the same discriminator the Rust scan
 * uses and the same one the host embeds a package by. One implementation on
 * this side, because finding 24 is what two implementations of one rule cost:
 * they do not disagree about the rule, they disagree about what the input is,
 * and both stay green.
 *
 * A file set with no readable manifest is not a contract package — a broken
 * runtime package must keep failing as one rather than becoming a different
 * format that happens to fail differently.
 */
export function isContractPackageFiles(files: GeneratedFile[]): boolean {
  const manifest = files.find((file) => file.path === "manifest.json");
  if (!manifest) return false;
  try {
    const parsed = JSON.parse(manifest.contents) as { widget?: unknown };
    return typeof parsed.widget === "object" && parsed.widget !== null;
  } catch {
    return false;
  }
}

/**
 * Existing files, in the same fenced form the model replies with.
 *
 * One format in both directions: the model reads back exactly what it is asked
 * to produce, so editing a widget is the same task as writing one.
 */
export function renderFilesForPrompt(files: GeneratedFile[]): string {
  return files
    .map((file) => "```" + fenceLang(file.path) + ` path=${file.path}\n${file.contents}\n` + "```")
    .join("\n\n");
}

/** How much widget the first turn asks for; see `turnForPackage`. */
export type WidgetScope = "simple" | "standard" | "rich";

/**
 * The line a scope adds to the first request. Standard adds nothing: it is
 * what the system prompt already describes, so saying it again would only
 * cost tokens.
 */
export const SCOPE_INSTRUCTION: Record<WidgetScope, string | null> = {
  simple:
    "Scope: simple. Build just the core action and its first-run state; leave out history, settings and extras.",
  standard: null,
  rich:
    "Scope: rich. Build a complete tool: history, settings and keyboard support, plus whatever else makes it one somebody relies on daily. Put the depth in a second view inside the card.",
};

/**
 * The instruction appended to the person's own words.
 *
 * The id is assigned by the host, never chosen by the model: it decides which
 * draft directory is written, and a model that could pick it could aim at a
 * different widget's draft.
 *
 * When editing, the current files ride along. They are sent once, on the turn
 * that starts the edit — afterwards the conversation already contains them.
 */
export interface TurnContext {
  /** How much widget to build. Read on the first turn only. */
  scope?: WidgetScope;
  /** The package as it is on disk right now. */
  currentFiles?: GeneratedFile[];
  /**
   * The set the model has already been shown, so it is not sent twice.
   *
   * Almost always its own last answer: the model returns the complete package
   * every turn, so that answer is already in the conversation verbatim.
   * Sending the identical set again in the next question doubled the package
   * in every round — and, because the whole history is replayed on every
   * request, kept paying for the duplicate on every later round too.
   *
   * Left undefined whenever the two could differ for a reason the model cannot
   * know about: a hand edit, a restored version, a save that rewrote
   * `ui.defaultSize`. Then the files ride along, which is what the duplication
   * was protecting in the first place.
   */
  knownFiles?: GeneratedFile[];
  samples?: EndpointSample[];
}

export function turnForPackage(
  userText: string,
  packageId: string,
  context: TurnContext = {},
): string {
  const { currentFiles, knownFiles, samples, scope } = context;
  /**
   * An empty id means this is the first turn and nothing is named yet.
   *
   * The wizard used to slug the whole request into an id and dictate it, which
   * is how a widget ended up called `a-tracker-for-how-much-water-i-drink` — a
   * sentence in a field that becomes a folder name, a palette entry and a url
   * host. The model has just read the request and can say what the thing *is*.
   * From the second turn on the id is settled and dictated again, because
   * renaming is the person's act and not a side effect of asking for a change.
   */
  const parts = [
    packageId
      ? `${userText}\n\n---\nPackage id to use: ${packageId}`
      : `${userText}\n\n---\nName this widget yourself, from the request:` +
        "\n- the package id: lower-case letters, digits and single dashes, " +
        "starting with a letter, at most 24 characters. Name what the widget " +
        '*is* — "water-tracker", not the sentence that asked for it.' +
        "\n- a display name of one to three words, in the language of the " +
        'request — "Water Tracker".',
  ];
  // Only while nothing exists: after that a request is a change, and "rich"
  // on "make the dots grey" would be an invitation to rebuild the widget.
  const scopeLine = !packageId && scope ? SCOPE_INSTRUCTION[scope] : null;
  if (scopeLine) parts.push(scopeLine);

  /**
   * What the endpoints actually returned, when somebody pressed Try.
   *
   * THIS IS THE POINT OF THE WHOLE FEATURE. Without it the model invents field
   * names from the endpoint's description and its own memory of what an API
   * like this usually looks like — and the widget renders "undefined" until
   * somebody reads the real response and says the names out loud. One request
   * replaces that entire loop.
   *
   * Before the files, because it changes how the files should be read: the
   * response is the ground truth and the code is the thing being fixed.
   */
  const unsent = (samples ?? []).filter((sample) => !sample.sent);
  if (unsent.length > 0) {
    parts.push(
      "These are real responses from this widget's own endpoints, captured just " +
        "now. Write against these exact field names, types and nesting — do not " +
        "guess a shape, and do not assume a field exists because an API like " +
        "this usually has one.",
      ...unsent.map(
        (sample) =>
          `Endpoint \`${sample.endpointId}\`${
            sample.status === null ? "" : ` responded ${sample.status}`
          }:\n\n\`\`\`json\n${sample.body}\n\`\`\``,
      ),
    );
  }

  // Sent only when the model does not already have them. Skipping the copy is
  // not a shortcut: the identical text is a few lines up in its own previous
  // message, and a second copy teaches it nothing while being billed twice —
  // once now, and again in every replay of this turn.
  if (currentFiles && currentFiles.length > 0) {
    const alreadyKnown = knownFiles !== undefined && sameFiles(knownFiles, currentFiles);
    if (!alreadyKnown) {
      parts.push(
        "These are the widget's current files.",
        renderFilesForPrompt(currentFiles),
      );
    }

    /**
     * THE OUTPUT SAVING, AND WHY IT IS A PER-TURN INSTRUCTION.
     *
     * Rewriting a whole package to change one line is the largest remaining
     * cost in the wizard: output is billed at five times input, and by this
     * point everything on the input side is deduplicated and cached.
     *
     * It goes here rather than in the system prompt for two reasons. The
     * system prompt is byte-identical across requests and cached — editing it
     * per turn would throw that away. And it is not true on the first turn:
     * there is no package to be partial against, and a model told it may omit
     * files before one exists omits them.
     */
    parts.push(
      "This widget already exists, so return **only the files you change** — " +
        "every file you leave out is kept exactly as it is. Do not repeat a " +
        "file whose contents you are not changing. To remove a file, emit its " +
        "block with `deleted=true` and an empty body.\n\n" +
        "For a change to part of a file, send an edit block instead of the whole " +
        "file. Each SEARCH text is copied exactly from the current file and occurs " +
        "there once; add surrounding lines until it does:\n\n" +
        "```edit path=app.js\n<<<<<<< SEARCH\nconst GOAL = 2000;\n=======\n" +
        "const GOAL = 2500;\n>>>>>>> REPLACE\n```\n\n" +
        "Send the whole file when you are rewriting most of it.",
    );
  }

  return parts.join("\n\n");
}

/** Error codes from `wizard_complete`, as a sentence. */
export function describeWizardError(code: string): string {
  if (code.startsWith("provider_error:")) {
    const detail = code.split(":").slice(2).join(":");
    return detail ? `The model provider refused: ${detail}` : "The model provider returned an error.";
  }
  switch (code) {
    case "not_configured":
      return "No API key for this model yet — add one in Settings → Credentials.";
    case "invalid_api_key":
      return "That API key was rejected. Check it in Settings → Credentials.";
    case "rate_limited":
      return "The provider is rate limiting. Wait a moment and try again.";
    case "model_refused":
      return "The model declined this request.";
    case "response_truncated":
      return "The answer was cut off. Ask for a smaller widget, or split the change.";
    // The budget went on thinking rather than on files, so simplifying the
    // request is the wrong advice — it was never about the widget's size.
    case "truncated_by_reasoning":
      return (
        "The model spent its whole output budget on reasoning and never got to " +
        "the files. Lower the effort next to the model name, or ask for a " +
        "smaller change."
      );
    case "empty_response":
      return "The model returned nothing.";
    default:
      return `Something went wrong: ${code}`;
  }
}

/**
 * Export failures as a sentence.
 *
 * Its own function rather than more cases in `describeDraftError`: none of
 * these is a validation result, and that fallback ends in "did not pass
 * validation" — which for a folder that has gone away names the wrong thing
 * entirely. The codes it does share are repeated here rather than chained,
 * because two of them mean something different once a file is being written.
 */
export function describeExportError(raw: string): string {
  const code = raw.startsWith("Error: ") ? raw.slice("Error: ".length) : raw;
  switch (code) {
    case "package_empty":
      return "There are no files to export yet.";
    case "package_not_found":
      return "That widget is not there any more.";
    case "package_too_large":
      return "This package is larger than a widget may be, so it was not exported.";
    case "invalid_package_id":
      return "That widget name cannot be used as a package id.";
    // Five codes, one sentence: they separate a path that was never usable from
    // one whose folder has gone, and the person did not type either — the save
    // dialog produced it. What they can do about it is the same in all five.
    case "target_empty":
    case "target_not_absolute":
    case "target_is_directory":
    case "target_has_no_folder":
    case "target_folder_missing":
      return "The archive cannot be written there. Pick another folder.";
    default:
      if (code.startsWith("write_failed:")) {
        return `The archive could not be written: ${code.slice("write_failed:".length)}`;
      }
      return `The widget could not be exported: ${code}`;
  }
}

/** Draft error codes from the scan, as a sentence. */
export function describeDraftError(raw: string): string {
  // Tauri rejects with a plain string, but a check made in the frontend arrives
  // as "Error: <code>". Both name the same code, and a message that fell
  // through to the default branch printed the code with a prefix on it.
  const code = raw.startsWith("Error: ") ? raw.slice("Error: ".length) : raw;
  switch (code) {
    case "missing_manifest":
      return "The package has no manifest.json.";
    case "missing_ui_entry":
      return "The manifest points at a UI file that is not there.";
    case "invalid_package_id":
      return "That widget name cannot be used as a package id.";
    case "id_folder_mismatch":
      return "The manifest id does not match the widget name.";
    case "id_already_installed":
      return "A widget with that name already exists. Rename this one first.";
    case "draft_not_found":
      return "There is no draft to keep yet.";
    case "package_not_found":
      return "That widget is not there any more.";
    default:
      if (code.startsWith("unsafe_path:")) {
        return "The package tried to write outside its own folder.";
      }
      if (code.startsWith("draft_conflict:")) {
        return "This draft changed elsewhere. Reload it before writing again.";
      }
      if (code.startsWith("draft_exists:")) {
        // Written by whoever holds it, and this conversation is not them: the
        // fix is to open it, not to retry, so the message says which.
        const id = code.slice("draft_exists:".length).split(":")[0];
        return `A draft called "${id}" already exists. Open it from the list to continue it, or pick another name.`;
      }
      if (code.startsWith("draft_recovery:") || code.startsWith("draft_publish:")) {
        return "The draft could not be published safely. Try the write again.";
      }
      return code.startsWith("api:")
        ? describeApiError(code.slice("api:".length))
        : `The package did not pass validation: ${code}`;
  }
}

/**
 * An `api.json` validation code as a sentence someone can act on.
 *
 * Only the handful a model actually trips is spelled out. The rest fall through
 * with their code intact — a wrong-but-confident sentence would be worse than a
 * code the person can search for.
 */
function describeApiError(code: string): string {
  const [head, detail] = [code.split(":")[0], code.split(":").slice(1).join(":")];
  switch (head) {
    case "invalid_endpoint_id":
      return "An endpoint id may only contain letters, digits and underscores, and must start with a letter — no dashes.";
    case "invalid_placeholder_name":
      return "A {placeholder} in a url may only contain letters, digits and underscores — no dashes.";
    case "header_not_allowed":
      return detail?.toLowerCase() === "authorization"
        ? "An endpoint may not set an Authorization header — use the credential field instead."
        : `The header "${detail}" is not allowed. Only Accept, Content-Type and X-* headers are.`;
    case "url_not_https":
      return "Endpoint urls must be https.";
    case "url_has_query":
      return "An endpoint url may not carry a query string — declare the parameters under query instead.";
    case "url_partial_placeholder":
      return "A {placeholder} must fill a whole path segment, not part of one.";
    case "unknown_credential_type":
      return `There is no credential type called "${detail}".`;
    case "undeclared_placeholder":
      return `The url uses {${detail}} but the declaration never defines it.`;
    default:
      return `The package did not pass validation: api:${code}`;
  }
}

/**
 * Advisory problems in a generated package, in plain language.
 *
 * These are the two ways a widget passes validation, renders correctly and
 * still does nothing — which is worse than failing, because there is no error
 * to read. Both are cheap to spot in the text, so the wizard says them out loud
 * instead of leaving someone to discover that their widget forgets everything.
 *
 * Advice, not rejection: the package is written either way, and a false
 * positive must not stop someone shipping a widget that works.
 */
export function lintGeneratedFiles(files: GeneratedFile[]): string[] {
  const notes: string[] = [];
  const code = files
    .filter((file) => /\.(html|js)$/i.test(file.path))
    .map((file) => file.contents)
    .join("\n");

  // The failure that actually shipped: a widget that renders perfectly and
  // whose every click throws, because the bridge it calls was never loaded.
  if (/\bkavibay\.(storage|http)\b/.test(code) && !code.includes("@kavibay/runtime.js")) {
    notes.push(
      "This widget calls kavibay.storage or kavibay.http but never loads the " +
        'bridge. It needs <script src="@kavibay/runtime.js"></script> before ' +
        "its own script, or every call throws.",
    );
  }
  if (files.some((file) => /kavibay-runtime\.js$/i.test(file.path))) {
    notes.push(
      "This package ships its own kavibay-runtime.js. The host serves the real " +
        "one at @kavibay/runtime.js; a copy is never loaded, and a hand-written " +
        "stand-in defines nothing.",
    );
  }

  const banned = ["localStorage", "sessionStorage", "document.cookie", "indexedDB"];
  const used = banned.filter((api) => code.includes(api));
  if (used.length > 0) {
    notes.push(
      `This widget uses ${used.join(", ")}, which throws in the sandbox. ` +
        `Ask for it to use kavibay.storage instead.`,
    );
  }

  const manifest = files.find((file) => file.path === "manifest.json");
  if (code.includes("kavibay.storage") && manifest) {
    let permissions: unknown;
    try {
      permissions = (JSON.parse(manifest.contents) as { permissions?: unknown }).permissions;
    } catch {
      permissions = undefined;
    }
    const declared = Array.isArray(permissions) ? permissions : [];
    if (!declared.includes("storage.instance")) {
      notes.push(
        "This widget saves data but the manifest does not ask for " +
          "storage.instance, so every save will be denied. Ask for the " +
          "permission to be added.",
      );
    }
  }

  notes.push(...sandboxLint(files));
  return notes;
}

/**
 * The guide's list of silent failures, checked instead of hoped for.
 *
 * Each of these renders a widget that looks right and does nothing — no error
 * in any console the person can see — which is why the guide spends a section
 * on them and why a model still writes them. Found here, they go back in the
 * repair round the wizard already runs, before anybody clicks a dead button.
 *
 * Biased towards silence like `maskLiterals`: a false positive costs a repair
 * round and reads as the model failing, so each check is narrow.
 */
function sandboxLint(files: GeneratedFile[]): string[] {
  const notes: string[] = [];
  const html = files.filter((file) => /\.html?$/i.test(file.path));
  const scripts = files.filter((file) => /\.js$/i.test(file.path));
  const markup = html.map((file) => file.contents).join("\n");
  const raw = [...html, ...scripts].map((file) => file.contents).join("\n");
  const code = scripts.map((file) => maskLiterals(file.contents)).join("\n");

  const inline = [...markup.matchAll(/<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)];
  if (inline.some((match) => match[1].trim() !== "")) {
    notes.push(
      "This widget has an inline <script>, which the sandbox never runs. Move the " +
        'code into a .js file and load it with <script src="app.js"></script>.',
    );
  }
  if (/<[a-z][^>]*\son[a-z]+\s*=\s*["']/i.test(markup)) {
    notes.push(
      "This widget uses inline event handlers (onclick=…), which never fire in the " +
        "sandbox. Attach them with addEventListener in the script file.",
    );
  }
  if (/\.addEventListener\(\s*["']submit["']|\.onsubmit\s*=/.test(raw)) {
    notes.push(
      "This widget listens for a form submit, which never fires in the sandbox. Use " +
        "a click listener on the button and a keydown listener for Enter.",
    );
  }
  if (/\bfetch\s*\(|\bXMLHttpRequest\b/.test(code)) {
    notes.push(
      "This widget calls fetch or XMLHttpRequest, which the sandbox blocks. Declare " +
        "the request in api.json and call it with kavibay.http.",
    );
  }
  if (/(^|[^.\w$])(alert|confirm|prompt)\s*\(/m.test(code)) {
    notes.push(
      "This widget calls alert, confirm or prompt, which do nothing in the sandbox. " +
        "Build the question or message into the widget itself.",
    );
  }

  // An element looked up by an id that nothing creates: `null.addEventListener`
  // on load, and every control after it is dead.
  const looked = new Set<string>();
  for (const match of raw.matchAll(/getElementById\(\s*["'`]([\w-]+)["'`]\s*\)|querySelector\(\s*["'`]#([\w-]+)["'`]\s*\)/g)) {
    looked.add(match[1] ?? match[2]);
  }
  const missing = [...looked].filter((id) => {
    const escaped = id.replace(/[-]/g, "\\-");
    return !new RegExp(`\\bid\\s*[=:]\\s*["'\`]${escaped}["'\`]|\\.id\\s*=\\s*["'\`]${escaped}["'\`]`).test(raw);
  });
  if (missing.length > 0) {
    notes.push(
      `The script looks up ${missing.map((id) => `#${id}`).join(", ")}, but no element ` +
        "has that id, so the lookup returns null and the code after it throws.",
    );
  }
  return notes;
}

/**
 * One state the package has been in, kept so it can be gone back to.
 *
 * WHY THIS EXISTS. Every generation rewrites the **complete** file set — the
 * model returns all of it, every turn. So when the fifth answer breaks what the
 * fourth one had working, there is nothing to go back to: the previous version
 * is not on disk, not in the transcript in a usable form, and not in the
 * model's hands either, since it reasons from the files it was last sent. The
 * only recovery was to describe the old behaviour again and hope.
 *
 * Hand edits have the same hole from the other side: `applyFile` overwrites the
 * package, and the textarea's own undo dies with the next generation.
 *
 * A few kilobytes of text per entry, in a session that may already hold
 * screenshots. This is close to free and it is what makes trying things
 * cheap.
 */
export interface DraftVersion {
  /** Stable across the list being capped, unlike an index. */
  id: string;
  at: number;
  /** What produced it: "Generated", "Edited widget.js", "Opened". */
  label: string;
  /** Known MCP source, when this checkpoint came from an external write. */
  author?: DraftAuthor;
  /** Exact MCP clientInfo.name for an externally written checkpoint. */
  clientName?: string | null;
  files: GeneratedFile[];
}

/**
 * How many states are kept.
 *
 * Five, because the useful answer to "that broke it" is almost always the
 * version immediately before, occasionally two back, and never the ninth. A
 * longer list is a longer strip of buttons to read past to reach the one that
 * matters.
 */
export const VERSION_LIMIT = 5;

/** Whether two file sets are the same package, regardless of order. */
function sameFiles(a: GeneratedFile[], b: GeneratedFile[]): boolean {
  if (a.length !== b.length) return false;
  const byPath = new Map(a.map((file) => [file.path, file.contents]));
  return b.every((file) => byPath.get(file.path) === file.contents);
}

export interface VersionUpdate {
  versions: DraftVersion[];
  /** The id now live. */
  current: string;
}

/**
 * Record the package as it now stands.
 *
 * Compared against the version that is **live**, not the newest one. After
 * going back to an older version those are different, and measuring against
 * the newest would call an unchanged package a change — adding an entry for
 * something nobody did.
 *
 * Deterministic ids rather than random ones, so this stays testable: the
 * timestamp, and a suffix only if that is somehow already taken.
 */
export function recordVersion(
  versions: DraftVersion[] | undefined,
  current: string | undefined,
  files: GeneratedFile[],
  label: string,
  at: number = Date.now(),
  author: DraftAuthor = null,
  clientName: string | null = null,
): VersionUpdate {
  const list = versions ?? [];
  const live = list.find((version) => version.id === current);
  if (live && sameFiles(live.files, files)) return { versions: list, current: live.id };

  let id = String(at);
  for (let bump = 1; list.some((version) => version.id === id); bump++) id = `${at}-${bump}`;

  const next = [...list, { id, at, label, author, clientName, files }];
  return {
    versions: next.length > VERSION_LIMIT ? next.slice(-VERSION_LIMIT) : next,
    current: id,
  };
}

/**
 * Replace the live version's files without adding an entry.
 *
 * For a write that changes the package without being a step anybody took —
 * saving patches `ui.defaultSize` to whatever the preview was left at. That is
 * a real change to the bytes and the snapshot has to follow it, but "Saved" is
 * not a state worth offering to go back to, and an entry per save would push
 * the version that matters off a five-long list.
 */
export function updateLiveVersion(
  versions: DraftVersion[] | undefined,
  current: string | undefined,
  files: GeneratedFile[],
): DraftVersion[] {
  return (versions ?? []).map((version) =>
    version.id === current ? { ...version, files } : version,
  );
}

/**
 * One value a person has to supply before an endpoint can be called.
 *
 * `const` parameters are deliberately absent: the declaration fixes them, the
 * caller cannot set them, and a field nobody may fill is a field that only
 * teaches people the form is lying to them.
 */
export interface EndpointInput {
  name: string;
  where: "path" | "query" | "body";
  type: "string" | "number" | "boolean" | "enum";
  required: boolean;
  /** The allowed values, for an enum. */
  values?: string[];
}

/** One endpoint of the current package, as something that can be tried. */
export interface EndpointProbe {
  id: string;
  description: string;
  method: string;
  /** Where it goes, for a person deciding whether to press the button. */
  host: string;
  /** The credential type it wants, when it wants one. */
  credential?: string;
  inputs: EndpointInput[];
}

const INPUT_TYPES = new Set(["string", "number", "boolean", "enum"]);

function readParams(
  raw: unknown,
  where: EndpointInput["where"],
): EndpointInput[] {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return [];
  const inputs: EndpointInput[] = [];
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) continue;
    const spec = value as { type?: unknown; required?: unknown; values?: unknown };
    if (typeof spec.type !== "string" || !INPUT_TYPES.has(spec.type)) continue;
    inputs.push({
      name,
      where,
      type: spec.type as EndpointInput["type"],
      required: spec.required === true,
      ...(Array.isArray(spec.values)
        ? { values: spec.values.filter((one): one is string => typeof one === "string") }
        : {}),
    });
  }
  return inputs;
}

/**
 * The endpoints a package declares, ready to be called one at a time.
 *
 * WHY THE WIZARD PARSES THIS AT ALL. Rust is the authority on what a
 * declaration means and refuses anything outside it — nothing here is a check.
 * This reads the same file only to know what to put on screen: which endpoints
 * exist and which boxes a person has to fill before one can be tried.
 *
 * Returns `[]` for anything it cannot read, and never throws. A malformed
 * `api.json` is the *expected* case here — the model wrote it seconds ago — and
 * the failure is already reported by the validator, in better words than a
 * parser in the UI could manage.
 */
export function endpointsToProbe(files: GeneratedFile[]): EndpointProbe[] {
  const declaration = files.find((file) => file.path === "api.json");
  if (!declaration) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(declaration.contents);
  } catch {
    return [];
  }
  const endpoints = (parsed as { endpoints?: unknown } | null)?.endpoints;
  if (!Array.isArray(endpoints)) return [];

  const probes: EndpointProbe[] = [];
  for (const each of endpoints) {
    if (typeof each !== "object" || each === null) continue;
    const endpoint = each as Record<string, unknown>;
    if (typeof endpoint.id !== "string" || endpoint.id === "") continue;

    let host = "";
    if (typeof endpoint.url === "string") {
      try {
        host = new URL(endpoint.url).host;
      } catch {
        // A url the wizard cannot parse is one Rust will refuse anyway. The
        // endpoint is still listed: "no host shown" is a smaller surprise than
        // an endpoint silently missing from a list that claims to be all of
        // them.
        host = "";
      }
    }

    probes.push({
      id: endpoint.id,
      description: typeof endpoint.description === "string" ? endpoint.description : "",
      method: typeof endpoint.method === "string" ? endpoint.method.toUpperCase() : "GET",
      host,
      ...(typeof endpoint.credential === "string" ? { credential: endpoint.credential } : {}),
      inputs: [
        ...readParams(endpoint.path, "path"),
        ...readParams(endpoint.query, "query"),
        ...readParams(endpoint.body, "body"),
      ],
    });
  }
  return probes;
}

/**
 * What one endpoint returned, kept so it can be shown and sent.
 *
 * `sent` rather than deleting it after use: the person should still see what
 * came back, and the conversation should carry it exactly once — the same rule
 * `currentFiles` follows.
 */
export interface EndpointSample {
  endpointId: string;
  status: number | null;
  /** The response body, already stringified and clipped. */
  body: string;
  sent?: boolean;
}

/**
 * How much of a response travels to the model.
 *
 * A weather forecast is a hundred lines of numbers and the first ten say
 * everything about its shape — which is all this is for. Field names, nesting
 * and types are what the model was guessing at; the two hundredth hourly
 * reading teaches it nothing and is billed by the token.
 */
export const SAMPLE_MAX = 2000;

/** A response body as it should be stored: pretty-printed if JSON, and clipped. */
export function sampleBody(value: unknown): string {
  let text: string;
  if (typeof value === "string") {
    text = value;
  } else {
    try {
      text = JSON.stringify(value, null, 2) ?? String(value);
    } catch {
      text = String(value);
    }
  }
  return text.length > SAMPLE_MAX
    ? `${text.slice(0, SAMPLE_MAX)}\n… (${text.length - SAMPLE_MAX} more characters)`
    : text;
}

/**
 * How many times a single message may be answered again automatically.
 *
 * ONE. The retry exists because a model handed the exact error text usually
 * fixes it on the first try, and the person was waiting anyway — the round trip
 * costs them nothing but a second of the wait they were already in. A second
 * retry is a different bet: by then the model has seen the problem, failed at
 * it, and been told again, and what that buys is mostly a slower way to arrive
 * at the same broken package while spending someone's tokens on it.
 *
 * A loop here would also be invisible. Nothing on screen distinguishes "still
 * thinking" from "trying the same thing for the fourth time".
 */
export const REPAIR_BUDGET = 1;

/** A runtime fault as the wizard needs it — the host's shape, minus the log's. */
export interface WizardFault {
  source: "error" | "rejection" | "console";
  message: string;
  where?: string;
}

/**
 * A fault the package's own code caused, as opposed to its circumstances.
 *
 * Those are the faults worth fixing without asking: a ReferenceError or a
 * `null.addEventListener` is the model's mistake on every machine. A network
 * error, a missing token or a provider outage is not, and regenerating the
 * widget would not touch it — those stay an offer the person decides on.
 */
export function isCodeFault(fault: WizardFault): boolean {
  if (fault.source === "console") return false;
  return /\b(ReferenceError|TypeError|SyntaxError|RangeError)\b|is not defined|is not a function|Cannot (read|set) propert/.test(
    fault.message,
  );
}

/** One runtime fault, phrased as something to fix rather than something to read. */
export function faultProblem(fault: WizardFault): string {
  const where = fault.where ? ` at ${fault.where}` : "";
  switch (fault.source) {
    case "rejection":
      return `A promise rejected with nothing to catch it${where}: ${fault.message}`;
    case "console":
      return `The widget logged an error${where}: ${fault.message}`;
    default:
      return `The widget threw${where}: ${fault.message}`;
  }
}

/**
 * The follow-up message, when a generated package came back broken.
 *
 * WHY THE MODEL AND NOT THE PERSON. The problems in it are things the wizard
 * already knows in exact words — "never loads the bridge", "uses localStorage,
 * which throws in the sandbox", "threw at widget.js:42:9". Printing that to a
 * person so they can paraphrase it back is asking them to be a courier. The
 * model is the party that can act on it and the party that wrote the fault.
 *
 * "Change only what is needed" earns its place: without it a model handed a
 * one-line complaint will often return a package rewritten from scratch, and
 * the fix arrives with three new behaviours nobody asked for.
 *
 * The problems are passed as-is. They are written for a person, and that is
 * the right register for a model too — `lint:no-bridge` would need a glossary
 * that only this file has.
 */
export function repairTurnFor(problems: string[]): string {
  const heading =
    problems.length === 1
      ? "The package you just returned has a problem, found automatically before anyone looked at it:"
      : `The package you just returned has ${problems.length} problems, found automatically before anyone looked at it:`;

  return [
    heading,
    "",
    ...problems.map((problem) => `- ${problem}`),
    "",
    "Return the corrected package in full, in the same format as before. Change",
    "only what is needed to fix the problems listed above — the rest was fine.",
    "One line of explanation is enough; your previous one still stands.",
  ].join("\n");
}

/**
 * What the preview frame may do **while the package is still a draft**.
 *
 * Exactly the storage permission the package asks for, and never the network: a
 * draft holds no grants, so claiming otherwise would produce a preview that
 * works and an installed widget that does not. The draft has its own storage
 * namespace, so this cannot reach the real widget's data.
 *
 * Once the package is enabled this is *not* the answer any more — the frame
 * checks `network.declared` against this list before the backend is consulted
 * at all, so a preview left on this subset refuses calls the package is
 * genuinely allowed to make. The caller swaps in the install record's grants at
 * that point (`adoptGrantedPermissions`).
 */
export function previewPermissionsFor(files: GeneratedFile[]): string[] {
  const manifest = files.find((file) => file.path === "manifest.json");
  if (!manifest) return [];
  try {
    const declared = (JSON.parse(manifest.contents) as { permissions?: unknown }).permissions;
    if (!Array.isArray(declared)) return [];
    return declared.includes("storage.instance") ? ["storage.instance"] : [];
  } catch {
    return [];
  }
}

/**
 * The package renamed to `id`, in the field its own format identifies it by.
 *
 * Renaming a widget is this edit and nothing else: the host moves the folder to
 * whatever the manifest names, so the manifest is where a rename is expressed.
 * Writing the folder without the manifest would be undone by the very next
 * write, which would read the old name and move it straight back.
 *
 * A runtime package's `name` is its *display* name — the field that must not
 * move here — so the format decides which key is written, exactly as
 * `fileSetProblem` decides which one it reads. Returns the files unchanged when
 * they already say `id`.
 */
export function withPackageId(files: GeneratedFile[], id: string): GeneratedFile[] {
  const manifest = files.find((file) => file.path === "manifest.json");
  if (!manifest) return files;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(manifest.contents) as Record<string, unknown>;
  } catch {
    return files;
  }

  const field = isContractPackageFiles(files) ? "name" : "id";
  if (parsed[field] === id) return files;

  return files.map((file) =>
    file.path === "manifest.json"
      ? { ...file, contents: `${JSON.stringify({ ...parsed, [field]: id }, null, 2)}\n` }
      : file,
  );
}

/**
 * The package with `ui.defaultSize` set to what the person left the preview at.
 *
 * The size someone drags the preview to *is* the size they want the widget to
 * open at — asking them to say it twice would be busywork. Returns the files
 * unchanged when there is nothing to patch, so the caller can skip a rewrite.
 */
export function withDefaultSize(
  files: GeneratedFile[],
  size: { w: number; h: number },
): GeneratedFile[] {
  const manifest = files.find((file) => file.path === "manifest.json");
  if (!manifest) return files;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(manifest.contents) as Record<string, unknown>;
  } catch {
    return files;
  }

  const ui = (parsed.ui ?? {}) as Record<string, unknown>;
  const current = ui.defaultSize as { w?: number; h?: number } | undefined;
  if (current?.w === size.w && current?.h === size.h) return files;

  const patched = {
    ...parsed,
    ui: { ...ui, defaultSize: { w: size.w, h: size.h } },
  };
  return files.map((file) =>
    file.path === "manifest.json"
      ? { ...file, contents: `${JSON.stringify(patched, null, 2)}
` }
      : file,
  );
}

/** `ui.defaultSize` from a package's manifest, when it declares one. */
/** Parses one file of the set as JSON, or `null` when it is absent or broken. */
/** The package with ui.defaultScale set to what the person left the preview at. */
export function withDefaultScale(files: GeneratedFile[], scale: number): GeneratedFile[] {
  const manifest = files.find((file) => file.path === "manifest.json");
  if (!manifest || !Number.isFinite(scale) || scale <= 0) return files;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(manifest.contents) as Record<string, unknown>;
  } catch {
    return files;
  }

  const ui = (parsed.ui ?? {}) as Record<string, unknown>;
  const storedScale = Math.round(scale * 1000) / 1000;
  if (ui.defaultScale === storedScale) return files;

  const patched = {
    ...parsed,
    ui: { ...ui, defaultScale: storedScale },
  };
  return files.map((file) =>
    file.path === "manifest.json"
      ? { ...file, contents: JSON.stringify(patched, null, 2) + "\n" }
      : file,
  );
}

function readJsonFile(files: GeneratedFile[], path: string): Record<string, unknown> | null {
  const file = files.find((entry) => entry.path === path);
  if (!file) return null;
  try {
    const parsed: unknown = JSON.parse(file.contents);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Hostname of every url an endpoint may reach, primary first, without repeats. */
function endpointHosts(url: unknown, fallbacks: unknown): string[] {
  const raw = [url, ...(Array.isArray(fallbacks) ? fallbacks : [])];
  const hosts: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    try {
      const host = new URL(entry).hostname;
      if (host && !hosts.includes(host)) hosts.push(host);
    } catch {
      // A url this cannot parse will fail validation on install; showing
      // nothing for it is better than showing a guess.
    }
  }
  return hosts;
}

/**
 * What enabling this file set would grant, before it has been installed.
 *
 * The consent shown after saving reads a scan row from the backend, which a
 * freshly generated package does not have yet. This derives the same lines from
 * the files themselves so the grant can be shown while it is still a preview.
 *
 * Deliberately lenient: anything malformed is dropped rather than throwing,
 * because the strict check runs on install and reports properly there. The one
 * thing it may never do is *understate* — a host it cannot read is omitted from
 * the line, so the endpoint still appears rather than vanishing.
 */
export function consentPreviewFor(files: GeneratedFile[]): string[] {
  const manifest = readJsonFile(files, "manifest.json");
  const declared = manifest?.permissions;
  const permissions = Array.isArray(declared)
    ? declared.filter((entry): entry is string => typeof entry === "string")
    : [];

  const api = readJsonFile(files, "api.json");
  const rawEndpoints = Array.isArray(api?.endpoints) ? api.endpoints : [];
  const apiEndpoints: ConsentEndpoint[] = [];
  for (const raw of rawEndpoints) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    apiEndpoints.push({
      description:
        typeof entry.description === "string" && entry.description.trim() !== ""
          ? entry.description.trim()
          : "An endpoint with no description",
      method: typeof entry.method === "string" ? entry.method : "GET",
      hosts: endpointHosts(entry.url, entry.fallbackUrls),
      credential: typeof entry.credential === "string" ? entry.credential : null,
    });
  }

  return consentLinesFor({ permissions, apiEndpoints });
}

export function manifestSize(files: GeneratedFile[]): { w: number; h: number } | null {
  const manifest = files.find((file) => file.path === "manifest.json");
  if (!manifest) return null;
  try {
    const ui = (JSON.parse(manifest.contents) as { ui?: { defaultSize?: unknown } }).ui;
    const size = ui?.defaultSize as { w?: unknown; h?: unknown } | undefined;
    if (typeof size?.w === "number" && typeof size?.h === "number") {
      return { w: size.w, h: size.h };
    }
  } catch {
    // A manifest that does not parse is reported elsewhere.
  }
  return null;
}

/**
 * The SVG a package names as its icon, read from the files themselves.
 *
 * Only an `.svg` the manifest points at and the package actually contains: the
 * Wizard shows it before anything is published, so there is no URL to ask the
 * host for yet. A PNG icon is the catalog's business and is left to it.
 */
export function manifestIconSvg(files: GeneratedFile[]): string | null {
  const manifest = files.find((file) => file.path === "manifest.json");
  if (!manifest) return null;
  let icon: unknown;
  try {
    icon = (JSON.parse(manifest.contents) as { icon?: unknown }).icon;
  } catch {
    return null;
  }
  if (typeof icon !== "string" || !icon.toLowerCase().endsWith(".svg")) return null;
  const path = icon.replace(/^\.\//, "");
  return files.find((file) => file.path === path)?.contents ?? null;
}

/** Read ui.defaultScale from a package manifest, when it declares one. */
export function manifestScale(files: GeneratedFile[]): number | null {
  const manifest = files.find((file) => file.path === "manifest.json");
  if (!manifest) return null;
  try {
    const ui = (JSON.parse(manifest.contents) as { ui?: { defaultScale?: unknown } }).ui;
    const scale = ui?.defaultScale;
    return typeof scale === "number" && Number.isFinite(scale) && scale > 0 ? scale : null;
  } catch {
    return null;
  }
}

/** One line of the visible transcript. */
/**
 * Whether a system bubble is a note rather than something to answer.
 *
 * A note reports what happened — opened, updated, renamed, saved, discarded.
 * It is not a turn in the conversation and does not read as one: centred, quiet
 * and only as wide as its own text.
 *
 * What disqualifies a bubble is a **question**, not a button. A consent screen
 * and an Enable put a list of capabilities in front of somebody and wait; those
 * need the width and the left edge of a real message. An "Add to desk" or a
 * "Fix it" is one optional convenience attached to a report, and treating it as
 * a dialog is what made the note that says "Saved" the widest, loudest thing in
 * the transcript — a full-bleed green slab announcing a step that had gone
 * fine.
 */
export function isPlainNote(bubble: WizardBubble): boolean {
  if (bubble.role !== "system") return false;
  return !bubble.approve && !bubble.enable && !(bubble.images && bubble.images.length > 0);
}

/**
 * Add a status note to the transcript without piling it up.
 *
 * Opening a project again with nothing said since wrote another "Continuing
 * your unsaved changes" under the last one, and three in a row read as three
 * events. An opening note replaces one directly above it, and a plain note the
 * same as the one above is written once. A note with a button is always kept.
 */
export function appendNote(bubbles: WizardBubble[], bubble: WizardBubble): void {
  const last = bubbles[bubbles.length - 1];
  const replaces =
    last !== undefined &&
    isPlainNote(last) &&
    isPlainNote(bubble) &&
    !last.run &&
    !bubble.run &&
    ((last.opened === true && bubble.opened === true) ||
      (last.text === bubble.text && last.tone === bubble.tone));
  if (replaces) bubbles.splice(bubbles.length - 1, 1, bubble);
  else bubbles.push(bubble);
}

export interface WizardBubble {
  role: "user" | "assistant" | "system";
  text: string;
  /** Inline preview chips in submitted messages; an empty list means ordinary text. */
  elementReferences?: PreviewElementReference[];
  /** Fresh next steps from this answer, shown only while its version is current. */
  suggestions?: WizardSuggestion[];
  /** Known MCP author for an externally updated system checkpoint. */
  author?: DraftAuthor;
  /** Exact MCP clientInfo.name for an externally updated checkpoint. */
  clientName?: string | null;
  /** Thumbnails of what was attached, so the transcript shows what was asked. */
  images?: WizardAttachment[];
  /**
   * Colour of a system note. Absent is the neutral amber used for anything the
   * person still has to act on; `success` is the green the rest of the app
   * already uses for "this worked", so a finished step stops looking like a
   * warning sitting in the transcript.
   */
  tone?: "success";
  /** Reports that a project was opened; the next opening replaces it. */
  opened?: boolean;
  /**
   * A package this bubble offers to enable, with the consent lines to show
   * first. Present only on the system note that reports a kept package still
   * needing review — the button is the settings trip, not a way around it.
   *
   * `done` flips once it has been used, so a transcript restored from disk
   * cannot offer a grant a second time.
   */
  /**
   * A saved widget this bubble offers to put on the desk.
   *
   * The note used to say "add it from the palette", which asked somebody to go
   * and search for a thing they had just made, by a name they had not chosen —
   * and the palette does not always have it the instant the save returns. The
   * one action anybody wants right after saving is to see the widget, so the
   * bubble offers it directly instead of describing a route to it.
   */
  run?: { id: string; done?: boolean };
  /** What this answer cost, shown in its model logo's tooltip. */
  usage?: WizardUsage;
  /**
   * The model that produced it, and what it cost on that model.
   *
   * Both recorded here rather than looked up when the line renders: the picker
   * moves, the catalog gets edited, a model leaves the list — and none of that
   * changes what this turn already cost. `null` is "this model listed no
   * price", which is not the same as "free".
   */
  model?: string;
  /** Retain the answer's brand even if its model later leaves the catalog. */
  modelCredentialType?: string;
  cost?: WizardCost | null;
  /**
   * The package state this message produced, if it produced one.
   *
   * WHY IN THE TRANSCRIPT. The version list answers "which states exist"; the
   * transcript answers "which state came from what I asked for", and that is
   * the question somebody actually has. "Go back to before I said change the
   * background" is a sentence about the conversation, and a strip of
   * timestamps somewhere else makes the reader translate it into one about
   * clocks.
   *
   * The id, not the files — the files live once, in `versions`. An id that has
   * since been pushed off the capped list simply renders no marker.
   */
  version?: string;
  /**
   * A problem the running preview reported, offered as something to fix.
   *
   * Offered rather than acted on. A static problem is repaired automatically
   * because the wizard found it in the text and nothing else could have caused
   * it — but a widget throws for reasons no regeneration touches: a token that
   * is not set yet, an API that is down, a laptop that is offline. Spending a
   * turn on those automatically would be the wizard quietly buying lottery
   * tickets with someone else's tokens.
   *
   * `done` flips on use, so a transcript restored from disk cannot re-fire it.
   */
  repair?: { problems: string[]; done?: boolean };
  enable?: {
    id: string;
    lines: string[];
    done?: boolean;
    /**
     * The package is still a draft, so the button must save it before it can
     * grant anything — a draft has no install record for a grant to live on.
     * The button says so; this is what makes it true.
     */
    needsSave?: boolean;
    /**
     * The person already approved exactly these lines for this package, so the
     * button is a Save rather than a decision. The list is not repeated: asking
     * someone to re-read an unchanged capability every time they iterate is how
     * a consent screen stops being read at all.
     */
    preApproved?: boolean;
  };
  /**
   * A saved contract package waiting to be told what it may read.
   *
   * Separate from `enable` because the question is a different one. `enable`
   * offers capability lines from a fixed catalogue; this offers the package's
   * requested provider queries, one tick each, and the answer is a grant rather
   * than a yes. Reusing one field would have meant one component rendering two
   * consent screens by branching, which is how the two start borrowing each
   * other's wording.
   *
   * Only the id is kept. The request itself is rebuilt from the scan row every
   * time it renders — a transcript survives restarts and regenerations, and a
   * consent screen restored from disk would be describing a package that has
   * since changed underneath it.
   */
  approve?: {
    id: string;
    /** True once answered, so a restored transcript cannot ask twice. */
    done?: boolean;
    /** Came from Save & Run: open it on the desk once it is approved. */
    run?: boolean;
  };
}

/** Plain-text transcript of the visible turns, with images represented as attachment notes. */
export function formatWizardTranscript(bubbles: readonly WizardBubble[]): string {
  const labels = { user: "You", assistant: "Assistant", system: "System" };
  return bubbles.map((bubble) => {
    const content = [
      bubble.text,
      ...(bubble.images ?? []).map((image, index) => `[Attached image ${index + 1}: ${image.mediaType}]`),
      ...(bubble.enable && !bubble.enable.preApproved ? bubble.enable.lines : []).map((line) => `- ${line}`),
    ].filter(Boolean).join("\n\n");
    return content ? `## ${labels[bubble.role]}\n\n${content}` : "";
  }).filter(Boolean).join("\n\n");
}

/**
 * Everything a wizard conversation needs to survive being unmounted.
 *
 * Widgets are unmounted whenever Kavibay is hidden, so component-local state is
 * lost on every Ctrl+Space. A half-finished conversation with a model is not
 * something to lose to a keystroke.
 */
/**
 * The two package formats, named as the backend deserializes them.
 *
 * A widget that reads from a connected account is a contract package; anything
 * else is a runtime package. The strings must match `WidgetFormat` in
 * `src-tauri/src/wizard/mod.rs` — a mismatch is a rejected command, not a
 * silently wrong prompt, because the enum has no catch-all variant.
 */
export type WidgetFormat = "runtime-package" | "contract-package";

export interface WizardSession {
  /** Identifies the stored conversation; also its file name. */
  id: string;
  /** What the person called the widget. Empty until they name it. */
  widgetName: string;
  /** Provider-facing model id; resolved to a provider by the backend. */
  model: string;
  /**
   * Which package format an older conversation was authoring.
   *
   * Read by nothing now: the format is derived from `providers` — any account
   * makes it a contract package — so this is a remnant of sessions stored while
   * it was a separate choice. Kept in the type so those sessions still parse,
   * and never written.
   */
  format?: WidgetFormat;
  /**
   * The providers a contract widget reads from, as qualified ids.
   *
   * Ids, never rendered blocks: the host embeds what the model is told about
   * each provider and splices them by these ids, so choosing here cannot change
   * the rules the generated package is checked against.
   *
   * Absent or empty for a runtime package, and for a contract widget that needs
   * no account — the prompt then carries no provider section at all rather than
   * an empty heading.
   */
  providers?: string[];
  bubbles: WizardBubble[];
  turns: WizardTurn[];
  /** Unsent input, so a half-typed sentence survives too. */
  draft: string;
  /** Attached but not yet sent. */
  attachments: WizardAttachment[];
  packageId: string | null;
  /** `""` when building something new, else the widget being edited. */
  editing: string;
  previewEntry: string | null;
  /** Permissions the preview frame runs with; see `previewPermissionsFor`. */
  previewPermissions: string[];
  /** The package as last written, so Save can patch its default size. */
  draftFiles: GeneratedFile[] | null;
  /** Size the preview was left at, in CSS pixels. */
  previewSize: { w: number; h: number } | null;
  /** Content scale the preview was left at, or the manifest's default. */
  previewScale: number | null;
  hasDraft: boolean;
  /** Revision of the complete draft tree last read or written. */
  draftRevision?: string;
  /** Latest validator code observed for the current draft, when any. */
  draftError?: string;
  /**
   * Everything this conversation has spent, summed as answers arrive.
   *
   * Accumulated rather than derived from the turns: the counts come from the
   * provider's response and are nowhere else afterwards, so a total that was
   * not kept could only be re-estimated, badly.
   */
  usage?: WizardUsage;
  /** The conversation's running cost; `null` once it cannot be stated. */
  cost?: WizardCost | null;
  /**
   * Reasoning effort for this conversation, or absent for the model's default.
   *
   * Per conversation rather than per model: it is a property of the job — a
   * throwaway tile and a widget with real logic want different amounts of
   * thinking from the same model.
   */
  effort?: string;
  /**
   * The file set the model has already seen — its own last answer.
   *
   * Compared against what is on disk to decide whether the package has to ride
   * along with the next question. Absent means "send them", which is the safe
   * direction: an extra copy costs tokens, a missing one costs a widget.
   */
  knownFiles?: GeneratedFile[];
  /**
   * States the package has been in, oldest first, capped at `VERSION_LIMIT`.
   *
   * Optional so conversations stored before this existed still parse — they
   * simply open with no history, which is what they have.
   */
  versions?: DraftVersion[];
  /** Which of them is on disk right now. */
  currentVersion?: string;
  /**
   * Responses captured by pressing Try, newest per endpoint.
   *
   * On the session so a response survives a reload and stays visible after it
   * has been sent — the person tested it to see it, not only to forward it.
   * Optional so conversations stored before this existed still parse.
   */
  samples?: EndpointSample[];
  /**
   * Unused since the current draft files are sent every turn.
   *
   * Kept in the type so sessions stored while it existed still parse, and
   * never written. It seeded the model once, when a saved widget was opened —
   * which meant a hand edit made mid-conversation reached nobody.
   */
  pendingFiles?: GeneratedFile[] | null;
}

export function emptyWizardSession(id = ""): WizardSession {
  return {
    id,
    widgetName: "",
    model: "",
    attachments: [],
    bubbles: [],
    turns: [],
    draft: "",
    packageId: null,
    editing: "",
    previewEntry: null,
    previewPermissions: [],
    draftFiles: null,
    previewSize: null,
    previewScale: null,
    hasDraft: false,
    pendingFiles: null,
  };
}

/** Storage key for one wizard instance. */
export function wizardSessionKey(instanceId: string): string {
  return `kavibay:widget-wizard:${instanceId}`;
}

/**
 * Cap on a serialized conversation.
 *
 * Generous because conversations are backend files now, not `localStorage`, and
 * because one screenshot is already megabytes of base64 — the old quota-shaped
 * limit would have trimmed a conversation away the moment a picture entered it.
 */
const MAX_SESSION_CHARS = 24 * 1024 * 1024;

/**
 * Drops the oldest turns until the session serializes within `maxChars`.
 *
 * Oldest first, and always in whole user/assistant pairs, so what survives is
 * still a coherent conversation rather than a reply with no question.
 *
 * Each turn is measured once and the total is kept by subtraction. The obvious
 * version — re-serialising the whole session after every drop — is quadratic,
 * which was invisible while a conversation was text and is very much not once
 * one screenshot makes it megabytes.
 */
export function trimWizardSession(
  session: WizardSession,
  maxChars: number = MAX_SESSION_CHARS,
): WizardSession {
  let total = JSON.stringify(session).length;
  if (total <= maxChars) return session;

  const cost = (value: unknown) => JSON.stringify(value).length + 1;
  const turnCost = session.turns.map(cost);
  const bubbleCost = session.bubbles.map(cost);

  let from = 0;
  while (total > maxChars && session.turns.length - from > 2) {
    total -= (turnCost[from] ?? 0) + (turnCost[from + 1] ?? 0);
    total -= (bubbleCost[from] ?? 0) + (bubbleCost[from + 1] ?? 0);
    from += 2;
  }

  return {
    ...session,
    turns: session.turns.slice(from),
    bubbles: session.bubbles.slice(from),
  };
}

/** Restore a stored session; anything unrecognised starts fresh. */
export function parseWizardSession(raw: string | null): WizardSession {
  if (!raw) return emptyWizardSession();
  try {
    const parsed = JSON.parse(raw) as Partial<WizardSession> | null;
    if (!parsed || typeof parsed !== "object") return emptyWizardSession();
    const base = emptyWizardSession();
    return {
      ...base,
      ...parsed,
      // Arrays are the fields a corrupted payload breaks on, and a non-array
      // here would throw on first render rather than merely look wrong.
      bubbles: Array.isArray(parsed.bubbles) ? parsed.bubbles : [],
      turns: Array.isArray(parsed.turns) ? parsed.turns : [],
      pendingFiles: Array.isArray(parsed.pendingFiles) ? parsed.pendingFiles : null,
      widgetName: typeof parsed.widgetName === "string" ? parsed.widgetName : "",
      // Sessions stored before models were selectable named only a provider;
      // an empty model just means "pick the default", so they open cleanly.
      model: typeof parsed.model === "string" ? parsed.model : "",
      attachments: Array.isArray(parsed.attachments) ? parsed.attachments : [],
      previewPermissions: Array.isArray(parsed.previewPermissions)
        ? parsed.previewPermissions
        : [],
      draftFiles: Array.isArray(parsed.draftFiles) ? parsed.draftFiles : null,
      versions: Array.isArray(parsed.versions) ? parsed.versions : undefined,
      knownFiles: Array.isArray(parsed.knownFiles) ? parsed.knownFiles : undefined,
      usage: parsed.usage ? readUsage(parsed.usage) : undefined,
      // `undefined` when nothing was ever spent, `null` when a total was kept
      // and cannot be stated — the two look the same on screen and must not be
      // collapsed here, or a restored conversation starts claiming $0.00.
      cost: parsed.cost === undefined ? undefined : readCost(parsed.cost),
      samples: Array.isArray(parsed.samples) ? parsed.samples : undefined,
      previewScale:
        typeof parsed.previewScale === "number" &&
        Number.isFinite(parsed.previewScale) &&
        parsed.previewScale > 0
          ? parsed.previewScale
          : null,
      draftRevision:
        typeof parsed.draftRevision === "string" && parsed.draftRevision.length > 0
          ? parsed.draftRevision
          : undefined,
      draftError:
        typeof parsed.draftError === "string" && parsed.draftError.length > 0
          ? parsed.draftError
          : undefined,
    };
  } catch {
    return emptyWizardSession();
  }
}

/** Sidebar row for one stored conversation. */
export interface ConversationHeader {
  id: string;
  title: string;
  updatedAt: number;
  /** The package this conversation is about, once it has produced one. */
  packageId?: string | null;
  /** The first thing the person asked, for labelling it inside its project. */
  preview?: string | null;
}

/**
 * What one conversation is called *inside* its project.
 *
 * Not `title`: that is the widget's name, which is the right label for the
 * project and says nothing at all here — six conversations about the water
 * tracker are six rows reading "Water Tracker". The first request is what tells
 * them apart. A conversation nobody has spoken in yet has neither, and is named
 * by the only thing it has, which is being the new one.
 */
export function conversationLabel(header: ConversationHeader | undefined): string {
  if (!header) return "Conversation";
  const preview = header.preview?.trim();
  if (preview) return preview;
  // Not the stored title. That is the widget's name, so a transcript nobody
  // ever spoke in rendered as one more row carrying the project's own name —
  // eight of them in a row, indistinguishable from the ones that hold work.
  // Saying what it is makes it something you can decide about.
  return "No request yet";
}

/**
 * Whether a conversation is worth a file of its own.
 *
 * Opening a project records a checkpoint and a system note, and that used to be
 * enough to persist it: every open left a transcript containing nothing but
 * "Editing…", and a project opened eight times had eight of them. What makes a
 * conversation worth keeping is that something happened *in* it — a request, a
 * sentence typed but not sent, or a change to the package that produced a
 * second version to go back to.
 */
export function conversationIsWorthKeeping(session: {
  bubbles: WizardBubble[];
  draft: string;
  versions?: DraftVersion[];
}): boolean {
  if (session.bubbles.some((bubble) => bubble.role === "user")) return true;
  if (session.draft.trim().length > 0) return true;
  // One version is the baseline recorded on open; a second means the package
  // changed while this conversation was the one on screen.
  return (session.versions?.length ?? 0) > 1;
}

/** One row of `list_drafts`, as the sidebar needs it. */
export interface DraftListRow {
  id: string;
  error: string | null;
  lastWriter?: DraftAuthor;
  lastClient?: DraftClient;
  lastClientName?: string | null;
  updatedAt?: number | null;
}

/**
 * One project: a widget and every conversation about it.
 *
 * The sidebar used to have three groups — saved widgets, conversations,
 * "external drafts" — which are three storage locations, not three kinds of
 * thing. One widget could appear in all three at once, with different contents
 * behind each row and nothing saying which was the real one. Worse, the
 * "external" list is simply `list_drafts`, so the draft the open conversation
 * was writing sat in it too, filed as somebody else's work.
 *
 * A project is the unit a person actually works in: they do not open "a draft"
 * or "a transcript", they go back to the water tracker. A conversation that has
 * not produced a package yet is a project too — an unnamed one — rather than a
 * fourth kind of row, because that is exactly what it is about to become.
 */
export interface ProjectRow {
  /** Package id, or `conversation:<id>` for a conversation with no package. */
  key: string;
  /** Empty until the conversation has named a package. */
  packageId: string;
  title: string;
  /** Conversations about this widget, newest first. */
  conversationIds: string[];
  /** Installed under the custom root, so the palette can run it. */
  saved: boolean;
  /** When it was last saved, ms since the epoch. */
  savedAt: number | null;
  /** Unsaved changes exist in the draft workspace. */
  draft: boolean;
  /** Who wrote those changes last. */
  author: DraftAuthor;
  /** Exact MCP clientInfo.name for the latest draft writer. */
  clientName?: string | null;
  /** When they were written, ms since the epoch. */
  changedAt: number | null;
  /** The draft does not pass validation. */
  invalid: boolean;
  /** Another row shows the same name, so this one has to name its folder. */
  ambiguous: boolean;
  /**
   * When this widget was last *talked* about, which is not when it changed.
   *
   * Opening a row saves its conversation, so this moves on every click. It is
   * the only time an idea with no package has, and it is deliberately not what
   * a row with a draft sorts by — see `projectTime`.
   */
  talkedAt: number;
}

/**
 * The time a row sorts by: when this widget was last edited.
 *
 * One number for the whole list, so the order is the one thing it claims to be.
 * Both halves of "edited" count and the later of them wins: the last write to
 * its draft, and the last Save that published one. A widget saved a moment ago
 * is the most recently edited thing there is — it stayed where it was only
 * because the first version of this gave a kept package no time at all and let
 * it fall through to alphabetical.
 *
 * What is deliberately *not* in it is when the row was opened. Opening saves the
 * conversation, so counting that orders the list by browsing rather than by
 * work, and moves the row out from under the pointer that selected it. A
 * conversation that never produced a package is the one exception: talking in it
 * is the only editing it can have.
 */
export function projectTime(row: ProjectRow): number {
  if (!row.draft && !row.saved) return row.talkedAt;
  return Math.max(row.changedAt ?? 0, row.savedAt ?? 0);
}

/**
 * The one thing the status dot says: can the palette run this yet.
 *
 * Not four states and not a sentence. The line under each name — what changed,
 * who changed it, how long ago — was answering questions nobody was asking
 * while reading a list, and it doubled the height of every row to do it. What a
 * person wants from a list of projects is which of them are real, and that is
 * one bit: a saved package is in the palette, a draft is not.
 *
 * The rest is not deleted, it is moved: the dot's tooltip still carries it, for
 * the moment somebody does want to know.
 */
export function projectIsLive(row: ProjectRow): boolean {
  return row.saved;
}

/** The dot's tooltip: where this project is, and what last happened to it. */
export function describeProjectStatus(row: ProjectRow, now: number): string {
  const where = row.saved
    ? "Saved — you can add it from the palette"
    : "Draft — not in the palette yet";
  return `${where} · ${describeProjectChange(row, now)}`;
}

/**
 * What the row is, in the one word the chip shows.
 *
 * `changed` and `new` are both unsaved drafts and differ in what Save does:
 * one replaces a widget that is on the desk right now, the other puts a new
 * one there. That is worth a different word.
 */
export function projectState(row: ProjectRow): "changed" | "new" | "saved" | "idea" {
  if (row.draft) return row.saved ? "changed" : "new";
  return row.saved ? "saved" : "idea";
}

/**
 * Merge the three sources into one row per widget.
 *
 * Pure, because it is the part worth pinning: the three inputs disagree in
 * normal use — a draft with no conversation is an MCP client's work, a
 * conversation with no draft is an idea nobody kept, a saved widget with both
 * is the ordinary case — and the rule for combining them is not obvious from
 * any one of them.
 */
export function buildProjectRows(input: {
  widgets: { id: string; name: string; updatedAt?: number | null }[];
  drafts: DraftListRow[];
  conversations: ConversationHeader[];
}): ProjectRow[] {
  const rows = new Map<string, ProjectRow>();
  const rowFor = (key: string, packageId: string): ProjectRow => {
    let row = rows.get(key);
    if (!row) {
      row = {
        key,
        packageId,
        title: packageId,
        conversationIds: [],
        saved: false,
        savedAt: null,
        draft: false,
        author: null,
        clientName: null,
        changedAt: null,
        invalid: false,
        ambiguous: false,
        talkedAt: 0,
      };
      rows.set(key, row);
    }
    return row;
  };

  for (const widget of input.widgets) {
    const row = rowFor(widget.id, widget.id);
    row.saved = true;
    row.savedAt = widget.updatedAt ?? null;
    // The scanner reads this out of the installed manifest, so it is the name
    // the widget actually answers to on the desk.
    row.title = widget.name || widget.id;
  }

  for (const draft of input.drafts) {
    const row = rowFor(draft.id, draft.id);
    row.draft = true;
    row.author = draftAuthorOf(draft.lastWriter, draft.lastClient);
    row.clientName = draft.lastClientName ?? null;
    row.changedAt = draft.updatedAt ?? null;
    row.invalid = Boolean(draft.error);
  }

  for (const conversation of input.conversations) {
    const packageId = conversation.packageId ?? "";
    // A conversation that has not produced a package is keyed by itself: two
    // unnamed ideas are two rows, and neither may collide with a package id.
    const key = packageId || `conversation:${conversation.id}`;
    const row = rowFor(key, packageId);
    row.conversationIds.push(conversation.id);
    row.talkedAt = Math.max(row.talkedAt, conversation.updatedAt);
    // A saved widget keeps its installed name; anything else is named by the
    // conversation, which is where the person last said what it is called.
    if (!row.saved && row.title === packageId) row.title = conversation.title;
  }

  const seen = new Map<string, number>();
  for (const row of rows.values()) {
    seen.set(row.title, (seen.get(row.title) ?? 0) + 1);
  }

  return [...rows.values()]
    .map((row) => ({
      ...row,
      // Two widgets can carry the same display name and cannot be merged: they
      // are different folders. Showing the id only where it disambiguates keeps
      // it out of the twenty rows where it would only repeat the name.
      ambiguous: (seen.get(row.title) ?? 0) > 1 && row.packageId.length > 0,
      // Newest first, so a row that says "opens this conversation" opens the
      // one the person was last in.
      conversationIds: [...row.conversationIds].sort(
        (left, right) =>
          conversationTime(input.conversations, right) -
          conversationTime(input.conversations, left),
      ),
    }))
    .sort((left, right) => {
      const time = projectTime(right) - projectTime(left);
      if (time !== 0) return time;
      return left.title.localeCompare(right.title);
    });
}

/**
 * Put the projects in the order the person arranged them.
 *
 * A project list is not a feed. Sorting it by activity means the row you are
 * about to click moves while you reach for it, and the shelf you built — this
 * one at the top because you are living in it, that one below because it is
 * done — is rebuilt behind your back every time anything is written. So the
 * order is yours, and the only automatic placement is for projects the order
 * has never seen.
 *
 * Those go **first**, newest work first among themselves: a project created a
 * second ago is the one thing you are certain to want next, and putting it at
 * the bottom of forty rows is the same as hiding it.
 */
export function orderProjects(rows: ProjectRow[], order: string[]): ProjectRow[] {
  const place = new Map(order.map((key, index) => [key, index]));
  // `rows` arrives sorted by time, and a stable sort keeps that among the
  // projects the order has not placed.
  return [...rows].sort((left, right) => {
    const leftAt = place.get(left.key);
    const rightAt = place.get(right.key);
    if (leftAt === undefined && rightAt === undefined) return 0;
    if (leftAt === undefined) return -1;
    if (rightAt === undefined) return 1;
    return leftAt - rightAt;
  });
}

/**
 * The order to store, after the world changed underneath it.
 *
 * Written back on every rebuild rather than only when somebody drags: a new
 * project that is merely *displayed* at the top and never recorded there would
 * move again as soon as something else was created, and a stored key for a
 * project that has been deleted keeps a hole in the list nothing can fill.
 * Returns `null` when nothing changed, so the common case writes nothing.
 */
export function nextProjectOrder(ordered: ProjectRow[], order: string[]): string[] | null {
  const keys = ordered.map((row) => row.key);
  const same = keys.length === order.length && keys.every((key, index) => key === order[index]);
  return same ? null : keys;
}

/**
 * Move one project by `delta` places, clamped to the ends.
 *
 * Takes and returns the whole key list because that is what is stored: a move
 * expressed as "this one, one up" has to be resolved against some order, and
 * resolving it against a *different* order than the one on screen is how a row
 * lands somewhere nobody pointed at.
 */
export function moveProject(order: string[], key: string, delta: number): string[] {
  const from = order.indexOf(key);
  if (from < 0) return order;
  const to = Math.min(order.length - 1, Math.max(0, from + delta));
  if (to === from) return order;
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, key);
  return next;
}

/** Move `key` to sit where `target` currently is — the drop half of a drag. */
export function dropProject(order: string[], key: string, target: string): string[] {
  const to = order.indexOf(target);
  if (to < 0 || key === target) return order;
  return moveProject(order, key, to - order.indexOf(key));
}

function conversationTime(headers: ConversationHeader[], id: string): number {
  return headers.find((header) => header.id === id)?.updatedAt ?? 0;
}

/**
 * How long ago, at the resolution a sidebar row can honestly claim.
 *
 * Rounded down and coarse on purpose: the question behind it is "is this from
 * this session or from last week", never "is it 94 or 96 seconds". A clock that
 * counts seconds in a list also has to be redrawn every second to stay true.
 */
export function describeAge(at: number | null, now: number): string {
  if (at === null || !Number.isFinite(at) || at <= 0) return "";
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/**
 * The line under a row's name: what this row is, and when it last changed.
 *
 * Every row gets one. It started as a label only for rows with unsaved work,
 * on the argument that a line on all of them leaves the ones worth reading
 * nowhere to stand out from — but with one flat order there is no longer a
 * position that says what a row is, and "a name on its own" was being drawn for
 * both a widget on the desk and a conversation that never produced one. The
 * dot, not the text, is what makes unsaved work stand out.
 *
 * A change nobody recorded an author for says nothing about who, rather than
 * "unknown": that word was in every row written before the host kept a byline,
 * which is most of them on an existing installation, and a column of it reads
 * as an error condition while crowding out the part that is known.
 */
export function describeProjectChange(row: ProjectRow, now: number): string {
  const who =
    row.author === "mcp" || row.author === "codex" || row.author === "claude"
      ? row.clientName || row.author !== "mcp"
        ? describeDraftClient(row.author, row.clientName)
        : "MCP"
      : row.author === "wizard"
        ? "you"
        : "";
  const state = projectState(row);
  if (state === "saved") return join("Saved", "", describeAge(row.savedAt, now));
  if (state === "idea") return join("Conversation", "", describeAge(row.talkedAt, now));
  const what = state === "changed" ? "Unsaved changes" : "Draft";
  return join(what, who, describeAge(row.changedAt, now));
}

function join(...parts: string[]): string {
  return parts.filter((part) => part.length > 0).join(" · ");
}


/**
 * A conversation's sidebar title.
 *
 * The widget's name if it has one, else the first thing the person actually
 * said — a list of "Untitled" tells you nothing about which one to reopen.
 */
export function conversationTitle(session: WizardSession): string {
  if (session.widgetName.trim().length > 0) return session.widgetName.trim();
  const firstAsk = session.bubbles.find((bubble) => bubble.role === "user");
  if (firstAsk) {
    const line = firstAsk.text.trim().split("\n")[0];
    return line.length > 60 ? `${line.slice(0, 57)}…` : line;
  }
  return "New project";
}

/**
 * The package id a conversation writes to.
 *
 * The name the person typed wins; before they type one, the first request is
 * the best guess available. Both go through the same slug rule, so the id is
 * always one the backend accepts.
 */
export function packageIdFor(session: WizardSession, firstRequest: string): string {
  const named = session.widgetName.trim();
  return slugifyPackageId(named.length > 0 ? named : firstRequest);
}

/** Image types both providers accept. Mirrors `IMAGE_TYPES` in providers.rs. */
export const ATTACHMENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

/** Per-image ceiling, mirroring `MAX_IMAGE_BYTES` in providers.rs. */
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
/** Images in one message, mirroring `MAX_IMAGES_PER_MESSAGE`. */
export const MAX_ATTACHMENTS = 6;

/**
 * Why a file cannot be attached, or `null` when it can.
 *
 * Checked here as well as in Rust so the answer arrives on the drop rather than
 * after a generation has been paid for. The backend refuses the same cases
 * regardless — this is convenience, not the boundary.
 */
export function attachmentProblem(
  file: { type: string; size: number },
  alreadyAttached: number,
): string | null {
  if (alreadyAttached >= MAX_ATTACHMENTS) {
    return `At most ${MAX_ATTACHMENTS} images per message.`;
  }
  if (!(ATTACHMENT_TYPES as readonly string[]).includes(file.type)) {
    return `${file.type || "That file"} is not an image the models accept.`;
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return "That image is larger than 4 MB.";
  }
  return null;
}

/**
 * Base64 payload from a `data:` URL, without the prefix.
 *
 * The prefix is provider-specific — Anthropic wants the media type in its own
 * field and rejects the URL form — so it is stripped once, here, rather than in
 * each request builder.
 */
export function base64FromDataUrl(dataUrl: string): string {
  const marker = "base64,";
  const at = dataUrl.indexOf(marker);
  return at === -1 ? dataUrl : dataUrl.slice(at + marker.length);
}

/** One model the wizard can use, as the backend reports it. */
export interface WizardModelOption {
  id: string;
  label: string;
  note: string;
  provider: string;
  credentialType: string;
  configured: boolean;
  /** From the model catalog, which already carries and validates it. */
  pricing?: LlmPricing;
  /**
   * Reasoning-effort levels this model takes, in its provider's words.
   *
   * Empty or absent means the model does not take the parameter — some return
   * an error when it is present at all — so the picker offers nothing and
   * nothing is sent.
   */
  effortLevels?: string[];
  /** The Wizard starts on this model when its provider is connected. */
  authoringDefault?: boolean;
}

/** Prices as `models.json` states them, per `unitTokens`. */
export interface LlmPricing {
  currency: string;
  unitTokens: number;
  input: number;
  output: number;
  /** Only some catalogs state it; see `CACHE_READ_RATE` for the fallback. */
  cachedInput?: number;
}

/**
 * What one turn cost, as the provider counted it.
 *
 * The four are billed at different rates, which is the only reason they are
 * four numbers instead of one: `cached` is a tenth of `input`, `cacheWrite` is
 * a quarter more than it, and `output` is several times it. A single "tokens"
 * figure would hide exactly the distinction that makes a long conversation
 * affordable.
 */
export interface WizardUsage {
  input: number;
  cached: number;
  cacheWrite: number;
  output: number;
}

export const NO_USAGE: WizardUsage = { input: 0, cached: 0, cacheWrite: 0, output: 0 };

/**
 * Everything sent that did not come from cache.
 *
 * WHY THIS EXISTS. The three input buckets are disjoint and billed at three
 * rates, so they are stored apart — but on screen "how big was my prompt"
 * has two answers, not three, and `input` alone is the wrong one. A new
 * message is largely written *into* the cache, so it lands in `cacheWrite`;
 * showing only `input` made every turn read as "3 in" no matter how much had
 * been typed, with the difference sitting in a bucket the line never named.
 *
 * The 1.25x that written tokens cost is not lost by folding them in — it is in
 * the money, which is where a rate belongs.
 */
export const freshInput = (usage: WizardUsage): number => usage.input + usage.cacheWrite;

export function addUsage(a: WizardUsage, b: WizardUsage): WizardUsage {
  return {
    input: a.input + b.input,
    cached: a.cached + b.cached,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    output: a.output + b.output,
  };
}

/** Anything the backend did not report reads as zero rather than as NaN. */
export function readUsage(raw: unknown): WizardUsage {
  const source = (raw ?? {}) as Partial<Record<keyof WizardUsage, unknown>>;
  const count = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
  return {
    input: count(source.input),
    cached: count(source.cached),
    cacheWrite: count(source.cacheWrite),
    output: count(source.output),
  };
}

/**
 * Provider-wide multipliers, not per-model prices.
 *
 * Both Anthropic and OpenAI bill a cache read at a tenth of the input rate and
 * a cache write at a quarter above it. The catalog states `cachedInput` where
 * it knows it; these are the fallback and the write side, which no catalog
 * field carries. Named here so the two numbers live in one place rather than
 * being spelled into a formula.
 */
const CACHE_READ_RATE = 0.1;
const CACHE_WRITE_RATE = 1.25;

/**
 * What one turn cost, priced at the moment it ran.
 *
 * WHY IT IS STORED AND NOT RECOMPUTED. The first version priced every message
 * with whatever model was selected *now*, so switching the picker rewrote the
 * cost of turns that had already been paid for — a conversation's history
 * changing because of a dropdown. What a turn cost is a fact about the past;
 * the only moment it can be established is when the answer arrives.
 */
export interface WizardCost {
  amount: number;
  currency: string;
}

/**
 * A stored cost, checked before it reaches a `toFixed`.
 *
 * The same reason the arrays in `parseWizardSession` are checked: a conversation
 * comes back off disk, and a field that is not the shape it claims does not look
 * wrong — it throws while rendering. Anything unreadable becomes `null`, which
 * the UI already knows how to show as "no figure" rather than as zero.
 */
export function readCost(raw: unknown): WizardCost | null {
  if (!raw || typeof raw !== "object") return null;
  const cost = raw as Partial<WizardCost>;
  if (typeof cost.amount !== "number" || !Number.isFinite(cost.amount)) return null;
  if (typeof cost.currency !== "string" || cost.currency === "") return null;
  return { amount: cost.amount, currency: cost.currency };
}

/**
 * Adds one turn to a running total, or gives up on it.
 *
 * `null` means the total cannot be stated, and it is deliberately sticky: one
 * turn on a model with no listed price, or in another currency, makes every
 * later sum incomplete. A total quietly missing a turn is a wrong number, and
 * this one is money — so it is withdrawn rather than understated.
 */
export function addCost(
  total: WizardCost | null | undefined,
  next: WizardCost | null,
): WizardCost | null {
  if (next === null || total === null) return null;
  if (total === undefined) return next;
  if (total.currency !== next.currency) return null;
  return { amount: total.amount + next.amount, currency: next.currency };
}

/**
 * Roughly what a turn cost, in the catalog's currency.
 *
 * APPROXIMATE ON PURPOSE, and labelled that way wherever it is shown. The token
 * counts are exact — they come from the provider — but a price can be an
 * introductory rate that lapses, a long-context tier the catalog does not model,
 * or simply out of date. Close enough to answer "is this widget costing me
 * cents or euros", which is the question being asked.
 *
 * Returns `null` when the model states no price, rather than a confident zero.
 */
export function estimateCost(usage: WizardUsage, pricing?: LlmPricing): WizardCost | null {
  if (!pricing || pricing.unitTokens <= 0) return null;
  const cachedRate = pricing.cachedInput ?? pricing.input * CACHE_READ_RATE;
  const tokens =
    usage.input * pricing.input +
    usage.cached * cachedRate +
    usage.cacheWrite * pricing.input * CACHE_WRITE_RATE +
    usage.output * pricing.output;
  return { amount: tokens / pricing.unitTokens, currency: pricing.currency };
}

/** `1.2k`, `18.4k`, `340` — a size, not an accounting figure. */
export function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  const thousands = count / 1000;
  return `${thousands < 10 ? thousands.toFixed(1) : Math.round(thousands)}k`;
}

/**
 * `$0.04`, or `<$0.01` for anything that would round to nothing.
 *
 * A turn that cost three tenths of a cent must not render as `$0.00`: that
 * reads as "free", and the running total it belongs to is not.
 */
export function formatCost(amount: number, currency = "USD"): string {
  const symbol = currency === "USD" ? "$" : `${currency} `;
  if (amount > 0 && amount < 0.01) return `<${symbol}0.01`;
  return `${symbol}${amount.toFixed(2)}`;
}

/**
 * Models you can actually use first, the rest after.
 *
 * Order within each group is the backend's, which is capability order — so the
 * list still reads best-first, it just stops opening with entries that cannot
 * run. A stable sort keeps that intact.
 */
/**
 * Keeps an effort level only while the chosen model still takes it.
 *
 * The vocabularies do not overlap fully — `max` and `xhigh` are Anthropic's,
 * `none` and `minimal` are OpenAI's — so switching models can leave a level the
 * new one has never heard of. The host refuses those outright, which would turn
 * an innocent model switch into a failed generation. Dropping to the model's
 * own default is the recoverable direction.
 */
export function effortForModel(
  effort: string | undefined,
  model: WizardModelOption | undefined,
): string | undefined {
  if (!effort) return undefined;
  return model?.effortLevels?.includes(effort) ? effort : undefined;
}

/**
 * A level as a person reads it.
 *
 * Capitalised and spelled out, with no "Effort:" in front of every row — the
 * list already sits under that heading, and repeating it once per item is the
 * kind of noise that makes a short list look long.
 *
 * The words track the API values rather than being reworded: `low` reads as
 * "Low", not "Light". Somebody comparing this against a provider's
 * documentation should not have to work out which of our words means which of
 * theirs.
 */
export function effortLabel(level: string): string {
  if (level === "") return "Default";
  if (level === "xhigh") return "Extra high";
  return level.charAt(0).toUpperCase() + level.slice(1);
}

/**
 * Display names for the platforms that serve authoring models.
 *
 * A short map rather than a field on the model, because the catalog's `vendor`
 * is an identifier (`"openai"`), not a name anybody writes down. Core has the
 * same three strings in `AI_PROVIDER_TABS`, and an extension may not import
 * core — so the duplication is deliberate and bounded: a platform missing from
 * here still shows up, under its own id, instead of vanishing from the list.
 */
const PLATFORM_LABELS: Readonly<Record<string, string>> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  cloudflare: "Cloudflare Workers AI",
};

/**
 * The platforms suggested first.
 *
 * Not a judgement on the vendors: these two serve the frontier models the
 * authoring prompt was written against, and a widget generated on a small
 * Workers AI model needs more turns to arrive somewhere. Somebody who already
 * has a Cloudflare account should still find it in the list, which is why it is
 * listed at all rather than hidden behind Settings.
 */
const RECOMMENDED_PLATFORMS: readonly string[] = ["anthropic", "openai"];

/** One platform the Wizard can author on. */
export interface WizardPlatform {
  id: string;
  label: string;
  /** What `openSettings("ai", …)` needs to land on the right provider tab. */
  credentialType: string;
  /** True once any of its models has a key. */
  configured: boolean;
  recommended: boolean;
  /** How many authoring models it serves, for the "3 models" subtitle. */
  modelCount: number;
}

/**
 * The platforms behind a model list, recommended ones first.
 *
 * *Which* platforms is derived from the catalog, so the Wizard offers exactly
 * what this build can run. The order of the recommended pair is not: it follows
 * `RECOMMENDED_PLATFORMS`, matching the tab order in Settings. Core makes the
 * same choice for the same reason (`AI_PROVIDER_TABS`) — the catalog is sorted
 * by model strength, so deriving the order from it means the list reshuffles
 * whenever a model is added, and this list is the one somebody reads while
 * deciding where to get a key. Unrecommended platforms keep catalog order,
 * having no fixed order to belong to.
 */
export function wizardPlatforms(models: readonly WizardModelOption[]): WizardPlatform[] {
  const byId = new Map<string, WizardPlatform>();
  for (const model of models) {
    const existing = byId.get(model.provider);
    if (existing) {
      existing.configured ||= model.configured;
      existing.modelCount += 1;
      continue;
    }
    byId.set(model.provider, {
      id: model.provider,
      label: PLATFORM_LABELS[model.provider] ?? model.provider,
      credentialType: model.credentialType,
      configured: model.configured,
      recommended: RECOMMENDED_PLATFORMS.includes(model.provider),
      modelCount: 1,
    });
  }
  const platforms = [...byId.values()];
  const recommended = RECOMMENDED_PLATFORMS.map((id) =>
    platforms.find((platform) => platform.id === id),
  ).filter((platform): platform is WizardPlatform => platform !== undefined);
  return [...recommended, ...platforms.filter((platform) => !platform.recommended)];
}

/**
 * Whether the Wizard can author at all yet.
 *
 * The question the empty conversation has to answer before it invites somebody
 * to describe a widget. It used to invite first and mention the missing key in
 * a line above the transcript, which is a caption on a form that cannot be
 * submitted.
 */
export function wizardHasAnyKey(models: readonly WizardModelOption[]): boolean {
  return models.some((model) => model.configured);
}

export function sortWizardModels(models: WizardModelOption[]): WizardModelOption[] {
  const usable = models.filter((model) => model.configured);
  const rest = models.filter((model) => !model.configured);
  return [...usable, ...rest];
}

/**
 * Which model to select.
 *
 * A model the person already chose is kept as long as it works; otherwise the
 * best one with a key. Only when nothing is configured does an unusable model
 * get selected — and then it is the first, so the "no key" hint names the model
 * they would most likely want.
 */
/**
 * Which model a fresh conversation starts on.
 *
 * A choice already made is kept — switching away to compare a price and back
 * again must not be undone by this.
 *
 * Otherwise the catalog's own preference wins over catalog order. "The first
 * configured model" put whichever entry happened to be listed first in charge
 * of what a generation costs, and the order of that file is maintained for
 * other reasons entirely. `authoringDefault` is the catalog saying which of a
 * provider's models the Wizard should open on.
 */
export function defaultWizardModel(
  models: WizardModelOption[],
  current?: string,
): string {
  if (current && models.some((model) => model.id === current && model.configured)) {
    return current;
  }
  const preferred = models.find((model) => model.configured && model.authoringDefault);
  if (preferred) return preferred.id;
  const usable = models.find((model) => model.configured);
  if (usable) return usable.id;
  return models[0]?.id ?? "";
}

/**
 * One run of text, or a provider mention that should render as the composer
 * chip (logo + display name, no leading `@`).
 */
export type MentionSegment =
  | { kind: "text"; text: string }
  | { kind: "mention"; id: string; label: string };

/** `@` is a mention only at a word start — the same rule the composer types with. */
const MENTION_BOUNDARY = /[\s([{"'.,!?]/;
const MENTION_CONTINUE = /[\p{L}\p{N}_]/u;

/**
 * Split stored `@DisplayName` mentions out of a message.
 *
 * Bubbles persist the composer's plain-text form (`@tado°`), not the chip DOM.
 * Both surfaces have to agree on what counts as a mention, so the walk lives
 * here rather than being copied into the transcript renderer.
 */
export function splitProviderMentions(
  text: string,
  providers: readonly { id: string; label: string }[],
): MentionSegment[] {
  const ranked = providers
    .map((provider) => ({ provider, marker: `@${provider.label}` }))
    .sort((a, b) => b.marker.length - a.marker.length);

  const segments: MentionSegment[] = [];
  const pushText = (value: string) => {
    if (!value) return;
    const last = segments[segments.length - 1];
    if (last?.kind === "text") {
      last.text += value;
      return;
    }
    segments.push({ kind: "text", text: value });
  };

  let cursor = 0;
  while (cursor < text.length) {
    const at = text.indexOf("@", cursor);
    if (at < 0) {
      pushText(text.slice(cursor));
      break;
    }
    const boundary = at === 0 || MENTION_BOUNDARY.test(text[at - 1] ?? "");
    if (!boundary) {
      pushText(text.slice(cursor, at + 1));
      cursor = at + 1;
      continue;
    }
    const hit = ranked.find(({ marker }) => text.startsWith(marker, at));
    const after = hit ? (text[at + hit.marker.length] ?? "") : "";
    if (!hit || (after && MENTION_CONTINUE.test(after))) {
      pushText(text.slice(cursor, at + 1));
      cursor = at + 1;
      continue;
    }
    pushText(text.slice(cursor, at));
    segments.push({ kind: "mention", id: hit.provider.id, label: hit.provider.label });
    cursor = at + hit.marker.length;
  }
  return segments;
}

/** What a package file is, as far as the file list's icon is concerned. */
export type FileKind = "json" | "markup" | "script" | "style" | "image" | "text";

const FILE_KINDS: readonly (readonly [RegExp, FileKind])[] = [
  [/\.json$/i, "json"],
  [/\.html?$/i, "markup"],
  [/\.[mc]?[jt]s$/i, "script"],
  [/\.css$/i, "style"],
  [/\.(svg|png|jpe?g|gif|webp|ico)$/i, "image"],
];

export function fileKind(path: string): FileKind {
  return FILE_KINDS.find(([pattern]) => pattern.test(path))?.[1] ?? "text";
}

/** Only SVG among the images is text, and it is markup. */
const HIGHLIGHT_AS: Record<FileKind, Language | null> = {
  json: "script",
  script: "script",
  markup: "markup",
  style: "style",
  image: "markup",
  text: null,
};

/** Which scanner colours a file in the editor, or null to show it plain. */
export function highlightLanguage(path: string): Language | null {
  return HIGHLIGHT_AS[fileKind(path)];
}

/** One line of the file list: a folder, or a file inside the folder above it. */
export type FileTreeRow =
  | { kind: "folder"; key: string; name: string; depth: number }
  | { kind: "file"; key: string; name: string; depth: number; path: string };

interface FileTreeDir {
  dirs: Map<string, FileTreeDir>;
  files: string[];
}

/**
 * The package's files as a tree, folders before files at every level.
 *
 * Flat rows with a depth rather than nested nodes: the list draws one row per
 * line and never folds, so nesting would only be something to walk back out of.
 */
export function fileTreeRows(paths: readonly string[]): FileTreeRow[] {
  const root: FileTreeDir = { dirs: new Map(), files: [] };
  for (const path of paths) {
    let dir = root;
    for (const part of path.split("/").slice(0, -1).filter(Boolean)) {
      let next = dir.dirs.get(part);
      if (!next) {
        next = { dirs: new Map(), files: [] };
        dir.dirs.set(part, next);
      }
      dir = next;
    }
    dir.files.push(path);
  }

  const rows: FileTreeRow[] = [];
  const byName = (a: string, b: string) => a.localeCompare(b);
  const walk = (dir: FileTreeDir, prefix: string, depth: number): void => {
    for (const [name, child] of [...dir.dirs].sort(([a], [b]) => byName(a, b))) {
      const key = `${prefix}${name}/`;
      rows.push({ kind: "folder", key, name, depth });
      walk(child, key, depth + 1);
    }
    for (const path of [...dir.files].sort(byName)) {
      rows.push({ kind: "file", key: path, name: path.slice(path.lastIndexOf("/") + 1), depth, path });
    }
  };
  walk(root, "", 0);
  return rows;
}
