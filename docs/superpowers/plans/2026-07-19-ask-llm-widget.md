# Ask LLM Widget + Cloudflare Workers AI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Ask LLM chat widget (per-instance system prompt + persisted history) backed by Cloudflare Workers AI, with Account ID / API token stored in Rust SQLite and Settings under Integrations → LLM → Cloudflare.

**Architecture:** Rust `cloudflare_ai` module owns credentials and streaming HTTP to Workers AI, emitting `llm:chunk` / `llm:done` / `llm:error` events. Vue extension owns chat UI, Clear, and localStorage for system prompt / model / messages. Settings modal gains nested Integrations navigation; Tado moves under Integrations as a sibling of LLM.

**Tech Stack:** Vue 3 + TypeScript, Vite, Tauri 2, `reqwest` (json + stream), `futures-util`, `rusqlite` (bundled), existing `serde` / `serde_json`.

## Global Constraints

- Extension id `ask-llm`, catalog name **Ask LLM**, category `productivity`
- `allowDuplicate: true`; duplicate copies system prompt + model, **not** chat history
- Default model `@cf/meta/llama-3.2-1b-instruct`; editable per instance
- Full chat history + optional system prompt sent to the model
- Streaming via SSE (`data: {"response":"…"}` / `data: [DONE]`)
- Credentials in `{app_data_dir}/cloudflare_ai.db`; never return API token to frontend
- Layout B: chat + Clear in header; Enter send, Shift+Enter newline
- Settings nav: Integrations → LLM → Cloudflare; Integrations → Tado
- No Vitest — verify with Node assert scripts, `npx vue-tsc --noEmit`, `cargo test -p kavibay_lib`, `cargo check -p kavibay_lib`, manual UI
- Spec: `docs/superpowers/specs/2026-07-19-ask-llm-widget-design.md`

## File Structure

| File | Responsibility |
|------|----------------|
| `src/extensions/ask-llm/askLlmLogic.ts` | Types, defaults, localStorage, message builders |
| `src/extensions/ask-llm/useAskLlmSettings.ts` | Per-instance reactive settings + history cache |
| `src/extensions/ask-llm/AskLlmWidget.vue` | Chat UI, Clear, send, stream listeners |
| `src/extensions/ask-llm/AskLlmSettings.vue` | System prompt + model fields |
| `src/extensions/ask-llm/manifest.json` | Catalog metadata + declared commands |
| `src/extensions/ask-llm/index.ts` | Extension module + lifecycle |
| `src/settings/CloudflareAiPanel.vue` | Save / clear / status for Cloudflare creds |
| `src/settings/SettingsModal.vue` | Nested Integrations nav |
| `src-tauri/src/cloudflare_ai/mod.rs` | Module root + re-exports |
| `src-tauri/src/cloudflare_ai/db.rs` | SQLite credentials CRUD |
| `src-tauri/src/cloudflare_ai/sse.rs` | Pure SSE line parser (unit-tested) |
| `src-tauri/src/cloudflare_ai/api.rs` | Workers AI streaming HTTP |
| `src-tauri/src/cloudflare_ai/commands.rs` | Tauri commands |
| `src-tauri/src/lib.rs` | `mod cloudflare_ai`; register commands |
| `src-tauri/Cargo.toml` | Add `stream` to reqwest; add `futures-util` |

---

### Task 1: Pure frontend helpers (`askLlmLogic`)

**Files:**
- Create: `src/extensions/ask-llm/askLlmLogic.ts`
- Test: inline Node assert script (no test file)

**Interfaces:**
- Consumes: nothing
- Produces:
  - `export type AskLlmRole = "user" | "assistant"`
  - `export interface AskLlmMessage { role: AskLlmRole; content: string }`
  - `export interface AskLlmSettings { systemPrompt: string; model: string; messages: AskLlmMessage[] }`
  - `export const DEFAULT_ASK_LLM_MODEL = "@cf/meta/llama-3.2-1b-instruct"`
  - `export const DEFAULT_ASK_LLM_SETTINGS: AskLlmSettings`
  - `askLlmStorageKey`, `normalizeAskLlmSettings`, `load/save/clearAskLlmSettings`
  - `buildApiMessages(settings, userText): { role: string; content: string }[]`
  - `settingsForDuplicate(source: AskLlmSettings): AskLlmSettings` — copies prompt/model, empty messages

- [ ] **Step 1: Create `src/extensions/ask-llm/askLlmLogic.ts`**

```ts
/**
 * Ask LLM: per-instance settings, chat history, API message assembly.
 * Cloudflare credentials stay in Rust SQLite — never here.
 */

export type AskLlmRole = "user" | "assistant";

export interface AskLlmMessage {
  role: AskLlmRole;
  content: string;
}

export interface AskLlmSettings {
  systemPrompt: string;
  model: string;
  messages: AskLlmMessage[];
}

export const DEFAULT_ASK_LLM_MODEL = "@cf/meta/llama-3.2-1b-instruct";

export const DEFAULT_ASK_LLM_SETTINGS: AskLlmSettings = {
  systemPrompt: "",
  model: DEFAULT_ASK_LLM_MODEL,
  messages: [],
};

/** Per-instance localStorage key. */
export function askLlmStorageKey(instanceId: string): string {
  return `kavibay:ask-llm:${instanceId}`;
}

function normalizeMessage(raw: unknown): AskLlmMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.role !== "user" && o.role !== "assistant") return null;
  if (typeof o.content !== "string") return null;
  return { role: o.role, content: o.content };
}

/** Normalize raw settings from localStorage or partial updates. */
export function normalizeAskLlmSettings(raw: unknown): AskLlmSettings {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const systemPrompt = typeof o.systemPrompt === "string" ? o.systemPrompt : "";
  const model =
    typeof o.model === "string" && o.model.trim()
      ? o.model.trim()
      : DEFAULT_ASK_LLM_MODEL;
  const messages = Array.isArray(o.messages)
    ? o.messages.map(normalizeMessage).filter((m): m is AskLlmMessage => m !== null)
    : [];
  return { systemPrompt, model, messages };
}

export function loadAskLlmSettings(instanceId: string): AskLlmSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(askLlmStorageKey(instanceId)) ?? "null");
    return normalizeAskLlmSettings(raw);
  } catch {
    return { ...DEFAULT_ASK_LLM_SETTINGS, messages: [] };
  }
}

export function saveAskLlmSettings(instanceId: string, settings: AskLlmSettings): void {
  localStorage.setItem(
    askLlmStorageKey(instanceId),
    JSON.stringify(normalizeAskLlmSettings(settings)),
  );
}

export function clearAskLlmSettings(instanceId: string): void {
  localStorage.removeItem(askLlmStorageKey(instanceId));
}

/**
 * Duplicate keeps prompt/model; chat history starts empty.
 */
export function settingsForDuplicate(source: AskLlmSettings): AskLlmSettings {
  const n = normalizeAskLlmSettings(source);
  return { systemPrompt: n.systemPrompt, model: n.model, messages: [] };
}

/**
 * Build Workers AI `messages` array: optional system + history + new user turn.
 */
export function buildApiMessages(
  settings: AskLlmSettings,
  userText: string,
): { role: string; content: string }[] {
  const out: { role: string; content: string }[] = [];
  const system = settings.systemPrompt.trim();
  if (system) out.push({ role: "system", content: system });
  for (const m of settings.messages) {
    out.push({ role: m.role, content: m.content });
  }
  out.push({ role: "user", content: userText });
  return out;
}
```

- [ ] **Step 2: Run Node assert script to verify helpers**

```bash
node --input-type=module -e "
import {
  normalizeAskLlmSettings,
  buildApiMessages,
  settingsForDuplicate,
  DEFAULT_ASK_LLM_MODEL,
  askLlmStorageKey,
} from './src/extensions/ask-llm/askLlmLogic.ts';

const n = normalizeAskLlmSettings({ systemPrompt: 'fix grammar', model: '', messages: [{ role: 'user', content: 'hi' }, { role: 'nope', content: 'x' }] });
if (n.model !== DEFAULT_ASK_LLM_MODEL) throw new Error('default model');
if (n.messages.length !== 1) throw new Error('bad message filter');
if (askLlmStorageKey('abc') !== 'kavibay:ask-llm:abc') throw new Error('key');

const api = buildApiMessages(n, 'next');
if (api[0].role !== 'system' || api[2].content !== 'next') throw new Error('buildApiMessages');

const dup = settingsForDuplicate({ ...n, messages: [{ role: 'user', content: 'hi' }] });
if (dup.messages.length !== 0 || dup.systemPrompt !== 'fix grammar') throw new Error('duplicate');
console.log('ok');
"
```

Expected: `ok` (if the project cannot import `.ts` via Node, run the same asserts after compiling with `npx tsx` if available, or paste the pure functions into a temporary `.mjs` copy for the assert — prefer `npx tsx` when present).

Alternative if Node cannot load TS directly:

```bash
npx --yes tsx -e "
import { normalizeAskLlmSettings, buildApiMessages, settingsForDuplicate, DEFAULT_ASK_LLM_MODEL, askLlmStorageKey } from './src/extensions/ask-llm/askLlmLogic.ts';
// same asserts as above
console.log('ok');
"
```

- [ ] **Step 3: Commit**

```bash
git add src/extensions/ask-llm/askLlmLogic.ts
git commit -m "feat(ask-llm): add settings and message helpers"
```

---

### Task 2: `useAskLlmSettings` composable

**Files:**
- Create: `src/extensions/ask-llm/useAskLlmSettings.ts`

**Interfaces:**
- Consumes: `askLlmLogic` helpers from Task 1
- Produces:
  - `useAskLlmSettings(instanceId)` → `{ settings, update, setMessages, clearMessages }`
  - `disposeAskLlmSettings(instanceId)`
  - `seedAskLlmSettingsFrom(fromId, toId)` — uses `settingsForDuplicate`

- [ ] **Step 1: Create `src/extensions/ask-llm/useAskLlmSettings.ts`**

```ts
import { type Ref, ref } from "vue";
import {
  type AskLlmMessage,
  type AskLlmSettings,
  loadAskLlmSettings,
  normalizeAskLlmSettings,
  saveAskLlmSettings,
  settingsForDuplicate,
} from "./askLlmLogic";

const cache = new Map<string, Ref<AskLlmSettings>>();

function ensure(instanceId: string): Ref<AskLlmSettings> {
  let existing = cache.get(instanceId);
  if (!existing) {
    existing = ref(loadAskLlmSettings(instanceId));
    cache.set(instanceId, existing);
  }
  return existing;
}

/** Per-instance Ask LLM settings shared by widget + settings popover. */
export function useAskLlmSettings(instanceId: string) {
  const settings = ensure(instanceId);

  function update(partial: Partial<Pick<AskLlmSettings, "systemPrompt" | "model">>) {
    settings.value = normalizeAskLlmSettings({ ...settings.value, ...partial });
    saveAskLlmSettings(instanceId, settings.value);
  }

  function setMessages(messages: AskLlmMessage[]) {
    settings.value = normalizeAskLlmSettings({ ...settings.value, messages });
    saveAskLlmSettings(instanceId, settings.value);
  }

  function clearMessages() {
    setMessages([]);
  }

  return { settings, update, setMessages, clearMessages };
}

export function disposeAskLlmSettings(instanceId: string): void {
  cache.delete(instanceId);
}

/** Duplicate: copy prompt/model only; empty history. */
export function seedAskLlmSettingsFrom(fromId: string, toId: string): void {
  const from = ensure(fromId);
  const seeded = settingsForDuplicate(from.value);
  cache.set(toId, ref(seeded));
  saveAskLlmSettings(toId, seeded);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/extensions/ask-llm/useAskLlmSettings.ts
git commit -m "feat(ask-llm): add per-instance settings composable"
```

---

### Task 3: Rust credentials DB

**Files:**
- Create: `src-tauri/src/cloudflare_ai/mod.rs`
- Create: `src-tauri/src/cloudflare_ai/db.rs`
- Modify: `src-tauri/src/lib.rs` — add `mod cloudflare_ai;` only (commands in Task 5)

**Interfaces:**
- Consumes: `rusqlite`, Tauri `AppHandle` path API (same as Tado)
- Produces:
  - `CredentialsRow { account_id, api_token, updated_at }`
  - `db_path`, `open_db`, `load_credentials`, `save_credentials`, `clear_credentials`

- [ ] **Step 1: Create `src-tauri/src/cloudflare_ai/db.rs`**

```rust
//! SQLite persistence for Cloudflare Workers AI credentials (single row).

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CredentialsRow {
    pub account_id: String,
    pub api_token: String,
    pub updated_at: i64,
}

/// Resolve `{app_data}/cloudflare_ai.db` and ensure parent exists.
pub fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("cloudflare_ai.db"))
}

pub fn open_db(app: &AppHandle) -> Result<Connection, String> {
    let path = db_path(app)?;
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS credentials (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          account_id TEXT NOT NULL,
          api_token TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        "#,
    )
    .map_err(|e| e.to_string())?;
    Ok(conn)
}

pub fn load_credentials(conn: &Connection) -> Result<Option<CredentialsRow>, String> {
    conn.query_row(
        "SELECT account_id, api_token, updated_at FROM credentials WHERE id = 1",
        [],
        |row| {
            Ok(CredentialsRow {
                account_id: row.get(0)?,
                api_token: row.get(1)?,
                updated_at: row.get(2)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn save_credentials(conn: &Connection, row: &CredentialsRow) -> Result<(), String> {
    conn.execute(
        r#"
        INSERT INTO credentials (id, account_id, api_token, updated_at)
        VALUES (1, ?1, ?2, ?3)
        ON CONFLICT(id) DO UPDATE SET
          account_id = excluded.account_id,
          api_token = excluded.api_token,
          updated_at = excluded.updated_at
        "#,
        params![row.account_id, row.api_token, row.updated_at],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn clear_credentials(conn: &Connection) -> Result<(), String> {
    conn.execute("DELETE FROM credentials WHERE id = 1", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn save_load_clear_roundtrip() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE credentials (
              id INTEGER PRIMARY KEY CHECK (id = 1),
              account_id TEXT NOT NULL,
              api_token TEXT NOT NULL,
              updated_at INTEGER NOT NULL
            );
            "#,
        )
        .unwrap();
        let row = CredentialsRow {
            account_id: "acc".into(),
            api_token: "tok".into(),
            updated_at: 99,
        };
        save_credentials(&conn, &row).unwrap();
        let loaded = load_credentials(&conn).unwrap().unwrap();
        assert_eq!(loaded.account_id, "acc");
        assert_eq!(loaded.api_token, "tok");
        clear_credentials(&conn).unwrap();
        assert!(load_credentials(&conn).unwrap().is_none());
    }
}
```

- [ ] **Step 2: Create `src-tauri/src/cloudflare_ai/mod.rs`**

```rust
//! Cloudflare Workers AI credentials + streaming chat.

mod db;

pub use db::*;
```

(Expand `mod` list in Task 4–5 as files are added.)

- [ ] **Step 3: Add `mod cloudflare_ai;` to `src-tauri/src/lib.rs`** (near `mod tado;`)

- [ ] **Step 4: Run DB unit test**

```bash
cd src-tauri
cargo test -p kavibay_lib cloudflare_ai::db::tests -- --nocapture
```

Expected: `save_load_clear_roundtrip` PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/cloudflare_ai/mod.rs src-tauri/src/cloudflare_ai/db.rs src-tauri/src/lib.rs
git commit -m "feat(cloudflare-ai): add credentials sqlite store"
```

---

### Task 4: Pure SSE parser

**Files:**
- Create: `src-tauri/src/cloudflare_ai/sse.rs`
- Modify: `src-tauri/src/cloudflare_ai/mod.rs` — `mod sse; pub use sse::*;` (or keep private and use from api)

**Interfaces:**
- Consumes: nothing (pure)
- Produces:
  - `pub enum SseParseItem { Text(String), Done }`
  - `pub fn push_sse_chunk(buffer: &mut String, chunk: &str) -> Vec<SseParseItem>`
  - Behavior: accumulate bytes; split on `\n`; for lines starting with `data:`, trim; if `[DONE]` → Done; else JSON-parse and take `.response` string when present

- [ ] **Step 1: Write `sse.rs` with tests first (failing compile until impl complete)**

```rust
//! Parse Cloudflare Workers AI SSE (`data: {"response":"…"}` / `data: [DONE]`).

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SseParseItem {
    Text(String),
    Done,
}

/**
 * Append a UTF-8 chunk to `buffer` and return completed SSE items.
 * Leaves an incomplete trailing line in `buffer`.
 */
pub fn push_sse_chunk(buffer: &mut String, chunk: &str) -> Vec<SseParseItem> {
    buffer.push_str(chunk);
    let mut items = Vec::new();
    while let Some(idx) = buffer.find('\n') {
        let mut line = buffer[..idx].to_string();
        buffer.drain(..=idx);
        if line.ends_with('\r') {
            line.pop();
        }
        if let Some(data) = line.strip_prefix("data:") {
            let data = data.trim();
            if data.is_empty() {
                continue;
            }
            if data == "[DONE]" {
                items.push(SseParseItem::Done);
                continue;
            }
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
                if let Some(text) = v.get("response").and_then(|r| r.as_str()) {
                    if !text.is_empty() {
                        items.push(SseParseItem::Text(text.to_string()));
                    }
                }
            }
        }
    }
    items
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_lines_across_chunk_boundaries() {
        let mut buf = String::new();
        let first = push_sse_chunk(&mut buf, "data: {\"response\":\"Hi\"}\n");
        assert_eq!(first, vec![SseParseItem::Text("Hi".into())]);

        let mut buf2 = String::new();
        assert!(push_sse_chunk(&mut buf2, "data: {\"respon").is_empty());
        let rest = push_sse_chunk(&mut buf2, "se\":\"there\"}\ndata: [DONE]\n");
        assert_eq!(
            rest,
            vec![
                SseParseItem::Text("there".into()),
                SseParseItem::Done
            ]
        );
    }
}
```

- [ ] **Step 2: Wire `mod sse;` in `mod.rs`**

- [ ] **Step 3: Run tests**

```bash
cd src-tauri
cargo test -p kavibay_lib cloudflare_ai::sse::tests -- --nocapture
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/cloudflare_ai/sse.rs src-tauri/src/cloudflare_ai/mod.rs
git commit -m "feat(cloudflare-ai): add workers ai sse parser"
```

---

### Task 5: Rust streaming API + Tauri commands

**Files:**
- Create: `src-tauri/src/cloudflare_ai/api.rs`
- Create: `src-tauri/src/cloudflare_ai/commands.rs`
- Modify: `src-tauri/src/cloudflare_ai/mod.rs`
- Modify: `src-tauri/src/lib.rs` — register four commands
- Modify: `src-tauri/Cargo.toml` — reqwest `stream` feature + `futures-util`

**Interfaces:**
- Consumes: `db`, `sse`, `reqwest`, `AppHandle` emit
- Produces commands:
  - `cloudflare_ai_save_credentials(account_id, api_token)`
  - `cloudflare_ai_clear_credentials()`
  - `cloudflare_ai_status() -> { configured: bool }`
  - `cloudflare_ai_chat_stream(instance_id, request_id, model, messages)` — async; emits events
- Events:
  - `llm:chunk` `{ instanceId, requestId, text }`
  - `llm:done` `{ instanceId, requestId }`
  - `llm:error` `{ instanceId, requestId, message }`
- Serde: frontend camelCase via `#[serde(rename_all = "camelCase")]` on event payloads and command args

- [ ] **Step 1: Update `src-tauri/Cargo.toml`**

Change reqwest features to include `stream`:

```toml
reqwest = { version = "0.12", default-features = false, features = ["rustls-tls", "gzip", "brotli", "json", "stream"] }
```

Add:

```toml
futures-util = "0.3"
```

- [ ] **Step 2: Create `api.rs`**

```rust
//! POST Workers AI run endpoint with stream:true and emit SSE text deltas.

use crate::cloudflare_ai::db::CredentialsRow;
use crate::cloudflare_ai::sse::{push_sse_chunk, SseParseItem};
use futures_util::StreamExt;
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LlmChunkPayload {
    instance_id: String,
    request_id: String,
    text: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LlmDonePayload {
    instance_id: String,
    request_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LlmErrorPayload {
    instance_id: String,
    request_id: String,
    message: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

/// Stream a chat completion; emits llm:* events for the given instance/request.
pub async fn stream_chat(
    app: &AppHandle,
    creds: &CredentialsRow,
    instance_id: &str,
    request_id: &str,
    model: &str,
    messages: &[ChatMessage],
) -> Result<(), String> {
    let model = model.trim();
    if model.is_empty() {
        return Err("model is empty".into());
    }
    let url = format!(
        "https://api.cloudflare.com/client/v4/accounts/{}/ai/run/{}",
        creds.account_id.trim(),
        model.trim_start_matches('/')
    );

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .bearer_auth(&creds.api_token)
        .json(&json!({ "messages": messages, "stream": true }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        let message = format!("Workers AI HTTP {status}: {body}");
        let _ = app.emit(
            "llm:error",
            LlmErrorPayload {
                instance_id: instance_id.to_string(),
                request_id: request_id.to_string(),
                message: message.clone(),
            },
        );
        return Err(message);
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    while let Some(item) = stream.next().await {
        let bytes = item.map_err(|e| e.to_string())?;
        let chunk = String::from_utf8_lossy(&bytes);
        for parsed in push_sse_chunk(&mut buffer, &chunk) {
            match parsed {
                SseParseItem::Text(text) => {
                    let _ = app.emit(
                        "llm:chunk",
                        LlmChunkPayload {
                            instance_id: instance_id.to_string(),
                            request_id: request_id.to_string(),
                            text,
                        },
                    );
                }
                SseParseItem::Done => {
                    let _ = app.emit(
                        "llm:done",
                        LlmDonePayload {
                            instance_id: instance_id.to_string(),
                            request_id: request_id.to_string(),
                        },
                    );
                    return Ok(());
                }
            }
        }
    }

    // Stream ended without [DONE] — still signal completion.
    let _ = app.emit(
        "llm:done",
        LlmDonePayload {
            instance_id: instance_id.to_string(),
            request_id: request_id.to_string(),
        },
    );
    Ok(())
}
```

- [ ] **Step 3: Create `commands.rs`**

```rust
//! Tauri commands for Cloudflare Workers AI credentials + chat streaming.

use crate::cloudflare_ai::api::{stream_chat, ChatMessage};
use crate::cloudflare_ai::db::{
    clear_credentials, load_credentials, open_db, save_credentials, CredentialsRow,
};
use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudflareAiStatus {
    pub configured: bool,
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[tauri::command]
pub fn cloudflare_ai_save_credentials(
    app: AppHandle,
    account_id: String,
    api_token: String,
) -> Result<(), String> {
    let account_id = account_id.trim().to_string();
    let api_token = api_token.trim().to_string();
    if account_id.is_empty() || api_token.is_empty() {
        return Err("Account ID and API token are required".into());
    }
    let conn = open_db(&app)?;
    save_credentials(
        &conn,
        &CredentialsRow {
            account_id,
            api_token,
            updated_at: now_secs(),
        },
    )
}

#[tauri::command]
pub fn cloudflare_ai_clear_credentials(app: AppHandle) -> Result<(), String> {
    let conn = open_db(&app)?;
    clear_credentials(&conn)
}

#[tauri::command]
pub fn cloudflare_ai_status(app: AppHandle) -> Result<CloudflareAiStatus, String> {
    let conn = open_db(&app)?;
    let configured = load_credentials(&conn)?.is_some();
    Ok(CloudflareAiStatus { configured })
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LlmErrorPayload {
    instance_id: String,
    request_id: String,
    message: String,
}

#[tauri::command]
pub async fn cloudflare_ai_chat_stream(
    app: AppHandle,
    instance_id: String,
    request_id: String,
    model: String,
    messages: Vec<ChatMessage>,
) -> Result<(), String> {
    let creds = {
        let conn = open_db(&app)?;
        load_credentials(&conn)?
    };
    let Some(creds) = creds else {
        let message = "Cloudflare AI is not configured".to_string();
        let _ = app.emit(
            "llm:error",
            LlmErrorPayload {
                instance_id: instance_id.clone(),
                request_id: request_id.clone(),
                message: message.clone(),
            },
        );
        return Err(message);
    };

    match stream_chat(&app, &creds, &instance_id, &request_id, &model, &messages).await {
        Ok(()) => Ok(()),
        Err(message) => {
            // stream_chat already emits llm:error for HTTP failures; emit for other errors too
            // only when not already emitted — simplest: always emit here for non-HTTP path.
            // To avoid double-emit on HTTP errors, change stream_chat to return a typed error,
            // OR emit only when message starts with something other than "Workers AI HTTP".
            if !message.starts_with("Workers AI HTTP") {
                let _ = app.emit(
                    "llm:error",
                    LlmErrorPayload {
                        instance_id,
                        request_id,
                        message: message.clone(),
                    },
                );
            }
            Err(message)
        }
    }
}
```

Prefer a cleaner approach in implementation: `stream_chat` returns `Result<(), String>` and **always** leaves event emission to the command for errors, emitting `llm:error` once in the command’s `Err` branch, and only emitting chunks/done from `api.rs`. Adjust `api.rs` accordingly so HTTP failures do **not** emit — the command emits once. (Avoid double `llm:error`.)

- [ ] **Step 4: Update `mod.rs`**

```rust
//! Cloudflare Workers AI credentials + streaming chat.

mod api;
mod commands;
mod db;
mod sse;

pub use commands::*;
```

- [ ] **Step 5: Register in `lib.rs`**

Add to `invoke_handler`:

```rust
            cloudflare_ai::cloudflare_ai_save_credentials,
            cloudflare_ai::cloudflare_ai_clear_credentials,
            cloudflare_ai::cloudflare_ai_status,
            cloudflare_ai::cloudflare_ai_chat_stream,
```

- [ ] **Step 6: Compile + unit tests**

```bash
cd src-tauri
cargo check -p kavibay_lib
cargo test -p kavibay_lib cloudflare_ai -- --nocapture
```

Expected: compile OK; db + sse tests PASS

- [ ] **Step 7: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/cloudflare_ai src-tauri/src/lib.rs
git commit -m "feat(cloudflare-ai): stream chat via workers ai api"
```

---

### Task 6: Settings — Integrations nav + Cloudflare panel

**Files:**
- Create: `src/settings/CloudflareAiPanel.vue`
- Modify: `src/settings/SettingsModal.vue`

**Interfaces:**
- Consumes: `invoke("cloudflare_ai_*")`
- Produces: nested nav UI; Cloudflare panel save/clear/status; Tado under Integrations

- [ ] **Step 1: Create `src/settings/CloudflareAiPanel.vue`**

```vue
<script setup lang="ts">
/**
 * Settings → Integrations → LLM → Cloudflare:
 * Account ID + API token for Workers AI (stored in Rust SQLite).
 */
import { onMounted, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";

const accountId = ref("");
const apiToken = ref("");
const configured = ref(false);
const saving = ref(false);
const clearing = ref(false);
const error = ref<string | null>(null);
const feedback = ref<string | null>(null);

async function refreshStatus() {
  const status = await invoke<{ configured: boolean }>("cloudflare_ai_status");
  configured.value = status.configured;
}

onMounted(async () => {
  try {
    await refreshStatus();
  } catch (e) {
    error.value = String(e);
  }
});

async function onSave() {
  saving.value = true;
  error.value = null;
  feedback.value = null;
  try {
    await invoke("cloudflare_ai_save_credentials", {
      accountId: accountId.value,
      apiToken: apiToken.value,
    });
    apiToken.value = "";
    feedback.value = "Saved";
    await refreshStatus();
  } catch (e) {
    error.value = String(e);
  } finally {
    saving.value = false;
  }
}

async function onClear() {
  clearing.value = true;
  error.value = null;
  feedback.value = null;
  try {
    await invoke("cloudflare_ai_clear_credentials");
    accountId.value = "";
    apiToken.value = "";
    feedback.value = "Cleared";
    await refreshStatus();
  } catch (e) {
    error.value = String(e);
  } finally {
    clearing.value = false;
  }
}
</script>

<template>
  <div class="cf-ai">
    <h2 class="cf-ai-title">Cloudflare Workers AI</h2>
    <p class="cf-ai-sub">
      Account credentials for Ask LLM widgets. The API token is stored only in the app
      database and is never shown after save.
    </p>

    <label class="cf-ai-field">
      Account ID
      <input v-model="accountId" type="text" autocomplete="off" spellcheck="false" />
    </label>

    <label class="cf-ai-field">
      API Token
      <input
        v-model="apiToken"
        type="password"
        autocomplete="off"
        spellcheck="false"
        :placeholder="configured ? '•••••••• (enter to replace)' : ''"
      />
    </label>

    <div class="cf-ai-actions">
      <button type="button" class="cf-ai-btn" :disabled="saving" @click="onSave">
        {{ saving ? "Saving…" : "Save" }}
      </button>
      <button
        type="button"
        class="cf-ai-btn cf-ai-btn--ghost"
        :disabled="clearing || !configured"
        @click="onClear"
      >
        {{ clearing ? "Clearing…" : "Clear" }}
      </button>
    </div>

    <p class="cf-ai-status">
      Status: {{ configured ? "configured" : "not configured" }}
    </p>
    <p v-if="feedback" class="cf-ai-feedback">{{ feedback }}</p>
    <p v-if="error" class="cf-ai-error">{{ error }}</p>
  </div>
</template>

<style scoped>
.cf-ai-title {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.95);
}
.cf-ai-sub {
  margin: 0 0 18px;
  font-size: 12px;
  line-height: 1.4;
  color: rgba(255, 255, 255, 0.45);
}
.cf-ai-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
}
.cf-ai-field input {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.25);
  color: rgba(255, 255, 255, 0.92);
  font-size: 13px;
}
.cf-ai-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}
.cf-ai-btn {
  padding: 8px 14px;
  border: none;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.92);
  font-size: 13px;
  cursor: pointer;
}
.cf-ai-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.cf-ai-btn--ghost {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.14);
}
.cf-ai-status {
  margin: 14px 0 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
}
.cf-ai-feedback {
  margin: 6px 0 0;
  font-size: 12px;
  color: rgba(160, 220, 180, 0.9);
}
.cf-ai-error {
  margin: 6px 0 0;
  font-size: 12px;
  color: rgba(255, 140, 140, 0.95);
}
</style>
```

**Important:** Tauri command args from the frontend use the Rust parameter names as camelCase by default in Tauri 2 (`accountId` → `account_id` if using rename). Match whatever Tado uses — check an existing `invoke` call. If Tado passes snake_case, use `account_id` / `api_token` in the invoke payload instead. Align command parameter names with the project convention (Tado uses snake_case Rust params; frontend typically passes camelCase with Tauri serde rename — verify one working invoke in `TadoAuthPanel.vue` and match it).

- [ ] **Step 2: Update `SettingsModal.vue` nav**

Replace `SectionId` and nav markup with nested Integrations:

```ts
type SectionId = "appearance" | "behavior" | "cloudflare-ai" | "tado";
```

Nav structure (aside):

```html
<div class="settings-nav-label">Settings</div>
<!-- Appearance, Behavior buttons unchanged -->

<div class="settings-nav-label settings-nav-label--spaced">Integrations</div>
<div class="settings-nav-group-label">LLM</div>
<button ... active when cloudflare-ai ... @click="setSection('cloudflare-ai')">
  Cloudflare
</button>
<button ... active when tado ... @click="setSection('tado')">
  Tado
</button>
```

Body:

```html
<AppearancePanel v-if="activeSection === 'appearance'" />
<BehaviorPanel v-else-if="activeSection === 'behavior'" />
<CloudflareAiPanel v-else-if="activeSection === 'cloudflare-ai'" />
<TadoPanel v-else-if="activeSection === 'tado'" />
```

Add CSS for nested labels:

```css
.settings-nav-label--spaced {
  margin-top: 16px;
}
.settings-nav-group-label {
  padding: 4px 10px 6px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
}
.settings-nav-item--nested {
  padding-left: 18px;
}
```

Apply `settings-nav-item--nested` to Cloudflare (under LLM). Tado can be a top-level Integrations item (not nested under LLM).

- [ ] **Step 3: Typecheck**

```bash
npx vue-tsc --noEmit
```

Expected: no errors related to new settings files

- [ ] **Step 4: Commit**

```bash
git add src/settings/CloudflareAiPanel.vue src/settings/SettingsModal.vue
git commit -m "feat(settings): add Integrations Cloudflare AI credentials"
```

---

### Task 7: Ask LLM settings popover + extension shell

**Files:**
- Create: `src/extensions/ask-llm/AskLlmSettings.vue`
- Create: `src/extensions/ask-llm/manifest.json`
- Create: `src/extensions/ask-llm/index.ts`

**Interfaces:**
- Consumes: `useAskLlmSettings`, host `widgetInstanceId`
- Produces: registered extension with settingsComponent + lifecycle

- [ ] **Step 1: `AskLlmSettings.vue`**

```vue
<script setup lang="ts">
import { inject } from "vue";
import { useAskLlmSettings } from "./useAskLlmSettings";

const instanceId = inject<string>("widgetInstanceId");
if (!instanceId) throw new Error("widgetInstanceId missing");
const { settings, update } = useAskLlmSettings(instanceId);

function onSystemPrompt(e: Event) {
  update({ systemPrompt: (e.target as HTMLTextAreaElement).value });
}

function onModel(e: Event) {
  update({ model: (e.target as HTMLInputElement).value });
}
</script>

<template>
  <div class="ask-llm-settings" @pointerdown.stop>
    <label>
      System prompt
      <textarea
        :value="settings.systemPrompt"
        rows="5"
        placeholder="e.g. Correct my grammar and fix typos. Reply with the corrected text only."
        @change="onSystemPrompt"
      />
    </label>
    <label>
      Model
      <input :value="settings.model" type="text" spellcheck="false" @change="onModel" />
    </label>
  </div>
</template>

<style scoped>
.ask-llm-settings {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 240px;
}
.ask-llm-settings label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.55);
}
.ask-llm-settings textarea,
.ask-llm-settings input {
  padding: 8px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.28);
  color: rgba(255, 255, 255, 0.92);
  font-size: 12px;
  font-family: inherit;
  resize: vertical;
}
</style>
```

(Use `@input` with debounce or `@change` — match Clock: live `@change` / immediate updates is fine; prefer `@input` for system prompt if other widgets do live-apply.)

- [ ] **Step 2: `manifest.json`**

```json
{
  "id": "ask-llm",
  "name": "Ask LLM",
  "description": "Chat with Cloudflare Workers AI using a custom system prompt.",
  "version": "1.0.0",
  "author": "kavibay",
  "keywords": ["llm", "ai", "chat", "grammar", "cloudflare"],
  "categories": ["productivity"],
  "ui": {
    "defaultOffset": { "x": 420, "y": 220 },
    "grabCursor": false,
    "allowDuplicate": true
  },
  "commands": [
    "cloudflare_ai_chat_stream",
    "cloudflare_ai_status"
  ],
  "permissions": []
}
```

- [ ] **Step 3: `index.ts`**

```ts
import type { ExtensionModule } from "../../core/extensions/types";
import AskLlmWidget from "./AskLlmWidget.vue";
import AskLlmSettings from "./AskLlmSettings.vue";
import { clearAskLlmSettings } from "./askLlmLogic";
import {
  disposeAskLlmSettings,
  seedAskLlmSettingsFrom,
} from "./useAskLlmSettings";

const extension: ExtensionModule = {
  component: AskLlmWidget,
  settingsComponent: AskLlmSettings,
  onDuplicate: (fromId, toId) => seedAskLlmSettingsFrom(fromId, toId),
  onDispose: (instanceId) => {
    disposeAskLlmSettings(instanceId);
    clearAskLlmSettings(instanceId);
  },
};

export default extension;
```

Note: `AskLlmWidget.vue` is created in Task 8 — if the build fails between tasks, create a minimal stub widget in this task:

```vue
<script setup lang="ts"></script>
<template><div class="ask-llm-stub">Ask LLM</div></template>
```

Replace fully in Task 8.

- [ ] **Step 4: Commit**

```bash
git add src/extensions/ask-llm/AskLlmSettings.vue src/extensions/ask-llm/manifest.json src/extensions/ask-llm/index.ts
git commit -m "feat(ask-llm): register extension settings shell"
```

---

### Task 8: Ask LLM chat widget (UI + streaming)

**Files:**
- Create / replace: `src/extensions/ask-llm/AskLlmWidget.vue`

**Interfaces:**
- Consumes: `useAskLlmSettings`, `buildApiMessages`, `invoke`, `listen`, `useSettingsModal`
- Produces: Layout B chat widget

- [ ] **Step 1: Implement `AskLlmWidget.vue`**

Behavior checklist (must all work):

1. Inject `widgetInstanceId`
2. On mount: `cloudflare_ai_status` → `configured` ref; listen `llm:chunk|done|error` filtered by `instanceId` + active `requestId`
3. Header: title text from layout (host shows title) **or** small label “Ask LLM” + **Clear** button calling `clearMessages()`
4. Message list: v-for `settings.messages`; user/assistant bubble styles; auto-scroll via `ref` on bottom sentinel when messages change
5. Input: textarea; Enter (without Shift) prevents default and calls `send`; Shift+Enter newline
6. Send icon button (SVG arrow) calls `send`
7. `send`:
   - no-op if streaming or empty trim
   - if `!configured`, set local error / show CTA that calls `useSettingsModal().show()`
   - `requestId = crypto.randomUUID()` (or `${Date.now()}-${Math.random()}`)
   - `apiMessages = buildApiMessages(settings.value, text)`
   - optimistically `setMessages([...messages, {role:'user', content:text}, {role:'assistant', content:''}])`
   - clear draft input; `streaming = true`
   - `await invoke('cloudflare_ai_chat_stream', { instanceId, requestId, model: settings.value.model, messages: apiMessages })`
   - on invoke throw: mark last assistant content with error text; `streaming = false`
8. On `llm:chunk` for active request: append `text` to last assistant message; `setMessages`
9. On `llm:done` / `llm:error`: `streaming = false`; on error append/set message on assistant bubble
10. Unlisten on unmount

Event payload fields: `instanceId`, `requestId`, `text` / `message` (camelCase).

Minimal structure sketch:

```vue
<script setup lang="ts">
import { computed, inject, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { buildApiMessages } from "./askLlmLogic";
import { useAskLlmSettings } from "./useAskLlmSettings";
import { useSettingsModal } from "../../settings/useSettingsModal";

const instanceId = inject<string>("widgetInstanceId");
if (!instanceId) throw new Error("widgetInstanceId missing");

const { settings, setMessages, clearMessages } = useAskLlmSettings(instanceId);
const { show: showSettings } = useSettingsModal();

const draft = ref("");
const streaming = ref(false);
const configured = ref(true);
const activeRequestId = ref<string | null>(null);
const bottomEl = ref<HTMLElement | null>(null);
const unlistens: UnlistenFn[] = [];

async function scrollToBottom() {
  await nextTick();
  bottomEl.value?.scrollIntoView({ block: "end" });
}

watch(() => settings.value.messages, () => { void scrollToBottom(); }, { deep: true });

function appendToLastAssistant(text: string) {
  const msgs = settings.value.messages.slice();
  const last = msgs[msgs.length - 1];
  if (!last || last.role !== "assistant") return;
  msgs[msgs.length - 1] = { role: "assistant", content: last.content + text };
  setMessages(msgs);
}

function failLastAssistant(message: string) {
  const msgs = settings.value.messages.slice();
  const last = msgs[msgs.length - 1];
  if (last?.role === "assistant") {
    msgs[msgs.length - 1] = {
      role: "assistant",
      content: last.content || message,
    };
    setMessages(msgs);
  }
}

async function send() {
  const text = draft.value.trim();
  if (!text || streaming.value) return;
  if (!configured.value) {
    showSettings();
    return;
  }
  const requestId = crypto.randomUUID();
  activeRequestId.value = requestId;
  const apiMessages = buildApiMessages(settings.value, text);
  setMessages([
    ...settings.value.messages,
    { role: "user", content: text },
    { role: "assistant", content: "" },
  ]);
  draft.value = "";
  streaming.value = true;
  try {
    await invoke("cloudflare_ai_chat_stream", {
      instanceId,
      requestId,
      model: settings.value.model,
      messages: apiMessages,
    });
  } catch (e) {
    failLastAssistant(String(e));
    streaming.value = false;
    activeRequestId.value = null;
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    void send();
  }
}

onMounted(async () => {
  try {
    const status = await invoke<{ configured: boolean }>("cloudflare_ai_status");
    configured.value = status.configured;
  } catch {
    configured.value = false;
  }
  unlistens.push(
    await listen<{ instanceId: string; requestId: string; text: string }>("llm:chunk", (ev) => {
      if (ev.payload.instanceId !== instanceId) return;
      if (ev.payload.requestId !== activeRequestId.value) return;
      appendToLastAssistant(ev.payload.text);
    }),
    await listen<{ instanceId: string; requestId: string }>("llm:done", (ev) => {
      if (ev.payload.instanceId !== instanceId) return;
      if (ev.payload.requestId !== activeRequestId.value) return;
      streaming.value = false;
      activeRequestId.value = null;
    }),
    await listen<{ instanceId: string; requestId: string; message: string }>("llm:error", (ev) => {
      if (ev.payload.instanceId !== instanceId) return;
      if (ev.payload.requestId !== activeRequestId.value) return;
      failLastAssistant(ev.payload.message);
      streaming.value = false;
      activeRequestId.value = null;
    }),
  );
});

onUnmounted(() => {
  for (const u of unlistens) u();
});

const empty = computed(() => settings.value.messages.length === 0);
</script>

<template>
  <div class="ask-llm" data-interactive>
    <div class="ask-llm-header">
      <span class="ask-llm-header-label">Ask LLM</span>
      <button type="button" class="ask-llm-clear" :disabled="empty || streaming" @click="clearMessages">
        Clear
      </button>
    </div>

    <div v-if="!configured" class="ask-llm-banner">
      Configure Cloudflare AI in Settings → Integrations → LLM → Cloudflare.
      <button type="button" class="ask-llm-link" @click="showSettings">Open Settings</button>
    </div>

    <div class="ask-llm-messages">
      <div v-if="empty" class="ask-llm-empty">Send a message to start.</div>
      <div
        v-for="(m, i) in settings.messages"
        :key="i"
        class="ask-llm-bubble"
        :class="m.role === 'user' ? 'ask-llm-bubble--user' : 'ask-llm-bubble--assistant'"
      >
        {{ m.content }}
      </div>
      <div ref="bottomEl" />
    </div>

    <div class="ask-llm-compose">
      <textarea
        v-model="draft"
        class="ask-llm-input"
        rows="2"
        placeholder="Message…"
        :disabled="streaming"
        @keydown="onKeydown"
      />
      <button
        type="button"
        class="ask-llm-send"
        aria-label="Send"
        :disabled="streaming || !draft.trim()"
        @click="send"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>
  </div>
</template>
```

Style to match Kavibay dark widgets (compact, ~280–320px wide, message area max-height ~220px, scroll). User bubbles right-aligned; assistant left. Do not invent a new purple glow theme — reuse existing rgba white overlays like Notes/Clipboard.

- [ ] **Step 2: Typecheck**

```bash
npx vue-tsc --noEmit
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/extensions/ask-llm/AskLlmWidget.vue src/extensions/ask-llm/index.ts
git commit -m "feat(ask-llm): add streaming chat widget ui"
```

---

### Task 9: End-to-end verification

**Files:** none (manual + compile)

- [ ] **Step 1: Full compile**

```bash
cd src-tauri
cargo test -p kavibay_lib cloudflare_ai -- --nocapture
cargo check -p kavibay_lib
cd ..
npx vue-tsc --noEmit
```

Expected: all green

- [ ] **Step 2: Manual UI checklist**

1. Open Settings → Integrations → LLM → Cloudflare; Save Account ID + API token → status configured
2. Add Ask LLM from palette; open widget settings; set system prompt e.g. “Correct grammar. Reply with corrected text only.”
3. Send a typo-laden sentence → streamed assistant reply appears; history persists after toggle window
4. Clear → messages empty; system prompt remains
5. Duplicate widget → same prompt/model, empty history
6. Clear Cloudflare credentials → widget shows configure CTA
7. Confirm Tado still opens under Integrations → Tado

- [ ] **Step 3: Final commit if polish fixes were needed**

```bash
git add -A
git commit -m "fix(ask-llm): polish after manual verification"
```

(Skip empty commit if nothing changed.)

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Multiple instances / per-instance system prompt | 1, 2, 7, 8 |
| Persist history + Clear in header | 1, 2, 8 |
| Rust credentials SQLite | 3, 5, 6 |
| Streaming Workers AI | 4, 5, 8 |
| Full history + system in API messages | 1, 8 |
| Integrations → LLM → Cloudflare + Tado | 6 |
| Model editable in widget settings | 7 |
| Default `@cf/meta/llama-3.2-1b-instruct` | 1 |
| Dispose clears localStorage | 7 |
| Duplicate without history | 1, 2, 7 |
| Status never returns token | 5, 6 |

## Placeholder / consistency notes

- Event + invoke argument casing must match Tauri’s serde convention used elsewhere in the app — verify against `TadoAuthPanel` / `clipboard` invokes before wiring Task 6–8.
- Avoid double-emitting `llm:error` (documented in Task 5).
- Cancel in-flight stream is out of scope (spec).
