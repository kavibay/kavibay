# Embedded authoring MCP server

Kavibay can expose its widget authoring workspace through an MCP server that
runs inside the existing `kavibay.exe` process. The server is a second client
of the Rust authoring service; it is not the Widget Wizard and it never calls a
model on its own.

The intended workflow is:

1. An MCP client reads the host-owned authoring guide.
2. The client creates or updates a complete draft file set.
3. Kavibay validates the draft and shows it in the Widget Wizard.
4. A person reviews the preview and presses **Save** in the Wizard.

MCP can author drafts. The Wizard remains the human decision point for saving,
permissions and enabling a widget.

## Check the server

Open **Settings → Integrations → MCP Server**. The server is enabled by default
when no preference has been saved. A saved disabled preference is preserved;
turn on **Enable MCP Server** if needed, then wait for **Running**.
Invalid or unreadable settings leave the server disabled.
The Widget Wizard's **Use MCP** dialog also shows the live server status and an
on/off switch. It refreshes the status while open, offers a retry after a bind
error, and uses the running server's address in the client setup commands.
Kavibay must remain running while a client connects; enabling the setting does
not start Kavibay for a client.

The listener is always local:

```text
http://127.0.0.1:43127/mcp
```

The port can be changed to any integer from `1024` through `65535`. A port
conflict is reported as an error and is never silently moved to another port.
Use **Retry on bind error** after freeing the port. Disabling the setting stops
the listener and releases the port.

The server binds only to IPv4 loopback. Requests must use the matching
`127.0.0.1:<port>` host and requests with an `Origin` header are rejected. Do
not publish this URL through a tunnel or proxy: the MVP deliberately has no
authentication and is intended for same-user local clients only.

## Configure a client

Run the command for your local client in a terminal.

Claude Code (run in the project where you want to use Kavibay):

```sh
claude mcp add --transport http kavibay http://127.0.0.1:43127/mcp
```

Codex:

```sh
codex mcp add kavibay --url http://127.0.0.1:43127/mcp
```

The Settings panel can also copy a Codex `config.toml` entry using the selected port:

```toml
[mcp_servers.kavibay]
url = "http://127.0.0.1:43127/mcp"
```

Replace `43127` if a different port is configured. In another MCP client, add a
custom **Streamable HTTP** server and use the same URL.

After connecting, initialize the server and call `tools/list`. The server name
is `kavibay-authoring`; the initialization instructions describe the complete
file-set and revision workflow in their first sentences.

## Resources and tools

The server exposes these host-owned resources:

| URI | Contents |
|---|---|
| `kavibay://authoring/runtime-package` | Runtime-package authoring guide used by the Wizard |
| `kavibay://authoring/contract-package` | Contract-package guide and provider rules used by the Wizard |
| `kavibay://authoring/provider-schema` | Read-only provider schemas |

The reviewed tool allowlist contains exactly these ten tools:

| Tool | Purpose |
|---|---|
| `get_authoring_guide` | Return the exact runtime or contract guide; optional provider ids are checked against the maintained catalog. |
| `list_widget_providers` | List the providers available to contract packages: id, display name, a one-line description and query/action names. Schemas come from `get_authoring_guide`. |
| `list_drafts` | List custom authoring drafts as `{ id, files, revision, error, lastWriter, lastClient, lastClientName, updatedAt }` summaries. |
| `read_draft` | Read the complete text file set, revision and current validation error for one draft. |
| `write_draft` | Create or replace a complete draft file set with optimistic revision checking. |
| `edit_draft` | Change or add files of an existing draft by exact text replacement, all edits or none, with a per-file revision check. |
| `validate_draft` | Run the same validator used before promotion and return its stable error code. |
| `list_custom_widgets` | List metadata for custom-root widgets only; installed packages are hidden. |
| `read_custom_widget` | Read a custom widget's text source and content revision. |
| `checkout_custom_widget` | Copy a saved custom widget into a new draft, returning only the files the caller has not seen. |

There are deliberately no model calls, conversations, endpoint calls,
credentials, grants, promote/save, enable, delete or discard tools.

## Draft writes and revisions

`write_draft` always receives the entire file set. An omitted file is removed;
MCP clients must not treat the call as a patch. Each file has a package-relative
`path` and UTF-8 `contents`:

```json
{
  "id": "water-tracker",
  "files": [
    { "path": "manifest.json", "contents": "{...}" },
    { "path": "index.html", "contents": "<!doctype html>..." }
  ]
}
```

Leave `expectedRevision` out only to create a draft that does not exist
(`null` means the same). For an update, call `read_draft` (or `list_drafts`)
first and pass its exact `revision`.
The revision is a deterministic SHA-256 content identity over normalized,
sorted paths and file contents. It is a coordination value, not a secret or an
authentication token.

### Small changes: `edit_draft`

`write_draft` takes every file, so a one-line change through it means the model
writes the whole package out again — for a widget of a few hundred lines, that
output is most of the wait. `edit_draft` takes only the change:

```json
{
  "id": "habit-tracker",
  "expectedRevision": "<revision returned by read_draft>",
  "edits": [
    { "path": "ui/index.html", "oldString": ".label.good { color: #8fd18f; }
", "newString": "" }
  ]
}
```

Each `oldString` must occur exactly once in its file, unless `replaceAll` is
set. An empty `oldString` creates a file at a path that does not exist yet,
with `newString` as its contents, so adding an `api.json` is one edit rather
than a `write_draft` of every file. Edits apply in order, all or none: one that
cannot be placed fails the call with `edit_not_found`, `edit_ambiguous`,
`edit_file_not_found`, `edit_file_exists` or `edit_empty` and the offending
`path`, and nothing is written. Removing a file is still a `write_draft`.

The revision check is per file. The host keeps a short history of each draft's
revisions with a hash per file, beside the draft and outside its revision, so
it can tell which files changed between the `expectedRevision` an edit was
written against and the draft on disk:

- A change to a file the edits touch fails the call with `draft_conflict`,
  because an `oldString` must not be applied to a file that changed under it.
- A change to any other file does not. The Wizard rewrites `manifest.json`
  whenever the person resizes the preview, and that is no reason to refuse an
  edit to `ui/app.js`.

Either way the reply carries `changedFiles`: every file that differs from
`expectedRevision`, with its current contents (`null` for a removed file). On a
conflict that is the material to redo the edits against `currentRevision`; on
success it keeps the client's copy exact, so the reply's revision never vouches
for a file the client has not seen. A revision the history no longer holds is
answered with every file. In both cases the client updates its copy instead of
calling `read_draft` again:

```json
{
  "code": "draft_conflict",
  "currentRevision": "…",
  "changedFiles": [{ "path": "manifest.json", "contents": "{…}" }]
}
```

### Who wrote it last

`lastWriter` is `"wizard"`, `"mcp"` or `null`; `lastClient` is `"codex"`,
`"claude"` or `null`; `lastClientName` is the sanitized exact
`clientInfo.name` (or `null`); and `updatedAt` is milliseconds since the epoch. The
client value comes from the MCP handshake's `clientInfo.name` and is advisory:
a client may omit or spoof its name. All three fields appear on `list_drafts`,
`read_draft` and every write reply. They are a byline, not a lock: a draft whose last writer is `wizard` and
whose `updatedAt` is a minute old is very likely open in front of a person right
now, and writing to it is a decision worth making deliberately rather than by
accident. The Wizard shows the same fields on its sidebar row. Known Codex and
Claude Code writes receive their supplied marks in the Wizard checkpoint.
Hovering the checkpoint, version or sidebar status reveals the exact
`clientInfo.name` (for example `codex-mcp-client`), including for an otherwise unknown MCP client; the visible
checkpoint label remains the generic **Updated via MCP** in that case.

### Renaming

The manifest names the package, and the folder follows it. Writing a file set
whose manifest declares a different name — `name` for a contract package, `id`
for a runtime one — moves the draft, and the reply names the folder it now lives
in:

```json
{ "id": "tadoweather", "renamedFrom": "dssd", "revision": "…", "error": null }
```

Keep writing to `id` from the reply; the old id no longer exists. A name another
draft already holds is refused with `draft_exists` and nothing is written, and a
name that is not a usable directory name is not treated as a rename — the file
is written as sent and `validate_draft` reports `invalid_package_id`.

Renaming a draft does not touch the installed widget of the old name. Only the
Wizard's Save promotes a draft, and only it knows the two are the same widget.

On a stale `write_draft` the server returns a machine-readable `draft_conflict`
error with `currentRevision`; no bytes are changed. Read the new snapshot, preserve
or deliberately replace its complete file set, and write again against that
revision. Every successful write is published as one complete staged tree, then
validated and announced to the open Wizard.

The existing package limits apply to MCP as well: at most 32 files, 512 KiB per
file and 2 MiB total, with text-only, safe package-relative paths. The outer
HTTP request body is bounded separately and requests are concurrency-limited.

### Editing a saved widget

`list_custom_widgets` and `read_custom_widget` operate on widgets that have
already been saved to the custom root and are callable from the palette. To
edit one, call `checkout_custom_widget` with the last revision you hold of it:

```json
{
  "id": "water-tracker",
  "expectedRevision": "<revision you last read or wrote>"
}
```

That revision may come from `read_custom_widget`, or be the last revision of
the widget's draft before the person saved it — Save removes the draft, and the
revision history outlives it for exactly this case. Leave `expectedRevision` out
if you have read neither.

The operation copies the complete saved source into `.drafts/<id>` and returns
the new draft's summary, including its `lastWriter`/`lastClient`/`lastClientName`
byline, plus `changedFiles`: every file that differs from `expectedRevision`,
with its contents, or every file when there is none to compare. After a Save
that only rewrote `ui.defaultSize`, that is `manifest.json` alone. The client
then knows the draft exactly and continues with `edit_draft` against the
returned `revision`. A checkout never replaces an existing draft
(`draft_exists`) — on that error, call `read_draft` and continue from the draft
that is already there rather than retrying the checkout. Then follow the normal
`edit_draft` → `validate_draft` workflow. The saved palette widget remains unchanged until a person opens the
draft in the Wizard and presses **Save**.

This is the same operation the Wizard performs when a person opens a saved
widget, which is what makes the two clients interchangeable: whichever one
starts, the other finds the work in the draft workspace rather than in a private
copy.

## Working with the Widget Wizard

An MCP-created draft appears in the Wizard's sidebar as a widget row like any
other — there is no separate group for drafts a client made, because the Wizard
edits widgets through the same checkout an MCP client uses and the storage
location is not what a person is choosing between. The row's byline says the
draft was last written by MCP and how long ago. Opening it loads the current
files and preview metadata and records an **Opened MCP draft** checkpoint.
For a widget that is already saved, the same row turns amber and keeps the
Codex, Claude Code or generic MCP mark until those pending changes are saved or
discarded. Reopening any conversation under that widget reads the current draft
rather than restoring the conversation's older file snapshot; the Wizard also
performs that reconciliation when it mounts after an event was missed.

When an open draft changes through MCP:

- a clean, idle Wizard applies the complete snapshot immediately and records an
  **Updated via MCP** checkpoint without fabricating a chat turn;
- a running generation, a pending Wizard write or an unsaved textarea edit
  shows a conflict banner instead of overwriting either side;
- **Reload their version** adopts the external snapshot;
- **Keep my version** explicitly writes the local complete file set against the
  external revision and asks again if that revision changed meanwhile.

Draft-scoped calls also publish ephemeral presence. While a tool request is
executing, the Wizard says that the named client is working on that widget.
After the request finishes, the indicator changes to "was active just now" and
expires after 60 seconds. This is intentionally not persisted: Kavibay can
observe MCP calls, but it cannot know whether a client-side model is thinking
between them. The tooltip names the last tool, such as `write_draft`.

Events for other draft ids refresh only the sidebar. The Wizard also ignores its
own already-applied revision, so a successful local write does not create an
event loop.

## Troubleshooting

**The client cannot connect.** Confirm that Kavibay is running, the setting is
enabled, the status is **Running**, and the client uses the exact URL shown in
Settings, including `/mcp`. A stopped or error state does not choose a fallback
port. If the port is occupied, select another valid port or free it and press
**Retry on bind error**.

**The server worked before a restart but not now.** The enabled setting and port
are persisted by Kavibay, but the server still only runs while Kavibay is open.
Check the status after startup; a bind error is retained so it can be retried
from Settings.

**A write returns `draft_conflict`.** Do not retry the old request. After
`edit_draft`, apply `changedFiles` to your copy and redo the edits against the
returned `currentRevision`. After `write_draft`, read the latest draft, preserve
or deliberately replace its complete file set, and pass `currentRevision` as
`expectedRevision`.

**An edit returns `draft_not_found` after the person saved.** Saving promotes
the draft and removes it. Call `checkout_custom_widget` with the last revision
you hold; the reply carries whatever the Save changed.

**A draft is missing from the Wizard.** Call `list_drafts` to confirm that it
exists under the custom authoring root. The Wizard refreshes its sidebar when
draft events arrive; reopening the Wizard also reads the list from disk.
Installed/manual packages are intentionally not listed as drafts.

**Validation fails.** Call `validate_draft`, read the returned stable error code,
then consult `get_authoring_guide` for the exact format rules. MCP cannot save an
invalid draft or bypass the Wizard's preview and consent checks.

**The client stops working after Kavibay exits.** This is expected. There is no
sidecar process or background service; start Kavibay before connecting again.

## Security boundary

The first-party TypeScript MCP adapters and presentation helpers, including
their assertions, live in `sdk/extension/mcp/` so Settings and the Widget Wizard
share one implementation. Moved from `core/app/settings/` in September 2026,
these files use the SDK's MIT license. This does not expose server controls
through the sandboxed runtime bridge.

The server reads and writes only the custom authoring root. It accepts package
ids and package-relative files, never absolute paths or a selectable root. It
does not expose secrets, resolved credentials, installed package paths,
arbitrary Tauri commands or the runtime HTTP capability. Authentication and any
non-loopback transport require a separate threat review and plan.
