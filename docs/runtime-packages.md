# Writing a runtime package

A runtime package is a folder you drop into Kavibay's `extensions/` directory.
It renders in a sandboxed iframe and talks to the host through one small bridge.
You need no Rust, no build step, and no changes to Kavibay itself.

Packages are **untrusted by design**. Everything below follows from that: the
host holds the secrets, makes the network requests, and shows the user exactly
what you declared before they enable you.

> **Styling:** [DESIGN.md](DESIGN.md) has the colours, type sizes and spacing
> the existing widgets use. Worth reading before you write any CSS.

> **This file is also the Widget Wizard's system prompt.** `src-tauri/src/wizard/prompt.rs`
> embeds it verbatim with `include_str!`, so a change here changes what the
> wizard's model is told — and a second, hand-maintained copy of the format can
> never drift from this one. Write it for both readers.

## Quick start

```
my-widget/
  manifest.json
  api.json            # only if you need network data
  ui/
    index.html
    app.js
```

`manifest.json`:

```json
{
  "id": "my-widget",
  "name": "My Widget",
  "version": "1.0.0",
  "description": "What it does, in one line.",
  "ui": {
    "entry": "ui/index.html",
    "defaultOffset": { "x": 0, "y": 0 },
    "defaultSize": { "w": 260, "h": 180 },
    "defaultHideTitle": false,
    "defaultScale": 1
  },
  "commands": [],
  "permissions": ["storage.instance"]
}
```

`ui` describes the state a fresh card opens in. `defaultOffset` and
`defaultSize` are required; `defaultHideTitle` (`true` opens without the title
bar) and `defaultScale` (content zoom, `1` = unzoomed — the factor
Ctrl+mousewheel writes, clamped to `0.5`…`3`) are optional. A value the host
cannot use falls back to its own default instead of failing the package.

`defaultSize` applies to the *first* card of your package. After someone resizes
one, the host reuses that size for every later one, so treat the manifest value
as an opening guess rather than the size people will see.

The folder name **must** equal `manifest.id`. Then: enable **Settings → Behavior
→ Developer Extensions**, open **Settings → Extensions → Runtime packages**,
**Rescan**, and enable your package.

## What the sandbox forbids

Your HTML runs under `script-src 'self'`, so:

- **No inline `<script>`.** Put your code in a `.js` file next to the HTML and
  load it with `<script src="app.js"></script>`.
- **No inline event handlers** — `onclick="..."` will not fire. Use
  `addEventListener` from your script file.
- **No scripts, fonts or stylesheets from a CDN.** Everything ships in the
  package. Inline `<style>` and `<style>` blocks are allowed.
- **No `fetch` or `XMLHttpRequest`** (`connect-src 'none'`). Network data comes
  from declared endpoints via `kavibay.http`, below.

Your frame is also sandboxed with `allow-scripts` and nothing else, so:

- **No form submission.** The frame has no `allow-forms`, and a `submit` event
  **never fires** — not from a `type="submit"` button, not from
  `requestSubmit()`. A `<form>` with a submit handler is the standard way to
  write an input with a button, and here it is a dead control: the handler
  never runs, and the browser logs nothing at all. Give the button a `click`
  listener and the input a `keydown` listener for Enter. `<form>` as a *layout*
  wrapper is fine; only submitting it is not.
- **No pop-ups or navigation.** `window.open`, `target="_blank"` and setting
  `location` do nothing, so a widget cannot send someone to a web page. Do not
  render links that look clickable.

These are silent failures in a browser sense: an inline script simply never
runs, a submit handler is simply never called, and the widget renders as an
empty box or a button that does nothing. If your widget shows nothing — or
looks right but ignores a click — check this list first.

## A widget is behaviour, not a screen

Most of the work in a widget is not the markup. It is the state it keeps, the
arithmetic it does on that state, and putting it back on screen afterwards. A
package that renders a beautiful layout whose buttons do nothing is not a
half-finished widget; it is a picture of one.

So: write the state first, the render function second, the markup last.

### Storage: `kavibay.storage`, and nothing else

**`localStorage`, `sessionStorage`, cookies and IndexedDB do not work.** The
package runs in an iframe sandboxed with `allow-scripts` and nothing else, which
gives it an opaque origin — touching any of them throws a `SecurityError`. There
is no workaround and there is not meant to be one: host-mediated storage is what
keeps one widget out of another's data.

Use the host instead:

```js
await kavibay.storage.set({ goalMl: 2000, entries: [] });
const saved = await kavibay.storage.get();   // null when nothing is stored yet
```

Three rules that follow from it being asynchronous and remote:

1. **Declare `storage.instance` in `manifest.json`.** Without the permission
   every call is denied, and the symptom is a widget that forgets everything the
   moment it reloads.
2. **Render before storage answers.** Start from defaults, draw immediately,
   and re-draw when the saved data arrives. A widget that shows `Loading…` until
   the host replies looks broken on a desktop, and if the reply never comes it
   stays broken forever.
3. **Save the whole state after every change**, not a diff. `set` replaces what
   is stored, so read-modify-write on your in-memory state and write it back.

### The shape that works

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      /* ... see DESIGN.md ... */
    </style>
  </head>
  <body>
    <p class="label">Today</p>
    <p><span id="total">0</span> ml of <span id="goal">2000</span> ml</p>
    <p id="percent">0%</p>
    <button type="button" data-add="250">+250 ml</button>
    <button type="button" data-add="500">+500 ml</button>

    <script src="@kavibay/runtime.js"></script>
    <script>
      // 1. State, with defaults that make the widget usable before storage answers.
      const state = { goalMl: 2000, day: today(), totalMl: 0 };

      function today() {
        return new Date().toISOString().slice(0, 10);
      }

      // 2. Everything that turns state into pixels lives in one function, so
      //    there is exactly one place that can be out of date.
      function render() {
        const percent = Math.min(100, Math.round((state.totalMl / state.goalMl) * 100));
        document.getElementById("total").textContent = state.totalMl;
        document.getElementById("goal").textContent = state.goalMl;
        document.getElementById("percent").textContent = percent + "%";
      }

      // 3. Change state, redraw, persist — in that order, every time.
      async function addDrink(ml) {
        state.totalMl += ml;
        render();
        await save();
      }

      async function save() {
        try {
          await kavibay.storage.set(state);
        } catch {
          // Storage being unavailable must not freeze the widget.
        }
      }

      for (const button of document.querySelectorAll("[data-add]")) {
        button.addEventListener("click", () => addDrink(Number(button.dataset.add)));
      }

      // 4. Draw now, reconcile when the host replies. Never the other way round.
      render();
      (async () => {
        try {
          const saved = await kavibay.storage.get();
          if (saved && saved.day === state.day) Object.assign(state, saved);
          else if (saved) state.goalMl = saved.goalMl ?? state.goalMl;  // new day, keep settings
          render();
        } catch {
          // Keep the defaults; the widget still works, it just does not remember.
        }
      })();
    </script>
  </body>
</html>
```

Note what the last block does about a **new day**: state that resets on a
schedule has to be reset explicitly, because storage will happily hand back
yesterday's numbers. Any widget that says "today" needs this.

### Do the arithmetic in the widget

Percentages, totals, streaks, remaining time, "3 of 8 done" — compute them in
`render()` from the state you keep. Do not store a derived value; store the
inputs and derive on every draw. A stored percentage is a percentage that will
eventually disagree with the numbers next to it.

## What you get

Load the runtime SDK from the host and put your own script after it:

```html
<script src="@kavibay/runtime.js"></script>
<script src="app.js"></script>
```

**Do not copy the SDK into your package and do not write your own.** The host
serves that path itself, so every package runs the current version. A file of
your own by that name is not loaded, and a hand-written stand-in defines
nothing — `kavibay` stays undefined and every call throws a `ReferenceError` on
the first click, with a widget that renders perfectly and does nothing.

It gives you two things:

```js
// Per-instance storage (needs the storage.instance permission)
await kavibay.storage.set({ city: "Berlin" });
const saved = await kavibay.storage.get();   // null when nothing is stored

// Declared HTTP (needs the network.declared permission + api.json)
const res = await kavibay.http("forecast", { latitude: 52.52, longitude: 13.405 });
if (!res.ok) return showError(res.code);
render(res.data);
```

Storage is namespaced to your package **and** the widget instance, so two copies
of your widget keep separate settings and no other package can read them.

## Network: declare, don't fetch

Your frame's CSP is `connect-src 'none'` and that will not change. Instead you
declare endpoints and the host calls them for you.

```json
{
  "schemaVersion": 1,
  "endpoints": [
    {
      "id": "forecast",
      "description": "Reads the current temperature for a location from Open-Meteo.",
      "method": "GET",
      "url": "https://api.open-meteo.com/v1/forecast",
      "query": {
        "latitude": { "type": "number", "required": true },
        "longitude": { "type": "number", "required": true },
        "current": { "type": "const", "value": "temperature_2m" }
      },
      "cache": { "ttlSeconds": 600 },
      "rate": { "minIntervalSeconds": 60 }
    }
  ]
}
```

### Endpoint fields

| Field | Meaning |
|---|---|
| `id` | what you pass to `kavibay.http()` — a letter, then letters, digits or `_`. **No dashes**: `review_requests`, never `review-requests` |
| `description` | **shown to the user** before they enable you — write it for them, not for you |
| `method` | `GET` or `POST` |
| `url` | absolute `https://`, no query string; `{name}` may fill a path segment or sit inside one beside literal text (`/feed/@{uid}/`), one placeholder per segment, never in the host |
| `path` / `query` / `body` | named parameters, one entry per `{name}` in the url |
| `bodyType` | `json` (default) or `form`, `POST` only |
| `headers` | static values; `Accept`, `Content-Type` and `X-*` only |
| `userAgent` | fixed agent string, when a provider insists on one |
| `fallbackUrls` | alternates tried on network error or 5xx; same placeholders as `url` |
| `credential` | a credential type the **user** grants you; you never see the secret |
| `cache` | `{ "ttlSeconds": n }` — a cache hit costs neither a request nor budget |
| `rate` | `{ "minIntervalSeconds": n }` — your own floor between calls |

### Parameter types

`string` (with optional `maxLength` and `charset`), `number`, `boolean`,
`enum` (with `values`), and `const` — a fixed value the caller cannot set.

`charset` is one of `alnum`, `alnumDash`, `alnumDot`, `alnumSymbol`. There is no
regex on purpose: a pattern would need two identical implementations and brings
catastrophic backtracking into a validator that runs on untrusted input.

### What the host guarantees

You do not have to be careful about any of this — the host is:

- **Your target is fixed.** Nothing you pass can change scheme, host or port, or
  add a path segment. Literal text in the url — the `@` in `/feed/@{uid}/` —
  comes from your declaration, not from the caller. Values are checked against the declared type and charset,
  rejected on traversal (`..`, `/`, `%`), then percent-encoded. A `?` in an
  argument becomes `%3F`; it cannot start a query.
- **No redirects.** A 3xx comes back as `http_error`, so a redirect cannot reach
  a private address.
- **No private network.** Resolved addresses in loopback, private, link-local,
  CGNAT or ULA ranges are refused, and the vetted address is pinned for the
  connection.
- **Bounded.** 10 s timeout, 1 MiB response cap, four concurrent calls, plus your
  declared interval and 500 calls per day.

### Errors

`kavibay.http()` never rejects for a provider error. Check `ok` and branch on
`code`:

| Code | Meaning |
|---|---|
| `permission_denied` | you were not granted `network.declared` |
| `consent_stale` | your `api.json` changed after the user enabled you — they must review it again |
| `unknown_endpoint` | no endpoint with that id |
| `invalid_arguments` | see `detail`, e.g. `missing_argument:latitude` |
| `rate_limited` | see `retryAfterSecs` |
| `budget_exhausted` | your daily budget is used up |
| `http_error` | provider answered; see `status` |
| `network_error`, `timeout`, `too_large` | the request did not complete |
| `credential_not_granted` / `credential_not_configured` / `credential_needs_reauth` | the credential is missing, unset, or needs reconnecting |

## Using someone's credentials without holding them

Set `credential` on an endpoint to a credential type id (for example
`githubPat`). At enable time the user sees which credential you want; the host
resolves it and attaches it to **your declared request only**. You receive the
response, never the token, and the user can revoke it in Settings → Credentials
without disabling your package.

## Rules that will fail your package

Validation is fail-closed and mirrored in the frontend and the backend, so a
package either loads completely or shows an error:

- an unknown key anywhere in `manifest.json` or `api.json`
- an endpoint `id` or a `{placeholder}` name with a dash in it — kebab-case is
  the reflex here and it is the wrong one; both must match `[a-zA-Z][a-zA-Z0-9_]*`
- `manifest.id` not equal to the folder name
- a path outside your package folder (`..`, absolute paths)
- `api.json` without the `network.declared` permission, or the permission
  without an `api.json`
- an `Authorization` header (use `credential`)
- an `http://` url, an IP-literal host, or a placeholder in the host
- a `{name}` the declaration does not define, or a `path` param the url never uses

## Format versioning

`schemaVersion` is `1`. The rules that go with it:

- **Unknown keys are an error, not a warning.** A format that silently ignores
  what it does not understand cannot be shown honestly in a consent dialog.
- **Additive changes keep version 1.** New optional fields may appear; a package
  written today keeps working.
- **A breaking change bumps the version**, and the host keeps accepting the
  previous one for at least one release, with the deprecation noted here.
- **Editing your `api.json` after release requires the user to re-consent.** The
  host stores a hash of what they agreed to and refuses calls (`consent_stale`)
  until they have seen the new endpoints. Ship declaration changes in a version
  bump and say what changed.

## Checking your work

Copy `examples/http-probe/` into your extensions folder and enable it. It tries
nine ways out of its own declaration and must report **ALL BLOCKED**. If it does
not, the host is broken — file that before trusting anything else here.

`examples/ipc-probe/` does the same for IPC isolation and must report **ALL
PASS**.

## Limits worth knowing before you design

Not supported, on purpose: response transformation in the declaration, streaming
or SSE, WebSockets, pagination loops, dependent request chains, file uploads,
arbitrary headers, and starting an OAuth sign-in yourself. If your idea needs one
of those, it is a first-party integration rather than a package — open an issue
and describe the API.

Related: [extension guide](extensions.md) ·
[runtime extensions design](superpowers/specs/2026-07-22-runtime-extensions-design.md) ·
[declarative HTTP design](superpowers/specs/2026-08-01-declarative-http-api-design.md)
