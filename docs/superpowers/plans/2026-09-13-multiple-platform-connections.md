# Multiple platform connections

Status: implementation in progress, authorized by Alex for every credential type.

Maintainer constraint: Kavibay is in development. Backward compatibility is not
required; existing configurations may break. Design directly for the new model,
without legacy API adapters, automatic data migration or dual-format support.
Resetting old development state and reconnecting accounts is acceptable.

## Intended behavior

Settings → Credentials manages multiple named connections per credential type,
for example `Linear — Work` and `Linear — Personal`. Each widget instance selects
its connection in a host-rendered Connections section of its settings.

- No matching connection: show setup guidance and a link to create one.
- Exactly one matching connection: preselect and persist its ID automatically.
  An incomplete or expired connection remains selected but requires setup or
  reauthentication before requests can run.
- Multiple matching connections and no previous selection: require a choice.
- An existing selection survives adding, reordering, or renaming connections.
- A deleted or disconnected selection never silently falls back to another
  account. Keep a missing/disconnected state until the user chooses or reconnects.
- Widgets sharing a platform may select different connections simultaneously.
- A widget using multiple credential types gets one selector per required type.
- Renaming a connection changes its label everywhere, not its identity.

Connection selection does not grant a sandboxed package access by itself.
Only approved connections may be used. A sole connection may be preselected in
the consent UI, but still requires the existing permission approval.

## Findings in the current code

| Area | Current behavior | Consequence |
| --- | --- | --- |
| `src-tauri/src/credentials/db.rs` | Rows already have independent IDs, type IDs, names and encrypted secret blobs. There is no unique constraint on type. | Reuse this store; do not create a second secrets system. |
| `credentials/commands.rs::credentials_save` | Saving without an ID reuses `find_by_type`. | A new connection currently edits the existing one. |
| `credentials/db.rs::find_by_type` | Chooses the first row by creation time and ID. | Cannot represent a widget's chosen account. |
| `credentials/resolve.rs` | Has both ID-based `resolve` and type-based `resolve_for_type`. | Keep ID resolution and replace implicit account selection at callers. |
| `core/app/settings/credentials/credentialsPanelLogic.ts` | `summaryForType` returns the first matching credential. | The UI needs a connection list inside each platform/type. |
| `core/app/extension-host/runtime.ts` | Provider contexts and statuses are provider-wide; cache keys are provider + query + arguments. | Requests, status, subscriptions and caches need connection context. |
| `core/app/extension-host/configOptions.ts` | Loads provider-backed configuration choices without instance context. | Team/project choices must use the same connection as the widget. |
| `src-tauri/src/extension_providers/mod.rs` | HTTP and status resolve by provider's credential type. | The Rust broker must validate and resolve the selected connection ID. |
| `src-tauri/src/runtime_extensions/http.rs` and `installs.rs` | Credential endpoints resolve by type; grants record credential types. | New accounts must not inherit a package's old type-wide grant. |
| `src-tauri/src/credentials/oauth/mod.rs` | Login/refresh state and generation guards are already keyed by credential ID. | Preserve and verify this isolation for multiple accounts. |
| `src-tauri/src/llm/{commands,catalog}.rs`, `wizard/providers.rs` | Host AI consumers still use type-wide lookup. | They need an explicit default or instance selection too. |

Linear itself is currently a provider-only extension (`extensions/linear/`),
not a standalone widget. The first end-to-end example should therefore be a
widget consuming `kavibay.linear/linear`, including a generated/runtime widget.
Its provider declares `credentialType: "linearApi"` and need not see any key.

The checked-in runtime endpoint implementation already supports approved use of
credentials despite the older broad statement in AGENTS.md that runtime packages
get none. Preserve the actual boundary: packages never receive secrets; approved
requests are authenticated in Rust. Reconcile that documentation in implementation.

## Recommended architecture

### Identity and ownership

Use the existing credential row ID as the connection ID. A credential type is
the auth schema; a connection is one saved account/workspace using that schema.
Do not key identity by the editable display name, provider name, or API key.

Keep bindings in the Rust credential subsystem, separately from encrypted
payloads and extension-owned configuration. A proposed binding record contains:

- Scope: widget instance, or a named host consumer with no widget instance.
- Owner ID: stable instance ID or host consumer ID.
- Credential type ID.
- Selected connection ID.
- Binding revision for detecting changes during requests and UI updates.

The key is `(scope, owner ID, credential type ID)`. This lets a widget's providers
and declared HTTP endpoints share its selection when they use the same auth type.
It deliberately allows one connection per type per widget; displaying several
accounts within one widget is a separate feature. Multiple widget instances cover
the requested use case.

Persist missing selections as unresolved references when a credential is deleted;
do not cascade-delete bindings into an indistinguishable never-configured state.
Widget deletion removes its bindings; duplication copies the chosen IDs, never
the secrets. Moving between desks or between palette and desktop preserves the
instance binding. Cross-desk placements of one instance share its selection.
Scratch previews need a temporary scope; promotion copies the selected bindings.

Alternative considered: put connection IDs in each extension's own config. That
requires every widget to implement account selection and creates separate paths
for providers, HTTP endpoints, settings and grants. A host-owned binding provides
one selection rule across all of them.

### Public contracts

Names below are proposed, not implemented:

- `connections_list(typeId)` → non-secret IDs, names, account labels and states.
- `connections_create(typeId, name, fields)` → new ID, never reuses another row.
- `connections_update(id, name?, fields?)` → updates that exact existing row;
  an unknown ID fails rather than creating a replacement.
- Existing connect/disconnect/test/delete operations remain ID-addressed.
- `connection_binding_get(scope, ownerId, typeId)` → selected/missing/needs-choice
  state and revision; a separate initialization operation may persist sole choice.
- `connection_binding_set(scope, ownerId, typeId, connectionId)` → validates
  declaration, type and applicable grant, then persists and emits a change event.
- Internal `resolve_connection(expectedType, connectionId)` → existing backend
  resolution plus an explicit type check. No first-row fallback.

The host derives widget identity and required types from the registered instance,
provider declarations and validated endpoint declarations. Guest-supplied owner
IDs or connection IDs do not establish authority. The UI displays only metadata;
saved keys/tokens stay encrypted and backend-only as today.

Provider handles remain convenient for widget authors:
`ctx.providers[providerId].query(...)` uses the instance's bound connection.
Provider implementation code receives a scoped HTTP/status context; it does not
pass or read secrets. Calls outside a widget use an explicit host scope.

### Data isolation and switching

Carry the resolved connection context through provider query, action, subscription,
HTTP transport, status checks and configuration option loading. Pin the context
for a request, including any OAuth refresh/retry; a retry must not select a new
account halfway through an operation.

Cache identity must include provider, connection ID, credential revision, query
and arguments. Authentication edits invalidate the affected connection's data;
renames need only refresh labels. Invalidation after actions must use that same
connection scope. Keep sharing between widgets using the same connection.

Switching a connection stops the old subscriptions, clears visible account data,
rebuilds scoped handles, and reloads options and results. Use binding revisions
to discard late responses for a previous selection. Account-derived persistent
data also needs connection-scoped keys or explicit invalidation. Do not clear
unrelated widget content or user-authored text.

Dependent configuration such as Linear team IDs must be revalidated against the
new workspace. Add explicit dependency metadata if the current configuration
schema cannot express which fields depend on which provider/connection. Clear
invalid dependent values and request a new choice; retain unrelated settings.
Already-sent mutations cannot be undone by switching accounts: finish/report them
against the original connection and prevent duplicate submission during switching.

### Settings and consumers

- Credentials panel: platform/type list → named connections → existing generic
  credential editor, with add, rename, test, reconnect and delete.
- Widget settings: host-owned Connections section before provider-dependent fields.
  Make settings available even if the widget has no custom settings of its own.
  Cover contract widgets, runtime packages, first-party adapters, and inline views.
- Show the sole selected connection as a read-only label; show a selector when
  there are multiple choices. Include setup/attention state and a management link.
- Deletion UI lists affected instances/host consumers. Deleting a connection
  invalidates their data and access without selecting a replacement.
- Host AI/Wizard/palette consumers without an instance need an explicit default
  binding. Prefill the existing/sole connection; ask for a default if ambiguous.
  Widget AI calls use their widget bindings. Settings → AI continues to reuse
  the generic credential editor; model preferences do not become credentials.
- Environment fallbacks must be explicit development connections or isolated
  host defaults. They must not fill missing fields in unrelated selected accounts.
- Local CLI-session discovery used by AI Usage is a different auth path; inventory
  it separately rather than presenting it as already migrated by this feature.

## Implementation sequence

1. **Credential operations and binding store.** Separate create/update, implement
   typed binding resolution and safe summary/state APIs, preserve encryption and
  per-ID OAuth guards. Define the new schema and add isolated Rust tests.
2. **Carry connection context through execution.** Update runtime contexts, broker,
   status, cache keys, subscriptions, actions and configuration options together.
   Include declared HTTP endpoints and refresh retries. Prove two Linear accounts
   can execute identical query names/arguments independently.
3. **Connection-specific permissions.** Scope runtime grants and revocation to
   exact connection IDs. Validate before serving cached results as well as before
   network calls. Preserve endpoint-consent hashes, host allowlists and sandbox
   frame identity checks; no new secret access or CSP entries.
4. **Settings and instance lifecycle.** Add platform connection management and the
   generic widget selector. Implement duplicate/dispose, first-run, inline,
   preview/promotion, switching and dependent-field behavior.
5. **Update every consumer and finish rollout.** Update host AI defaults, Wizard,
   status gates and any remaining first-party/type-based callers. Remove implicit
   first-row resolution APIs from request paths. Update SDK/bridge declarations,
   fixtures, documentation and frontend/Rust validators together where affected.

Do not expose multiple-account creation to users until routing and permissions
are connection-aware. Steps are reviewable units, not independent release points.

## Development cutover — no backward compatibility

- Reuse the existing encrypted credential store infrastructure and ID-based
  OAuth machinery where they fit. There is no requirement to preserve old data.
- Implement the new schema and contracts directly. Update all callers in the
  same change series and delete obsolete type-only resolution APIs and unused
  old import paths. No first-row fallback, compatibility wrapper or dual reader.
- Old widget bindings and type-wide package grants are not migrated. Reset the
  affected development state and require new selections/connection-specific
  consent. Re-entering credentials is acceptable if the schema change needs it.
- Keep the reset scope explicit: connection-related development state only;
  unrelated widget content does not need to be deleted for this feature.
- New connections never inherit another connection's grants. Old-format grants
  must be rejected rather than interpreted as access to every account.
- Document the required development reset and startup schema-version behavior.
  No migration tooling or support for running older builds is part of this work.

## Verification and acceptance

- Rust: independent create/update/delete; wrong-type and unknown IDs refused;
  zero/one/many selection; independent OAuth refresh, login and
  disconnect; deleted credentials cannot be resurrected by a late task.
- TS asserts: per-connection cache/status/invalidation; config options use the
  selected account; stale responses after switching are discarded; bindings
  survive duplicate, moves and adding a second account.
- Runtime tests: a forged instance/connection ID fails; an old type grant never
  grants a newly created account; revocation prevents cached and fresh access;
  retries retain the original connection; no secrets cross either bridge.
- Manual app smoke: two named Linear connections with distinguishable workspace
  data, two widgets side by side, automatic sole choice, explicit multiple choice,
  switching, team re-selection, rename/delete/reconnect, restart, inline/desktop,
  generated widget consent and host AI default. Also exercise one OAuth provider.
- Run `npm run verify` and `npm run verify:rust`. Run fresh-setup/reset smoke using both
  an isolated absolute `KAVIBAY_DATA_DIR` and `WEBVIEW2_USER_DATA_FOLDER`.

Planning verification: source inspection only. This document changes no runtime
behavior; no live credentials were read and no application tests were run for it.
