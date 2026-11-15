//! Ephemeral MCP activity for the Widget Wizard.
//!
//! A tool call is observable; a model thinking between calls is not. Presence
//! therefore distinguishes an exact active request from a short, expiring
//! "recently active" lease and never persists either one to disk.

#![cfg_attr(test, allow(dead_code))]

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::runtime_extensions::drafts::McpClientKind;

pub const EVENT: &str = "runtime-draft:presence";
pub const RECENT_FOR_MS: i64 = 60_000;
/// How long an editing session survives without a tool call. A client that
/// crashes or forgets `end_editing` stops claiming the widget after this.
pub const EDITING_IDLE_MS: i64 = 5 * 60_000;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DraftPresence {
    pub id: String,
    pub client: Option<McpClientKind>,
    pub client_name: Option<String>,
    pub tool: String,
    pub active: bool,
    /// Between `begin_editing` and `end_editing`: the client said it is
    /// working on this widget, including while the model thinks between calls.
    pub editing: bool,
    pub editing_since: Option<i64>,
    /// What the client said it is about to do, from `begin_editing`.
    pub plan: Option<String>,
    pub last_seen: i64,
    pub expires_at: i64,
}

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
struct PresenceKey {
    id: String,
    client_key: String,
}

#[derive(Debug, Clone)]
struct PresenceEntry {
    id: String,
    client: Option<McpClientKind>,
    client_name: Option<String>,
    tool: String,
    active_requests: u32,
    editing_since: Option<i64>,
    plan: Option<String>,
    last_seen: i64,
    expires_at: i64,
}

impl PresenceEntry {
    fn payload(&self) -> DraftPresence {
        DraftPresence {
            id: self.id.clone(),
            client: self.client,
            client_name: self.client_name.clone(),
            tool: self.tool.clone(),
            active: self.active_requests > 0,
            editing: self.editing_since.is_some(),
            editing_since: self.editing_since,
            plan: self.plan.clone(),
            last_seen: self.last_seen,
            expires_at: self.expires_at,
        }
    }

    /// Seen now: an open session holds the widget longer than one call does.
    fn touch(&mut self, now: i64) {
        self.last_seen = now;
        self.expires_at = now
            + if self.editing_since.is_some() {
                EDITING_IDLE_MS
            } else {
                RECENT_FOR_MS
            };
    }
}

fn presence_key(id: &str, client: Option<McpClientKind>, client_name: Option<&str>) -> PresenceKey {
    PresenceKey {
        id: id.to_string(),
        client_key: client_name
            .map(str::to_string)
            .or_else(|| client.map(|known| known.label().to_string()))
            .unwrap_or_else(|| "mcp".to_string()),
    }
}

#[derive(Debug, Default)]
struct PresenceBook {
    entries: HashMap<PresenceKey, PresenceEntry>,
}

#[derive(Clone, Debug, Default)]
pub struct McpPresenceState(Arc<Mutex<PresenceBook>>);

impl McpPresenceState {
    fn start_at(
        &self,
        id: &str,
        tool: &str,
        client: Option<McpClientKind>,
        client_name: Option<&str>,
        now: i64,
    ) -> (PresenceKey, DraftPresence) {
        let key = presence_key(id, client, client_name);
        let mut book = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        book.entries
            .retain(|_, entry| entry.active_requests > 0 || entry.expires_at > now);
        let entry = book
            .entries
            .entry(key.clone())
            .or_insert_with(|| PresenceEntry {
                id: id.to_string(),
                client,
                client_name: client_name.map(str::to_string),
                tool: tool.to_string(),
                active_requests: 0,
                editing_since: None,
                plan: None,
                last_seen: now,
                expires_at: now + RECENT_FOR_MS,
            });
        entry.client = client;
        entry.client_name = client_name.map(str::to_string);
        entry.tool = tool.to_string();
        entry.active_requests = entry.active_requests.saturating_add(1);
        entry.touch(now);
        (key, entry.payload())
    }

    /// Open (or renew) an editing session for one client on one widget.
    ///
    /// Only ever called inside that client's own tool call, so `start_at` has
    /// already created the entry; a missing one means nothing to mark.
    fn begin_editing_at(
        &self,
        id: &str,
        client: Option<McpClientKind>,
        client_name: Option<&str>,
        plan: Option<String>,
        now: i64,
    ) -> bool {
        let key = presence_key(id, client, client_name);
        let mut book = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(entry) = book.entries.get_mut(&key) else {
            return false;
        };
        // A second begin renews the session and keeps when it started.
        entry.editing_since.get_or_insert(now);
        if plan.is_some() {
            entry.plan = plan;
        }
        entry.touch(now);
        true
    }

    /// Close the session; the widget then reads "active just now" for a minute.
    fn end_editing_at(
        &self,
        id: &str,
        client: Option<McpClientKind>,
        client_name: Option<&str>,
        now: i64,
    ) -> bool {
        let key = presence_key(id, client, client_name);
        let mut book = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(entry) = book.entries.get_mut(&key) else {
            return false;
        };
        let was_editing = entry.editing_since.take().is_some();
        entry.plan = None;
        entry.touch(now);
        was_editing
    }

    pub fn begin_editing(
        &self,
        id: &str,
        client: Option<McpClientKind>,
        client_name: Option<&str>,
        plan: Option<String>,
    ) -> bool {
        self.begin_editing_at(id, client, client_name, plan, now_ms())
    }

    pub fn end_editing(
        &self,
        id: &str,
        client: Option<McpClientKind>,
        client_name: Option<&str>,
    ) -> bool {
        self.end_editing_at(id, client, client_name, now_ms())
    }

    fn finish_at(&self, key: &PresenceKey, now: i64) -> Option<DraftPresence> {
        let mut book = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let entry = book.entries.get_mut(key)?;
        entry.active_requests = entry.active_requests.saturating_sub(1);
        entry.touch(now);
        Some(entry.payload())
    }

    fn list_at(&self, now: i64) -> Vec<DraftPresence> {
        let mut book = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        book.entries
            .retain(|_, entry| entry.active_requests > 0 || entry.expires_at > now);
        let mut rows = book
            .entries
            .values()
            .map(PresenceEntry::payload)
            .collect::<Vec<_>>();
        rows.sort_by(|left, right| {
            left.id
                .cmp(&right.id)
                .then_with(|| right.active.cmp(&left.active))
                .then_with(|| right.last_seen.cmp(&left.last_seen))
        });
        rows
    }

    pub fn list(&self) -> Vec<DraftPresence> {
        self.list_at(now_ms())
    }
}

pub struct PresenceGuard {
    app: AppHandle,
    state: McpPresenceState,
    key: Option<PresenceKey>,
}

impl Drop for PresenceGuard {
    fn drop(&mut self) {
        let Some(key) = self.key.take() else {
            return;
        };
        if let Some(payload) = self.state.finish_at(&key, now_ms()) {
            let _ = self.app.emit(EVENT, payload);
        }
    }
}

pub fn begin(
    app: &AppHandle,
    state: &McpPresenceState,
    id: &str,
    tool: &str,
    client: Option<McpClientKind>,
    client_name: Option<&str>,
) -> PresenceGuard {
    let (key, payload) = state.start_at(id, tool, client, client_name, now_ms());
    let _ = app.emit(EVENT, payload);
    PresenceGuard {
        app: app.clone(),
        state: state.clone(),
        key: Some(key),
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|since| since.as_millis() as i64)
        .unwrap_or(0)
}

#[tauri::command]
pub fn mcp_draft_presence(state: State<'_, McpPresenceState>) -> Vec<DraftPresence> {
    state.list()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn active_requests_are_counted_and_recent_activity_expires() {
        let state = McpPresenceState::default();
        let (key, first) = state.start_at(
            "clock",
            "read_draft",
            Some(McpClientKind::Codex),
            Some("codex-mcp-client"),
            1_000,
        );
        assert!(first.active);
        let (_, second) = state.start_at(
            "clock",
            "write_draft",
            Some(McpClientKind::Codex),
            Some("codex-mcp-client"),
            1_010,
        );
        assert!(second.active);

        assert!(state.finish_at(&key, 1_020).unwrap().active);
        let finished = state.finish_at(&key, 1_030).unwrap();
        assert!(!finished.active);
        assert_eq!(finished.tool, "write_draft");
        assert_eq!(state.list_at(1_030).len(), 1);
        assert!(state.list_at(1_030 + RECENT_FOR_MS).is_empty());
    }

    #[test]
    fn an_editing_session_outlives_its_calls_until_it_ends_or_idles_out() {
        let state = McpPresenceState::default();
        let client = Some(McpClientKind::Claude);
        let name = Some("claude-code");

        let (key, _) = state.start_at("clock", "begin_editing", client, name, 1_000);
        assert!(state.begin_editing_at("clock", client, name, Some("Bigger digits".into()), 1_000));
        let open = state.finish_at(&key, 1_010).unwrap();
        assert!(
            open.editing && !open.active,
            "thinking between calls is still editing"
        );
        assert_eq!(open.editing_since, Some(1_000));
        assert_eq!(open.plan.as_deref(), Some("Bigger digits"));
        assert_eq!(
            state.list_at(1_010 + RECENT_FOR_MS).len(),
            1,
            "a session is not dropped after the one-minute lease"
        );

        // A later call renews the session and keeps when it started.
        let (key, _) = state.start_at("clock", "edit_draft", client, name, 200_000);
        let renewed = state.finish_at(&key, 200_010).unwrap();
        assert!(renewed.editing);
        assert_eq!(renewed.editing_since, Some(1_000));

        let (key, _) = state.start_at("clock", "end_editing", client, name, 210_000);
        assert!(state.end_editing_at("clock", client, name, 210_000));
        let ended = state.finish_at(&key, 210_010).unwrap();
        assert!(!ended.editing && ended.plan.is_none());
        assert!(state.list_at(210_010 + RECENT_FOR_MS).is_empty());

        // Forgotten end: the session idles out on its own.
        let (key, _) = state.start_at("clock", "begin_editing", client, name, 300_000);
        state.begin_editing_at("clock", client, name, None, 300_000);
        state.finish_at(&key, 300_000);
        assert!(state.list_at(300_000 + EDITING_IDLE_MS).is_empty());
    }

    #[test]
    fn clients_on_the_same_widget_keep_independent_request_counts() {
        let state = McpPresenceState::default();
        let (codex, _) = state.start_at(
            "clock",
            "read_draft",
            Some(McpClientKind::Codex),
            Some("codex-mcp-client"),
            1,
        );
        let (claude, _) = state.start_at(
            "clock",
            "read_draft",
            Some(McpClientKind::Claude),
            Some("claude-code"),
            2,
        );
        assert_ne!(codex, claude);
        assert_eq!(state.list_at(2).len(), 2);
    }
}
