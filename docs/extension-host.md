# Extension host

The second extension system, built from the contract in
`docs/extension-sdk-reference/`. It runs beside the folder-discovered one in
`extensions/`; widgets move over one at a time.

Read `docs/extension-sdk-reference/FINDINGS.md` first if you are changing the
contract. It records twenty-nine errors. Most were found by running rather than
reading, and several are invisible in review; §25 and §27–29 came from
questions instead and say so.

## Where things live

| Path | What |
|---|---|
| `sdk/extension/contract/sdk.ts` | The contract. Sections 1-7 carry no framework types, and that is compiler-enforced. |
| `sdk/extension/contract/sdk-vue.ts` | The only contract file that imports Vue. |
| `core/app/extension-host/` | The host: registry, runtime, query cache, data store, bridge, http. |
| `core/app/extension-host/ui/` | Runtime-owned UI. `WidgetGate.vue` is the entry point. |
| `extensions/<id>/` | Widgets that have migrated — beside the old host's, not inside this one. |
| `sdk/extension/contract/declaredQuery.ts` | A provider query as data: url, params, result, `pick`. Returns an ordinary `ProviderQuery`; the host knows nothing of it. |
| `core/app/extension-host/bundledExtensions.ts` | Discovers those folders. |
| `core/app/extension-host/fixtures/` | The reference set. Test material only — see below. |
| `core/app/extension-host/cockpit.ts` | Where the host meets the running app. |
| `core/app/extension-host/widgetPackageLoad.ts` | Scanned packages + stored grants → loaded extensions. |
| `src-tauri/src/extension_providers/` | The Rust broker: allowlist enforcement, credential injection, `{{placeholder}}` substitution. |
| `src-tauri/src/extensions/generated.rs` | **Generated** from `extensions/*/provider.ts` by `pnpm run build:provider-doc`. The compiled allowlist; never edited by hand. |

## The two boundaries that matter

**A provider never sees a credential.** `ProviderHostContext.credentials` is
`isConnected()` and nothing else. The Rust broker attaches auth for the
provider's declared hosts, and `ResolvedCredential` is not `Serialize`, so a
token cannot cross into JS at all. `scripts/extensionHostSecrets.assert.mjs`
fails the build if a token getter reappears. Finding 8.

**A widget renders only on success.** The gate resolves
`missing-definition` / `provider` / `unconfigured` / `ready` before anything
mounts, and skeleton and error are the runtime's. A widget that draws its own
connect screen or spinner is a bug, not a style choice — in a transparent
overlay, five widgets inventing five loading states reads as breakage.

## Writing a widget

A bundled Contract contribution is a folder under `extensions/<id>`. Widgets
use three files; a standalone palette-action or provider-only extension needs
the manifest and `extension.ts` (plus `provider.ts` when it contributes a
provider):

```
extensions/tado/
  manifest.json     what it is        identity + catalog presentation
  extension.ts      assembly only     identity + contributes
  provider.ts       a contribution    PR-only, never generated
  widgets/
    tile.ts         a contribution    framework-free, loadable under tsx
    TadoTile.vue    how it draws
  view.ts           the Vue surface   widget name → component + icon
```

The folder is split along `contributes`, because that is also how the pieces
are reviewed. A provider decides which hosts this app will send a credential
to and can only arrive by reviewed PR; a widget is the end of the scale a
model may generate. `extension.ts` is assembly, so what an extension
contributes fits on one screen.

`manifest.json` states `name`, `version`, `displayName`, `description` and
`engines` — the same identity block a widget package states, because a bundled
extension is not a different kind of thing (invariant 7). `extension.ts` reads
those fields back out of it rather than repeating them, so the two cannot
drift. On top of that the manifest carries what the contract deliberately does
not model: `replaces`, keywords, categories and a pixel default size.

`extension.ts` and `view.ts` are found by their **default export**; the folder
is found by `"format": "contract"` in its manifest, which is also what keeps the
old host's loader from trying to read it.

Standalone actions use the same discriminator but omit `widgets` and `view.ts`.
Their metadata is an `actions` array in `manifest.json`; handlers are under
`contributes.actions` in `extension.ts`. The cockpit exposes them as global
palette rows with no widget instance. They are bundled first-party code, so a
handler may use the reviewed app surface it needs (Confetti is browser-local;
Kill Port invokes its fixed Rust command after validating the port).

A provider-only extension is the same shape without a palette row: `provider.ts`
plus `contributes.providers` in `extension.ts`, and no `view.ts`. The compiled
allowlist is generated from that file. Linear, n8n, Fitbit and Notion are the
examples — Settings → Credentials and the Widget Wizard see it; the palette does
not until a widget is written against it. Spotify began this way and now ships
its Playlists widget beside the provider.

A definition is a plain object with a headless `setup(ctx)` that returns a view
model. The split from its view is not taste: the contract must stay
framework-free, and the 37-assertion suite runs definitions under `tsx`, which
cannot compile an SFC.

**The manifest is not a trust or permission input.** It carries an icon,
keywords, a default size and `replaces`. Trust still comes from the load source
and permissions still come from the compiled definition — a folder cannot name
itself into a tier by adding a field.

`setup` runs inside an `effectScope` the runtime owns, so `onScopeDispose` is
the whole teardown contract — a widget never sees a mount or unmount hook.

A subscribed query refreshes itself at its `staleTime`; a one-shot `query` does
not. So `staleTime` on anything a widget subscribes to is a call budget, not a
hint — `extensions/tado/provider.ts` derives its 16 minutes from tado°'s 100-a-day
ceiling, and every tile on screen shares the one key and the one timer.

Every query a widget opens is tracked separately, keyed by name and arguments,
and the widget's phase is the worst of them: any error, else any pending, else
success. Error outranks pending because a failure has already happened while a
pending query only might, and letting the maybe win hides the fact. A widget
with two queries therefore cannot render as if fine while one of them is broken.

`ctx.config` is read once, as a plain value. A configuration change therefore
remounts the widget rather than propagating into it.

Reviewed host capabilities are available to bundled first-party widgets:
`ctx.systemInfo.snapshot()` for an OS metrics snapshot and
`ctx.nowPlaying.snapshot()` plus the fixed `previous`, `playPause`, `next`, and
`openSource` controls for the active media session. A widget declaring
`notification: true` may call `ctx.notification.show({ title, body })` to leave
a native OS notification; Windows is implemented first. They are bound from the
compiled widget definition, never from a manifest or runtime package, and do
not expose arbitrary Tauri command names. Alarm widgets additionally receive
`ctx.alarm.notify()` with only `sound_and_pop`, `pop`, `sound`, or `none`; the
host owns the beep, focus, and reveal. Snake may use the HTTPS-only
`ctx.openExternal.open()` surface, and Snippets may use
`ctx.clipboard.writeText()`; neither exposes an arbitrary host command. Polling,
scheduling, and teardown remain the widget's `setup()`/`onScopeDispose`
responsibility. Single Purpose AI may additionally use `ctx.llm.models()`,
`ctx.llm.stream()` and `ctx.llm.cancel()`; the host keeps the model catalog,
provider selection and credentials behind that fixed streaming surface. The
Widget Wizard uses `ctx.wizard` for its fixed authoring, conversation, draft,
scan, and package-enable operations. Its preview and permission components are
provided by the host; the extension never receives a Tauri command name or
imports `core`.

**No `<form>` in a view.** A widget runs under `sandbox="allow-scripts"`, and
the form submission algorithm checks that flag before firing the `submit` event
— so the event never arrives and `@submit.prevent` never runs. Wire the button
with `@click` and the field with `@keyup.enter`. Enforced by
`scripts/extensionHostSandboxGuard.assert.mjs`, because the failure is a widget
that looks right and does nothing. Finding 18.

That is the shape to expect generally: a sandbox flag does not only restrict
what a widget may do, it changes which events exist. Anything gated on the
sandbox flags rather than on permissions behaves this way, so a widget that has
only ever run in the host document has not been tested.

## Fixtures are not examples

`fixtures/` is the reference set from the handoff, and it addresses endpoints
that do not exist. It is the control case for `scenarios.assert.ts` and must
keep its exact shape — the assertions about caching, permissions and
invalidation are pinned to it.

`extensions/tado/` is the pattern to copy for real work.

## Phases

| Phase | State |
|---|---|
| 1 — contract in the repo | Done. 37 assertions, `scenarios.assert.ts`. |
| 2 — Rust host | Done. Both http paths go through the broker; the bundle carries no credential surface. |
| 3 — widget runtime in Vue | Done. Four gate states, runtime-owned skeleton and error. |
| 4 — Tado end to end | Done. The shipping widget now runs on the contract. |
| 5 — command palette | Partly. `HostUi` and palette listing work; see below. |
| 6 — AI builder | Done. The Widget Wizard runs as a Contract widget; model, draft/package, conversation, and approval operations cross `ctx.wizard`, while preview chrome remains host-owned. |

Phase 2 and 4 turned out to be largely already built for the other extension
tier — the broker, the credential store and the tado° device-code flow all
existed. Finding 10 records that, and the general lesson: a phase written
against a reference implementation describes the work *that* reference needed.

## The iframe boundary

Finding 14 put two routes for Phase 6 and this is the one taken: give the
contract host real isolation first, then let generated widgets into it. A trust
label is not a boundary, and loading model-generated code in-process would have
been a step down from the sandbox runtime packages already get.

| Piece | What |
|---|---|
| `bridge.ts` | `JsonBridge.connect(instanceId, emit)` → one `BridgeConnection` per frame. Everything a frame may reach is fixed when the host opens it. |
| `sandboxTransport.ts` | The postMessage protocol: request/response correlation, the ready/init handshake, and shape checks so foreign traffic is left alone. |
| `ui/SandboxedWidgetFrame.vue` | The host end. Owns the iframe, `sandbox="allow-scripts"`, accepts messages only from its own `contentWindow`. |
| `extension-host-sandbox/main.ts` | The guest end. Runs `setup` and renders — trusted with nothing. |
| `scripts/extensionHostSandboxGuard.assert.mjs` | Greps both ends for the rules no test can reach. |

Three rules, and none of them is optional:

**Identity is the connection, never the payload.** A frame is told which
instance it is; it is never asked. Finding 16 is what happens otherwise.

**Identity is a window reference, never a string.** `event.origin` is `"null"`
for an opaque origin, so a check against it passes for everyone while looking
like security. Both ends compare `event.source`.

**The guest is trusted with nothing, including about itself.** It keeps a
registry only to find the `setup` function the host named. Every permission
decision is made on the host side from the host's own record.

**The guest loads a classic script, not a module.** An opaque origin makes every
`type="module"` fetch cross-origin, so a guest written the obvious way does not
load at all. Runtime packages already follow this rule for what looked like a
CSP reason. Finding 17.

**The theme is pushed, not inherited.** A separate document inherits nothing, so
the host sends a curated set of design tokens — `SANDBOX_THEME_TOKENS` in
`sandboxTheme.ts` — on connect and again whenever they change. That list is a
contract of its own: it is what a widget author may rely on, so the cockpit's
internals stay free to move. Adding to it is a decision; reaching around it is
not possible.

Pushed rather than read once because `appearanceLogic` rewrites these on
`documentElement` while the app runs. The frame watches that element's
attributes, which is where the colour-mode attribute and every inline Appearance
property live, and the `prefers-color-scheme` query for a system switch under
"auto" — which changes no attribute at all.

**The gate is the host's, on both sides.** `widgetPhase.ts` holds the rules and
both paths use it, rendering the same `WidgetSkeleton` and `WidgetError`. Query
states reach the frame through `BridgeConnection` — they already cross it, so
nothing is asked of the guest. The one thing the guest reports is whether its
own `setup` finished; lying there draws a skeleton over its own widget and
reaches nothing else.

## Widget packages

A widget that does not ship in the bundle arrives as a package under the
`kavibay-ext` protocol, the same way runtime packages already do.

```
manifest.json          what it is, and what it wants
index.html             <div id="kavibay-widget"> and two classic scripts
widget.js              kavibayWidget.define({ setup, render })
```

```html
<script src="@kavibay/contract.js"></script>
<script src="widget.js"></script>
```

Both host-served or package-local, both **classic** — a module script cannot
load inside an opaque origin at all (finding 17). `@kavibay/contract.js` is the
host's, embedded at compile time and unshadowable; it is a different runtime
from `@kavibay/runtime.js`, which is the one for declared-endpoint packages, and
a package loads one or the other.

| Comes from the file | Comes from the user |
|---|---|
| name, version, display name, engine range | **every permission** |
| default size, configuration schema | |
| which providers it wants (each an entry in `requires.providers`) | which of those accounts it may read |
| which queries it reads (the entry's `queries`) | nothing: it is shown, not granted |
| which actions it wants (the entry's `actions`) | which of those accounts it may also change |

**Writing is declared, reading is the account.** A widget, bundled or
generated, may call a provider action only when its definition names it in
`requires.actions` (a package writes it as `actions` on the provider's entry in
`requires.providers`); `Host.action` refuses anything else with
`permission-denied`, before it touches the connection. For a package the list
that counts is the one in its grant: the dialog asks, per account, whether the
widget may also make changes, and the definition's `requires.actions` is built
from that answer. The file only bounds it — an approval naming an action the
package never declared is refused. Generated code still cannot contribute a
provider, a command, or a palette callback: that is code the host would run,
refused at load.

`widgetPackageManifest(raw, approved)` takes the grant as a required argument,
so there is no path that reads a permission out of the file. `requestedPermissions(raw)`
is the other half: what to show in an approval dialog. Trust never comes from
the file either — the registry derives it from the load source, so a package
loaded as `{ kind: "generated" }` gets trust `generated` and cannot claim a
reserved namespace.

One rule is easy to miss and is enforced there: a `select` field drawing its
options from a provider query must name the package's own provider and an
approved query. A select may set `multiple: true` to store an array of chosen
values. The runtime runs those queries with permissions bypassed, which is
correct when a human wrote the manifest and is a hole when a model did.
Finding 19.

## How a generated widget reaches the screen

The chain, in the order a package travels it. Each link is one file, and each
was a separate failure before it existed.

| Step | Where |
|---|---|
| The scan says which format the directory holds | `runtime_extensions/mod.rs` — the manifest's `widget` object, decided once |
| The user is asked what it may read | `ui/PermissionRequest.vue`, from `buildPermissionRequest` |
| The answer is stored beside the enable flag | `ContractGrant` in `installs.rs`, clamped to what the manifest asked for |
| The grant builds a manifest, which loads | `widgetPackageLoad.ts` → `widgetPackageManifest` → the registry |
| The card picks the frame by format | `WidgetInstanceView` / `InlineWidgetBody` → `ContractPackageWidget` |
| The frame runs the package's own document | `SandboxedWidgetFrame`, `entryUrl` = `kavibay-ext://<id>/index.html` |

Three of these are load-bearing in a way that is not obvious.

**The grant is stored, never derived.** `ContractGrant` has a provider list and
**no per-query or per-action field** — approving the account is the whole
answer. It sits on the install record, so deleting a package forgets what it
was allowed to use and an id that becomes free again inherits nothing. A
package enabled without a grant does not load and says so on the card; that is
fail-closed, not a bug to fix by defaulting.

**A missing grant and an empty grant are different answers.** Absent is "never
asked". Empty is "asked, and told no" — the widget loads and can read nothing,
which is what the user said. Collapsing the two is how a dialog stops mattering.

**The frame is chosen before the runtime branch, and the guard checks the
order.** Both branches match on `runtimeEntryUrl`, so a contract check placed
second never runs — which is the shape the original bug had.
`extensionHostSandboxGuard` asserts the ordering, because nothing else can: the
wrong frame mounts, the document loads, no exception is thrown, and the card is
black.

The chain was run end to end in the app before this was written: a generated
package that had been sitting enabled-and-black reported that it was
unapproved, took a grant from the dialog, and rendered. Worth saying because
every layer of it passed its own tests while the widget was still black — the
suites are necessary here and have never been sufficient.

## Where the dialog lives

**Save, in the wizard.** The same `PermissionRequest` Settings shows, from the
same `buildPermissionRequest`, rendered into the transcript as a bubble. Settings
remains the second way in, for a package that arrived some other way or whose
grant is being changed later.

Not the preview, and the reason is worth keeping: what a draft asks for changes
with every regeneration, so a dialog there would return on each iteration — and a
dialog that keeps returning is one that gets clicked away, which is finding 20's
own argument turned against itself. Save is the moment a draft stops being a
draft, and it is the moment Settings asks at too.

The bubble stores only the package id. The request is rebuilt from the scan on
every render, because a transcript outlives regenerations and a consent screen
restored from disk would otherwise describe a package that has since changed
while granting against the current one.

**A contract draft therefore has no preview to run.** It has no install record,
so it has no grant, and reading the permissions out of its own manifest is the
thing the whole boundary exists to prevent. The stage says so — "Not approved
yet", and what to do about it — rather than embedding a frame that would only be
refused. Once saved and approved it previews for real, through the same
`ContractPackageWidget` the desk uses.

## What is left

- **A package that changes what it asks for after consent** is not re-asked. It
  cannot gain anything — the stored grant is what loads, and a query added to
  the manifest afterwards is not in it — so this is a clarity gap rather than a
  hole. Runtime packages have `api_hash` for the same question.
- **`src-tauri/src/tado/` is gone** (2026-08-17). The call ledger it held is
  the one thing that did not survive it — see Open, below.

## The provider schema

Steps 1 and 2 of the decisions below are built. A query now declares what it
takes and what it returns, and the provider — not the widget — maps the
vendor's JSON into that shape.

| Piece | What |
|---|---|
| `ProviderQuery.args` / `.result` | Optional in the contract so the pinned fixtures keep their shape; required for a shipping provider. |
| `sdk/extension/contract/resultSchema.ts` | `resultSchemaProblems(schema, value)`. MIT, because a third-party provider author needs it to check their own declaration. |
| `Host.runFetch` | The one place `fetch` is called, so the declaration is compared with the real answer in dev builds. |
| `scripts/providerSchema.assert.ts` | Loads every `extensions/*/provider.ts` headlessly and refuses a query without `args`, `result` or `description`. |
| `extensions/tado/provider.assert.ts` | Runs the real fetches against a fake http, and checks each output against the schema that query declares. |

`ResultSchema` has no union, no recursion and no dynamic-key map, and that
omission is the design: a result that will not fit is a result the provider has
not normalized yet. Home Assistant's `entities` with per-domain `attributes` is
the case to expect — the answer is `climateEntities`, not a wider schema.

The derived document is `docs/provider-schema.md` — generated, committed so it
is readable in a PR, and guarded against going stale. The app does not read it:
`providerSchemas()` in `cockpit.ts` derives the same data from the definitions
it already holds, because a second reader of a generated file is a second thing
that can be wrong.

| Piece | What |
|---|---|
| `sdk/extension/contract/providerSchema.ts` | `describeProvider(id, def)`. Carries no actions — the rule made structural rather than remembered. |
| `scripts/providerSchemaDoc.ts` | Renders the document. `pnpm run build:provider-doc` writes it. |
| `scripts/providerSchemaDoc.assert.ts` | Fails the build when document and code disagree. |
| `providerSchemas()` | The same data at runtime, for the picker and the prompt block. |

The picked provider's block and picker are now supplied by the Widget Wizard's
host capability; the extension does not import the provider registry.

## Why the schema looks like this

Decided 2026-08-18 with Alex and built the same day. Kept because the reasoning
is not recoverable from the type names, and two of these were nearly decided the
other way.

- **A query declares its arguments and its result.** `ProviderQuery` gains
  `args: Record<string, ArgSpec>`, mirroring `ProviderAction`, plus a declared
  result shape. Today it declares neither, so nothing machine-readable says what
  `zoneStates` takes or returns, and a generated widget would have to guess
  field names against a live API.
- **And therefore the provider normalizes.** The declared result is the
  provider's own flat shape, not the vendor's JSON. `zoneStates` returns
  `{ id, name, temperature, humidity }[]` rather than tado°'s nested
  `sensorDataPoints.insideTemperature.celsius`. Declaring the vendor's structure
  instead would put one fact in two places with nothing checking them — the
  shape of findings 4 and 7. It also means no widget, generated or not, has to
  know how the upstream API nests things. The host validates a response against
  the declaration in dev builds, so a declaration cannot lie quietly.
- **The schema is derived, never hand-written.** A build step loads the provider
  definitions headlessly — they are framework-free and `tsx`-loadable, which is
  exactly why that property is worth keeping. Consequence: `description` becomes
  required for a provider that contributes queries. Finding 20 keeps it optional
  because an unlabelled query reads badly in the consent dialog and should; for
  a model a bare name is not merely ugly but unusable.
- **The picked provider's schema is injected at runtime**, while the contract and
  design docs stay `include_str!`. A fully dynamic prompt would invalidate the
  existing prompt tests for no gain — only the provider block varies, and
  injecting just that keeps the model from inventing queries on a provider the
  user never connected.
- **Actions are in the derived schema, so the Wizard can call them.** Approving
  an account approves its queries and actions. Generated widgets still cannot
  contribute a provider, a command, or a palette callback.
- **No builtin/third-party split for providers.** Both allowlists are
  compile-time (`ALL`, `CAPABILITY_HOSTS`), so every provider necessarily ships
  in the binary and the third-party side would be empty by construction — and
  "no store, no catalog, no install" is already the scope. The distinction that
  is real gets surfaced instead: `requiresCredential`, which
  `ProviderDefinition` already carries, shown in the derived schema and the
  picker. No new concept.

## Self-hosted providers

Home Assistant and n8n live on the user's own network. n8n shipped 2026-08-29
as the first `FromCredential` provider; Home Assistant is the same rule, not
yet written. GitHub and Linear are unaffected — they stay on exact
hosts.

The check belongs on **who supplied the address**, not on which address it is.

Three of the four protections this needs already exist and must not be touched:
redirects are off (`Policy::none()`), the address is resolved once and pinned
(`.resolve(host, address)`), and *every* resolved address is inspected rather
than the first. Redirect-based SSRF and DNS rebinding are therefore already
closed.

What shipped with n8n (2026-08-29), and what Home Assistant still needs:

1. **The base URL is a credential field.** Normalized on save (`instance_url_field`)
   and copied into metadata as `origin` so provider URLs can use `{{origin}}`.
2. **The provider declares `HostRule::FromCredential`, not a hostname list.**
   Exact-host providers are unchanged.
3. **`vetted_address` takes a policy.** `UserSupplied` allows private, loopback
   and unique-local; **link-local stays refused**.
   `link_local_including_metadata_is_refused` must keep passing.
4. **http, narrowly.** Accepted only when the resolved address is on the user's
   network **and** the provider declared `FromCredential`. Public addresses stay
   https. The token then crosses the LAN in clear text — decided knowingly.
5. **Validate on save.** Parse the URL; drop userinfo, query and fragment; keep
   a path prefix (`N8N_PATH`); strip a trailing `/api/v1`.
6. **Still pending for Home Assistant:** a blocking identity probe before store.
   n8n uses the existing "Test connection" button, same as GitHub and Linear.

**What this gives up, stated plainly.** For a `FromCredential` provider the host
allowlist stops being a boundary; the app will send that credential wherever the
person pointed it. That is their decision to make, and the probe in step 6 is
what makes it an informed one. The same sentence is already true of
`CAPABILITY_HOSTS` and is documented there.

## A widget on two providers

Room temperatures from tado° with the outdoor temperature under them, in one
widget. Built 2026-08-21; `two-providers.assert.ts` is the case, run against
both real providers rather than fixtures.

**The contract.** `requires: { providers: ProviderId[] }` and
`ctx.providers[id]` — one handle per declared provider, keyed by id. All of them
are required: the gate does not mount until every one is connected.

*No roles, deliberately.* A list of ids has a complete meaning: every
provider named is needed. The day a widget wants one it can render without —
GitHub issues visible while Linear is unconnected — that arrives as an extra
field with a default and changes no existing declaration.

*`ctx.provider` is gone rather than kept as a shorthand.* A widget that grows a
second provider would keep compiling and start talking to whichever one the
shorthand picked.

**Finding 7 turned around, not loosened.** The provider id is on the wire,
because the caller's identity no longer picks one provider out.
`JsonBridge.provider()` checks it against the caller's declared set — and
deliberately not against the registry's installed providers: the question is
never "does this exist" but "did this caller declare it". The rule, restated so
it survives the next change: **the wire never decides anything; it may only say
which of the caller's own declarations it means.**

**The gate returns every unconnected provider**, not the first. Connecting one,
being asked for the next, connecting that and being asked for a third is the
same wait presented as three surprises. A provider with
`requiresCredential: false` is never in that list.

**Grants are per provider, not per query.** `permissions` is gone (FINDINGS
§27). `requires.providers` is the request, the approval dialog lists accounts,
and the stored grant is a list of provider ids. **Changes are the one finer
answer**: the entry's `actions` asks, the dialog offers "may also make changes"
once per account, and `ContractGrant.actions` stores what was ticked, clamped in
`set_enabled` to the manifest on disk and to the approved providers. It is one
answer per account rather than one per action, because "may change your
heating" is a decision and "may call `setTemperature` but not `boost`" is the
per-query dialog again. What generated code still cannot contribute is a
provider, a command, or a palette callback.

**Stored grants read three shapes and write one.** `installs.json` records written before
this say `{ provider, queries }` or `{ providers: [{ provider, queries }] }`;
`ContractGrant::migrated` folds both into `{ approved: [...] }` on load, keeping
the provider names and dropping the query lists. Dropping the old spelling would not have
failed loudly — the grant would have parsed as empty and the package would have
loaded granted nothing and rendered blank. A package **manifest** in the old
spelling is refused out loud instead, which is the opposite choice for the
opposite reason: a manifest is authored, so being told is useful.

**The Wizard picks several accounts.** `contract_system_prompt` takes a slice
and splices one block per ticked provider out of
`src-tauri/src/wizard/provider-blocks.json`; the picker is a checkbox list.
Singular and plural are two headings on purpose — "the providers this widget
reads from" above a single block invites the model to invent a second.

**Cross-provider invalidation is not coming.** `runtime.ts` prefixes every
invalidation with the id of the provider whose action ran, so a Linear write
cannot invalidate a GitHub query — and should not be able to, or one provider
could clear another's cache. A widget needing the other side refreshed refetches
it. Worth stating in the contributor docs before the first such widget: the
symptom is "invalidation mysteriously doesn't fire", which is finding 4's
symptom with a completely different cause.

**Still singular, and fine as it is:** `ArgSpec.source` names a query on the
same provider, and `when.providerConnected` names one provider. Neither has met
a case that needs more.

## What a widget may contribute besides a view

Four capabilities the contract did not have when it was ported. They arrived
with the Emoji Picker and Calculator migrations, and are kept — but they were
built inside a migration diff rather than decided, so what they are and where
their limits sit is written down here rather than inferred from the types.

| Field | Closes | What it is |
|---|---|---|
| `actions` | migration gap "A", 12 extensions | Local widget actions plus standalone palette actions. **Declared in `manifest.json`, implemented in the definition**, paired by id. |
| `palette` | gap "M", 2 extensions | `inlineView`, `searchText`, `instanceActions` — what the palette shows for one placed instance. |
| `duplicateData` / `duplicateDataTransform` | gap "L", 19 extensions | Whether persisted `ctx.data` is copied when an instance is duplicated. |
| `sharedData` | the shared-store question | A second store, scoped to the extension rather than the instance. |
| `wizard` | Widget Wizard's control-plane boundary | A bundled-only capability for model completion, backend conversation files, draft/package operations, and host-owned package refresh. |

**An action is declared where a person will look for it.** `manifest.json`
carries the id, title, subtitle, keywords and the parameter it prompts for; the
widget definition carries only `actions: { "<id>": handler }`. That split is the
old extension format's, restored on purpose: the manifest is the file somebody
reads to see what an extension offers, and an action is the most consequential
thing on that list. Merging both halves into TypeScript put the interesting one
where only a reader of code would find it — which is exactly how it was noticed.

It also leaves room for a package to declare actions later, since a package's
only declarative surface is JSON.

An action-only extension uses the same pairing at the extension level:

```json
"actions": [
  { "id": "launch", "title": "Launch Confetti", "needsInstance": false }
]
```

```ts
contributes: {
  actions: {
    launch: ({ args }) => { /* ... */ },
  },
}
```

Standalone actions are always `needsInstance: false`; they do not appear in the
widget catalog and the host does not create a placeholder card for them.

Both halves, in full — `manifest.json`:

```json
"widgets": {
  "emoji-picker": {
    "actions": [
      {
        "id": "search-emojis",
        "title": "Search Emoji",
        "subtitle": "Search the emoji picker",
        "keywords": ["search", "find", "emoji"],
        "params": [
          { "name": "search", "type": "text", "required": true,
            "placeholder": "Emoji name or keyword" }
        ]
      }
    ]
  }
}
```

and `widgets/emojiPicker.ts`, where the same id is the only thing repeated:

```ts
export const emojiPickerWidget = defineWidget({
  name: "emoji-picker",
  actions: {
    "search-emojis": ({ ctx, args, setConfig }) => { /* ... */ },
  },
  component: /* ... */,
});
```

`bundledExtensions.ts` pairs the two and **refuses either half without the
other**: a declaration with no handler is a palette row that does nothing when
pressed, and a handler with no declaration is unreachable code no reviewer would
see. The old loader only warned about the second and dropped it silently.
`widget-actions.assert.ts` pins both directions on synthetic input, and
`scripts/extensionActions.assert.ts` runs the real pairing function over every
shipped extension — because the refusal itself lives in a module that only ever
executes under Vite, so without it the first report of a mismatch was a
module-load error in the browser.

**Local actions are not provider commands, and the distinction is the point.**
An action here normally runs against one widget instance (or receives an empty
instance id when its manifest declares `needsInstance: false`) and never
crosses a provider boundary — that is why it can be a plain callback while an
`ActionCommand` needs a declared provider, an `ArgSpec` and a confirm rule.
Reinterpreting the old palette actions as provider commands is what
`docs/extension-migration.md` warned against; this is the other route.

**`sharedData` is scoped by the host, never by the widget.** The runtime hands
in `this.data.shared(found.ext.id)` — the extension id it resolved from the
caller, so one extension cannot name another's scope. That is invariant 4 in
the same shape `provider.*` requests use. Writes go through the same `encode()`
as `ctx.data`, so the 256 KiB quota and the JSON-only rule still apply.

**None of it is available to a generated widget.** `actions` and `palette` are
callbacks the host invokes, which is the same category as
`contributes.commands` — refused for generated extensions since the beginning.
The registry refuses all three now. Nothing could reach it today anyway,
because `widgetPackageManifest` builds a widget field by field out of JSON and
a function cannot come from JSON; the check exists so the protection comes from
the rule rather than from another file's construction.

Open: `evict(instance)` clears one instance's data, and there is no equivalent
for the shared store. That is probably right — a recent-emoji list should
outlive the widget that wrote it — but it means shared data currently has no
path to being cleared at all.

## Asking twice is not caution

A contract package is asked what it may read at Save. It used to be asked again
at every following Save, because regenerating a widget rewrites its files — and
iterating on the wording of a tile produced an identical dialog each time.

That is not a stricter boundary, it is a weaker one. A dialog that always
returns unchanged is one people learn to dismiss unread, and then the dialog
that *does* ask for something new gets dismissed with it. Finding 20 makes the
argument about unlabelled queries; this is the same argument one level up, and
the runtime-package path had already answered it ("that is not a decision worth
re-reading").

The grant survives a regeneration — it lives on the install record, not in the
package — so:

- **identical or narrower** → no dialog. The existing grant is re-applied and
  the widget comes back on. Narrowing is the user's to do in Settings, not a
  reason to interrupt an edit.
- **one new query** → the dialog returns, with the already-approved boxes
  ticked, so the empty box is the question.

A tick can only ever come from a decision the person already made for this same
package. Nothing the *package* asks for pre-ticks anything: a request is not a
decision. `askedNothingNew` and the pre-ticking are pinned by
`permission-request.assert.ts`, because both failure directions are silent —
one nags, the other grants unasked.

## Open

- **Self-hosted providers do not connect yet.** The design is decided and
  written above; nothing is built. Anyone reaching for Home Assistant or n8n
  starts there rather than at `is_forbidden_address`.
- **Phase 5 has no command to demonstrate.** Its acceptance names "Living room
  to 21 degrees", which was a fixture invention. The real Tado provider is
  read-only, like the widget it replaced, so it contributes no actions. The
  Calendar fixture's commands are the only ones left, and that provider cannot
  connect.
- **A tolerated failure still shows as one.** The aggregate reports every query
  the widget opened, so a widget that catches a query error and carries on
  deliberately still lands on the error panel. No widget here does that, and the
  alternative — letting a widget suppress the runtime's error UI — is the thing
  the gate exists to prevent. It is a decision, not an oversight, but it is the
  one to revisit first if a widget ever needs an optional query.
- **HTTP status maps to `ProviderError` lossily.** A server 403 and a genuine
  permission denial both arrive as `permission-denied`. That mapping cost four
  rounds of misdiagnosis once; the server's own message is now in the error
  text, which is what made it findable.
- **No daily call ledger on the contract side.** `src-tauri/src/tado/` was
  deleted on 2026-08-17 — 828 lines with no frontend caller since the widget
  moved — and its pacing constants live on in `extensions/tado/provider.ts`.
  What did *not* survive is its daily call ledger (`calls_today` / `add_calls`
  in a SQLite table). The contract keeps the account under tado°'s ~100-a-day
  ceiling **by construction**: every tile shares one cache key, so `staleTime`
  is the interval for the whole screen. That holds within a session. A ledger
  would additionally survive restarts and account switches, which pacing alone
  cannot. Recover it from git history if that turns out to matter.
- **Todo remains a dev-only control.** Clock now ships through the contract
  adapter and reuses the `clock` catalog id; both views remain statically
  mapped in `widgetViews.ts`.
