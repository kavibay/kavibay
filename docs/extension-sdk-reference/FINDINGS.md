# Falsification results

Seven contract errors, found by compiling and running rather than by reading.
All seven are in the type contract, not in the implementation.

## 1. A QueryKey cannot be refetched

Going from `["tado","roomState","living-room"]` back to `(queryName, args)`
requires parsing an author-defined key shape. The cache must retain the
resolved fetcher. `key(args)` is for identity and invalidation only.

## 2. Loading must be two-phase

A command binding to a provider in another extension cannot be validated
until every extension is registered, and a dependency cannot be resolved
against something not yet present. `load()` registers, `link()` validates and
unloads what fails. A single-pass load cannot work.

## 3. Provider-sourced literals: shape at load, existence at invocation

The first rule (forbid a literal for a provider-sourced arg) would have
rejected `"Living room to 21 degrees"` — the exact command the AI builder
exists to generate. Load time can only check shape. Existence is checked at
invocation against a live query, failing with `not-found` if the room is gone.

## 4. Two parties were building one query key

Authors wrote `["tado","roomState",roomId]`; the host re-namespaced by
slicing off the first element. The composed key and the invalidation prefix
silently could not match, so **invalidation never fired and no widget ever
refreshed after an action** — while dedupe still passed, because both paths
were wrong identically. Fix: `key()` returns the discriminating part only
(`[a.roomId]`); the host prefixes provider and query name. `invalidates`
returns `{ query, key? }`, never a raw key.

This is the one that would have shipped. It is invisible in review and
invisible in any test that does not assert on a refresh after a write.

## 5. Optional permissions fail open

`permissions?: { queries?: string[]; actions?: string[] }` with
`if (allowed && !allowed.includes(name))` meant that a widget declaring only
queries could call **every action on its provider**. The Tado temperature
widget could set temperatures. Missing must mean deny. The field is required
whenever `requires.provider` is set, and the compiler now catches every
widget that was silently over-permissioned.

## 6. Code commands had no permission declaration

Once permissions fail closed, a `CodeCommand` could either touch nothing or
had to be unrestricted. `when` is visibility, not capability. Code commands
need their own `requires`, `permissions` and `capabilities`, exactly like
widgets. Action commands do not: the host resolves and executes those, and
the user invoked them explicitly.

## 7. The wire carried a value the host can derive

`{ type: "provider.query", provider: ProviderId, ... }` let the widget name
its own provider, reducing `requires` to a suggestion — any widget could
address any connected provider. Provider requests now carry no provider id;
the host resolves it from the caller's registered instance. General rule:
**the wire never carries a value the host can derive from caller identity.**

---

# What the suite verifies

37 assertions, `npx tsx core/app/extension-host/scenarios.assert.ts`.

- **Registry** — namespace derived from source, not manifest; a sideloaded copy
  of the Tado extension becomes `dev.tado`/untrusted and cannot claim
  `kavibay`; engine range mismatch refuses the load; cross-extension provider
  use without a declared dependency is refused at link time.
- **Todo (falsification 1)** — no provider, no capability, no configuration.
  Gate ready immediately, `ctx.provider` and `ctx.http` absent, two instances of
  one definition hold independent data, quota enforced.
- **Tado (control)** — two widgets on one key produce one fetch; an action
  invalidates and pushes a refresh to subscribers; a widget without action
  permission is denied; no fetch for a room nobody subscribed to; disconnect
  evicts the cache and reads fail closed.
- **HTTP capability** — allowlisted host succeeds, non-allowlisted refused.
- **Calendar (falsification 2)** — commands hidden while disconnected; a
  prompt-bound arg gets its options resolved from the live provider at
  invocation; a write action does not force confirm; a code command with no
  widget runs; the gate reports `unconfigured` before render.
- **Policy** — `confirm: false` on a destructive action is refused at link
  time; a provider-sourced literal passes when the value exists and fails with
  `not-found` when it does not.
- **Wire boundary** — the Tado control widget runs **unchanged** over a
  transport where every payload is `JSON.stringify`'d and parsed. Invalidation
  events reach the sandbox, errors survive serialization as typed
  `ProviderError`, and a provider-less widget cannot reach any provider.

That last group is the load-bearing one. It is the evidence that moving to an
iframe or worker is a change to `core/app/extension-host/bridge.ts` and
nothing else.

---

# Still open

- **Config chicken-and-egg is handled but not solved well.** `widgetGate`
  returns `provider` before `unconfigured`, so the order is forced, but the
  connect and configure UI is the runtime's problem and does not exist yet.
- **Two subscribers, different staleTime** — first one wins. Fine for now,
  wrong eventually.
- **Provider-level rate limiting** is declared in the architecture and
  implemented nowhere. Google will make this real.
- **Allowlist is enforced in TypeScript here.** In the app it must be Rust.
  In-process JS bypasses a JS-side check in one line.
- **Exfiltration is not addressed and cannot be by an allowlist.** A widget
  permitted to reach `api.open-meteo.com` can encode anything it read into
  query parameters. PR review is the control. Write that down; do not let the
  allowlist be mistaken for a security boundary.
- **Google Calendar is capped at 100 users** for the lifetime of the project
  until verification passes, and the cap cannot be reset. Not a code problem.

## 8. `ProviderHostContext` leaked tokens into the webview

Found after Phase 1, while planning the Rust host.

Invariant 3 says "secrets never cross the wire". The contract satisfied that
for widgets and broke it for the app: `ProviderHostContext.credentials`
exposed `getAccessToken()` and `getApiKey()`, and provider code is TypeScript.
In the shipped app that puts the Tado token in the webview. The invariant
protected widgets from tokens, not the application.

Fix, in the contract rather than the implementation. `getAccessToken` and
`getApiKey` are removed. The Rust HTTP broker attaches the auth header itself
when the target is one of the provider's declared hosts. Providers stay in
TypeScript and keep describing semantics; they never see a token value.
`credentials` retains only `isConnected(): Promise<boolean>`, for providers
that need to branch before issuing a request.

Consequence: a provider can only authenticate against hosts it declared, which
makes `ProviderDefinition.hosts` load-bearing rather than advisory.

## 9. `http.ts` swallowed the non-https rejection

The protocol check sat inside the `try` block that catches URL parse failures,
so its message was discarded and rethrown as "unparseable url". No assertion
could tell the two apart because both paths say "denied". Found during the
Phase 1 port. Fixed there.

The lesson generalises: the suite asserts on behaviour, so two wrong paths that
produce the same visible outcome stay invisible. Where a refusal has several
distinct causes, assert on the cause.

## 10. Phase 2 was already built, for the other extension tier

Found on starting Phase 2, by reading `src-tauri/` before writing any of it.

The handoff describes building an HTTP broker and a credential vault. Both
exist. `runtime_extensions/http.rs` brokers declared endpoints for runtime
packages: caller identity bound host-side rather than taken from the payload,
DNS resolution with address classification and connection pinning, rate limits,
budget, response cache — and the credential attached last, so a declared header
cannot shadow it. `credentials/` holds the type registry, the encrypted store,
OAuth auth-code and device-code flows, and a `ResolvedCredential` that is
deliberately not `Serialize`.

So Phase 2 was not "build a broker and a vault". It was "give the extension
host a door into the ones that exist". `extension_providers` is that door and
is about 150 lines, most of it a table.

Two instructions in the handoff are wrong **for this repo** as a result:

- **"OS keychain, the `keyring` crate."** That would be a second credential
  system beside `credentials/`, which AGENTS.md invariant 5 forbids outright.
  The existing store already satisfies the requirement the phase actually
  states — a token cannot be read back into JS — because the type that holds
  it cannot be serialised across the boundary.
- **"Wire Tauri's capability/ACL so the webview cannot call these commands
  directly."** There is nothing to wire it against. The main webview runs
  first-party code exclusively (AGENTS.md invariant 7) and already holds
  `launch_path`, clipboard and virtual-key commands. An ACL that fences off two
  new commands from a window that can already do all of that is decoration.
  It becomes real with iframe or worker isolation, which is explicitly out of
  scope.

The general lesson is about the handoff, not the code: a phase written against
a reference implementation describes the work that reference needed. Read the
target repo first, or you will faithfully rebuild something it already has —
and end up maintaining two.

## 11. The allowlist and the credential boundary are not the same check

Consequence of finding 8, and the reason `extension_providers` moves only one
of the two HTTP paths into Rust.

`ctx.http` on a **provider** decides where this app attaches a credential. That
must be host-side, and now is: the provider id goes over the wire, the host
resolves both the allowlist and the token from it, and TypeScript no longer
checks the host at all — deliberately, because a check on this side would only
hide whether the real one works.

`ctx.http` on a **widget capability** (Weather reaching open-meteo) carries no
credential. Moving that allowlist into Rust buys nothing today: the widget runs
in the privileged webview, so anything it is stopped from doing through the
broker it can do with `fetch` or `invoke` directly. The handoff's argument
("bypassable in one line by in-process widget code") is true and is exactly why
the move does not help — it is the same one line either way.

What that path *would* gain from Rust is `net_guard`: a declared public host
that resolves into the LAN or onto a metadata endpoint. That is protection
against a mistake rather than against the widget, and it is worth doing. It is
the next increment, and it is a different justification from the one the
handoff gives.

Until then: the capability allowlist stays a declaration, not a boundary. That
was already true when it lived in TypeScript. Writing it in Rust would have
changed how it looks, not what it does.

## 12. `ProviderConnectionSpec` describes an auth flow the app does not use

Found on starting Phase 4, the same way as finding 10.

The contract has a provider declare its own sign-in:
`{ kind: "oauth2-pkce", authorizeUrl, tokenUrl, clientId, scopes }`. The Tado
provider in the reference declares exactly that, and the phase says to build
"OAuth PKCE with a loopback redirect".

Both are wrong here, and the handoff half-predicted it: *"Verify the current
Tado auth flow against their docs first — it changed."* It did, and this repo
already followed. `credentials/registry.rs` has tado° as
`AuthKind::OAuth2DeviceCode` against `login.tado.com/oauth2/device_authorize`,
with a built-in client id, an identity probe that captures the home id, and
`Injection::Bearer`. The device-code UI, the token refresh and the encrypted
store all exist. Phase 4 was not "build OAuth"; it was "let the gate open the
sign-in that is already there".

So the field is not merely stale — it is a second place to state something the
app already states correctly, and the two disagree today. A widget author can
neither act on it (no widget may see a token — finding 8) nor be trusted to
define it (it decides where credentials go — finding 11). The flow, endpoints,
client id and scopes belong to the host, next to the storage and the refresh.

What the contract actually needs from a provider is one bit: *does this need a
credential*. `ProviderDefinition.hosts` plus the Rust credential type already
carry the rest. `connection` should shrink to that, and until it does it is
documentation that will keep drifting from the truth — the drift is already
here.

Related: the same pull applies to `ProviderConnectionSpec.kind: "api-key"`,
which describes a form the generic Credentials panel already generates from
`CredentialTypeDef.fields`.

## 13. A provider cannot build its own URL

Found on trying to take Phase 4 to a real account.

The Tado provider in the reference fetches `/api/v2/rooms` and
`/api/v2/rooms/{id}/state`. Neither exists. The real API is
`/api/v2/homes/{homeId}/zones` and `/homes/{homeId}/zoneStates` — as this
repo's own working client has always known.

The interesting part is not the wrong path, it is *why the right one cannot be
written*. It needs the home id, which is credential-bound: the identity probe
captures it when the account is connected, and it differs per user. Finding 8
correctly stopped provider code from reading its credential — and took this
with it. A provider can now declare a query, but not address it.

So the fixture was never a Tado client. It was a shape that a fake fetcher
answered, and every assertion about it stayed true because the fake agreed with
the fiction. The suite verifies caching, permissions and invalidation, and it
verifies them correctly; it says nothing about whether an endpoint exists. That
is worth stating plainly rather than discovering per provider.

Two ways out, and they are not equivalent:

- **Templated URLs, substituted host-side.** A provider writes
  `https://my.tado.com/api/v2/homes/{{homeId}}/zones` and the broker fills it
  in. `ResolvedCredential::render` already does exactly this for the auth
  header, and `metadata_i64("homeId")` is already there. Nothing
  credential-derived enters the webview, so finding 8 holds unchanged.
- **Expose non-secret credential metadata** through `ProviderHostContext`. A
  home id is not a secret, and this is the smaller change — but it reopens the
  question finding 8 closed, and "non-secret" is a judgement someone has to
  make correctly for every field of every future provider.

The first keeps the boundary where it is. The second moves it and asks for
vigilance instead.

## 14. Phase 6 would put generated code inside the trusted process

Found on starting Phase 6, by reading the Widget Wizard before writing to it.

The phase says generated widgets load with `source.kind === "generated"` and
get trust `generated`. In this repo that means running in the main webview,
in-process, beside first-party code — and AGENTS.md invariant 7 is explicit
that the webview holds `launch_path`, clipboard and virtual-key commands
*because* everything in it is first-party. A trust tier is a label on a load
source. It is not a boundary, and nothing in the host consults it at runtime.

The app already answered this question, and answered it better. The Widget
Wizard's prompt asks the model for a `manifest.json` and an `index.html` — a
runtime package, which loads into an iframe with `sandbox="allow-scripts"` and
reaches storage and commands only through the postMessage bridge. Generation
and writing are separated too: `wizard` produces text and has no path to disk,
`runtime_extensions::drafts` joins every path under a drafts root so a caller
**cannot address an installed package even if it tries**, on the stated grounds
that "do not overwrite installed packages" is exactly the kind of rule that
gets forgotten.

So implementing Phase 6 as written would move model-generated code from a
sandbox into the trusted process and call the result safer because it carries a
weaker label.

The contract is not the obstacle — it was shaped for this. FINDINGS calls
section [7] of the suite "the evidence that moving to an iframe or worker is a
change to bridge.ts and nothing else", and that claim is now load-bearing
rather than decorative. Two coherent routes:

- **Keep generating runtime packages.** The sandbox exists, the draft root
  exists, the wizard works. Contract widgets stay authored.
- **Do the isolation first.** Give the contract host the iframe boundary
  `bridge.ts` was designed for, then let generated widgets load into it.

What is not coherent is Phase 6 before either. The handoff put iframe isolation
out of scope on the grounds that "all code arrives via reviewed PR" — which is
true of every extension in this repo except the ones Phase 6 exists to create.

## 15. A read-only provider's widget could never update

`QueryCache` says of itself that it "pushes invalidation to every active
subscriber so no widget ever polls". The first half is built. The second was
true only for data that some action invalidates.

Nothing else re-reads. `staleTime` is consulted inside `read`, so it decides
whether an *incoming* call may be served from cache — it never causes a call.
A subscription registers a listener and performs exactly one fetch. So the
update path for a subscribed query is: someone runs an action whose
`invalidates` names it.

A read-only provider has no actions. Its widgets therefore render whatever was
true when they mounted and never move again.

This is not hypothetical. The shipping tado° tile is read-only, because the
widget it replaced was, and it froze at mount: correct temperature on open,
correct forever after. It reads as working, which is why it survived being
looked at.

The reference suite could not catch it, and neither could the phase criterion.
Phase 4 accepts when "pressing + on the control widget refreshes both without
polling" — a refresh driven by an action, on a provider that has one. The one
arrangement that fails is the one with nothing to press.

The fix is in the cache, not the contract: a subscribed entry schedules its own
refetch at `staleTime`, chained rather than intervalled, cancelled when the last
subscriber leaves or the provider is evicted. `staleTime` doubles as the
interval rather than gaining a `refreshInterval` beside it — for a watched
query, "expires after N" and "someone is watching" already say when to fetch,
and a second field could only disagree with the first.

Two things this makes visible in `src/host/query-cache.ts` as ported:

- **The timer must be unref'd.** Every assert file that subscribes would
  otherwise hang instead of exiting, and none of them unsubscribe.
- **`evictProvider` must cancel.** A timer outliving its entry goes on calling
  a provider the user just disconnected, with a credential the host still
  attaches.

Separately, the port had inherited the fixture's 30-second `staleTime` for
tado°. Against the real 100-calls-per-day ceiling that is about 2,900. The
integration this replaced paced itself to 86,400/90 seconds for exactly that
reason, and that constant had to come back with it — a fixture's numbers are
scenery, and they stop being harmless the moment something reads them.

## 16. The wire carried the caller's identity after all

Finding 7 removed the provider id from `provider.*` requests and wrote the rule
down: *the wire never carries a value the host can derive from the caller's
identity*. `WidgetRequest` in `sdk.ts` honours it — there is no instance id in
any of its ten variants.

`bridge.ts` types every request as `WidgetRequest & { instanceId?: string }` and
derives four things from that field: which provider the caller may address,
which queries and actions it may call, which data scope it reads and writes, and
which http capability it gets. The contract states the rule; the file whose job
is to enforce it puts the value back and believes it.

It is invisible while the only caller is the suite. Section [7] proves a widget
*works* over a JSON transport, and a cooperating widget always sends its own id.
Nothing there sends somebody else's.

Against the ported bridge, a Todo tile — a widget that declares no provider at
all — reads the Tado tile's room state:

```
{ type: "provider.query", name: "roomState",
  args: { roomId: "living-room" }, instanceId: "victim" }
→ { ok: true, value: { roomId: "living-room", current: 20.5, target: 21 } }
```

and writes into its data scope with the same one-word addition. Same file, one
field.

The fix is not validation, it is arity. A payload cannot be trusted to say who
is calling, so nothing asks it: `JsonBridge.connect(instanceId, emit)` resolves
the instance once, from the host's own map, and hands back a connection whose
reach is fixed at construction. Requests carry no id and none is read.

Three things fall out of connections that were bugs waiting in the shared one:

- **Subscription ids are per-connection.** They are chosen by the guest and
  guessable by construction (`${instanceId}-1`). In one shared map, a frame
  cancels another frame's subscription by naming it.
- **Events go to one frame.** A single `emit` on the bridge delivered every
  subscriber's updates to whoever was listening.
- **Closing a frame has to unsubscribe.** Since finding 15 a subscribed query
  schedules its own refresh, so a leaked subscription is not a dangling
  listener — it keeps calling the provider for a widget the user closed.

The lesson is the one finding 7 already paid for, and it did not transfer: a
rule written in the type is not enforced by the type. `WidgetRequest` was
correct the whole time, and `& { instanceId?: string }` undid it in nine
characters.

## 17. An opaque origin makes every module script a cross-origin fetch

The frame mounted, the guest document loaded, and its script never ran:

```
Access to script at '…/extension-host-sandbox/main.ts' from origin 'null'
has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header
```

`sandbox="allow-scripts"` gives the frame an opaque origin, which reports as
`null`. A `<script type="module">` is always fetched in CORS mode — unlike a
classic script, which is exempt. So the isolation that makes the sandbox worth
having is the same thing that stops it loading its own code.

The existing sandbox never hit this because runtime packages load classic
scripts. `docs/runtime-packages.md` tells the model "no inline `<script>`, put
your code in a `.js` file and load it with `<script src="app.js">`" — and gives
the CSP as the reason, which is true and incomplete. The convention also happens
to be the only form that loads at all under an opaque origin, and nothing said
so. A contract guest written as an ES module is the natural thing to write and
fails for a reason neither document mentions.

Two consequences, and they are not the same:

- **Dev.** Vite 6 answers same-origin and localhost only. `Origin: null` gets no
  header, so the guest's script is refused. `server.cors.origin` gains `"null"`
  beside the localhost default — narrow deliberately, because a permissive dev
  server lets any page you visit read your source, which is why Vite tightened
  it.
- **Shipped.** A build has to serve the guest as a classic script, the way
  packages already do, or send `Access-Control-Allow-Origin` from whatever
  serves it. `kavibay-ext` sets a CSP on package responses and no CORS header,
  which is consistent — it never needed one.

The general shape is worth keeping: this failure is invisible to every check
that does not put a document inside a frame. Types pass, asserts pass, the grep
guard passes, and the guest runs correctly when loaded on its own — which is how
it was verified, and why the verification missed it. The first thing that
touched a real embedding found it immediately.

## 18. A sandboxed form is skipped, not prevented

The Todo widget rendered correctly inside the frame, took typed input, and did
nothing at all when the button was pressed. One console line:

```
Blocked form submission to '' because the form's frame is sandboxed
and the 'allow-forms' permission is not set.
```

The view already had `@submit.prevent`, which is the thing you would reach for
and is not enough. The HTML form submission algorithm checks the sandboxed forms
flag **before** it fires the `submit` event. So inside `allow-scripts` the event
is never dispatched, the framework's handler never runs, and `preventDefault`
has nothing to prevent — the handler is not cancelled, it is skipped.

The screenshot proved it without a debugger: `submit()` clears the input as its
first act, and the input still held the typed text. Whatever ran, it was not
that.

`allow-forms` is the wrong fix. It would make the event fire, but it also makes
real submission work, and a form can POST to any url — an exfiltration path
around the http broker, granted to close a bug about a button. The right fix is
that a widget view does not use a form: the button gets `@click`, the field gets
`@keyup.enter`, and both work identically on either side of the boundary.

Worth stating as a rule rather than a fix, because it is invisible: the widget
looks right, the sandbox attribute is right, every test passes, and the failure
is one line in a frame's console that nobody has open. `extensionHostSandboxGuard`
now refuses a `<form>` in any widget view.

The general point, and it is the second time in three findings: an opaque origin
and a sandbox flag do not merely restrict what a widget may do. They change
which events exist. Finding 17 was module scripts, this is form submission, and
there will be more — anything the platform gates on the sandbox flags rather
than on permissions. A widget that has only ever run in the host document has
not been tested.

## 19. The settings form is a permission bypass, once code is generated

`ConfigField.source` lets a `select` draw its options from a provider query, and
`WidgetGate` runs that query with `allowed = null` — permissions deliberately
bypassed. The comment there is right about why:

> a runtime-initiated read: the widget never asked for it and its own
> permission list must not gate the settings form the runtime is drawing.

That reasoning holds for every widget in this repo, because every one of them
arrived through a reviewed PR. It stops holding the moment a manifest is written
by a model. A generated package declaring

```json
"configuration": {
  "room": { "type": "select", "label": "Room",
            "source": { "provider": "kavibay.google-calendar/calendar",
                        "query": "calendars" } }
}
```

makes the host call a provider the package never declared and a query nobody
approved, without a line of code. The permission list it was granted is
irrelevant, because this path does not consult it.

It is not a dramatic leak — the options are rendered into a form the user is
looking at, not handed to the widget. What it is, is arbitrary provider traffic
on a package's say-so, and the shape of the hole is the interesting part: the
bypass was correct when it was written, and became a hole because the *source of
the manifest* changed underneath it. Nothing about `WidgetGate` moved.

`widgetPackage.ts` refuses a source that does not name the package's own
declared provider and a query the user approved. Refused, not dropped: a field
that silently loses its options is a dropdown with nothing in it and no
explanation.

The general lesson for the rest of Phase 6: every place the host does something
"on the widget's behalf" needs re-reading with a generated manifest in mind.
Trust and permissions were the obvious ones and were already handled — invariant
1 derives trust from the load source, invariant 2 fails permissions closed. This
was neither, and there may be more of them.

## 20. A permission is a query name, and consent needs a sentence

`permissions` is `{ queries: string[], actions: string[] }`, which is exactly
right for the host: the bridge checks a name against a list, and nothing else
would be safer. It is useless the moment a person has to answer for it.

> May "Room summary" use **roomState**?

Nobody can decide that. They will click yes, and they will click yes the next
time too, which is the actual cost — a dialog that cannot be answered teaches
the user to dismiss dialogs, and that is worth more to an attacker than any
single grant.

`ProviderQuery` gained an optional `description`: what this query reads, in a
sentence. `zoneStates` becomes "Current temperature and humidity in every room".
Optional rather than required, and the dialog falls back to the bare name, so an
unlabelled query still works and reads badly — which is the right pressure on
whoever adds the next provider.

Two things this does not solve, worth stating so nobody assumes otherwise:

- **The description is the provider's, not the package's.** That is deliberate.
  A generated package writing its own explanation of what it wants to read is a
  generated package writing the consent dialog.
- **Query names still leak into the UI when a description is missing.** There is
  no guard forcing one, because a provider is written by a person in a reviewed
  PR and a missing description is visible in the dialog itself. If providers
  ever arrive another way, that changes.

## 21. Every layer that reads a manifest was written when there was one

Generating a contract package end to end failed four times in a row, each time
one layer further out, each time with a different message and the same cause.

| Layer | What it said | What was actually true |
|---|---|---|
| `fileSetProblem` (wizard, pre-write) | `the manifest says id "undefined"` | it has `name`; `id` is the other format's field |
| `validate_manifest_on_disk` (Rust) | `missing_id` | same field, a second time |
| `uiEntryOf` (preview) | nothing — empty preview, Save greyed out | no `ui.entry`; the document is `index.html` |
| preview frame + enable | a black frame, "could not be enabled" | it is embedded with the runtime bridge |

None of these was reachable by reading. Every one needed the chain to be run,
and each fix only revealed the next — the classic shape of a change that adds a
second case to something written for one.

Three things are worth taking from it.

**The generated package was correct the whole time.** Every failure was a host
layer, not the model. It obeyed the format, kept `actions` empty, threw instead
of drawing an error panel, and pointed its `configuration.source` at its own
provider and a query it had asked for — finding 19's rule, followed by something
told only the consequence. The prompt was the part that worked.

**A message naming the wrong thing costs more than no message.** "The manifest
says id undefined" reads as a model failure, and the natural response is to
regenerate — which produces the identical package and the identical error. Two
of these four cost a full round trip for that reason.

**Count the readers before adding a format, not after.** Anything that parses a
manifest is a place that assumed a shape. Here there were five: the prompt, the
wizard's pre-write check, the Rust validator, the preview's entry resolution,
and the install path. Four are done. Listing them first would have cost minutes.

Still one-format-shaped, and the reason the frame renders black: the wizard's
preview embeds a package with `bridgeProtocol.ts`, the runtime package channel.
A contract guest posts `ready` into it and waits for an `init` that never comes.
It needs `SandboxedWidgetFrame` with a `JsonBridge` and a grant from the
approval dialog. The install path needs the same grant, which is why the package
could be kept but not enabled.

## 22. The manifest readers were six, and the sixth refuses correct packages

Finding 21 counted five layers that parse a manifest and said listing them first
would have cost minutes. The list was still short by one, and the missing one is
not a parser at all — it is `ExtensionRegistry.link()`.

A widget that names a provider owned by another extension is refused unless its
manifest declares a dependency on that owner. Every hand-written manifest in the
repo declares one, which is why the rule has never been visible. A package
manifest is built by `widgetPackageManifest`, which declares nothing, so the
first correct, approved, loadable contract package produced:

```
local.room-summary/tile: uses kavibay.tado/tado
without declaring a dependency on kavibay.tado
```

and the widget did not load. Same shape as all four of finding 21: a rule
written when there was one format, invisible until something else arrived.

The fix is a dependency derived from **the grant**, not from the file. That
distinction is the whole reason it is safe to synthesise: the user was shown
that provider by name and said yes to it, so the declaration records a decision
they made rather than a claim the package made about itself. It grants nothing
by itself either — the permission lists are still whatever the same grant filled
them with, and a package cannot reach a provider it was not approved for. The
range is `*`, because a package cannot know which version of a provider
extension an install carries and a range invented to look specific would be a
second gate answering a question nobody asked.

Two things worth keeping from it.

**The count is of layers, not of parsers.** Four of finding 21's five read the
JSON. This one never sees it; it reads the object the JSON was turned into, and
enforces a rule about a field that object had no way to carry. Anything that
*validates a manifest's meaning* belongs on the list, not just anything that
reads its bytes.

**The first message named the wrong thing, again.** Left to the linker, a
package whose provider is simply not installed reports "missing dependency
kavibay.tado" — naming a dependency nobody wrote, because the loader is what
derives it. A reader goes looking in the manifest for a block that is not there.
So the loader asks that question itself, before loading, and says "this widget
reads from kavibay.tado/tado, which is not installed". Finding 21's second
lesson, paid for a second time inside the same chain.

## 23. The guest's fingerprint was of the checkout, not of the content

`contractGuestArtifact.assert.mjs` compares a SHA-256 in the built guest against
a hash of its two sources, so a stale artifact is detectable without running the
build. On Windows it failed on a clean tree, against sources nobody had touched:

```
sdk/contract-guest/kavibay-contract-guest.js is stale:
guest.ts or sandbox-guest.ts changed since it was built.
Run `npm run build:guest`.
```

`sourceHash()` hashed raw bytes. `.gitattributes` declares `* text=auto`, so
those files are stored LF and checked out with the platform's own endings — CRLF
here. The hash therefore fingerprints the *checkout*. An artifact built on Linux
reads as stale on Windows and the reverse, and the declared hash was exactly the
LF-normalised one, which is what identified it:

```
declared : ffa8f5c0…
raw bytes: e15e408b…
LF-only  : ffa8f5c0…
```

The advice in the message is the part that makes it expensive: rebuilding
produces the identical bundle and the identical complaint, so the natural
response confirms nothing and costs a round trip. A second CRLF bug sat behind
it — the guard split the artifact on `"\n"` and read the hash without trimming,
so the value carried a carriage return and could never match either.

Both are normalised now. The general shape is worth stating because nothing in
this repo would have caught it: a check that hashes file bytes is a check that
depends on git's checkout rules, and `text=auto` makes those platform-specific
by design. Anything comparing content across machines has to normalise first, or
it is comparing machines.

## 24. The example package was refused for documenting the rule it follows

Installing `sdk/extension/contract/example-package/` — the smallest whole
package, the one authors copy and the generator is shown — produced:

```
Counter v1.0.0    error — module_script
```

Its `index.html` loads two classic scripts and never a module. What it also does
is explain why, in a comment:

> ...which makes every `type="module"` fetch cross-origin, so a
> module script does not load here at all.

`contract_draft_error` greps the raw file for `type="module"`. The comment is a
match. The most-copied package in the repo could not be installed, and the
message named the one thing it was most careful to get right.

The reason it survived this long is the interesting part. The same rule is
checked twice: in Rust at scan time, and in
`scripts/extensionHostSandboxGuard.assert.mjs`, which asserts the example
package specifically. The guard strips comments before every check — it has
since it was written, because the *host's own* files document their rules the
same way and would otherwise trip it. So the assert was green on precisely the
package the scanner refused, and neither ever saw the other's answer.

Both now strip comments first. Stripping also makes the two positive checks
stricter, and that is the right direction: a `<div id="kavibay-widget">` that
exists only inside a comment is not a mount point, and a package whose only
`@kavibay/contract.js` is commented out loads nothing.

Two things to carry forward.

**One rule, two implementations, no shared notion of the input.** Not a
disagreement about the rule — both agree module scripts are forbidden. They
disagreed about what the file *is*: markup, or bytes. Any rule enforced on both
sides of the Rust/TS line needs its input defined once, or the two drift while
both stay green.

**A test that reads the real artifact is worth more than a test that builds a
fixture.** Every fixture in `contract_draft_tests` wrote a minimal `index.html`
with no comments in it, so none could have found this. The test that does is the
one that puts the actual example package through the actual scanner — three
lines, and it fails loudly on exactly the sentence above.

## 25. A grant with no stated subject, found by asking rather than by running

Every finding above this one came from running something. This one did not, and
the difference is worth stating before the content: it came from a question the
suite cannot ask, because the suite can only exercise contracts that exist.

The question was whether a widget could read two providers — GitHub issues on
one side, Linear on the other, with a button that turns the first into the
second. `requires` names one provider, so the answer is no, and that part is
just a missing feature. What the question exposed is in a field that ships
today:

```ts
permissions?: { queries: string[]; actions: string[] };
```

Read that with one provider and it is unambiguous. Read it with two and
`actions: ["createIssue"]` is a grant with no stated subject. There are exactly
two ways to resolve it — the action on either provider, or a guess about which
— and the first is finding 5 again, in a place finding 5 does not look.

So the field is now keyed by provider id:

```ts
permissions?: Partial<Record<ProviderId, { queries: string[]; actions: string[] }>>;
```

Three things about the change itself.

**Redundant beats ambiguous, when the redundancy is checked.** While `requires`
names one provider the key restates it, and a restatement that can drift is
worse than no key at all. `strayGrants` in `registry.ts` refuses any key that is
not the required provider, which turns the redundancy into a spelling check and
means no shipped manifest can be carrying a stray key on the day `requires`
grows a second entry.

**The shape it replaced is a structurally valid instance of the shape that
replaced it.** `ProviderId` is `string`, so `{ queries: [...], actions: [...] }`
is a perfectly good map describing two providers named "queries" and "actions".
It would compile, grant nothing, and survive review. The type forbids it by hand
(`queries?: never; actions?: never`) and the registry refuses it at load,
because a manifest arriving as JSON never met the type. A migration whose old
form is silently legal under the new form needs both.

**Cheap now, expensive later, and that is the whole argument for the timing.**
Sixteen declarations and one afternoon today; every third-party manifest and the
AI builder's approval path once either exists. The contract's rule against
speculative additions (CLAUDE.md, *Traps*) is about capabilities — things that
let code reach further. This adds no capability. It removes a reading.

What it does **not** do, so nobody reads more into it than is there: `requires`
is still singular, the wire still carries no provider id, and `widgetGate` still
returns one provider state. A widget still cannot use two providers. The rest of
that work — a wire discriminator validated against the declared set, a gate that
distinguishes a provider the widget needs from one it can do without, and an
`ArgSpec.source` that may name a provider other than its own — is written up in
`docs/extension-host.md` under *Decided, not yet built*, and is deliberately not
built until a second credential-holding provider actually exists.

## 26. An auth invariant that had never met a provider without auth

Making Open-Meteo a provider — not because it holds a secret, it holds none,
but because the Widget Wizard can only offer a person data sources that are
providers — failed one Rust test immediately:

```
kavibay.weather/weather would attach a credential to
geocoding-api.open-meteo.com, declared by kavibay.weather
```

The rule is `capability_hosts_are_not_provider_hosts`, and it is a good rule.
A capability host is not an auth boundary and a provider host is; letting one
list reach into the other would mean a host reviewed as "a widget may fetch
this" quietly becoming "a credential may go here". Both halves say so in their
own failure messages: *would attach a credential to*, and *may reach it without
one*.

Neither sentence is true of a provider with `credential_type: None`. Nothing is
attached on either path, so the two lists are describing the same, weaker thing
— a CSP and SSRF boundary — and their overlapping is not a leak. The message
even reads as the bug it is: it names a credential that does not exist.

Every provider had one when the test was written, so the condition it was
really about and the set it iterated were the same set, and nothing forced the
difference into the open. That is the shape of finding 21 again, one layer
down: **a rule stated in terms of X, enforced over a collection that happened
to be all-X.** The two stay identical until the day they do not, and the test
fails for something that is not a violation.

Narrowed to `credential_type.is_some()`, with the real rule kept under test on
synthetic values rather than deleted — a security invariant that becomes
inconvenient is exactly the one to keep, and exactly the one where "make the
test pass" and "make the rule right" have to be shown to be the same edit.

The general form, worth applying before adding the second instance of anything
rather than after: when a test iterates *everything* and asserts something that
is only about *some* of it, the filter is missing whether or not it currently
matters.

## 27. Two of the last three findings were about a field that should not exist

Findings 5, 25 and half of 26 are all about `WidgetDefinition.permissions` — a
per-provider list of the queries and actions a widget was allowed. Finding 5
made it fail closed. Finding 25 keyed it by provider so it kept a meaning when a
widget named two. Both were correct given the field. Neither asked whether the
field was.

The question that ended it was one sentence from the owner: *"widget wants to
use github, widget wants to use tado is vollkommen ausreichend."*

He is right, and the reason is not that finer is unnecessary — it is that finer
was never being decided. The dialog asked "may this widget use `zoneStates`?",
which is a question with no answer a person can reach: they do not know what
`zoneStates` returns, whether the widget breaks without it, or what a second
query would cost them. Finding 20 already recorded that queries make a bad
consent vocabulary and responded by adding a human sentence to each one. That
was treating the symptom. The disease was asking at all.

So the grant is now the provider list, and `permissions` is gone.

**What paid for it, stated plainly.** A widget granted an account may call
every query that account declares — including, if the provider has one, a
write. Google Calendar has `createEvent` today. The read-only rule for generated
widgets therefore moved out of the permission list and into `Host.action`,
which refuses **every** action when the caller's trust is `generated`.

That move is the part worth keeping. The old rule asked a manifest what it was
allowed to do; the new one asks the registry who wrote the code. Trust is
derived from the load source and cannot be declared (invariant 1), so there is
no manifest that talks its way past it — and it refuses every action rather than
every *write* action, because a provider author marking a write as a read would
otherwise be the whole bypass.

**The general shape, which is the reusable part.** A permission model is worth
having only where a person can actually make the distinction it encodes.
Anything finer than that is not protection; it is a dialog people learn to
dismiss, and the dialog that later matters gets dismissed with it. Ask what
decision the model is asking somebody to make, and if the honest answer is
"none, they will click yes", the model is too fine — however defensible each
individual check looks.

**Cost of having learned it late:** three findings, a keyed rewrite across the
contract, host, registry, package format and stored grants, and then most of it
deleted two days later. The deletion was smaller than the build. That is the
usual ratio and not a reason to have built it — the reason it went in at all is
that nobody asked what the dialog was for until somebody had to answer it.

## 28. The Rust half of three extensions was a copy of their TypeScript

"If somebody wants a widget showing GitHub issues, do they have to go into the
Rust code?" — no, and the answer took evidence rather than assertion, because
the file that made it look otherwise was `src-tauri/src/extensions/github/mod.rs`:

```rust
const PROVIDER: ProviderDef = ProviderDef {
    id: "kavibay.github/github",
    hosts: &["api.github.com"],
    credential_type: Some(credential_registry::GITHUB_PAT),
};
```

Thirty-four lines, twelve of them test, and not one data structure. Every query,
every response shape and every normalization was already TypeScript in
`extensions/github/provider.ts`, and the broker checks only host and scheme —
so a new endpoint on an allowlisted host was, and had always been, a
TypeScript-only change.

But the perception was not wrong about everything. There were **two** places a
provider was declared, and the second one existed for a good reason stated
badly: the allowlist decides where a credential goes, so it must not come from
the webview. That reason justifies *compiled in and PR-reviewed*. It does not
justify *hand-written twice* — which is what it had turned into.

`generated.rs` is now produced by `npm run build:provider-doc` from the same
definitions that already produce `provider-schema.md` and the Wizard's prompt
blocks, and `providerSchemaDoc.assert.ts` fails the build when it drifts. The
security property is unchanged: the source is reviewed, the output is committed
and compiled. What is gone is the second statement.

Three Rust modules disappeared entirely — tado°, GitHub and Google Calendar had
no Rust left once the allowlist was derived.

Two things worth carrying.

**Check what a boundary actually requires before deciding where it lives.**
"This must be compiled in" and "this must be typed out in Rust by hand" had
become the same sentence in this repo, and only one of them was true. Every
finding here about two statements of one fact (§21, §22, §26) is the same
mistake at a different layer.

**A wrong mental model of the cost is a real cost.** Nobody was blocked by those
34 lines; they were blocked by believing a new endpoint meant crossing a
language boundary. That belief shaped a proposal to delete providers entirely —
which would have taken the typed prompt, the shared call budget and the
consent vocabulary with it. The fix was one generator.

## 29. A query is mostly data, and it was all code

§28 established that adding a provider query touches no Rust. It did not make
adding one *cheap*: a query was a `fetch` function, so every endpoint on an
already-allowed host was a code contribution — authored in the repo, reviewed as
code, shipped in a build. For tado° with two queries that is nothing. For GitHub
it is the reason nobody adds the fifth one.

And it closes a door that matters more than the effort: generated code may not
contribute a provider, so the Widget Wizard can never add a query. Somebody who
wants a "review requests" widget cannot get one, however well they describe it.

Reading the four shipping providers, almost none of that code was logic. A URL,
some fixed parameters, the shape that comes back, and which fields of it matter
— data, written as a function because the contract offered nothing else. The
exception is real but rare: GitHub's runs-then-jobs pair makes two dependent
calls, and Open-Meteo geocodes before it forecasts.

So `declaredQuery` takes the data and returns an ordinary `ProviderQuery`.
tado°'s `zones` is now six lines of declaration, and GitHub's `reviewRequests`
— the query that started this — is fifteen, with no `fetch` at all.

**A builder, not a second kind of query.** The host sees exactly what it saw
before: same cache, same budget, same generated schema, same consent
vocabulary, not one line changed in `runtime.ts`. That was the whole design
constraint. A declarative form the *host* had to understand would be a second
code path through the machinery findings 4 and 7 are about, and the failure mode
would be the two paths disagreeing about a key.

**What it deliberately cannot express.** No conditionals, no chained requests,
no computed URLs, no expressions. A declaration that can express logic is a
language, and a language in JSON is one nobody reviews at a glance — they skim
it, which is the same failure as a consent dialog people click through (§27).
When a query needs logic, the function is still there, in the same map, beside
the declarations.

**`pick` is required, not optional.** Handing a widget the vendor's own JSON is
what made the tado° tile read `sensorDataPoints.insideTemperature.celsius`, and
what made a model — told the endpoint but not the shape — produce a widget that
displayed nothing. A declaration that could skip normalization would be the
convenient option and the wrong one every time.

The part worth carrying: **before making a contribution easier to review, check
whether it needed to be a contribution.** The effort was never the code; it was
that a category of change could only enter one way.

