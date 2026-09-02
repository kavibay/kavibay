# Extension Roots and the Custom Package Workspace

Date: 2026-08-01
Status: **W0, W1 and W2 done.** What is still out of scope is in section 5.

**Goal:** separate where a package came from, so the boundary a future
Widget-Wizard needs is structural rather than a rule someone has to remember.

**Why now:** the wizard writes package files. "Check whether this id is already
installed" is a rule that can be forgotten or raced. A separate root that
`safe_join` cannot escape is a boundary that holds by construction — the same
reasoning that put credential resolution behind one function.

## 1. Shape

```
{appData}/extensions/                 ← installed: store + manual drop-in
{appData}/extensions-custom/          ← custom: the wizard's, never touched by updates
{appData}/extensions-custom/.drafts/  ← work in progress, invisible to the scan
```

First-party extensions are **not** a directory: they are compiled into the
binary (`import.meta.glob` for the Vue side, `include_str!` for declarations).
Nothing can write to them at runtime, which is why they need no separation.

Drafts need no fourth root. The scanner already skips dot-directories
(`mod.rs`), so `.drafts/<id>/` is invisible by construction and "keep this" is a
move one level up rather than a state field to keep in sync.

## 2. Decisions

| Decision | Why |
|---|---|
| **Flat id namespace across roots**, duplicates rejected at scan | Keying by `(root, id)` would ripple into storage keys (`kavibay:runtime:<extId>:<instanceId>`), grant records, the bridge, rate limits, the cache and the `kavibay-ext://<extId>/` URL. A duplicate check is one rule against a dozen touched call sites. |
| **`installs.json` stays one file** at the installed root | Grants belong to an id, not to a location. Splitting it would make "which grants apply" depend on where a folder happens to sit. |
| **One resolver**, `package_root_for(app, ext_id)` | Seven call sites derive a path from the root today. If they diverge, the protocol serves from the wrong place and the symptom is "widget does not load". One function is the only way this stays honest. |
| **No migration** | `extensions/` keeps its meaning and its contents; `extensions-custom/` is new and starts empty. |

## 3. Call sites to convert

| File | Today |
|---|---|
| `runtime_extensions/protocol.rs:73` | `app_data.join("extensions").join(ext_id)` — serves package UI |
| `runtime_extensions/http.rs:121` | `load_endpoint` reads `api.json` |
| `runtime_extensions/mod.rs` | `declared_credential_types`, `current_api_hash`, `runtime_extensions_root`, `runtime_extensions_scan` |
| `runtime_extensions/installs.rs:89` | `installs.json` — **stays on the installed root**, not converted |

## 4. Steps

- [x] **W0.1** `PackageOrigin` (`Installed` / `Custom`), `root_path`, and
      `package_root_for` — the single resolver, built on a pure `resolve_in_roots`
      so its id rules are testable without a Tauri app
- [x] **W0.2** Scan enumerates both roots and tags each row; `mark_duplicate_ids`
      fails **both** copies of a clashing id, because which one wins would
      otherwise depend on scan order
- [x] **W0.3** All path-deriving call sites converted (`protocol.rs`, `http.rs`,
      `declared_credential_types`, `current_api_hash`); `installs.json` stayed on
      the installed root by design
- [x] **W0.4** `origin` on the scan row and a badge in Settings
- [x] **W1.1** `runtime_extensions_draft_write` — every path through `safe_join`
      under the drafts directory, whole-set replace, bounded to 32 files /
      512 KiB each / 2 MiB total
- [x] **W1.2** `runtime_extensions_draft_validate` + `_list` — runs the *same*
      chain the package list runs, so a draft cannot pass here and fail after
      promotion
- [x] **W1.3** `_promote` / `_discard` — promotion refuses a draft that does not
      scan cleanly and refuses an id that exists in any root
- [x] **W1.4** Tests on both sides
- [x] **W2.1** `Injection::Header` plus `anthropicApiKey` / `openaiApiKey`
      credential types — Anthropic authenticates with `x-api-key`, and sending it
      a bearer token authenticates as nobody
- [x] **W2.2** `wizard::prompt` — the system prompt embeds
      `docs/runtime-packages.md` with `include_str!` rather than restating the
      format, so the two cannot drift
- [x] **W2.3** `wizard_complete` / `wizard_models` — one non-streaming turn per
      provider; the caller may not send a `system` role
- [x] **W2.4** `kavibay-ext://__draft__<id>/` preview route — collision-proof
      because a package id must start with an alphanumeric
- [x] **W2.5** The `widget-wizard` first-party widget: chat, model picker, live
      preview, keep/discard
- [x] **W2.6** Keep enables the widget directly. Developer Extensions now gates
      the *installed* root only — it exists to stop folder drop-ins loading, and
      a package built in the app is not one. A widget that wants network access
      or a credential is kept but **not** enabled: "the person asked for this
      widget" is not the same as "the person saw what it may reach".
- [x] **W2.7** Open one of your own widgets and change it:
      `runtime_extensions_read_package` (custom root only — the wizard may read
      exactly what it may write), current files rendered into the first turn in
      the same fenced format the model replies in, and `_promote` replacing a
      custom package while still refusing an installed one. The replace rule is
      a pure `replaceable` function because it is the one place in this path
      that deletes something the user did not just generate.
- [x] **W2.8** Runtime packages reach the command palette at all. They were
      never in its catalog, so "enabled" and "usable" were two different things.
      Visibility is now one `runtimeExtVisible` rule asked by the scan, the
      resolver and the palette — it used to be spelled out in three places,
      which is exactly how a widget ended up enabled and invisible.
- [x] **W2.9** The conversation survives Ctrl+Space. Widgets are unmounted when
      Kavibay hides, so the wizard's state moved out of the component into a
      per-instance store, persisted and capped.
- [x] **W3** Three columns: conversations, chat, preview. Conversations are
      **backend-stored**, one file per conversation under `{appData}/wizard/` —
      an edit turn carries the widget's whole file set, so `localStorage` would
      hit its quota and fail silently. The preview mounts the real `WidgetCard`
      (props and emits only, no host injection), so the draft is shown in the
      chrome it will actually wear: title, menu, drag and resize, bounded by the
      panel instead of floating over the screen.

### What the boundary actually is

`is_valid_package_id` refuses a leading dot, and `resolve_in_roots` refuses one
too. That pair is what keeps `.drafts` unreachable: a caller cannot name it, and
a lookup cannot land in it. The draft workspace is not hidden by a flag that
someone can forget to check — it is hidden because the scanner skips dot
directories and nothing else can address them.

### Why generation and writing are separate modules

`wizard` turns a conversation into text. It has no path to the disk at all.
`runtime_extensions::drafts` writes files and cannot leave the custom root. The
split is why "the model decided to overwrite an installed widget" is not a
failure mode that needs guarding against — the code that talks to the model
cannot address a file, and the code that addresses files never sees the model.

## 5. Out of scope

**Streaming.** Each provider has its own SSE dialect, and the wizard's unit of
work is a whole package, not a token. Two hand-rolled event parsers cost more
than a spinner does.

**Version history** for generated files: a draft is replaced wholesale on every
turn, so there is no undo beyond re-asking. Worth adding once people actually
iterate on long-lived widgets.

**Cloudflare Workers AI as a wizard model.** It is configured in this app
already, which is why it looked like the cheapest third option — but its models
do not reliably emit a correct multi-file package, and a provider choice that
usually fails is worse than one that is absent.
