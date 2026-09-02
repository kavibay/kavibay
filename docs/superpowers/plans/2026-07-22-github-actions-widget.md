# GitHub Actions Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-party GitHub Actions widget: app-global PAT in Rust, one `owner/repo` per instance, spotlight run with job/step progress plus a short recent-runs list.

**Architecture:** Rust module owns PAT (DPAPI-protected SQLite) and GitHub REST. Vue extension owns per-instance repo settings, adaptive polling, and the tile UI. Settings modal hosts PAT paste/clear (Cloudflare AI pattern). Host stays generic.

**Tech Stack:** Vue 3 + TypeScript, Tauri 2, `reqwest`, `rusqlite`, existing `open` / `launch_path` for browser links. No Vitest — Node assert scripts + `cargo test` + `vue-tsc`.

**Tier:** L

**Spec:** `docs/superpowers/specs/2026-07-22-github-actions-widget-design.md`

## Global Constraints

- Extension id `github-actions`, catalog name **GitHub Actions**, category `information`
- `allowDuplicate: true`
- PAT app-global; never in localStorage / frontend storage
- Per-instance settings: `{ owner: string, repo: string }`
- REST only: runs `per_page=10`, `recent` = first 5, spotlight = first `queued`|`in_progress` else newest
- Jobs+steps only for spotlight run
- Poll ~30s idle / ~8s while spotlight in progress; pause on suspend; no poll when unmounted
- On 401: do **not** auto-delete PAT; surface auth error
- Match Kavibay dark-glass UI (Stocks / Notes); no new purple/glow theme
- Do not edit `WidgetHost` for per-widget special cases
- Comment new methods/functions with a short purpose note
- Commit after each task

## File Structure

| File | Responsibility |
|------|----------------|
| `src/extensions/github-actions/githubActionsLogic.ts` | Settings, DTO types, spotlight/progress/status helpers, storage |
| `src/extensions/github-actions/githubActionsLogic.assert.ts` | Node assert coverage for pure helpers |
| `src/extensions/github-actions/useGithubActionsSettings.ts` | Per-instance settings cache (Weather pattern) |
| `src/extensions/github-actions/GithubActionsWidget.vue` | Tile UI + poll + open run |
| `src/extensions/github-actions/GithubActionsSettings.vue` | Owner/repo gear form |
| `src/extensions/github-actions/manifest.json` | Catalog + declared commands |
| `src/extensions/github-actions/index.ts` | Extension module + lifecycle |
| `src/settings/GithubActionsPanel.vue` | PAT save/clear/status (clone CloudflareAiPanel) |
| `src/settings/SettingsModal.vue` | Nav section `github-actions` |
| `src-tauri/src/github_actions/mod.rs` | Module root |
| `src-tauri/src/github_actions/secret_protect.rs` | DPAPI protect/unprotect (clone calendar) |
| `src-tauri/src/github_actions/db.rs` | `{app_data}/github_actions.db` PAT row |
| `src-tauri/src/github_actions/types.rs` | Serde DTOs returned to UI |
| `src-tauri/src/github_actions/api.rs` | REST client + mapping + spotlight pick |
| `src-tauri/src/github_actions/commands.rs` | Tauri commands |
| `src-tauri/src/lib.rs` | `mod github_actions` + register commands |

---

### Task 1: Pure TS helpers + asserts

**Files:**
- Create: `src/extensions/github-actions/githubActionsLogic.ts`
- Create: `src/extensions/github-actions/githubActionsLogic.assert.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `GithubActionsSettings { owner: string; repo: string }`
  - DTO types matching spec (`RepoStatus`, `RunSummary`, `RunDetail`, `Job`, `Step`) — camelCase in TS; map from Rust snake_case at the invoke boundary **or** use `#[serde(rename_all = "camelCase")]` in Rust and keep TS camelCase (prefer **camelCase end-to-end** via serde rename)
  - `storageKey(instanceId)`, `normalizeSettings`, `load/save/clearSettings`
  - `pickSpotlight(runs: RunSummary[]): RunSummary | null` — first queued/in_progress, else `runs[0]` or null
  - `stepProgress(detail: RunDetail | null): { done: number; total: number }` — completed-like steps / all steps across jobs
  - `statusLabel(status, conclusion): string`
  - `pollIntervalMs(spotlight: RunSummary | null): number` — `8000` if queued/in_progress else `30000`
  - `isRepoConfigured(settings): boolean` — non-empty owner+repo after trim
  - `displayTitle(settings): string` — `repo` if set else `"GitHub Actions"`

- [ ] **Step 1: Implement `githubActionsLogic.ts`** with the interfaces above. Treat a step as completed when `status === "completed"` **or** `conclusion` is non-null. Storage key: `kavibay:github-actions-widget:{instanceId}`.

- [ ] **Step 2: Write `githubActionsLogic.assert.ts`** covering normalize, pickSpotlight (in-progress wins), stepProgress, pollIntervalMs, isRepoConfigured.

- [ ] **Step 3: Verify**

```bash
npx tsx src/extensions/github-actions/githubActionsLogic.assert.ts
```

Expected: exits 0, prints ok/pass lines.

- [ ] **Step 4: Commit**

```bash
git add src/extensions/github-actions/githubActionsLogic.ts src/extensions/github-actions/githubActionsLogic.assert.ts
git commit -m "feat(github-actions): add pure settings and status helpers"
```

---

### Task 2: Rust DTOs + mapping unit tests

**Files:**
- Create: `src/tauri` module files under `src-tauri/src/github_actions/` — start with `types.rs`, `api.rs` (mapping only), `mod.rs`
- Modify: `src-tauri/src/lib.rs` — `mod github_actions;` only (commands later)

**Interfaces:**
- Consumes: GitHub JSON shapes (workflow_runs list, jobs list)
- Produces (serde, camelCase to frontend):
  - `RepoStatus { owner, repo, spotlight: Option<RunDetail>, recent: Vec<RunSummary>, fetched_at }`
  - `RunSummary`, `RunDetail`, `Job`, `Step` as in the spec
  - `fn pick_spotlight(runs: &[RunSummary]) -> Option<&RunSummary>`
  - `fn map_run_summary(raw: &Value) -> Result<RunSummary, String>` (or typed structs)
  - `fn map_jobs(raw: &Value) -> Result<Vec<Job>, String>`
  - `fn build_repo_status(owner, repo, runs, spotlight_jobs) -> RepoStatus`

- [ ] **Step 1: Add `types.rs`** with public DTOs + `#[serde(rename_all = "camelCase")]`.

- [ ] **Step 2: Add mapping helpers in `api.rs`** (no HTTP yet) + `#[cfg(test)]` fixtures for:
  - spotlight prefers `in_progress` over newer completed
  - recent truncated to 5
  - steps mapped with `number`, `name`, `status`, `conclusion`

- [ ] **Step 3: Verify**

```bash
cargo test -p kavibay_lib github_actions -- --nocapture
```

Expected: mapping tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/github_actions src-tauri/src/lib.rs
git commit -m "feat(github-actions): add Rust DTOs and run mapping tests"
```

---

### Task 3: PAT storage + token commands

**Files:**
- Create: `src-tauri/src/github_actions/secret_protect.rs` (clone `calendar/secret_protect.rs`)
- Create: `src-tauri/src/github_actions/db.rs`
- Create: `src-tauri/src/github_actions/commands.rs` (token commands only for now)
- Modify: `src-tauri/src/github_actions/mod.rs`
- Modify: `src-tauri/src/lib.rs` — register three token commands

**Interfaces:**
- Consumes: `AppHandle`, PAT string
- Produces:
  - DB path `{app_data}/github_actions.db`, table `credentials (id=1, token_protected TEXT, updated_at INTEGER)`
  - `github_actions_token_status() -> { configured: bool }`
  - `github_actions_save_token(token: String) -> ()` — trim; reject empty; protect; upsert
  - `github_actions_clear_token() -> ()`
  - Internal: `load_token(app) -> Result<Option<String>, String>`

- [ ] **Step 1: Implement secret_protect + db** (protect PAT at rest; never return plaintext to frontend).

- [ ] **Step 2: Implement + register token commands.**

- [ ] **Step 3: Verify**

```bash
cargo check -p kavibay_lib
cargo test -p kavibay_lib github_actions -- --nocapture
```

Expected: compiles; existing github_actions tests still PASS.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/github_actions src-tauri/src/lib.rs
git commit -m "feat(github-actions): store PAT with DPAPI-protected SQLite"
```

---

### Task 4: GitHub REST fetch command

**Files:**
- Modify: `src-tauri/src/github_actions/api.rs` — HTTP
- Modify: `src-tauri/src/github_actions/commands.rs` — `github_actions_fetch_repo_status`
- Modify: `src-tauri/src/lib.rs` — register fetch command

**Interfaces:**
- Consumes: stored PAT; `owner: String`, `repo: String`
- Produces:
  - `github_actions_fetch_repo_status(owner, repo) -> Result<RepoStatus, String>`
  - HTTP:
    - `GET https://api.github.com/repos/{owner}/{repo}/actions/runs?per_page=10`
    - Headers: `Authorization: Bearer {token}`, `Accept: application/vnd.github+json`, `User-Agent: kavibay-github-actions`, `X-GitHub-Api-Version: 2022-11-28`
    - Spotlight jobs: `GET .../actions/runs/{id}/jobs?per_page=100`
  - Error strings (stable prefixes for UI):
    - `unauthorized` — 401
    - `forbidden` — 403
    - `not_found` — 404
    - `rate_limited` — 429
    - `no_token` — PAT missing
    - `jobs_failed:...` — runs ok but jobs fetch failed (still return status with `spotlight.jobs = []` **or** Err only for hard failures — prefer: return `RepoStatus` with empty jobs + let command succeed; surface jobs error via optional field **Skip optional field for V1**: on jobs failure, return spotlight as `RunDetail` with `jobs: []` and do not fail the whole command)
  - If no PAT: `Err("no_token")`
  - If runs list empty: `spotlight: null`, `recent: []`

- [ ] **Step 1: Implement HTTP client helpers** using `reqwest` (blocking or async matching tado/stocks neighbors — prefer the same style as `tado/api.rs` / `stocks`).

- [ ] **Step 2: Wire `github_actions_fetch_repo_status`** and register it.

- [ ] **Step 3: Verify**

```bash
cargo check -p kavibay_lib
cargo test -p kavibay_lib github_actions -- --nocapture
```

Expected: compiles; unit tests PASS (no live GitHub in CI).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/github_actions src-tauri/src/lib.rs
git commit -m "feat(github-actions): fetch repo workflow status via REST"
```

---

### Task 5: Settings panel for PAT

**Files:**
- Create: `src/settings/GithubActionsPanel.vue`
- Modify: `src/settings/SettingsModal.vue` — add section id `github-actions`, nav button, panel branch

**Interfaces:**
- Consumes: `github_actions_token_status`, `github_actions_save_token`, `github_actions_clear_token`
- Produces: Settings UI clone of `CloudflareAiPanel.vue` (single token field; no account id)
- Copy must mention scopes: classic `repo` (or public+Actions read); fine-grained Actions **Read** on selected repos
- Never echo saved token; clear input after save

- [ ] **Step 1: Add `GithubActionsPanel.vue`.**

- [ ] **Step 2: Wire into `SettingsModal.vue`** next to Tado / Cloudflare (Integrations-style placement).

- [ ] **Step 3: Verify**

```bash
npx vue-tsc --noEmit
```

Expected: no new errors in the touched settings files.

- [ ] **Step 4: Commit**

```bash
git add src/settings/GithubActionsPanel.vue src/settings/SettingsModal.vue
git commit -m "feat(github-actions): add Settings panel for PAT"
```

---

### Task 6: Extension scaffold (manifest, settings, lifecycle)

**Files:**
- Create: `src/extensions/github-actions/manifest.json`
- Create: `src/extensions/github-actions/index.ts`
- Create: `src/extensions/github-actions/useGithubActionsSettings.ts`
- Create: `src/extensions/github-actions/GithubActionsSettings.vue`
- Create: `src/extensions/github-actions/GithubActionsWidget.vue` — **stub** (states shell only: no PAT / no repo / placeholder) so the extension loads

**Interfaces:**
- Consumes: Task 1 helpers + Task 5 status command
- Produces:
  - manifest: id `github-actions`, commands listed, `allowDuplicate: true` via `ui.allowDuplicate` if used by peers — match `stocks`/`tado` manifest shape
  - `useGithubActionsSettings` — same API shape as `useWeatherSettings` (`settings`, `update`, `dispose`, `seed`, `clear`)
  - Settings popover: owner + repo text fields, live-apply
  - `index.ts`: `onDuplicate` seeds settings; `onDispose` clears; `onSuspend`/`onResume` will stop/start poll in Task 7 (export suspend flag helpers now if needed)

- [ ] **Step 1: Create manifest + settings composable + settings Vue.**

- [ ] **Step 2: Create stub widget** that injects `widgetInstanceId`, shows gate copy for missing PAT/repo, title from `displayTitle`.

- [ ] **Step 3: Wire `index.ts` lifecycle.**

- [ ] **Step 4: Verify**

```bash
npx vue-tsc --noEmit
```

Expected: extension typechecks; palette can discover it after app reload (manual smoke later).

- [ ] **Step 5: Commit**

```bash
git add src/extensions/github-actions
git commit -m "feat(github-actions): scaffold extension settings and stub widget"
```

---

### Task 7: Widget UI + adaptive polling + open run

**Files:**
- Modify: `src/extensions/github-actions/GithubActionsWidget.vue`
- Modify: `src/extensions/github-actions/index.ts` — suspend/resume hooks for poll
- Possibly small helpers in `githubActionsLogic.ts` if relative-time formatting is pure

**Interfaces:**
- Consumes: `github_actions_token_status`, `github_actions_fetch_repo_status`, `launch_path` (open `htmlUrl`)
- Produces full tile per spec:
  - Spotlight: status pill, workflow name, branch, relative time, progress bar (`stepProgress`), jobs + steps (expand steps for active or failed job)
  - Recent: up to 5 rows; click → `invoke("launch_path", { path: htmlUrl })`
  - Keep last good `RepoStatus` on transient errors; map error prefixes to UI hints (`unauthorized` → Settings CTA; `rate_limited` → back off to 60s until success; `forbidden`/`not_found` → repo message)
  - Poll loop with `pollIntervalMs`; clear timer on unmount / suspend; restart on resume
  - Light CSS pulse on in-progress step only

- [ ] **Step 1: Implement fetch + poll lifecycle** in the widget (or a tiny `useGithubActionsStatus(instanceId)` composable colocated in the extension folder if the widget file gets heavy — optional).

- [ ] **Step 2: Implement spotlight + recent UI** matching Stocks density / dark glass.

- [ ] **Step 3: Verify**

```bash
npx vue-tsc --noEmit
npx tsx src/extensions/github-actions/githubActionsLogic.assert.ts
cargo test -p kavibay_lib github_actions -- --nocapture
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/extensions/github-actions
git commit -m "feat(github-actions): live spotlight run with job and step progress"
```

---

## Manual UI checklist

- [ ] Settings → GitHub Actions: save PAT → status configured; clear → not configured; token field empty after save
- [ ] Palette: add **GitHub Actions**; duplicate instance copies owner/repo only
- [ ] Without PAT: widget shows Settings CTA
- [ ] With PAT, empty repo: prompt for owner/repo in gear
- [ ] Bind a public repo with runs: spotlight + recent populate
- [ ] Bind a private repo the PAT can read: same
- [ ] While a workflow is running: steps advance; poll feels ~8s
- [ ] After completion: poll slows; success/failure pill correct
- [ ] Click spotlight/recent opens the run in the browser
- [ ] Bad PAT: `unauthorized` UI; PAT still present until user clears
- [ ] Wrong repo / no access: forbidden/not_found message; PAT kept
- [ ] Suspend/hide cockpit: polling stops; resume refreshes
- [ ] Remove widget: localStorage key cleared

## Self-review (plan vs spec)

| Spec item | Task |
|-----------|------|
| PAT in Rust + Settings panel | 3, 5 |
| Per-instance owner/repo | 1, 6 |
| Spotlight + jobs/steps + recent 5 | 2, 4, 7 |
| Adaptive poll + suspend | 1 (`pollIntervalMs`), 7 |
| Error matrix (401/403/404/429/keep last good) | 4, 7 |
| Open `html_url` | 7 (`launch_path`) |
| No OAuth / GraphQL / notifications | Out of scope — not planned |
| Assert + cargo mapping tests | 1, 2 |

No intentional placeholders; types use camelCase end-to-end via serde rename.
