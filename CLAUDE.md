# Kavibay Extension System — implementation handoff

This folder is a **verified reference implementation** of the extension
contract, not a prototype to be reinterpreted. It compiles under
`tsc --strict` and 37 assertions pass (`npx tsx src/test/scenarios.ts`).

Read `FINDINGS.md` before writing any code. It documents seven contract errors
that were found by running this suite. Each one looks like a reasonable design
choice on paper. If you redesign from the type names alone you will reintroduce
at least findings 4 and 5, and neither is visible in code review.

---

## Non-negotiable invariants

These are not preferences. Each one is enforced by a test in
`src/test/scenarios.ts`. If a change breaks one, the change is wrong.

1. **Trust is derived from the load source, never read from a manifest.**
   An extension cannot name itself into a tier. Reserved namespaces
   (`kavibay`, `core`, `official`, `system`) are refused for anything not
   bundled. See `deriveNamespace` / `deriveTrust` in `src/host/registry.ts`.

2. **Permissions fail closed.** A missing or empty permission list means deny,
   never "unchecked". `permissions` is required whenever `requires.provider`
   is set. (Finding 5 — a widget declaring only queries could call every
   action on its provider.)

3. **Secrets never cross the wire.** `ProviderHostContext` is handed only to
   provider code running in the host. No token value ever appears in a
   `WidgetResponse`. Widgets get a capability handle, never a credential.

4. **The wire never carries a value the host can derive from caller identity.**
   `provider.*` requests carry no provider id; the host resolves it from the
   caller's registered instance. (Finding 7.)

5. **Query keys are built by one party.** `ProviderQuery.key()` returns the
   discriminating part only (`[a.roomId]`). The host prefixes provider id and
   query name. `invalidates` returns `{ query, key? }`, never a raw key.
   (Finding 4 — the bug that silently disabled all invalidation.)

6. **Everything crossing the widget boundary is async and JSON-serializable.**
   No functions, no reactive objects, no direct `invoke`. A `Ref` in a
   `WidgetRequest` is a bug. Verified by section [7] of the suite, which runs a
   real widget over a `JSON.stringify` transport.

7. **Bundled widgets use the same API as external ones.** No
   `import { store } from "../../core"` because a widget ships in the binary.
   If a bundled widget needs something the SDK cannot express, extend the SDK.

8. **Anything requiring a credential is a Provider.** Never an http capability
   call with a key in widget configuration, however trivial the provider looks.

---

## Port map

| File | Action |
|---|---|
| `src/sdk.ts` | **Port unchanged.** This is the contract. |
| `src/host/query-cache.ts` | **Port unchanged.** No environment dependency. |
| `src/host/registry.ts` | Port; replace `satisfiesCaret` with a real semver lib and `APP_VERSION` with the value from `tauri.conf.json`. |
| `src/host/bridge.ts` | Port; this is the only file that changes when sandboxing changes. |
| `src/host/data-store.ts` | Port the scoping and quota logic; back it with a real store instead of a `Map`. |
| `src/sdk-vue.ts` | Port unchanged. Already compiled against real Vue. |
| `src/host/runtime.ts` | **Adapt.** Logic is correct; provider execution must route through Rust. |
| `src/host/http.ts` | **Rewrite in Rust.** The TypeScript version exists only so the suite can run. |
| `src/host/credentials.ts` | **Rewrite in Rust** against the OS keychain. |
| `src/extensions/*` | Reference only. Rewrite as real Vue SFCs, keep the manifests. |
| `src/test/scenarios.ts` | **Port and keep green.** This is the regression suite. |

---

## Phases

Do these in order. Each phase has an acceptance criterion. Do not start the
next phase until the current one passes.

### Phase 1 — Contract in the repo

Copy `sdk.ts`, `query-cache.ts`, `registry.ts`, `bridge.ts`, `data-store.ts`,
`sdk-vue.ts` and the test suite into the repo. Swap the `Map`-backed data store
for real persistence. Replace the caret check with semver.

*Accept when:* the ported suite passes inside the repo's own toolchain, with
the same 37 assertions.

### Phase 2 — Rust host

Move two things into Rust and expose them as commands:

- **HTTP broker.** Takes an extension id, url, method, body. Loads the
  declared allowlist from the registry and rejects anything outside it, plus
  anything non-https. Enforcement in TypeScript is bypassable in one line by
  in-process widget code, so this check must not live in JS.
- **Credential vault.** OS keychain (the `keyring` crate is the usual choice;
  verify current Tauri v2 guidance). Exposes only "does a credential exist",
  "store", "clear". **It must be impossible to read a token value back into
  JS.** Provider fetches that need a token are executed host-side.

Wire Tauri v2's own capability/ACL config so the webview cannot call these
commands directly, only through the host layer.

*Accept when:* a widget calling a non-allowlisted host fails, and grepping the
JS bundle for a token value finds nothing.

### Phase 3 — Widget runtime in Vue

Mount widgets through `buildWidgetContext`. Implement the four gate states from
`Host.widgetGate` as runtime-owned UI:

- `missing-definition` — broken widget placeholder
- `provider` — connect prompt, using `ProviderStatus`
- `unconfigured` — generated settings form from the `configuration` schema
- `ready` — mount the component

Skeleton and error rendering belong to the runtime, driven by `QueryState`.
A widget renders only for `status: "success"`. No widget builds its own connect
screen, loading spinner or error state. In a visual overlay, inconsistent error
UI is immediately visible and reads as broken.

*Accept when:* Todo and Clock render with no provider, and the Tado widget
shows a connect prompt before it shows data, without either widget containing
lifecycle code.

### Phase 4 — Tado end to end

OAuth PKCE with a loopback redirect, no client secret in the repo. Verify the
current Tado auth flow against their docs first — it changed, and the
`ProviderConnectionSpec` in the reference may not match what they require now.

*Accept when:* two Tado widgets on the same room produce one API call, and
pressing + on the control widget refreshes both without polling.

### Phase 5 — Command palette

Register commands from the registry. Implement `HostUi` (`prompt`, `confirm`,
`notify`). Prompt options come from the runtime resolving `ArgSpec.source` at
invocation, not at load. Force confirm for `destructive` and `sensitive`.

*Accept when:* "Living room to 21 degrees" runs from the palette, and the
palette hides Tado commands while Tado is disconnected.

### Phase 6 — AI builder integration

Feed the model the provider schema (query names, action names, `ArgSpec`) as
tools. It generates widget components and `ActionCommand` bindings only.

**It must not generate:** provider code, auth code, `CodeCommand` logic, or
manifest fields that affect trust or permissions. Generated widgets load with
`source.kind === "generated"` and get trust `generated`. Permissions for a
generated widget are set by the runtime from what the user approved, never
copied from model output.

*Accept when:* a generated widget compiles against `WidgetDefinition` and is
refused if it declares a permission the user did not approve.

---

## Traps

- **Do not make `permissions` optional again.** It is tempting because most
  widgets need few of them. See finding 5.
- **Do not let provider authors write the full query key.** See finding 4.
  If invalidation "mysteriously doesn't fire", this is why.
- **Do not use `when.providerConnected` as a capability grant.** It is
  visibility only. Code commands declare `requires` and `permissions`
  separately. See finding 6.
- **Do not add capabilities speculatively.** v1 ships `http` and nothing else.
  Secure storage is provider-internal and never widget-facing; widget
  persistence is `ctx.data`.
- **Do not treat the http allowlist as a security boundary.** A widget allowed
  to reach `api.open-meteo.com` can encode anything it read into query
  parameters. PR review is the control for third-party code. State this in the
  contributor docs rather than implying protection that does not exist.
- **Google Calendar is post-launch.** Calendar scopes are sensitive; until
  Google verification passes, the project is capped at 100 users for its
  lifetime and the cap cannot be reset by a new client id. Either start
  verification early or let users supply their own client id.

---

## Out of scope

Do not build these now, regardless of how naturally they follow:

- A store UI, a remote catalog, or any install mechanism. Everything is
  bundled; the gate the user experiences is **connect**, not install.
- iframe or worker isolation. The contract is already shaped for it; building
  it now costs weeks and buys nothing while all code arrives via reviewed PR.
- Additional capabilities, additional contribution types, a plugin dev CLI,
  or a public SDK package.

The launch needs the overlay, the builtins, Tado, and the AI builder. This
extension system exists to keep those four from painting the project into a
corner, not to be a product of its own.
