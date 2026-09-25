<div align="center">

# Kavibay

**An open-source app launcher and widget workspace, always one keystroke away. Build your own widgets with AI.**

[Website](https://kavibay.com/) ·
[Docs](docs/README.md) ·
[Widgets](extensions/README.md) ·
[Build a widget](docs/widget-tutorial.md) ·
[Discussions](https://github.com/kavibay/kavibay/discussions) ·
[Contributing](CONTRIBUTING.md)

[![CI](https://github.com/kavibay/kavibay/actions/workflows/ci.yml/badge.svg)](https://github.com/kavibay/kavibay/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-GPL--3.0%20%C2%B7%20MIT-blue)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%C2%B7%20Linux-lightgrey)](#platforms)
[![Tauri](https://img.shields.io/badge/Tauri-v2-24C8DB?logo=tauri&logoColor=white)](https://tauri.app)
[![Vue](https://img.shields.io/badge/Vue-3-42B883?logo=vuedotjs&logoColor=white)](https://vuejs.org)
[![Rust](https://img.shields.io/badge/Rust-stable-000000?logo=rust&logoColor=white)](https://rustup.rs)

Tap `Ctrl` twice. A command palette opens in the middle of the screen and brings
your widgets with it. Tap twice again and everything is gone.

<img src="https://kavibay.com/videos/launcher-poster.jpg" width="80%" alt="The Kavibay command palette over a desktop wallpaper" />

</div>

---

## What is Kavibay?

Kavibay is one transparent, always-on-top window that sits between you and your
wallpaper. It holds a fuzzy command palette and a desk of widgets — a clock, the
weather, a todo list, a countdown, whatever you put there. Clicks fall through
the gaps between the cards, so it is a layer over your desktop rather than
another window to manage.

**Why use it:**

- **One key for everything** — apps, files, web searches, widgets and actions
  behind a double tap of `Ctrl`, with no window to find first.
- **Widgets that stay out of the way** — pin the ones you want, peek at the rest
  with `Ctrl+Space`, and get your screen back the moment you let go.
- **Describe a widget instead of writing it** — the Widget Wizard turns a
  sentence into a working, sandboxed widget in about a minute.
- **Credentials never reach a widget** — API keys and OAuth tokens are entered
  once, encrypted at rest, and resolved in Rust. A widget only ever learns
  *whether* it is connected.


## Quickstart

**Prerequisites**

| | |
|---|---|
| OS | Windows 11 (Windows 10 should work) — see [Platforms](#platforms) |
| Node | 20 or newer |
| Rust | Stable toolchain via [rustup](https://rustup.rs/) |
| Build tools | Visual Studio Build Tools with **Desktop development with C++** |

The Tauri CLI comes from `devDependencies` — nothing to install globally.

**1. Clone and install**

```bash
git clone https://github.com/kavibay/kavibay && cd kavibay && npm install
```

**2. Run it**

```bash
npm run tauri dev
```

The first run compiles the Rust backend and takes a few minutes. Later runs are
fast, and the Vue side hot-reloads.

**3. Open it**

Nothing appears on screen — that is correct. The window starts invisible. Tap
`Ctrl` twice, or double-click the tray icon. On the very first start it opens by
itself and asks two setup questions — start at login, and which screen to cover.
Answer them and the desk arrives with a clock and a to-do list already on it,
then a short tour teaches the double tap, the launcher and the widget desk.
It ends there and offers the six card gestures rather than insisting on them.
`Settings → Behavior → Replay tour` brings it back, and the startup switch stays
in `Settings → Behavior`.

> `npm run dev` on its own starts only Vite on <http://localhost:1420>. The UI
> renders in a browser, but every `invoke` fails — use it for pure CSS work, not
> for anything that talks to Rust.

Full setup, per platform, plus what to do when it does not start:
**[docs/getting-started.md](docs/getting-started.md)**.

## Install

**Option A — download a build.** Releases are built by
[`release.yml`](.github/workflows/release.yml) when a `v*` tag is pushed, and land
as a draft with both Windows artifacts, the Linux AppImage and `.deb`, plus
`SHA256SUMS.txt`.

Everything is **unsigned** — no free code-signing option exists that Windows
trusts — so SmartScreen warns on first run ("More info" → "Run anyway"). Check the
published SHA256 if you want to be sure of what you downloaded.

**Option B — build it yourself.**

```bash
npm run package:win              # NSIS installer  → src-tauri/target/release/bundle/nsis/
npm run package:win:standalone   # single .exe     → src-tauri/target/release/kavibay.exe
npm run package:linux            # AppImage + .deb → src-tauri/target/release/bundle/
```

## Widgets

30 widgets ship with the app, plus two palette-only actions. The full catalogue —
what each one does, its tier, and what it needs — is in
**[extensions/README.md](extensions/README.md)**.

| Category | Widgets |
|---|---|
| **Productivity** | Alarm · Clipboard · Clock · Focus Tracker · Moodist · Notes · Single Purpose AI · Pomodoro · Snippets · Stopwatch · Time Tracker · Timer · Todo |
| **Information** | Calendar · GitHub Actions · Stocks · Tado · Weather |
| **Tools** | Calculator · Color Picker · Emoji Picker · Widget Gallery · Redacted · Snake · Widget Wizard |
| **System** | AI Usage · Launcher Buttons · System Info |
| **Media** | Image · Now Playing |
| **Actions** | Confetti · Kill Port |

Some need an account — Anthropic, OpenAI, Cloudflare Workers AI, Google Calendar,
GitHub, Tado. Those are entered once in **Settings → Integrations → Credentials**.

## Build your own

Every widget is an extension, and there is no registry file to edit — the host
scans folders, and the folder name is the extension's id.

| Path | For | Start at |
|---|---|---|
| **Describe it** | Not a developer, or just faster | [Widget Wizard](docs/widget-wizard.md) |
| **Write a Vue extension** | First-party widgets, compiled into the app | [Tutorial](docs/widget-tutorial.md) · [Reference](docs/extensions.md) |
| **Drop in a package** | Sandboxed, no build step | [Runtime packages](docs/runtime-packages.md) |

Pick the smallest tier that fits — going up later is cheap:

| Tier | When | Backend |
|---|---|---|
| **S** | Client-only, or one plain API call | none, or a declared endpoint in `api.json` |
| **M** | Per-instance settings, menus, richer UI | same as S |
| **L** | Streaming, pagination, shared cache, OS APIs | its own Rust module |

### Let a model do it

**Widget Wizard** — add it from the palette and describe what you want ("a tracker
for how much water I drink today"). It generates a package, previews it in the
same sandbox every runtime package gets, and **Keep** moves it into your widgets.
It needs an Anthropic or OpenAI key and costs a few cents per widget. It can only
write into its own drafts directory — it cannot reach a widget you already
installed. → [docs/widget-wizard.md](docs/widget-wizard.md)

**MCP server** — Kavibay can expose its authoring workspace over MCP on
`127.0.0.1`, so Claude Code or any other local MCP client can write drafts
directly. Off by default; the Wizard stays the human decision point for saving
and permissions. → [docs/mcp-server.md](docs/mcp-server.md)

## Keys

| Key | Does |
|---|---|
| `Ctrl` `Ctrl` | Show / hide the cockpit (Windows only — read from a keyboard hook) |
| `Shift+Ctrl+Space` | Show / hide on the screen under the mouse — and the way in on Linux and macOS |
| `Ctrl+Space` (hold) | Peek at the widgets, no palette |
| `Ctrl+Shift+Q` | Quick actions on text selected in **any** app — translate, fix grammar, rewrite |
| `↑` `↓` `Enter` | Move through results; on a widget row, put it on the desk |
| `Ctrl+Enter` | Open a widget *inside* the palette instead of adding it to the desk |
| `Tab` | Fill in an action's arguments, or jump into the widget |
| `Ctrl+Shift+1…9` | Switch desk |
| `Ctrl+Z` / `Ctrl+Y` | Undo a hide, delete or move |
| `Escape` | Hide it |

<details>
<summary><b>Every other key</b></summary>

| Key | Does |
|---|---|
| `↓` on an empty query | Recently used commands |
| `←` on an empty query | The widgets on this desk, plus the whole catalog |
| `Ctrl+N` / `Ctrl+W` / `Ctrl+H` / `Ctrl+R` | On a palette row: new instance / close (hide) / delete |
| `Ctrl+S` / `Ctrl+W` | On the search palette itself (outside folder browsing): pin or unpin / hide |
| `Ctrl+T` | On a folder row: open it in the terminal |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Cycle focus through the open widgets and back to the palette |
| `Ctrl+Alt+S` | Jump into the palette search from any widget, selecting the old query |
| `Ctrl+W` / `Ctrl+H` / `Ctrl+R` | On the widget you are in: close/hide it (`W`/`H`) / delete it (`R`, content included) |
| `Ctrl+W` | Close the Settings dialog while it is open |
| `Ctrl+S` / `Ctrl+D` | On the widget you are in: pin or unpin / duplicate |
| `Ctrl+Shift+←↑→↓` | Nudge the focused widget by 10px |
| `Ctrl+Alt+←↑→↓` | Move the active widget or palette by one grid gap |
| `Ctrl`+mousewheel · pinch | Zoom a widget's content (`0.5`…`3`), remembered per card |
| `Ctrl`+drag | Move the whole layout instead of one widget |
| Double-click a widget title | Rename it |
| Hold the card's `×` | Short release hides; holding arms **delete** |

A few notes worth having: no OS can register a bare modifier as a hotkey, which
is why the `Ctrl` double tap is a keyboard hook and Windows-only. `Ctrl+Space`
releases the widgets again the moment you let go — click one while holding and
that one stays. `Ctrl+Enter` on a widget row opens it in the palette without
touching your layout, and the ↗ button in that header promotes it to a card and
takes the content with it. Hold `Ctrl` for 750ms in the palette or active widget
to reveal the pin/hide and desk shortcut hints. A widget you deleted comes back
from `Ctrl+Z` empty.

</details>

## Platforms

| | Status |
|---|---|
| **Windows 11 / 10** | Supported. The `Ctrl` double tap is Windows-only. |
| **Linux (X11)** | Works. |
| **Linux (Wayland)** | Runs, but **pinned widgets do not stay on top** — Wayland grants no client that right. [How to get an X11 session](docs/getting-started.md#run-on-linux) |
| **macOS** | **Untested.** The code paths exist; nothing has ever been compiled on a Mac. Packaging is not set up, and the transparent window relies on Apple private APIs, which rules out the App Store. [What to expect](docs/getting-started.md#run-on-macos) |

## Where your things live

Everything durable sits in `~/.kavibay` — the same path on every platform, and
outside the Windows roaming profile.

| What | Where |
|---|---|
| Settings, meant to be edited by hand | `~/.kavibay/settings.json` |
| Layout, desks, appearance, per-widget settings | `~/.kavibay/web-storage.json` |
| Secrets (API keys, OAuth tokens) | `~/.kavibay/credentials.db` — encrypted, never returned to the frontend |
| Runtime packages you installed | `~/.kavibay/extensions/` |
| Widget Wizard drafts and kept widgets | `~/.kavibay/extensions-custom/` |
| Regenerable caches — safe to delete | `~/.kavibay/cache/` |

**How secrets are stored.** Every field of a credential is bundled into one JSON
blob, wrapped with Windows **DPAPI** and written to `credentials.db`; a test
asserts that neither the value nor the field name survives in what lands on disk.
The blob is bound to your Windows account, so a copied file is unreadable
elsewhere. Listing a credential reports the *names* of the fields that hold a
value, never the values. A key leaves Rust only towards its provider.

Where the protection stops: DPAPI defends against someone taking the file, not
against code running as you. Non-Windows builds fail closed — nothing is stored
at all until a Keychain backend lands. Details in [SECURITY.md](SECURITY.md).

## Repo map

Folders are license boundaries — a new file adopts its directory's license.

| Path | What | License |
|---|---|---|
| `core/app/` | Vue host: palette, settings, widget host, runtime sandbox | GPL-3.0-or-later |
| `src-tauri/` | Rust backend — part of core; at the root because the Tauri CLI wants it there | GPL-3.0-or-later |
| `sdk/extension/` | Extension-facing SDK (`@sdk` alias) | MIT |
| `sdk/runtime/` | postMessage SDK for sandboxed packages | MIT |
| `extensions/` | First-party widgets, compiled into the app | MIT |
| `examples/` | Runtime package template + security probes | MIT |
| `docs/` | Guides, plus `superpowers/{specs,plans}` | CC-BY-4.0 |
| `scripts/` | Repo guards / tooling | GPL-3.0-or-later |

`sdk/` never imports from `core/` or `extensions/` — it has to stay
self-contained MIT.

## Docs

Start at **[docs/README.md](docs/README.md)** for the full index.

| Read this | For |
|---|---|
| [getting-started.md](docs/getting-started.md) | Running and building it, per platform, plus troubleshooting |
| [architecture.md](docs/architecture.md) | How the window, palette, host, sandbox and credentials fit together |
| [widget-tutorial.md](docs/widget-tutorial.md) | Write your first widget, tiers S → M → L |
| [widget-wizard.md](docs/widget-wizard.md) | Generating widgets with a model, and what the Wizard cannot do |
| [extensions.md](docs/extensions.md) | First-party extension reference |
| [runtime-packages.md](docs/runtime-packages.md) | Sandboxed packages, declared HTTP endpoints |
| [mcp-server.md](docs/mcp-server.md) | The embedded local authoring MCP server |
| [DESIGN.md](docs/DESIGN.md) | Visual rules: colour, type, spacing, dropdowns |
| [AGENTS.md](AGENTS.md) | Conventions and invariants for contributors and coding agents |

## Community

Ideas and finished widgets are welcome in
[Discussions](https://github.com/kavibay/kavibay/discussions) — you do not need an
issue first. [CONTRIBUTING.md](CONTRIBUTING.md) has the three contribution paths,
what CI checks, and what a PR needs.

Found a security issue? Please use
[private vulnerability reporting](https://github.com/kavibay/kavibay/security/advisories/new)
rather than a public issue — see [SECURITY.md](SECURITY.md).

**Recommended editor setup:** [VS Code](https://code.visualstudio.com/) or Cursor
with [Vue - Official](https://marketplace.visualstudio.com/items?itemName=Vue.volar),
[Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
and [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer).

## License

Per-directory licenses — see [LICENSE](LICENSE) for the map, and
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) for third-party material
(notably the vendored Moodist sounds).

> This is a learning-driven project: a clean, explained foundation beats feature
> count. The **widget contract** is the part that gets the attention.
