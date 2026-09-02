# Palette Search Feel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make palette app search feel closer to Raycast — right top hit after 1–2 chars, instant stable icons — on Windows and macOS.

**Architecture:** Keep keystroke fuzzy search in the FE on a warm installed-apps list. Add query-conditioned frecency + stricter short fuzzy in TS; persist extracted icons under `{app_data_dir}/palette-app-icons/` via Rust; prewarm habitual/pinned icons. macOS implements the same `list_installed_apps` / `extract_app_icon` / `launch_path` commands behind `cfg(macos)`.

**Tech Stack:** Vue 3 + TypeScript (palette FE), Tauri v2 Rust commands, colocated `*.assert.ts` via `npx tsx`, `cargo test --lib` when Rust changes.

**Spec:** `docs/superpowers/specs/2026-07-25-palette-search-feel-design.md`

## Global Constraints

- Keystroke path stays in FE — no per-keystroke Rust search IPC.
- FE must not hard-code Windows paths (`.exe`, `.lnk`, drive letters, `\`).
- Icon cache uses Tauri `app_data_dir`, not OS-specific hard-coded roots.
- Same command names on Windows and macOS; backends are `cfg`-split.
- Host stays generic (no `typeId` switches). `sdk/` must not import core.
- Do not commit unless the user explicitly asks; plan commit steps are optional checkpoints.
- Verify with: relevant `npx tsx …assert.ts`, `npm run build` after FE tasks, `cargo test --lib` after Rust tasks.

## File map

| File | Responsibility |
|------|----------------|
| `core/app/palette/fuzzy.ts` | Stricter 2-char accept rule |
| `core/app/palette/fuzzy.assert.ts` | USB / ODBC-style rejects |
| `core/app/palette/appLaunchHistory.ts` | Global + query-prefix frecency; OS-agnostic path keys |
| `core/app/palette/appLaunchHistory.assert.ts` | Frecency + path-key asserts |
| `core/app/palette/paletteResults.ts` | Rank apps with query boost; optional `nameLower` on apps |
| `core/app/palette/paletteResults.assert.ts` | Ranking order asserts |
| `core/app/palette/CommandPalette.vue` | Pass query into record/boost; prewarm hooks; hot-path diet |
| `core/app/palette/installedAppsIndex.ts` | Disk-cache read path; prewarm list helper |
| `src-tauri/src/palette_app_icons.rs` | Disk cache read/write + path key (new) |
| `src-tauri/src/app_launcher.rs` | Cache-aware `extract_app_icon`; macOS icon/launch |
| `src-tauri/src/installed_apps.rs` | macOS `/Applications` scan |
| `src-tauri/src/lib.rs` | Register new module / commands |

---

### Task 1: Stricter 2-char fuzzy

**Files:**
- Modify: `core/app/palette/fuzzy.ts`
- Modify: `core/app/palette/fuzzy.assert.ts`

**Interfaces:**
- Consumes: existing `fuzzyMatch(query, target) -> { matched, score }`
- Produces: same signature; for `query.length === 2`, match only if contiguous run of 2 **or** `wordStartHits >= 2`

- [x] **Step 1: Write the failing asserts**

**Rule for `q.length === 2`:** accept only if:
- `maxConsecutive === 2` **and** (`wordStartHits >= 1` OR `firstMatchAt === 0`), **or**
- `wordStartHits >= 2`

(Mid-token contiguous like `USB` is rejected; prefix `Slack` and word-start pairs like `Sublime Text` stay.)

Append to `fuzzy.assert.ts`:

```ts
assert(!fuzzyMatch("sb", "Create USB Recovery").matched, "sb ↛ USB mid-token");
assert(!fuzzyMatch("sb", "Windows Backup").matched, "sb ↛ Windows Backup density");
assert(
  !fuzzyMatch("sb", "ODBC Data Sources (32-bit)").matched,
  "sb ↛ Sources+bit weak acronym",
);
assert(fuzzyMatch("sl", "Slack").matched, "sl → Slack prefix");
assert(fuzzyMatch("sb", "Sublime Text").matched, "sb → Sublime Text word starts");
```

- [x] **Step 2: Run asserts — expect FAIL on new cases**

Run: `npx tsx core/app/palette/fuzzy.assert.ts`  
Expected: FAIL on one of the new `sb` rejects (current matcher accepts them).

- [x] **Step 3: Implement rule in `fuzzy.ts`**

After the existing 1-char word-start gate, before density/acronym accept, add:

```ts
  if (q.length === 2) {
    const contiguous = maxConsecutive === 2;
    const contiguousOk =
      contiguous && (wordStartHits >= 1 || firstMatchAt === 0);
    const twoWordStarts = wordStartHits >= 2;
    if (!contiguousOk && !twoWordStarts) {
      return { matched: false, score: 0 };
    }
  }
```

Keep the later general `tightChunk / acronym / dense` gate for longer queries. For length 2, the new gate is sufficient; the general gate may still run — ensure USB (`contiguous` mid-word, `wordStartHits === 0`, `firstMatchAt !== 0`) fails the new gate.

- [x] **Step 4: Run asserts — expect PASS**

Run: `npx tsx core/app/palette/fuzzy.assert.ts`  
Expected: `fuzzy.assert: ok`

---

### Task 2: OS-agnostic path keys + query frecency

**Files:**
- Modify: `core/app/palette/appLaunchHistory.ts`
- Modify: `core/app/palette/appLaunchHistory.assert.ts`
- Modify: `core/app/palette/paletteResults.ts` (`buildAppRows`)
- Modify: `core/app/palette/paletteResults.assert.ts`
- Modify: `core/app/palette/CommandPalette.vue` (record + boost with query)

**Interfaces:**
- Consumes: `appNameDedupeKey` from `paletteResults.ts`
- Produces:
  - `normalizeLaunchPathKey(path: string): string` — trim, lower case, `\` → `/`
  - `appHistoryKey(name, path)` — uses `normalizeLaunchPathKey` for path fallback (not Windows `\`)
  - `APP_LAUNCH_HISTORY_KEY = "kavibay:palette-app-launches-v3"`
  - `export interface AppLaunchHistoryState { apps: AppLaunchHistory; queries: Record<string, AppLaunchHistory> }`
  - `loadAppLaunchHistory(): AppLaunchHistoryState` (migrate v2 apps map → `{ apps, queries: {} }`)
  - `saveAppLaunchHistory(state: AppLaunchHistoryState): void`
  - `recordAppLaunch(state, name, path, query: string, now?): AppLaunchHistoryState` — bumps app + all prefixes of normalized query (len 1..min(16, q.length)), still gap-debounced **per appKey** for the apps map; query maps use same gap per `(prefix, appKey)`
  - `usageBoostForApp(state.apps | state, …)` — keep working on apps map
  - `queryFrecencyBoost(state, query, name, path, now?): number` — look up `state.queries[normalizedQuery][appKey]`; require `count >= MIN_COUNT_FOR_BOOST`; base boost `50` + small recency (higher than global usage so query wins ties)
  - `buildAppRows(query, apps, limit, usageBoost, queryBoost?: (app) => number)` — `rankScore = fuzzy + pin + usage + queryBoost`

- [x] **Step 1: Failing asserts for path key + query boost**

In `appLaunchHistory.assert.ts`, add (adjust imports to new state type):

```ts
assert(
  appHistoryKey("App", "/Applications/App.app").includes("/applications/app.app"),
  "path key keeps posix-style separators",
);

let state = loadEmptyState(); // helper: { apps: {}, queries: {} }
const q = "spot";
state = recordAppLaunch(state, "Spotify", "/Applications/Spotify.app", q, t0);
state = recordAppLaunch(state, "Spotify", "/Applications/Spotify.app", q, t0 + COUNT_GAP_MS);
assert(queryFrecencyBoost(state, "sp", "Spotify", "/Applications/Spotify.app", t0 + COUNT_GAP_MS) > 40, "prefix sp gets query boost after 2 launches of spot");
assert(queryFrecencyBoost(state, "zz", "Spotify", "/Applications/Spotify.app", t0 + COUNT_GAP_MS) === 0, "unrelated query → 0");
```

- [x] **Step 2: Run — expect FAIL**

Run: `npx tsx core/app/palette/appLaunchHistory.assert.ts`

- [x] **Step 3: Implement history v3 + helpers**

Implement interfaces above. Migration:

```ts
// v2: Record<string, AppLaunchEntry> at APP_LAUNCH_HISTORY_KEY old constant
// v3: { apps, queries } at new key; on load, if v3 missing, read v2 into apps
```

`normalizeQueryPrefix(query: string): string` — trim, lower case, slice 0..16.

`recordAppLaunch`: if normalized query empty, only bump apps (same as today).

- [x] **Step 4: Wire `buildAppRows` + palette**

```ts
export function buildAppRows(
  query: string,
  apps: { name: string; path: string; pinned?: boolean }[],
  limit = 12,
  usageBoost: (app: { name: string; path: string }) => number = () => 0,
  queryBoost: (app: { name: string; path: string }) => number = () => 0,
): PaletteAppRow[] {
  // ...
  const boosted = score + (pinned ? 5 : 0) + usage + queryBoost({ name, path });
```

In `CommandPalette.vue`:

```ts
const appRows = buildAppRows(
  query.value,
  installedAppsIndex.value,
  12,
  (app) => usageBoostForApp(appLaunchHistory.value.apps, app.name, app.path),
  (app) => queryFrecencyBoost(appLaunchHistory.value, query.value, app.name, app.path),
);

// on launch:
const next = recordAppLaunch(appLaunchHistory.value, row.title, row.path, query.value);
```

Update all `appLaunchHistory` typings in the Vue file to `AppLaunchHistoryState`.

- [x] **Step 5: Ranking assert in `paletteResults.assert.ts`**

```ts
const ranked = buildAppRows(
  "sp",
  [
    { name: "Spark", path: "/Applications/Spark.app" },
    { name: "Spotify", path: "/Applications/Spotify.app" },
  ],
  12,
  () => 0,
  (app) => (app.name === "Spotify" ? 50 : 0),
);
assert(ranked[0]?.title === "Spotify", "query frecency beats other sp* fuzzy hits");
```

- [x] **Step 6: Run asserts + build**

```bash
npx tsx core/app/palette/appLaunchHistory.assert.ts
npx tsx core/app/palette/paletteResults.assert.ts
npx tsx core/app/palette/fuzzy.assert.ts
npm run build
```

Expected: all ok / build green.

- [ ] **Step 7: Manual smoke (Windows)** — *deferred*

Launch Spotify twice via palette with query `spo` (respect gap or temporarily lower gap in a debug build — prefer waiting / using assert coverage). Type `sp` → Spotify should rank above unrelated `sp*` apps.

---

### Task 3: Rust icon disk cache

**Files:**
- Create: `src-tauri/src/palette_app_icons.rs`
- Modify: `src-tauri/src/app_launcher.rs` (`extract_app_icon` takes `AppHandle`, check/write cache)
- Modify: `src-tauri/src/lib.rs` (`mod palette_app_icons`; register `get_cached_app_icons`)

**Interfaces:**
- Consumes: `app.path().app_data_dir()`, existing extract helpers
- Produces:
  - `normalize_icon_path_key(path: &str) -> String` — trim, lower case, `\` → `/`
  - `icon_cache_file(app, path) -> PathBuf` — `{app_data}/palette-app-icons/{sha256_hex}.png`
  - `read_cached_app_icon(app, path) -> Option<String>` — data URL if file exists
  - `write_cached_app_icon(app, path, png_bytes: &[u8]) -> Result<(), String>`
  - `#[tauri::command] get_cached_app_icons(app, paths: Vec<String>) -> Result<HashMap<String, String>, String>` — only disk hits; no extract
  - `extract_app_icon(app, path)` — return cache hit if present; else extract; if PNG data URL, decode base64 and write cache; return data URL

- [x] **Step 1: Add `palette_app_icons.rs` with key + read/write unit tests**

```rust
#[cfg(test)]
mod tests {
    #[test]
    fn normalize_slashes() {
        assert_eq!(
            normalize_icon_path_key(r"C:\Apps\Foo.exe"),
            "c:/apps/foo.exe"
        );
        assert_eq!(
            normalize_icon_path_key("/Applications/Foo.app"),
            "/applications/foo.app"
        );
    }
}
```

Use `sha2` if already in Cargo.toml; else `default-features` of an existing hasher, or simple stable hash — check `Cargo.toml` first and prefer an existing dependency (`sha2` / `blake3` / manual). If none, add `sha2`.

- [x] **Step 2: Wire extract + get_cached command**

Change signature:

```rust
#[tauri::command]
pub fn extract_app_icon(app: tauri::AppHandle, path: String) -> Result<String, String> {
```

FE `invoke("extract_app_icon", { path })` unchanged (AppHandle injected).

```rust
#[tauri::command]
pub fn get_cached_app_icons(
    app: tauri::AppHandle,
    paths: Vec<String>,
) -> Result<std::collections::HashMap<String, String>, String> {
    let mut out = std::collections::HashMap::new();
    for path in paths {
        if let Some(url) = crate::palette_app_icons::read_cached_app_icon(&app, &path) {
            out.insert(path, url);
        }
    }
    Ok(out)
}
```

Register in `lib.rs` next to `extract_app_icon`.

- [x] **Step 3: `cargo test --lib` for normalize tests**

Run: `cd src-tauri && cargo test --lib palette_app_icons`  
Expected: PASS

- [ ] **Step 4: Manual — second extract is cache-fast** — *deferred*

In app, clear nothing; open palette, search an app (icons extract once). Restart app, open palette, same query — icons should appear from cache without slow shell extract (Task 4 prewarm makes this obvious).

---

### Task 4: FE cache read + prewarm

**Files:**
- Modify: `core/app/palette/installedAppsIndex.ts`
- Modify: `core/app/palette/CommandPalette.vue` (call prewarm on show / after index load)
- Modify: `core/app/palette/appLaunchHistory.ts` only if needing top-N habitual paths helper

**Interfaces:**
- Consumes: `get_cached_app_icons`, `extract_app_icon`, `installedAppsIndex`, launch history
- Produces:
  - `hydrateAppIconsFromCache(paths: string[]): Promise<void>` — invoke `get_cached_app_icons`, merge into `installedAppIcons`
  - `prewarmAppIcons(apps: InstalledAppEntry[], history: AppLaunchHistoryState, limit = 24): void` — pick pinned + top habitual by `apps` map count + recently shown; `hydrateAppIconsFromCache` then `ensureAppIcons` for misses
  - `ensureAppIcons` unchanged externally; still extracts misses (which now populate disk via Rust)

- [x] **Step 1: Implement hydrate + prewarm in `installedAppsIndex.ts`**

```ts
export async function hydrateAppIconsFromCache(paths: string[]): Promise<void> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return;
  try {
    const hit = await invoke<Record<string, string>>("get_cached_app_icons", {
      paths: unique,
    });
    if (!hit || typeof hit !== "object") return;
    const next = { ...installedAppIcons.value };
    let changed = false;
    for (const [path, url] of Object.entries(hit)) {
      if (url && !next[path]) {
        next[path] = url;
        changed = true;
      }
    }
    if (changed) installedAppIcons.value = next;
  } catch {
    // Cache optional — extract path still works.
  }
}
```

- [x] **Step 2: Call prewarm after index warm / palette visible**

Find existing `ensureInstalledAppsIndex` call sites in `CommandPalette.vue` (mount / show). After apps load:

```ts
void hydrateAppIconsFromCache(installedAppsIndex.value.map((a) => a.path));
prewarmAppIcons(installedAppsIndex.value, appLaunchHistory.value);
```

Keep the existing 80ms debounced `ensureAppIcons` on `results` for visible rows.

- [ ] **Step 3: Manual smoke** — *deferred*

Cold start → open palette → type habitual app: icon should already be present (or appear from disk hydrate before extract). No layout jump preferred.

- [x] **Step 4: `npm run build`**

Expected: green.

---

### Task 5: Hot-path diet

**Files:**
- Modify: `core/app/palette/installedAppsIndex.ts` / `paletteResults.ts` — cache `nameLower` when building rows
- Modify: `core/app/palette/CommandPalette.vue` — skip note body keywords when query length is 0 (already) / skip `attachNoteSnippets` work when no note-capable rows; ensure `previewWidget` not called for app rows (verify `previewTargetId` already returns null)

**Interfaces:**
- Produces: `buildAppRows` uses `app.nameLower ?? app.name.toLowerCase()` if we add optional field when index loads:

```ts
// when setting installedAppsIndex:
installedAppsIndex.value = apps.map((a) => ({
  ...a,
  nameLower: a.name.trim().toLowerCase(),
}));
```

Cheap reject in `buildAppRows` uses `nameLower` instead of recomputing.

- [x] **Step 1: Add `nameLower` on index load; use in `buildAppRows`**

- [x] **Step 2: Gate notes snippet attachment**

In `attachNoteSnippets` caller or function: if no row is a notes widget/type hit needing snippets, return rows as-is early.

- [x] **Step 3: Confirm preview skip for apps**

Read `previewTargetId` — already null for `kind === "app"`. Add a one-line comment if missing so future changes do not preview-scale on app selection.

- [x] **Step 4: `npx tsx core/app/palette/paletteResults.assert.ts` && `npm run build`**

---

### Task 6: macOS `list_installed_apps`

**Files:**
- Modify: `src-tauri/src/installed_apps.rs`

**Interfaces:**
- Produces: `#[cfg(target_os = "macos")]` scan returning `Vec<InstalledApp>` with `pinned: false` for v1
- Paths are absolute `.app` bundle paths (opaque to FE)

- [x] **Step 1: Implement macOS scan**

```rust
#[cfg(target_os = "macos")]
fn scan_installed_apps_macos() -> Result<Vec<InstalledApp>, String> {
    let mut out = Vec::new();
    for dir in [
        PathBuf::from("/Applications"),
        dirs_home_applications(), // ~/Applications
    ] {
        // read_dir, filter *.app, name from plist or file_stem
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(dedupe_by_path(out))
}
```

Name resolution order: `CFBundleDisplayName`, `CFBundleName`, then filename without `.app`. Reading Info.plist: prefer a minimal plist parse already in deps, or `defaults`/`plutil` only if no crate — check `Cargo.toml` for `plist`. Add `plist` crate if needed.

- [x] **Step 2: Hook into `list_installed_apps`**

Replace bare error on non-Windows with:

```rust
#[cfg(target_os = "macos")]
{
    // same cache mutex pattern as Windows
    let apps = tokio::task::spawn_blocking(scan_installed_apps_macos)...
}
#[cfg(not(any(windows, target_os = "macos")))]
{
    Err("Installed apps listing is only supported on Windows and macOS".into())
}
```

- [x] **Step 3: `cargo check` / `cargo test --lib`**

On Windows CI: macOS module must compile under `cfg` (use `cargo check` on Windows — macOS code not compiled). On macOS runner (continue-on-error ok): list returns non-empty if `/Applications` has apps.

---

### Task 7: macOS `extract_app_icon` + `launch_path`

**Files:**
- Modify: `src-tauri/src/app_launcher.rs`

**Interfaces:**
- Produces:
  - `extract_app_icon_macos(path) -> Result<String, String>` PNG data URL from `.app` bundle icon
  - `launch_path` macOS: open path via `std::process::Command::new("open").arg(path)` (or existing pattern)
  - Disk cache write path shared with Task 3 (same `palette_app_icons`)

- [x] **Step 1: launch_path macOS**

```rust
#[cfg(target_os = "macos")]
fn launch_path_macos(path: &str) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}
```

Wire into existing `launch_path` command `cfg` split.

- [x] **Step 2: extract icon macOS**

Preferred approach (pick first that fits deps):
1. `objc2` / AppKit `NSWorkspace.iconForFile` → PNG (if project already has objc bindings)
2. Else: read `Info.plist` `CFBundleIconFile` / asset catalog; decode `.icns` with an `icns` crate or `sips -s format png` via `spawn_blocking` to a temp file, then read bytes → data URL

Keep output contract identical: `data:image/png;base64,…`.

- [x] **Step 3: Cache integration**

macOS extract goes through the same cache check/write as Windows in `extract_app_icon`.

- [x] **Step 4: Verify**

`cargo test --lib` on Windows (cfg-gated). Manual on macOS when available: list apps in palette, icons from cache after first extract, Enter launches.

---

### Task 8: Spec completion note + final verify

**Files:**
- Modify: `docs/superpowers/specs/2026-07-25-palette-search-feel-design.md` (status → Implemented + short completion note)
- Modify: `docs/superpowers/plans/2026-07-25-palette-search-feel.md` (checkboxes)

- [x] **Step 1: Run full verify**

```bash
npx tsx core/app/palette/fuzzy.assert.ts
npx tsx core/app/palette/appLaunchHistory.assert.ts
npx tsx core/app/palette/paletteResults.assert.ts
npm run build
cd src-tauri && cargo test --lib
```

- [ ] **Step 2: Manual UI smoke** — *deferred*

- Palette add/search app, duplicate gap launches → short prefix ranks it first  
- Restart → icons present for habitual apps  
- Junk `sb`-style USB/ODBC noise reduced  

- [x] **Step 3: Mark spec implemented**

Add at top of spec:

```markdown
**Status:** Implemented (2026-07-25)
**Completion:** Phases 1–3 + macOS list/icon/launch backends. Phase 4 not needed unless catalog size demands it.
```

---

## Self-review (plan vs spec)

| Spec item | Task |
|-----------|------|
| Phase 1 icon disk cache + prewarm | Tasks 3–4 |
| Phase 2 query frecency + 2-char fuzzy | Tasks 1–2 |
| Phase 3 hot-path diet | Task 5 |
| macOS list / icon / launch | Tasks 6–7 |
| Phase 4 only if needed | Explicitly deferred (no task) |
| OS-agnostic FE paths | Task 2 path keys; Task 3 normalize |
| No per-keystroke Rust search | Honored throughout |
| Success criteria / verify | Task 8 |

**Placeholder scan:** none intentional.  
**Type consistency:** `AppLaunchHistoryState`, `queryFrecencyBoost`, `get_cached_app_icons`, `normalizeLaunchPathKey` / `normalize_icon_path_key` named consistently across tasks.

**Note on Task 1 vs USB:** contiguous mid-token `USB` is rejected by requiring word-start or index-0 for 2-char contiguous hits — slightly stricter than the spec’s first sentence, aligned with the spec’s USB noise example.
