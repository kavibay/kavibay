# Palette search feel (Raycast-like) — Design

**Status:** Implemented (2026-07-25)  
**Completion:** Phases 1–3 + macOS list/icon/launch backends. Phase 4 not needed unless catalog size demands it.

**Date:** 2026-07-25  
**Approach:** C — warm index + FE keystroke search; disk icon cache; query-conditioned frecency  
**Supersedes (partially):** speed/icons notes in `2026-07-22-palette-installed-apps-search-design.md` (V1 “no icons”; Windows-only out of scope). That doc’s warm-list + FE fuzzy shape stays.

## Goal

Palette app search should feel closer to Raycast on **both ranking and instant UI**:

1. **Right app on top** after 1–2 characters (learned from prior picks for that query prefix).
2. **Instant stable rows** (icons already present for habitual/pinned/recent hits; no pop-in cascade).

Must work on **Windows and macOS**. OS-specific work stays in Rust backends; the FE search/rank/cache *contract* is shared.

## Non-goals

- Native (non-webview) palette UI
- Per-keystroke Rust `search_*` IPC (deferred unless profiling proves FE scan is the bottleneck)
- Full-disk file indexer / Spotlight replacement
- Raycast-style sensitivity preference UI (can add later)
- Changing widget/command/notes ranking beyond sharing the same query-frecency helper if trivial

## Constraints

- Host stays generic: no `typeId` switches for this work.
- `sdk/` must not import core.
- Keystroke path stays in the FE (existing `fuzzyMatch` + `buildAppRows`) so typing does not wait on IPC.
- macOS port is incomplete today (`list_installed_apps` / `extract_app_icon` / `launch_path` error on non-Windows). New APIs and FE modules must not hard-code Windows paths or assumptions.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ FE (shared)                                             │
│  installedAppsIndex  → fuzzy + query frecency → rows  │
│  iconCache (memory)  ← read disk cache / prewarm       │
│  appLaunchHistory    → global + queryPrefix → appKey   │
└───────────────┬───────────────────────────▲─────────────┘
                │ warm list / extract miss  │ data URLs / paths
┌───────────────▼───────────────────────────┴─────────────┐
│ Rust                                                    │
│  list_installed_apps()     cfg(windows) | cfg(macos)    │
│  extract_app_icon(path)    cfg(windows) | cfg(macos)    │
│  icon disk cache (app_data/palette-app-icons/…)         │
│  launch_path(path)         cfg(windows) | cfg(macos)    │
└─────────────────────────────────────────────────────────┘
```

**Platform backends (same command names):**

| Command | Windows (existing) | macOS (required for parity) |
|---------|--------------------|-----------------------------|
| `list_installed_apps` | Start apps + Start Menu + registry | `/Applications` + `~/Applications` (`.app` bundles); optional Login Items / pinned later |
| `extract_app_icon` | Shell / exe / lnk icon → PNG data URL | Bundle icon via AppKit/`NSWorkspace` or `icns` → PNG data URL |
| `launch_path` | ShellExecute / existing | `open` / LaunchServices for `.app` and files |
| Icon disk cache | Shared layout under app data | Same layout; path keys normalized per OS |

Until a macOS backend lands, commands may still return a clear “unsupported” error — but **cache paths, FE ranking, and prewarm logic must compile and run on macOS** (empty app list is fine; no Windows-only string parsing in FE).

## Phase 1 — Instant rows (icon disk cache + prewarm)

### Behavior

- After a successful `extract_app_icon`, Rust (preferred) or FE writes a small PNG under app data, keyed by a stable hash of the normalized launch path (+ optional content mtime when cheap).
- `ensureAppIcons(paths)`:
  1. Memory hit → done
  2. Disk cache hit → load into memory (no extract)
  3. Else extract → write disk → memory
- On palette show / index refresh: **prewarm** icons for pinned apps, high global-usage apps, and last N shown palette app hits (cap workers; never block typing).
- Keep short debounce only for *new* extracts so typing does not fight IPC.

### Cross-platform rules

- Cache directory via Tauri `app_data_dir` (or existing kavibay data root), not `%APPDATA%` hard-coded.
- Path normalization for keys: Windows case-fold + `\`/`/` normalize; macOS keep path as resolved UTF-8 (no assuming drive letters or `.lnk`).
- FE never assumes `.exe` / `.lnk`; treat `path` as opaque launch target.

### Verify

- Cold palette open after prior session: habitual/pinned app icons appear without extract delay.
- Missing/corrupt cache file → one extract + rewrite; no UI crash.
- macOS build: cache module + FE path compile; extract/list may stub until backend exists.

## Phase 2 — Right top hit (query-conditioned frecency + tighter short fuzzy)

### Behavior

Extend palette launch history (FE `localStorage`, already cross-platform):

- Keep global `{ appKey → { count, lastAt } }` for habitual boost.
- Add `{ queryPrefix → { appKey → { count, lastAt } } }` recorded on **successful** palette app launch.
- Prefix = trimmed lowercased query at launch time, capped length (e.g. 16). Also bump shorter prefixes (e.g. `"spo"`, `"sp"`, `"s"`) with decaying weight **or** store only the exact typed query and match by prefix lookup at rank time — prefer **exact typed query + prefix-of-stored-key lookup** so one launch of `spot` boosts when typing `sp` / `spo` / `spot`.

**Rank order for app rows** (high → low):

1. Query-frecency for current query (and parent prefixes)
2. Fuzzy score (existing)
3. Global usage boost (existing thresholds)
4. Start/Dock pin flag when available
5. Title tie-break

### Short-query quality

- For `query.length === 2`: accept only contiguous substring **or** both chars on word starts (drop sparse density-only / weak acronym noise like USB / “Sources”+“bit”).
- Keep 1-char word-start rule as today.
- Cap remains ~12; ranking quality matters more than shrinking the list.

### Verify

- After several launches of the same app for a short prefix, that app is #1 for that prefix.
- Colocated `*.assert.ts` for frecency merge + 2-char fuzzy rejects.
- Works with empty macOS app list (no crashes).

## Phase 3 — Hot-path diet (perceived latency)

- Profile `results` computed in `CommandPalette.vue`.
- Skip note-body / snippet work when the query cannot usefully hit notes (cheap gate).
- Do not drive widget `previewWidget` scaling for pure app-row selections.
- Precompute lowercase app names once when the installed-apps index updates (avoid per-key `toLowerCase` over the full catalog).

### Verify

- Typing a 3–4 char app query does not trigger widget preview scale.
- Asserts or manual smoke: notes search still works when query is aimed at notes.

## Phase 4 — Only if needed

If Phase 1–3 still feel slow with large catalogs (~1k+ apps):

- FE prefix bucket / first-letter index, **or**
- Rare batch Rust filter (not every keystroke).

Do not start here.

## macOS backend (parity track)

Tracked as part of this feel work’s platform contract, but can ship behind the FE phases:

1. `list_installed_apps` on macOS: scan `/Applications` + `~/Applications` for `*.app`, name from `CFBundleDisplayName` / `CFBundleName` / filename.
2. `extract_app_icon` on macOS: bundle icon → PNG data URL (same FE contract).
3. `launch_path` on macOS: open `.app` / files via LaunchServices/`open`.
4. Pin flag: optional Dock favorites later; omit or `false` in v1 macOS list.

Windows behavior must stay green while macOS backends land.

## Files (expected)

| Area | Likely touch |
|------|----------------|
| FE index / icons | `core/app/palette/installedAppsIndex.ts` (+ small cache helper) |
| FE ranking | `core/app/palette/appLaunchHistory.ts`, `paletteResults.ts`, `fuzzy.ts` + asserts |
| Palette hot path | `core/app/palette/CommandPalette.vue` |
| Rust icons cache | `src-tauri/src/app_launcher.rs` and/or new `palette_icons.rs` |
| Rust list/launch | `src-tauri/src/installed_apps.rs`, `app_launcher.rs` (`cfg(macos)` modules) |
| Docs | this spec; short note in `docs/extensions.md` only if user-facing behavior changes meaningfully |

## Success criteria

- Habitual/pinned icons show from disk cache on palette open (Windows now; macOS once extract exists).
- Query-conditioned frecency puts the usual pick on top for short prefixes.
- Short 2-char queries produce fewer junk system/driver hits.
- FE + cache code paths are OS-agnostic; macOS backends implement the same commands.
- `npm run build` green; relevant `*.assert.ts` green; `cargo test --lib` green when Rust touched.

## Rollout order

1. Phase 2 fuzzy tighten + query frecency (FE-only, both OS) — fastest ranking win  
2. Phase 1 icon disk cache + prewarm (Rust cache API shared; Windows extract first)  
3. Phase 3 hot-path diet  
4. macOS `list` / `icon` / `launch` backends (can parallelize with 2–3 once command shapes are stable)  
5. Phase 4 only if metrics/feel still demand it  
