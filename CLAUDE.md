# Kavibay extension system — invariants

The extension contract lives in `sdk/extension/contract/sdk.ts`, and `AGENTS.md`
is the guide to the repository as it is now. The handoff this contract was
built from — the reference implementation, its port map, the phase plan and
the scope it set for v1 — is frozen in `docs/extension-sdk-reference/`.

Read `docs/extension-sdk-reference/FINDINGS.md` before changing the contract.
It documents seven contract errors that were found by running the suite. Each
one looks like a reasonable design choice on paper. If you redesign from the
type names alone you will reintroduce at least findings 4 and 5, and neither
is visible in code review.

---

## Non-negotiable invariants

These are not preferences. Each one is enforced by the assert suite
(`core/app/extension-host/*.assert.ts`, run by `npm run test:assert`). If a
change breaks one, the change is wrong.

1. **Trust is derived from the load source, never read from a manifest.**
   An extension cannot name itself into a tier. Reserved namespaces
   (`kavibay`, `core`, `official`, `system`) are refused for anything not
   bundled. See `deriveNamespace` / `deriveTrust` in `core/app/extension-host/registry.ts`.

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
   `WidgetRequest` is a bug. Verified by section [7] of `scenarios.assert.ts`, which runs a
   real widget over a `JSON.stringify` transport.

7. **Bundled widgets use the same API as external ones.** No
   `import { store } from "../../core"` because a widget ships in the binary.
   If a bundled widget needs something the SDK cannot express, extend the SDK.

8. **Anything requiring a credential is a Provider.** Never an http capability
   call with a key in widget configuration, however trivial the provider looks.

---

## Traps

- **Do not make `permissions` optional again.** It is tempting because most
  widgets need few of them. See finding 5.
- **Do not let provider authors write the full query key.** See finding 4.
  If invalidation "mysteriously doesn't fire", this is why.
- **Do not use `when.providerConnected` as a capability grant.** It is
  visibility only. Code commands declare `requires` and `permissions`
  separately. See finding 6.
- **Do not add capabilities speculatively.** Each one is reviewed host surface,
  added when a bundled widget needs it.
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
