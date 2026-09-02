# Contract widget packages

A contract widget package is a widget that reads from one or more
**providers** — connected accounts like tado°, or open data sources like
Open-Meteo — and runs inside a sandboxed frame. It is the second package format,
beside [runtime-packages.md](runtime-packages.md), and you pick between them by
what the widget needs:

| Needs | Format |
|---|---|
| A connected account: tado°, a calendar, anything with a login | **this one** |
| A public URL, or nothing but its own stored state | [runtime packages](runtime-packages.md) |

The difference is not size. A provider is credentials, refresh, caching and rate
limits, all of which live in the host — a package never sees a token and never
holds one. What it gets is a typed handle to queries somebody already wrote.

> This file is also the Widget Wizard's system prompt for this format:
> `src-tauri/src/wizard/prompt.rs` embeds it verbatim with `include_str!`, the
> same arrangement `runtime-packages.md` has. Editing it changes what the model
> is told, which is the point. Write it for both readers.

## The three files

```
manifest.json     what it is, and what it wants to read
index.html        the mount point and two script tags
widget.js         setup + render
api.json          optional — HTTP endpoints, when no provider covers what you need
```

Nothing else. No build step, no bundler, no npm.

### manifest.json

```json
{
  "name": "room-summary",
  "version": "1.0.0",
  "displayName": "Room summary",
  "description": "Temperature in every room, at a glance.",
  "engines": { "kavibay": "^0.1" },
  "widget": {
    "name": "tile",
    "displayName": "Room summary",
    "defaultSize": { "w": 2, "h": 2 },
    "requires": { "providers": ["kavibay.tado/tado"] },
    "configuration": {
      "zone": {
        "type": "select", "label": "Room", "required": true,
        "source": { "provider": "kavibay.tado/tado", "query": "zones" }
      }
    }
  }
}
```

`requires.providers` is a **list**, even with one provider — there is no
singular spelling, and `requires: { "provider": … }` is refused at load rather
than ignored.

**There is no `permissions` field.** Naming an account in `requires.providers`
is the whole request: the person is shown which accounts you want and ticks the
ones they allow. You do not list queries, and you cannot be granted a subset of
an account — either you may read it or you may not.

### More than one provider

A widget may name several, and the usual reason is that one account does not
have everything the widget shows. Indoor temperature comes from tado°; the
outdoor temperature does not exist there, and Open-Meteo has it:

```json
"requires": {
  "providers": ["kavibay.tado/tado", "kavibay.weather/weather"]
}
```

In the widget, each one is its own handle:

```js
const rooms   = await ctx.providers["kavibay.tado/tado"].query("zoneStates", {});
const outside = await ctx.providers["kavibay.weather/weather"].query("current", {
  location: "Berlin",
});
```

Two rules that follow:

- **Name only providers you were given.** The section above this prompt lists
  the ones this widget may use, with their queries. Asking a provider for a
  query another one declares is refused by the host.
- **Every provider you name must connect before the widget renders.** So do not
  name one you only might use — you would be putting a connect prompt in front
  of a widget that does not need it.

`requires.providers` is a **request, not a grant**. The user is shown which
accounts you asked for and ticks the ones they allow, and the host loads the
widget with their answer and nothing else. Two consequences worth designing
around:

- **Ask for the fewest accounts that work.** Every extra one is another connect
  prompt in front of your widget, and one the person does not have makes it look
  broken. Do not name an account you only might use.
- **You may call the provider's actions.** Approving an account approves its
  queries *and* its actions. Start a Spotify playlist with
  `ctx.providers["kavibay.spotify/spotify"].action("play", { playlistId })`.
  Do not invent a second write path.

## Settings the person can change later

`configuration` is a schema, and the host builds the form from it — you never
write one. Each widget **instance** keeps its own answers, so two copies of the
same widget can watch two different cities.

```json
"configuration": {
  "token": { "type": "string", "label": "WAQI API token", "required": true },
  "city":  { "type": "string", "label": "City", "required": true, "default": "Berlin" },
  "showPm10": { "type": "boolean", "label": "Show PM10", "default": true }
}
```

Field types: `string`, `number`, `boolean`, `select`. A `select` takes either
static `options` or a provider-backed `source`.

Read them as plain values — they are already there when `setup` runs:

```js
const res = await ctx.endpoint("station_search", {
  token: ctx.config.token,
  keyword: ctx.config.city,
});
```

Three things that follow, and are the reason this is worth using:

- **`required: true` gates the widget.** Until every required field has a value,
  the host shows the generated form instead of your widget. That is how an API
  token gets asked for once, without you writing an onboarding screen.
- **The gear in the widget menu reopens the same form.** Anything declared here
  stays changeable; anything you put in `ctx.data` instead does not.
- **`ctx.config` is read once.** Changing a setting remounts the widget, so you
  never watch it for changes.

**Use `configuration` for what the person decides, `ctx.data` for what the
widget remembers.** A city, a token, a unit: configuration. A collapsed section,
a last-seen id: `ctx.data`.

A `configuration` field with a `source` must name **one of your own declared
providers**. Any query on that provider is fine. The host runs that query to fill the dropdown, so
a field pointing anywhere else is refused at load — the whole package, not the
field.

### index.html

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <style>
      html, body {
        height: 100%; margin: 0; background: transparent;
        color-scheme: var(--native-color-scheme, dark);
        font-family: var(--font-family, system-ui, sans-serif);
        color: var(--text, rgba(255, 255, 255, 0.92));
      }
      #kavibay-widget { height: 100%; }
    </style>
  </head>
  <body>
    <div id="kavibay-widget"></div>
    <script src="@kavibay/contract.js"></script>
    <script src="widget.js"></script>
  </body>
</html>
```

Copy this. Three details in it are load-bearing and none of them is visible when
you get them wrong:

- **`<div id="kavibay-widget">`** is where the runtime puts your widget. Without
  it the frame stays empty and the host reports that the package has no mount
  point.
- **`@kavibay/contract.js` is served by the host.** Do not ship a file by that
  name; you cannot, the host answers first. It defines `kavibayWidget`.
- **Both scripts are classic.** Never `type="module"`. The frame has an opaque
  origin, which makes a module script a cross-origin fetch, and it silently does
  not load — no error you will see, just a blank widget.

### widget.js

```js
kavibayWidget.define({
  async setup(ctx) {
    const zone = String(ctx.config.zone);
    const states = await ctx.providers["kavibay.tado/tado"].query("zoneStates", {});
    const mine = states.find((state) => state.id === zone);

    return {
      name: ctx.config.zone,
      temperature: mine?.temperature ?? null,
    };
  },

  render(model, root) {
    const value = document.createElement("p");
    value.textContent = model.temperature === null ? "—" : `${model.temperature.toFixed(1)}°`;
    value.style.cssText = "margin:0;font-size:28px;font-weight:600";
    root.append(value);
  },
});
```

`setup` receives the context and returns a model. `render` is called **once**,
with the element to fill; if your widget changes over time, keep a reference to
the node and update it from a handler, the way the example package does.

### `render` has no `ctx`

Its signature is `render(model, root)` and nothing else. `ctx` is a parameter of
`setup`, so reaching for it inside `render` — or inside a click handler `render`
installed — is a `ReferenceError` thrown in a handler, where nobody sees it. The
widget draws, the button does nothing, and there is no error anywhere to read.

Whatever a later interaction needs, `setup` puts in the model:

```js
kavibayWidget.define({
  async setup(ctx) {
    const spotify = ctx.providers["kavibay.spotify/spotify"];
    const cache = new Map();

    return {
      playlists: await spotify.query("playlists", {}),
      // A function, not a value: the tracks are fetched when a row is clicked.
      loadTracks: async (playlistId) => {
        if (!cache.has(playlistId)) {
          cache.set(playlistId, await spotify.query("playlistTracks", { playlistId }));
        }
        return cache.get(playlistId);
      },
    };
  },

  render(model, root) {
    // model.loadTracks works here. ctx.providers does not exist here.
  },
});
```

A function in the model is fine **here and only here**: `setup` and `render` run
in the same document, so the model is handed over as a live object rather than
serialized. The JSON rule governs the sandbox boundary — a `WidgetRequest`, an
argument to `query`, anything returned to the host — not this.

### An interaction that fetches owns its own failure

The four states below are the host's, and they cover *mounting*. A click happens
after that, and the host has no panel for it. So a handler that queries must
handle its own outcome, or a failure is a button that silently does nothing:

```js
row.addEventListener("click", () => {
  status.textContent = "Loading…";
  model
    .loadTracks(playlist.id)
    .then((tracks) => fill(tracks))
    .catch((error) => showRetry(error));
});
```

That is the one place a package writes its own loading and error text. Keep it to
a line and a retry — the host's panels still own everything up to first paint,
and a second full-size error screen inside a card reads as breakage.

## Reaching an API nobody wrote a provider for

A provider is the better shape when one exists: it brings a shared cache, a call
budget, and a result somebody already normalized. But "no provider exists" used
to mean "not possible", and for a public API that is the wrong answer — an air
quality reading, a train departure board, a currency rate.

So a contract widget may also ship an **`api.json`**, exactly as a standalone
package does, and call it through `ctx.endpoint`:

```json
{
  "schemaVersion": 1,
  "endpoints": [
    {
      "id": "air_quality",
      "description": "Reads the current air quality index for a location.",
      "method": "GET",
      "url": "https://air-quality-api.open-meteo.com/v1/air-quality",
      "query": {
        "latitude": { "type": "number", "required": true },
        "longitude": { "type": "number", "required": true },
        "current": { "type": "const", "value": "european_aqi" }
      },
      "cache": { "ttlSeconds": 900 }
    }
  ]
}
```

```js
const res = await ctx.endpoint("air_quality", { latitude: 52.52, longitude: 13.4 });
if (res.ok) render(res.data.current.european_aqi);
```

### Two calls, where the second needs the first

The ordinary REST shape — search, then fetch one result by id — is two
endpoints, and the id goes in the path:

```json
{
  "id": "station_search",
  "url": "https://api.waqi.info/v2/search/",
  "query": {
    "token": { "type": "string", "required": true },
    "keyword": { "type": "string", "required": true }
  }
},
{
  "id": "station_feed",
  "url": "https://api.waqi.info/feed/@{uid}/",
  "path": { "uid": { "type": "string", "required": true, "charset": "alnum" } },
  "query": { "token": { "type": "string", "required": true } }
}
```

```js
const found = await ctx.endpoint("station_search", { token, keyword: city });
const uid = found.data.data[0].uid;
const feed = await ctx.endpoint("station_feed", { uid: String(uid), token });
```

A `{name}` may sit **inside** a segment beside literal text, one per segment.
The `@` is yours, in the declaration; only `uid` comes from the widget, and it
is charset-checked and percent-encoded before it goes anywhere.

**A token that is a query parameter is just a parameter.** `credential` is for
credential types the host holds; an API that wants `?token=` takes a normal
`string` you pass from `ctx.config`.

Everything [runtime-packages.md](runtime-packages.md) says about declared
endpoints holds here too: the target is fixed, no redirects, no private
addresses, a 10 s timeout, a 1 MiB cap, and a daily budget. `ctx.endpoint` never
rejects for a remote failure — check `ok` and branch on `code`.

The person reviews the endpoint list before the widget is enabled, in the same
dialog that asks about accounts. Write the `description` for them.

**Use a provider when there is one.** Two widgets asking a provider for the same
thing share one call; two widgets declaring the same endpoint do not.

## What the host draws, and you must not

The host owns the whole lifecycle around your widget:

| Situation | What the user sees |
|---|---|
| A provider not connected | A connect prompt naming every one still missing |
| Required configuration missing | A settings form generated from your schema |
| Your queries still loading | A skeleton |
| `setup` threw, or a query failed | An error panel with a retry button |
| Everything succeeded | Your `render` |

So **do not write a spinner, a loading state, an error message, a retry button
or a connect screen.** Your `render` only ever runs when there is data. A widget
that draws its own is not customising anything — the overlay already has one of
each, and a second set reads as breakage.

Every row above is about reaching first paint. The one exception is a query a
*handler* runs after that — the host has already resolved by then and has no
panel left to show, so that one line of status is the widget's; see
[An interaction that fetches owns its own failure](#an-interaction-that-fetches-owns-its-own-failure).

If something is wrong, **throw**. The host turns it into the same error panel it
shows for everything else:

```js
if (!states.some((state) => state.id === zone)) {
  throw { kind: "not-found", message: `no room ${zone}` };
}
```

## Styling

The host pushes its design tokens onto your document and pushes them again when
the user changes theme. Use them, with fallbacks:

```
--text  --text-muted  --text-faint
--border  --border-strong  --fill  --fill-hover
--fg-rgb  --inset-bg  --surface-radius  --font-family
```

`rgba(var(--fg-rgb), 0.5)` is how you get a tint at any opacity. Do not hardcode
a colour — the overlay is transparent and its background is whatever is behind
it, so a fixed colour is unreadable half the time.

## Rules that bite silently

Each of these produces a widget that looks finished and does nothing, with no
error anywhere a user would look.

- **No `<form>`, ever.** Form submission is checked against the frame's sandbox
  flags *before* the submit event fires, so your handler is not prevented, it is
  never called. Use a `<button type="button">` with a click listener, and
  `keyup` on an input for Enter.
- **No `type="module"`, no `import`, no `export`.** See above.
- **No `fetch`, no `XMLHttpRequest`, no WebSocket.** The frame's CSP denies them.
  Data comes from `ctx.providers[id]`; the host does the network.
- **No `localStorage`.** An opaque origin has none. Use `ctx.data`, which the
  host scopes to this widget instance and persists.
- **No `window.parent`, no `postMessage`.** That channel is the runtime's, and
  writing to it does not give you anything the context does not already offer.

## What you may not generate

- **A provider.** That is auth, credentials and refresh. Use ones that exist —
  the providers named above this prompt, and no others. For anything they do
  not cover, declare an `api.json` endpoint instead.
- **A command** for the palette. That is code running in the host process.
- **A palette action** on the widget (`widget.actions`). That is also code the
  host runs. Provider actions are the other thing: call them with
  `ctx.providers[id].action(name, args)` — they are listed on the account above.

All three are refused by the registry rather than ignored, so a package that
declares one does not load at all.

## The context

```js
ctx.config                       // this instance's settings, read once
ctx.data.get(key)                // persisted, scoped to this instance
ctx.data.set(key, value)
ctx.data.delete(key)

ctx.providers[id].query(name, args)   // one read, cached by the host
ctx.providers[id].action(name, args)  // write through the provider
ctx.providers[id].subscribe(name, args, (state) => {})
ctx.providers[id].status()

// `id` is the full provider id, exactly as written in requires.providers.
// There is no `ctx.provider`: a widget that grows a second provider would keep
// working and start reading the wrong one.
```

`subscribe` is how a widget stays current. The host refetches on its own
schedule and pushes the result; a package never polls, and a `setInterval`
calling `query` will be refused by the rate limit rather than working.

Only `status: "success"` carries data:

```js
await ctx.providers["kavibay.tado/tado"].subscribe("zoneStates", {}, (state) => {
  if (state.status === "success") update(state.data);
});
```

Ignore `loading` and `error` — the host is already showing both, outside your
frame. Branching on them is how you end up with two spinners.

## A complete example

[`sdk/extension/contract/example-package/`](../sdk/extension/contract/example-package)
is the smallest whole package: a counter that persists through `ctx.data`, with
no provider. Read it before writing your first one.
