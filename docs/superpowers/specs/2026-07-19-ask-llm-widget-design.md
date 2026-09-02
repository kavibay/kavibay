# Ask LLM Widget + Cloudflare Workers AI — Design

**Date:** 2026-07-19  
**Status:** Approved for implementation planning  
**Approach:** Cloudflare-only, Tado-mirrored (Rust credentials + streaming via Tauri events; per-instance chat in localStorage)

## Goal

Add a first-party **Ask LLM** widget: chat history, text input, send control, and a per-instance system prompt so users can run different use cases (e.g. grammar correction, typo fixes) as separate widget instances. Global Cloudflare Workers AI credentials live in Settings under **Integrations → LLM → Cloudflare**, persisted like Tado (Rust SQLite). Default model is `@cf/meta/llama-3.2-1b-instruct`; model name is editable in widget settings.

## Decisions

| Topic | Choice |
|-------|--------|
| Use cases | Multiple widget instances; each has its own system prompt |
| Chat history | Persist per instance; Clear control in widget header |
| API / secrets | Rust backend; Account ID + API token in SQLite; never in Vue localStorage |
| Responses | Streaming (SSE from Workers AI → Tauri events → UI) |
| Context to model | System prompt + full chat history |
| Settings nav | Nested Integrations: LLM → Cloudflare, and Tado as sibling |
| Provider scope | Cloudflare Workers AI only in V1 (no multi-provider abstraction) |

## Requirements

### Behavior

- Extension id `ask-llm`, catalog name “Ask LLM”, category productivity
- `allowDuplicate: true` — one instance per use case / system prompt
- Per-instance settings + history in localStorage key `kavibay:ask-llm:{instanceId}`:
  - `systemPrompt: string`
  - `model: string` (default `@cf/meta/llama-3.2-1b-instruct`)
  - `messages: { role: "user" | "assistant"; content: string }[]`
- Account credentials are **app-global** (not per widget)
- Send builds messages as: optional system message (if system prompt non-empty) + full persisted history including the new user turn
- Enter sends; Shift+Enter inserts newline
- While a request is in flight for an instance: disable send; append streaming text to the assistant bubble
- **Clear** in the widget header clears that instance’s `messages` (keeps system prompt + model)
- On dispose: clear localStorage for that instance (same pattern as other extensions)
- On duplicate: seed settings (system prompt + model); do **not** copy chat history

### Visual (widget)

- Layout B: classic chat with Clear in the header row
- Message list (user / assistant bubbles), auto-scroll during stream and after send
- Bottom row: multiline-capable input + send icon button
- Empty / misconfigured states:
  - No Cloudflare credentials → short message + hint to open Settings → Integrations → LLM → Cloudflare
  - Empty history → minimal empty hint
- Streaming: assistant bubble grows as chunks arrive

### Widget settings popover

- System prompt (textarea)
- Model name (text field; default `@cf/meta/llama-3.2-1b-instruct`)

### Settings modal

Restructure left nav:

- Appearance
- Behavior
- **Integrations**
  - **LLM**
    - **Cloudflare** — Account ID, API Token (masked), Save, Clear, status (`configured` / not)
  - **Tado** — existing Tado panel moved under Integrations (behavior unchanged)

### States

| State | UI |
|-------|-----|
| Not configured | Widget shows connect/configure CTA; Settings status “not configured” |
| Configured, idle | Chat works when system prompt optional; send allowed |
| Streaming | Assistant bubble updates; send disabled for that instance |
| API / network error | `llm:error` → show error inline (e.g. replace/fail the in-progress assistant turn); re-enable send |
| Cleared history | Empty message list; prompt/model unchanged |

### Out of scope (V1)

- Multi-provider LLM abstraction (OpenAI, Anthropic, etc.)
- Cancel in-flight stream (nice-to-have later)
- Tool calling / structured output
- Encrypted-at-rest vault beyond OS user profile permissions on the SQLite file
- Sharing chat history across instances
- Token usage metering UI

## Architecture

### Layers

| Layer | Responsibility |
|-------|----------------|
| Rust `cloudflare_ai` module | Credential SQLite, Workers AI HTTP + SSE parse, emit stream events |
| Settings `CloudflareAiPanel` | Save / clear / status for Account ID + API token |
| Settings modal nav | Nested Integrations → LLM → Cloudflare; Tado under Integrations |
| Extension `src/extensions/ask-llm/` | Chat UI, Clear, per-instance settings, listen for stream events |

### Credential store (SQLite)

Path: `{app_data_dir}/cloudflare_ai.db` (Tauri `path().app_data_dir()`).

**Table `credentials`** (single-row store):

| Column | Notes |
|--------|--------|
| `id` | Constant `1` |
| `account_id` | Cloudflare Account ID |
| `api_token` | API token (Bearer); never returned to frontend after save |
| `updated_at` | Unix seconds |

### Workers AI call

- Endpoint:  
  `POST https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/{model}`  
  with `Authorization: Bearer {api_token}`
- Body: `{ "messages": [...], "stream": true }`
- Default model: `@cf/meta/llama-3.2-1b-instruct` (URL-encode model path segments as required)
- Parse SSE / stream chunks; emit text deltas to the frontend

Reference: [llama-3.2-1b-instruct](https://developers.cloudflare.com/workers-ai/models/llama-3.2-1b-instruct/)

### Tauri commands

> Superseded: the `cloudflare_ai_*` credential commands moved to the generic
> credential layer, and `cloudflare_ai_chat_stream` / `_cancel` became
> provider-neutral `llm_chat_stream` / `llm_chat_cancel` (extra `provider`
> argument) when One-purpose LLM added Anthropic and OpenAI. Stream events are
> unchanged.

| Command | Purpose |
|---------|---------|
| `cloudflare_ai_save_credentials` | Persist account ID + API token |
| `cloudflare_ai_clear_credentials` | Delete stored credentials |
| `cloudflare_ai_status` | `{ configured: bool }` only (no token leakage) |
| `cloudflare_ai_chat_stream` | Start stream for `{ instanceId, requestId, model, messages }` (`requestId` from frontend) |

### Stream events

Scoped by `instanceId` + `requestId` so concurrent widgets do not cross-talk:

| Event | Payload |
|-------|---------|
| `llm:chunk` | `{ instanceId, requestId, text }` |
| `llm:done` | `{ instanceId, requestId }` |
| `llm:error` | `{ instanceId, requestId, message }` |

Frontend: on send, create `requestId`, append user message + empty assistant message, invoke `cloudflare_ai_chat_stream`, listen until `done`/`error` for that `requestId`, then persist messages to localStorage.

### Data flow

```
Settings → save credentials → SQLite
Ask LLM Send → invoke cloudflare_ai_chat_stream
  → Rust loads creds → POST Workers AI (stream)
  → emit llm:chunk / llm:done / llm:error
  → widget updates assistant bubble → persist messages
```

## Testing

- Credentials: save → status configured; clear → not configured; status never includes token
- Widget: send with stubbed/mocked stream events appends assistant text; Clear empties history only
- Isolation: two instances with different system prompts; events for instance A do not mutate B
- Missing creds: invoke returns clear error; widget shows Settings CTA
- Dispose removes `kavibay:ask-llm:{instanceId}`

## File touch list (expected)

- `src-tauri/src/cloudflare_ai/` (new: db, api/stream, commands)
- `src-tauri/src/lib.rs` — register commands
- `src/settings/SettingsModal.vue` — Integrations nav + panels
- `src/settings/CloudflareAiPanel.vue` (new)
- `src/settings/TadoPanel.vue` — nav placement only (move under Integrations)
- `src/extensions/ask-llm/` (new: manifest, widget, settings, logic, composables)
