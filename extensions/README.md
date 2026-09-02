# Extensions

Every widget on the Kavibay desk is an extension. One folder per widget, no
registry file — the host scans `extensions/*/manifest.json` at build time. A
Contract extension's folder name **must** equal `manifest.name`; legacy
extensions use `manifest.id` until they are ported.


- **How to write one:** [../docs/widget-tutorial.md](../docs/widget-tutorial.md)
  (hello world in three tiers)
- **Reference:** [../docs/extensions.md](../docs/extensions.md) — manifest,
  persistence, palette actions, credentials
- **How it should look:** [../docs/DESIGN.md](../docs/DESIGN.md)
Standalone Contract actions omit a widget contribution and expose
`needsInstance: false` palette actions. They appear as direct commands, not in
the widget catalog — `confetti` and `kill-port` are the current pair. Their
metadata lives in `manifest.json` and their handlers in `extension.ts`.

- **Untrusted drop-ins:** [../docs/runtime-packages.md](../docs/runtime-packages.md)
- **Design contract:** [../docs/superpowers/specs/2026-07-18-extension-system-design.md](../docs/superpowers/specs/2026-07-18-extension-system-design.md)

Add a widget from the command palette (`Ctrl+Space`) or from the **Widget
Gallery** widget.

## Tiers

The tier is not metadata — nothing reads it. It is shorthand for how much
machinery a widget needed, and it is the first thing to know when you copy one
as a starting point.

| Tier | Means | Backend |
|------|-------|---------|
| **S** | Client-only, or one declared API call | none, or `api.json` + `extension_http_call` |
| **M** | Per-instance settings or a context menu | same as S |
| **L** | Streaming, chained calls, OS access, credentials | its own Rust module under `src-tauri/src/` |

## Catalog

### Productivity

| Widget | `id` | What it does | Tier | Notes |
|--------|------|--------------|:----:|-------|
| Alarm | `alarm` | Alarms that ring at a chosen time. | S | Per-instance alarm list |
| Clipboard | `clipboard` | Recent clipboard history. | L | Contract `ctx.clipboard` capability; backend-owned history |
| Clock | `clock` | Local time, optional seconds and timezone. | M | Settings |
| Focus Tracker | `focus-tracker` | Day/week/month focus time per app or window title, with habit limits. | L | Tracks the foreground window; habit rules live in settings |
| Moodist | `moodist` | Mix looping ambient sounds for focused work. | S | Vendored sounds — see [`moodist/LICENSES.md`](moodist/LICENSES.md) |
| Notes | `notes` | Sticky notes with rich text. | M | tiptap editor, context menu |
| Single Purpose LLM | `one-purpose-llm` | Pick a purpose (translate, fix grammar), tweak its prompt, run it. | L | Needs an **Anthropic**, **OpenAI** or **Cloudflare Workers AI** credential; streams |
| Pomodoro | `pomodoro` | Focus timer with work and break sessions. | M | Keeps ticking while the desk is hidden (no `onSuspend`) |
| Snippets | `snippets` | Fill `{placeholder}` templates and copy the result. | S | Palette action; widget edits the shared library |
| Stopwatch | `stopwatch` | Count-up stopwatch. | S | |
| Time Tracker | `time-tracker` | Time on projects and tasks with day/week/month totals. | M | Settings |
| Timer | `timer` | Countdown timer with presets. | S | |
| Todo | `todo` | Nestable checklist with drag reorder and inline editing. | M | Context menu |

### Information

| Widget | `id` | What it does | Tier | Notes |
|--------|------|--------------|:----:|-------|
| Calendar | `calendar` | Google Calendar month view with day list and quick add. | L | Needs a **Google Calendar OAuth2** credential; polls per instance, pauses on suspend |
| GitHub Actions | `github-actions` | Spotlight workflow run with job and step progress for one repo. | L | First widget in the Contract extension **GitHub**; needs a **GitHub PAT** |
| Stocks | `stocks` | Watchlist with Yahoo quotes and expandable detail. | S | Declared endpoint — [`stocks/api.json`](stocks/api.json) |
| Tado | `tado` | Read-only thermostat tiles for Tado heating zones. | L | Needs a **Tado OAuth2** credential; one zone per instance |
| Weather | `weather` | Current weather for a chosen location. | S | Declared endpoints — [`weather/api.json`](weather/api.json), Open-Meteo |

### Tools

| Widget | `id` | What it does | Tier | Notes |
|--------|------|--------------|:----:|-------|
| Calculator | `calculator` | Quick arithmetic with history. | S | Smallest complete example |
| Color Picker | `color-picker` | Pick and copy screen colours. | L | Contract `ctx.colorPicker` screen eyedropper capability |
| Emoji Picker | `emoji-picker` | Browse, search and copy emoji. | S | Bundled emoji dataset |
| Widget Gallery | `gallery` | Browse widgets with video previews and add them to the desk. | S | Onboarding surface; single instance |
| Redacted | `redacted` | Opaque cover for sensitive areas while screensharing. | M | Full-surface drag, no title bar |
| Snake | `snake` | Nokia-style Snake on a small grid. | S | Marked `playground`, so keys go to the widget |
| Widget Wizard | `widget-wizard` | Describe a widget in plain language and watch it get built. | L | Contract `ctx.wizard`; host-owned model, draft/package, conversation, and preview surfaces — [guide](../docs/widget-wizard.md) |

### Palette actions (no widget)

| Extension | `id` | What it does | Tier | Notes |
|-----------|------|--------------|:----:|-------|
| Confetti | `confetti` | Fullscreen confetti burst from the command palette. | S | Optional intensity 1–5 |
| Kill Port | `kill-port` | Stop the process listening on a TCP port. | L | Tab (or Enter), then the port; Windows and Linux |

### System

| Widget | `id` | What it does | Tier | Notes |
|--------|------|--------------|:----:|-------|
| AI Usage | `ai-usage` | Codex and Claude Code subscription usage. | L | Local Codex data; opt-in Claude live usage with local status-line fallback |
| Launcher Buttons | `launcher-buttons` | Launch pinned apps with keyboard shortcuts. | L | Contract `ctx.launcher` capability; app list in `ctx.data` |
| System Info | `system-info` | CPU, memory and battery from the host. | L | Host polls `widget_system_info` every 5 s |

### Media

| Widget | `id` | What it does | Tier | Notes |
|--------|------|--------------|:----:|-------|
| Image | `image` | Show a local image or URL on the desktop. | L | Contract `ctx.image` capability; source in `ctx.data` |
| Now Playing | `now-playing` | Currently playing media session. | L | Host polls `widget_now_playing` every second |

## Credentials

Some widgets need an account. None of them store anything themselves: the
credential types are declared in `manifest.json`, the OAuth flows and the
encrypted store live in `src-tauri/src/credentials/`, and the widget only ever
learns *whether* it is connected.

| Credential type | Used by | Obtained via |
|-----------------|---------|--------------|
| `anthropicApi` | Single Purpose LLM, Widget Wizard | API key, entered in settings |
| `openaiApi` | Single Purpose LLM, Widget Wizard | API key, entered in settings |
| `cloudflareWorkersAi` | Single Purpose LLM | Account ID + API token, entered in settings |
| `googleCalendarOAuth2` | Calendar | OAuth flow from the widget's auth panel |
| `githubPat` | GitHub Actions | Personal access token, entered in settings |
| `tadoOAuth2` | Tado | Device-code OAuth flow |

## Anatomy

The file names are a convention, not a requirement, but every widget here
follows it — which is what makes them readable side by side.

```
extensions/<id>/
  manifest.json          # identity, catalog metadata, actions, credentials
  extension.ts            # Contract assembly + framework-free handlers
  view.ts                 # Contract widget name → Vue component + icon
  index.ts                # legacy only; absent after a Contract migration
  icon.svg               # palette and gallery icon
  <Name>Widget.vue       # the widget surface
  <Name>Settings.vue     # optional — rendered in the settings popover (gear)
  <Name>Menu.vue         # optional — rendered in the context menu
  <name>Logic.ts         # pure functions: parsing, formatting, normalising
  <name>Logic.assert.ts  # colocated test, plain node:assert
  use<Name>State.ts      # instance store wiring (createInstanceStore)
  api.json               # optional — declared HTTP endpoints (Tier S with data)
```

`ui` in the manifest is where the small behaviours hide: `allowDuplicate`,
`compact`, `hugHeight`, `flush`, `grabCursor`, `defaultHideTitle`, `fullDrag`,
`playground`. Grep the manifests above for a flag to see it used in context.

Alongside those, `ui` holds the state a fresh card opens in: `defaultOffset`,
`defaultSize`, `defaultHideTitle` (no title bar) and `defaultScale` (content
zoom, `1` = unzoomed — the factor Ctrl+mousewheel writes). Each becomes a normal
per-instance value once the widget is on a desk.

## Verifying

```bash
npx vue-tsc --noEmit
```

Run the colocated tests of the widget you touched — 19 of the 30 have one:

```bash
npx tsx extensions/todo/todoLogic.assert.ts
```

Then the part no test covers: add the widget, duplicate it, change a setting,
remove it.

## Licensing

Everything in this directory is MIT — see [LICENSE](LICENSE). Vendored assets
carry their own terms; the Moodist sounds are the notable case
([`moodist/LICENSES.md`](moodist/LICENSES.md), summarised in
[../THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md)).
