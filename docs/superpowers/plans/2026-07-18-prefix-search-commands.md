# Prefix Search Commands (Google + Windows Files) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add non-widget palette actions so `g`/`google` opens Google and `f` opens Windows Search, with static discoverable command rows for both.

**Architecture:** Pure TS prefix parser runs on Enter before normal command selection. Google uses existing `launch_path` with a search URL. Files use a new Rust `open_windows_search` command (ShellExecute `search-ms:`) because `launch_path` rejects non-http paths that are not filesystem paths. Static `search-google` / `search-files` commands call the same open helpers.

**Tech Stack:** Vue 3 + TypeScript, Vite, Tauri 2 (Windows ShellExecute), no new npm dependencies.

## Global Constraints

- Prefixes: `g` / `google` (Google), `f` (Windows Search) — case-insensitive whole first token only
- Prefix Enter runs before list selection; no matching row required
- Empty term → Google homepage / empty Windows Search UI
- Static rows: if query is a matching prefix for that kind, use remainder; otherwise empty term (never search for fuzzy-match text like `search goo`)
- On open failure: keep window open, do not clear query
- No new widgets; no in-palette file index; no other search engines
- No git repository in this workspace — skip all commit steps
- No test runner — verify with Node assert scripts, `npx vue-tsc --noEmit`, `cargo check`, and manual UI checks
- Spec: `docs/superpowers/specs/2026-07-18-prefix-search-commands-design.md`

## File Structure

| File | Responsibility |
|------|----------------|
| `src/palette/prefixSearch.ts` | Parse prefixes; build Google URL; resolve static-command terms |
| `src/palette/commands.ts` | Add `search-google` and `search-files` rows |
| `src/palette/CommandPalette.vue` | Prefix-on-Enter; special-case static search commands |
| `src-tauri/src/app_launcher.rs` | `open_windows_search` Tauri command |
| `src-tauri/src/lib.rs` | Register `open_windows_search` in invoke handler |

---

### Task 1: Prefix parser + Google URL helpers

**Files:**
- Create: `src/palette/prefixSearch.ts`
- Test: Node assert script (inline)

**Interfaces:**
- Consumes: none
- Produces:
  - `export type PrefixSearchKind = "google" | "files"`
  - `export interface PrefixSearchMatch { kind: PrefixSearchKind; term: string }`
  - `export function parsePrefixSearch(query: string): PrefixSearchMatch | null`
  - `export function buildGoogleSearchUrl(term: string): string`
  - `export function resolveStaticSearchTerm(query: string, kind: PrefixSearchKind): string`

- [ ] **Step 1: Write the failing Node assert script (file does not exist yet)**

Run from repo root:

```powershell
node --input-type=module -e @"
import assert from 'node:assert/strict';
import { parsePrefixSearch, buildGoogleSearchUrl, resolveStaticSearchTerm } from './src/palette/prefixSearch.ts';

assert.deepEqual(parsePrefixSearch('g cats'), { kind: 'google', term: 'cats' });
assert.deepEqual(parsePrefixSearch('google cats'), { kind: 'google', term: 'cats' });
assert.deepEqual(parsePrefixSearch('G Cats'), { kind: 'google', term: 'Cats' });
assert.deepEqual(parsePrefixSearch('google  cats'), { kind: 'google', term: 'cats' });
assert.deepEqual(parsePrefixSearch('g'), { kind: 'google', term: '' });
assert.deepEqual(parsePrefixSearch('google'), { kind: 'google', term: '' });
assert.deepEqual(parsePrefixSearch('f invoice'), { kind: 'files', term: 'invoice' });
assert.deepEqual(parsePrefixSearch('f'), { kind: 'files', term: '' });
assert.equal(parsePrefixSearch('cats'), null);
assert.equal(parsePrefixSearch('gift'), null);
assert.equal(parsePrefixSearch('find'), null);
assert.equal(parsePrefixSearch('googlechrome'), null);
assert.equal(parsePrefixSearch(''), null);
assert.equal(parsePrefixSearch('   '), null);

assert.equal(buildGoogleSearchUrl(''), 'https://www.google.com/');
assert.equal(buildGoogleSearchUrl('hello world'), 'https://www.google.com/search?q=hello%20world');

assert.equal(resolveStaticSearchTerm('g cats', 'google'), 'cats');
assert.equal(resolveStaticSearchTerm('f invoice', 'files'), 'invoice');
assert.equal(resolveStaticSearchTerm('f invoice', 'google'), '');
assert.equal(resolveStaticSearchTerm('search goo', 'google'), '');
assert.equal(resolveStaticSearchTerm('search files', 'files'), '');

console.log('prefixSearch ok');
"@
```

Expected: FAIL with module not found / cannot resolve `./src/palette/prefixSearch.ts`

- [ ] **Step 2: Create `src/palette/prefixSearch.ts`**

```ts
/** Google vs Windows file search prefix kinds. */
export type PrefixSearchKind = "google" | "files";

/** Result of parsing a palette prefix (`g` / `google` / `f`). */
export interface PrefixSearchMatch {
  kind: PrefixSearchKind;
  /** Search term; empty means homepage / empty Windows Search. */
  term: string;
}

/**
 * Parse `g` / `google` / `f` as a whole first token.
 * Returns null when the query is not a prefix search action.
 */
export function parsePrefixSearch(query: string): PrefixSearchMatch | null {
  const trimmed = query.trim();
  if (!trimmed) return null;

  const m = /^(\S+)(?:\s+(.*))?$/.exec(trimmed);
  if (!m) return null;

  const token = m[1].toLowerCase();
  const term = (m[2] ?? "").trim();

  if (token === "g" || token === "google") {
    return { kind: "google", term };
  }
  if (token === "f") {
    return { kind: "files", term };
  }
  return null;
}

/** Google search URL; empty term opens the homepage. */
export function buildGoogleSearchUrl(term: string): string {
  const t = term.trim();
  if (!t) return "https://www.google.com/";
  return `https://www.google.com/search?q=${encodeURIComponent(t)}`;
}

/**
 * Term for static Search Google / Search Files commands.
 * Only uses a remainder when the query is a prefix of the same kind; otherwise empty.
 */
export function resolveStaticSearchTerm(
  query: string,
  kind: PrefixSearchKind,
): string {
  const parsed = parsePrefixSearch(query);
  if (parsed && parsed.kind === kind) return parsed.term;
  return "";
}
```

- [ ] **Step 3: Re-run the assert script**

Same command as Step 1.

Expected: `prefixSearch ok`

If Vite/Node cannot import `.ts` directly, run via:

```powershell
npx vite-node -e "import assert from 'node:assert/strict'; import { parsePrefixSearch, buildGoogleSearchUrl, resolveStaticSearchTerm } from './src/palette/prefixSearch.ts'; /* same asserts */ console.log('prefixSearch ok')"
```

Or compile with `npx tsx` if available. Prefer whatever already works in this repo; the asserts and expected values stay the same.

- [ ] **Step 4: Commit**

Skip — no git repository in this workspace.

---

### Task 2: Rust `open_windows_search`

**Files:**
- Modify: `src-tauri/src/app_launcher.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `cargo check`

**Interfaces:**
- Consumes: existing Windows `ShellExecuteW` / `wide` helpers in `app_launcher.rs`
- Produces: `#[tauri::command] pub fn open_windows_search(query: String) -> Result<(), String>`

- [ ] **Step 1: Add `open_windows_search` to `src-tauri/src/app_launcher.rs`**

Place after `launch_path` (near the top-level commands). Do **not** reuse `launch_path_windows` as-is — it rejects non-http paths that fail `Path::exists`, so `search-ms:` would error with "Pfad nicht gefunden".

```rust
/// Open Windows Search (`search-ms:`) with an optional query string.
#[tauri::command]
pub fn open_windows_search(query: String) -> Result<(), String> {
    #[cfg(not(windows))]
    {
        let _ = query;
        return Err("Windows Search is only supported on Windows".into());
    }
    #[cfg(windows)]
    {
        open_windows_search_windows(&query)
    }
}

#[cfg(windows)]
fn open_windows_search_windows(query: &str) -> Result<(), String> {
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let term = query.trim();
    let uri = if term.is_empty() {
        "search-ms:".to_string()
    } else {
        // encodeURIComponent-compatible: percent-encode query for search-ms
        let encoded: String = term
            .chars()
            .map(|c| match c {
                'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
                _ => {
                    let mut buf = [0u8; 4];
                    let s = c.encode_utf8(&mut buf);
                    s.as_bytes()
                        .iter()
                        .map(|b| format!("%{b:02X}"))
                        .collect::<String>()
                }
            })
            .collect();
        format!("search-ms:query={encoded}")
    };

    let file = wide(&uri);
    let operation: Vec<u16> = "open".encode_utf16().chain(std::iter::once(0)).collect();

    // SAFETY: null-terminated wide strings for ShellExecuteW open.
    let result = unsafe {
        ShellExecuteW(
            None,
            PCWSTR(operation.as_ptr()),
            PCWSTR(file.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };

    if (result.0 as usize) <= 32 {
        return Err(format!("Windows Search failed (code {})", result.0 as usize));
    }
    Ok(())
}
```

Confirm `wide` already exists in this file (used by `launch_path_windows`). Reuse it.

Simpler encoding alternative if preferred (same behavior for typical queries): use the `url` crate already in the project:

```rust
let encoded = url::form_urlencoded::byte_serialize(term.as_bytes()).collect::<String>();
format!("search-ms:query={encoded}")
```

Use the `url` crate approach if `form_urlencoded` is available via the existing `url` dependency; otherwise keep the manual encoder above.

- [ ] **Step 2: Register in `src-tauri/src/lib.rs`**

In `tauri::generate_handler![...]`, next to `app_launcher::launch_path`, add:

```rust
app_launcher::open_windows_search,
```

- [ ] **Step 3: Verify compile**

Run:

```powershell
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: success, no errors.

- [ ] **Step 4: Commit**

Skip — no git repository in this workspace.

---

### Task 3: Wire palette commands + Enter interceptor

**Files:**
- Modify: `src/palette/commands.ts`
- Modify: `src/palette/CommandPalette.vue`
- Test: `npx vue-tsc --noEmit` + manual UI

**Interfaces:**
- Consumes:
  - `parsePrefixSearch`, `buildGoogleSearchUrl`, `resolveStaticSearchTerm` from Task 1
  - `invoke("launch_path", { path })` and `invoke("open_windows_search", { query })` from Task 2
- Produces: working prefix + static search commands in the palette

- [ ] **Step 1: Add static commands to `src/palette/commands.ts`**

Insert near the top of the `commands` array (after `open-settings` is fine):

```ts
  {
    id: "search-google",
    title: "Search Google",
    subtitle: "Open Google in the browser (prefix: g / google)",
    keywords: ["google", "search", "web", "g", "browser"],
  },
  {
    id: "search-files",
    title: "Search Files",
    subtitle: "Open Windows Search (prefix: f)",
    keywords: ["files", "folders", "search", "find", "explorer", "f"],
  },
```

- [ ] **Step 2: Import helpers and add open + error handling in `CommandPalette.vue`**

Add imports:

```ts
import {
  buildGoogleSearchUrl,
  parsePrefixSearch,
  resolveStaticSearchTerm,
  type PrefixSearchMatch,
} from "./prefixSearch";
```

Add helpers inside `<script setup>` (near `runCommandAt`):

```ts
/**
 * Open Google or Windows Search for a parsed prefix match.
 * On failure, leave the window open and keep the query.
 */
async function runPrefixSearch(match: PrefixSearchMatch) {
  try {
    if (match.kind === "google") {
      await invoke("launch_path", { path: buildGoogleSearchUrl(match.term) });
    } else {
      await invoke("open_windows_search", { query: match.term });
    }
    await getCurrentWindow().hide();
  } catch {
    // Keep overlay visible so the user can edit the query and retry.
  }
}
```

- [ ] **Step 3: Intercept Enter for prefixes before normal command run**

Update `onKeydown` Enter case:

```ts
    case "Enter":
      event.preventDefault();
      {
        const prefix = parsePrefixSearch(query.value);
        if (prefix) {
          void runPrefixSearch(prefix);
          break;
        }
      }
      void runCommandAt(selectedIndex.value);
      break;
```

Also handle click on a result row: clicks still go through `runCommandAt` only (prefix without selecting a row uses keyboard Enter). That matches the spec (prefix path on Enter). Optional: if desired later, clicking empty area is out of scope.

- [ ] **Step 4: Special-case static command IDs in `runCommandAt`**

After the `new-note` block and before `execute_action`:

```ts
  if (command.id === "search-google") {
    await runPrefixSearch({
      kind: "google",
      term: resolveStaticSearchTerm(query.value, "google"),
    });
    return;
  }

  if (command.id === "search-files") {
    await runPrefixSearch({
      kind: "files",
      term: resolveStaticSearchTerm(query.value, "files"),
    });
    return;
  }
```

- [ ] **Step 5: Typecheck**

Run:

```powershell
npx vue-tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Manual UI check**

Run the app (`npm run tauri dev` or the project's usual launch). Verify:

1. Type `g hello` → Enter → browser opens Google results for hello; Kavibay hides
2. Type `google` → Enter → Google homepage; Kavibay hides
3. Type `f hello` → Enter → Windows Search with hello; Kavibay hides
4. Type `f` → Enter → Windows Search UI; Kavibay hides
5. Type `Search Google` → select row → Enter → Google homepage (empty term)
6. Type `gift` → still fuzzy-matches normal commands; does **not** open Google
7. Calculator and other commands still work
8. (Optional failure path) Temporarily break the URI and confirm query/window stay

- [ ] **Step 7: Commit**

Skip — no git repository in this workspace.

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| `g` / `google` prefix → Google | Task 1 + 3 |
| `f` prefix → Windows Search | Task 1 + 2 + 3 |
| Empty term → homepage / empty search | Task 1 + 2 |
| Case-insensitive whole first token | Task 1 |
| Prefix before list selection | Task 3 |
| Static `search-google` / `search-files` | Task 3 |
| Static empty term unless same-kind prefix | Task 1 + 3 |
| Failure keeps window + query | Task 3 |
| No widgets / no file index | (all tasks — not added) |
| Unit-test prefix parser | Task 1 |
| Manual checks | Task 3 |

## Placeholder / consistency notes

- `open_windows_search` arg name is `query` (Tauri invoke `{ query: match.term }`).
- `launch_path` arg name remains `path`.
- Do not route `search-ms:` through `launch_path` — exists-check would fail.
- Regex alternation pitfall avoided by first-token split (`google` before `g` is irrelevant with token compare).
