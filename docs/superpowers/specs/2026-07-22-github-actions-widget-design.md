# GitHub Actions Widget — Design

**Date:** 2026-07-22  
**Status:** Approved for implementation planning  
**Approach:** Rust PAT store + GitHub REST polling (approach 1)  
**Tier:** L (credentials DB + Rust HTTP)

## Goal

Add a first-party **GitHub Actions** extension: each widget instance binds to one `owner/repo` and shows the **active (or latest) workflow run** with **job + step progress**, plus a short list of recent runs. Auth is a personal access token (PAT) stored only in Rust.

## Decisions

| Topic | Choice |
|-------|--------|
| Binding | One repo per widget instance |
| Auth | App-global PAT (paste in Settings); OAuth later |
| API | GitHub REST (`api.github.com`); GraphQL later if needed |
| Spotlight | Prefer `in_progress` / `queued` run; else newest completed |
| Progress | Jobs + steps for the spotlight run; optional derived steps bar |
| Token / secrets | SQLite in Tauri app data + OS secret protect (same pattern as calendar); all HTTP in Rust |
| Host | Generic only — no `typeId` switches |

## Requirements

### Behavior

- Extension id `github-actions`, catalog name “GitHub Actions”, category `information`
- `allowDuplicate: true` — one instance per repo (or multiple watches of the same repo if the user wants)
- Per-instance settings: `{ owner: string, repo: string }`
- PAT is **app-global** (shared by all instances)
- Settings panel: save / clear PAT; status never echoes the token
- Widget CTA when no PAT: point user to Settings
- Poll while mounted:
  - ~30s when spotlight is idle / completed
  - ~5–10s when spotlight is `queued` or `in_progress`
- Pause polling on `onSuspend`, resume on `onResume`
- No background poll when widget unmounted
- Click run (spotlight or recent row) → open `html_url` in the system browser
- Document required token scopes in Settings copy:
  - Classic: `repo` (private) or sufficient public + Actions read
  - Fine-grained: Actions **Read** on the selected repositories

### Visual

- Compact dark-glass tile (~280–320px wide), family of Stocks / Notes overlays — not a dashboard
- Title: repo short name (fall back to `owner/repo` when ambiguous)
- Settings gear: `owner`, `repo` fields
- **Spotlight (top):**
  - Status pill (queued / in progress / success / failure / cancelled / …)
  - Workflow name · branch · relative time
  - Job list; for the active or failed job, show step rows with status
  - Optional thin derived progress: completed steps / total steps (no fake precision beyond that)
- **Recent (below):** ~5 rows — status icon · workflow · branch · age
- Light motion only: pulse/spinner on the active in-progress step

### States

| State | UI |
|-------|-----|
| No PAT | Short message + “Add token in Settings” |
| No repo | Prompt for owner/repo (gear or inline) |
| Loading | Compact placeholder on first fetch |
| Refresh error | Keep last good snapshot; subtle error hint |
| Rate limited | Keep last good; “rate limited”; back off poll |
| Repo 403/404 | “Repo unavailable or no access” (do not clear PAT) |
| 401 / bad PAT | Treat as disconnected / invalid; show Settings CTA |
| No runs | “No workflow runs yet” |
| Partial (runs ok, jobs fail) | Show run summary; steps area shows error hint |

### Out of scope (V1)

- GitHub OAuth / GitHub App install flow
- Filter by workflow file, branch, or actor
- Multi-repo status board in one widget
- Log streaming / log tail
- Cancel, re-run, or approve deployments
- Desktop notifications
- GraphQL client
- Background polling while overlay hidden / widget unmounted

## Architecture

### Layers

| Layer | Responsibility |
|-------|----------------|
| Rust `github_actions` module | PAT protect/store/clear/status; REST client; map JSON → safe DTOs |
| Settings `GitHubActionsPanel` (or equivalent) | Paste / clear PAT; connected status; scope hint |
| Extension `src/extensions/github-actions/` | Tile UI, per-instance repo settings, invoke + poll |
| Host | Unchanged generics (`addWidget`, settings popover, suspend/resume) |

### Auth flow

1. User creates a PAT with Actions read (and repo access as needed).
2. Settings → paste token → `github_actions_save_token` → Rust protects and stores in SQLite.
3. `github_actions_token_status` returns `{ configured: bool }` (never the secret).
4. Clear via `github_actions_clear_token`.
5. On 401 from GitHub: do **not** auto-delete the PAT; return a distinct auth-error so Settings and the widget show “token invalid” + clear/re-save CTA. User clears or replaces the token explicitly.

### Data flow (mounted widget)

1. Read per-instance `{ owner, repo }`.
2. Invoke `github_actions_fetch_repo_status(owner, repo)`.
3. Rust (with stored PAT):
   - `GET /repos/{owner}/{repo}/actions/runs?per_page=10`
   - Pick spotlight: first run in that list with `status` in `queued` | `in_progress`, else the newest run (list order / `updated_at`)
   - `recent` in the DTO is the first **5** runs from that list (may include the spotlight)
   - `GET .../actions/runs/{run_id}/jobs` (include steps) for the spotlight run only
   - Build DTO and return
4. UI renders spotlight + recent; schedule next poll based on spotlight status.
5. User click → open run `html_url`.

### Tauri commands (V1)

| Command | Purpose |
|---------|---------|
| `github_actions_token_status` | `{ configured: bool }` |
| `github_actions_save_token` | Persist PAT (protected) |
| `github_actions_clear_token` | Remove PAT |
| `github_actions_fetch_repo_status` | Snapshot DTO for `owner`/`repo` |

Declare command names on the extension manifest `commands` array.

### DTO (Rust → UI)

Conceptual TypeScript shape (implement as serde types in Rust + matching TS types in `*Logic.ts`):

```ts
type RepoStatus = {
  owner: string;
  repo: string;
  spotlight: RunDetail | null;
  recent: RunSummary[];
  fetchedAt: string; // ISO
};

type RunSummary = {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  branch: string;
  event: string;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
};

type RunDetail = RunSummary & {
  jobs: Job[];
};

type Job = {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  steps: Step[];
};

type Step = {
  name: string;
  status: string;
  conclusion: string | null;
  number: number;
};
```

Status/conclusion strings are GitHub’s; UI maps to pills/icons. Derived progress = completed steps / total steps across **all jobs** on the spotlight run (count every step GitHub returns).

### Extension files (expected)

```
src/extensions/github-actions/
  manifest.json
  index.ts
  GithubActionsWidget.vue
  GithubActionsSettings.vue
  githubActionsLogic.ts
  useGithubActionsState.ts   # or settings composable — match neighbors
```

Plus Rust module under `src-tauri/src/github_actions/` (db, api, commands, types) registered in `lib.rs`.

### Persistence

- PAT: Rust SQLite only (protected at rest on Windows via DPAPI-style helper, same idea as calendar)
- Per-instance repo: `localStorage` key `kavibay:github-actions-widget:{instanceId}` (or project convention)
- Duplicate: copy `owner`/`repo`; do not copy transient fetch cache

## Error handling

| Case | Behavior |
|------|----------|
| Missing PAT | Gate UI; no GitHub calls |
| 401 | Invalid invalid; Settings CTA; keep last good on screen if any |
| 403 / 404 repo | Message; do not clear PAT |
| 429 rate limit | Keep last good; hint; increase poll interval |
| Network / 5xx | Keep last good; subtle error |
| Jobs/steps fetch fails | Show `RunSummary` level; steps panel error |

## Testing

- Pure TS: normalize settings, spotlight selection helper (if extracted), status → label mapping — Node assert script
- Rust: map fixture JSON → DTO (unit tests); no live GitHub in CI
- Manual: save/clear PAT; public + private repo; watch a live run’s steps advance; error keep-last-good; suspend/resume stops/starts polling

## Future (not V1)

- OAuth device/app flow
- Workflow / branch filters
- Multi-repo board
- Notifications on failure
- GraphQL batching
- Re-run / cancel actions

## Reference extensions

- Credentials + Rust HTTP: `tado`, `calendar`
- Polling backend widget patterns: `system-info`, `stocks`
- Settings + localStorage: `weather`, `clock`
