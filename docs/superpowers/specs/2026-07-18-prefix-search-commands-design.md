# Prefix Search Commands (Google + Windows Files) — Design

**Date:** 2026-07-18  
**Status:** Approved for implementation planning  
**Approach:** Prefix interceptor on Enter; Google via `launch_path`; files via Windows Search (`search-ms:`)

## Goal

Add **non-widget** palette actions for web and file search:

- Prefix `g` / `google` → open Google in the default browser
- Prefix `f` → open Windows Search (Explorer) with the query

No new widgets. No in-app file index.

## Requirements

### Prefix behavior

| Input | Enter does |
|-------|------------|
| `g cats` or `google cats` | Open `https://www.google.com/search?q=cats`, hide Kavibay |
| `g` / `google` alone | Open Google homepage, hide Kavibay |
| `f invoice` | Open Windows Search with query `invoice`, hide Kavibay |
| `f` alone | Open Windows Search UI (empty query), hide Kavibay |
| Anything else | Existing command matching / calculator — unchanged |

- Prefix matching is case-insensitive (`G Cats`, `Google cats` count).
- Prefix must be a whole first token followed by space, or the entire query (`g`, `google`, `f`).
- On a matched prefix, Enter runs the search **before** normal list selection — the user does not need a matching command row.

### Static command rows

Add two discoverable commands in `commands.ts`:

| id | title | purpose |
|----|-------|---------|
| `search-google` | Search Google | Same as `g` / `google` using the current input as query when useful |
| `search-files` | Search Files | Same as `f` using the current input as query when useful |

Selecting a static row:

- If the input is a prefix form (`g cats`, `f invoice`), use the **term after the prefix**.
- Otherwise open with an **empty** term (Google homepage / empty Windows Search). Do **not** use the fuzzy-match text (e.g. typing `search goo` to find the command) as the search query — that avoids accidental searches for the command title itself.
- Primary path for a non-empty query remains the prefix interceptor (`g cats`, `f invoice`).

Keywords should include: google, search, web, files, folders, find, explorer (as appropriate per command).

### Errors

If `launch_path` or Windows Search open fails: keep the Kavibay window open and do not clear the query.

## Out of scope

- In-palette file/folder result rows
- Everything / Spotlight-style indexed search
- Other search engines or configurable prefixes
- Implementing unrelated stub commands (`open-terminal`, `sleep`, etc.)

## Architecture

### Approach

**Prefix interceptor on Enter (Approach 1).**

Rejected:

- Dynamic palette rows only — more UI plumbing; prefix-on-Enter is enough for the chosen UX
- Static commands only — fights the prefix model

### Components

| Piece | Location | Role |
|-------|----------|------|
| Prefix parser | `src/palette/` (small helper, e.g. `prefixSearch.ts`) | Parse `g` / `google` / `f` + optional term; unit-tested |
| Google open | `CommandPalette.vue` + existing `launch_path` | Build Google URL, invoke, hide window |
| Windows Search | New Rust command, e.g. `open_windows_search(query: String)` | ShellExecute `search-ms:query=…` (URL-encoded) |
| Static commands | `src/palette/commands.ts` | Discoverability via fuzzy match |
| Special-case run | `CommandPalette.vue` `runCommandAt` | Handle `search-google` / `search-files` like Settings (not stub `execute_action`) |

### Data flow

```
Enter
  → parsePrefix(query)
  → if google: launch_path(googleUrl) → hide
  → if files: open_windows_search(term) → hide
  → else: existing runCommandAt(selectedIndex)
       → search-google / search-files: same open helpers
       → other commands: unchanged
```

### Windows Search details

- Use the `search-ms:` protocol via shell open (same family as `launch_path` / ShellExecute).
- Query string URL-encoded.
- Empty query still opens the Search UI.

### Google details

- Search URL: `https://www.google.com/search?q=` + `encodeURIComponent(term)`
- Empty term: `https://www.google.com/`

## Testing

### Unit

Prefix parser cases:

- `g cats`, `google cats`, `G Cats`, `Google  cats` (trim)
- bare `g`, `google`, `f`
- `f invoice`
- non-prefix: `cats`, `gift`, `find` (must **not** match `f` as substring of another word — only first-token `f`)
- `googlechrome` without space after google — not a prefix (first token is `googlechrome`)

### Manual

- `g hello` → browser with Google results
- `f hello` → Windows Search
- Static “Search Google” / “Search Files” rows appear when typing those titles
- Normal commands and calculator still work
- Failed open leaves window visible with query intact

## Success criteria

1. Prefix `g`/`google` and `f` open the correct external UI and hide Kavibay on success.
2. Static commands exist and perform the same opens.
3. No new widget types.
4. Prefix parser covered by unit tests for the cases above.
