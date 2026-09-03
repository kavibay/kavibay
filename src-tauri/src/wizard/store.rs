//! Durable storage for wizard conversations.
//!
//! Not `localStorage`. An edit turn carries the widget's entire file set, so a
//! handful of conversations blows past the browser quota — and the failure mode
//! there is a silent write rejection, which loses exactly the history someone
//! was relying on. One file per conversation under `{data_dir}/wizard/` has no
//! practical ceiling and rewrites only the conversation being touched.
//!
//! The payload is opaque here on purpose. Rust owns durability; the frontend
//! owns what a conversation *means*. Mirroring the shape in both would mean two
//! definitions to keep in step for no gain — this layer never looks inside.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

use crate::paths::data_dir;

/// Total conversations kept. Oldest are pruned on save.
const MAX_CONVERSATIONS: usize = 100;

/// One stored conversation.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredConversation {
    pub id: String,
    /// Shown in the sidebar. The frontend derives it; this layer just keeps it.
    pub title: String,
    /// Milliseconds since the epoch, for ordering the list.
    pub updated_at: i64,
    /// The frontend's session object, untouched.
    pub payload: Value,
}

/// Sidebar row: everything needed to list conversations without reading them.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationHeader {
    pub id: String,
    pub title: String,
    pub updated_at: i64,
    /// The package this conversation is about, when it has picked one.
    ///
    /// Read out of the stored payload rather than kept as a second copy: the
    /// session owns it, and a header that could disagree with the session is a
    /// sidebar row that opens a different widget than it names. `None` for a
    /// conversation that has not produced a package yet.
    pub package_id: Option<String>,
    /// The first thing the person asked in this conversation.
    ///
    /// `title` is the widget's name, which is the right label for the *project*
    /// and useless inside it: six conversations about the water tracker are six
    /// rows reading "Water Tracker". What tells them apart is what was asked,
    /// so it is read here rather than stored again — the payload is already
    /// being parsed for `package_id`, and deriving it means the conversations
    /// that exist right now get a label without being re-saved first.
    pub preview: Option<String>,
}

/// The first user line of a stored conversation, trimmed to one short line.
fn first_request(payload: &Value) -> Option<String> {
    let bubble = payload
        .get("bubbles")?
        .as_array()?
        .iter()
        .find(|bubble| bubble.get("role").and_then(Value::as_str) == Some("user"))?;
    let text = bubble.get("text").and_then(Value::as_str)?;
    let line = text.lines().find(|line| !line.trim().is_empty())?.trim();
    if line.is_empty() {
        return None;
    }
    // Character count, not bytes: a hard byte slice can land inside a multi-byte
    // character, and this text is whatever somebody typed.
    Some(match line.char_indices().nth(80) {
        Some((cut, _)) => format!("{}…", line[..cut].trim_end()),
        None => line.to_string(),
    })
}

/// `{data_dir}/wizard`
///
/// Through `paths::data_dir`, so a dev instance keeps its drafts in its own
/// profile instead of writing them into the installed one.
fn store_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = data_dir(app)?.join("wizard");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

/// True when `id` is safe as a single file name.
///
/// The id comes from the frontend and becomes a path, so it is checked here
/// rather than trusted — the same reasoning as package ids.
fn is_valid_conversation_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn path_for(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if !is_valid_conversation_id(id) {
        return Err("invalid_conversation_id".into());
    }
    Ok(store_dir(app)?.join(format!("{id}.json")))
}

/// Every conversation, newest first.
#[tauri::command]
pub fn wizard_conversations_list(app: AppHandle) -> Result<Vec<ConversationHeader>, String> {
    let dir = store_dir(&app)?;
    let Ok(entries) = fs::read_dir(&dir) else {
        return Ok(Vec::new());
    };

    let mut out: Vec<ConversationHeader> = entries
        .flatten()
        .filter_map(|entry| {
            let text = fs::read_to_string(entry.path()).ok()?;
            // A corrupt file is skipped rather than failing the whole list: one
            // bad conversation must not hide the other ninety-nine.
            let stored: StoredConversation = serde_json::from_str(&text).ok()?;
            let package_id = stored
                .payload
                .get("packageId")
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty())
                .map(str::to_string);
            let preview = first_request(&stored.payload);
            Some(ConversationHeader {
                id: stored.id,
                title: stored.title,
                updated_at: stored.updated_at,
                package_id,
                preview,
            })
        })
        .collect();

    // Newest first: the sidebar's top row should be what you were just doing.
    out.sort_by_key(|header| std::cmp::Reverse(header.updated_at));
    Ok(out)
}

/// One conversation, or `None` when it is gone.
#[tauri::command(rename_all = "camelCase")]
pub fn wizard_conversation_load(
    app: AppHandle,
    id: String,
) -> Result<Option<StoredConversation>, String> {
    let path = path_for(&app, &id)?;
    let Ok(text) = fs::read_to_string(&path) else {
        return Ok(None);
    };
    serde_json::from_str(&text)
        .map(Some)
        .map_err(|error| error.to_string())
}

/// Writes one conversation and prunes the oldest beyond the cap.
#[tauri::command(rename_all = "camelCase")]
pub fn wizard_conversation_save(
    app: AppHandle,
    conversation: StoredConversation,
) -> Result<(), String> {
    let path = path_for(&app, &conversation.id)?;
    let text = serde_json::to_string(&conversation).map_err(|error| error.to_string())?;
    fs::write(&path, text).map_err(|error| error.to_string())?;
    prune(&app, &conversation.id)
}

/// Deletes one conversation. The widgets it produced are untouched.
#[tauri::command(rename_all = "camelCase")]
pub fn wizard_conversation_delete(app: AppHandle, id: String) -> Result<(), String> {
    let path = path_for(&app, &id)?;
    if path.is_file() {
        fs::remove_file(&path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Drops the oldest conversations past `MAX_CONVERSATIONS`.
///
/// `keep` is never pruned: saving a conversation must not be able to delete the
/// one being saved, whatever the clock says.
fn prune(app: &AppHandle, keep: &str) -> Result<(), String> {
    let mut headers = wizard_conversations_list(app.clone())?;
    if headers.len() <= MAX_CONVERSATIONS {
        return Ok(());
    }
    headers.retain(|header| header.id != keep);

    for header in headers.into_iter().skip(MAX_CONVERSATIONS - 1) {
        if let Ok(path) = path_for(app, &header.id) {
            let _ = fs::remove_file(path);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The id becomes a file name, so it is checked rather than trusted.
    #[test]
    fn conversation_ids_are_safe_file_names() {
        assert!(is_valid_conversation_id("c-1"));
        assert!(is_valid_conversation_id("a_B9"));

        assert!(!is_valid_conversation_id(""));
        assert!(!is_valid_conversation_id(".."));
        assert!(!is_valid_conversation_id("a/b"));
        assert!(!is_valid_conversation_id("a\\b"));
        assert!(!is_valid_conversation_id("a.json"));
        assert!(!is_valid_conversation_id(&"x".repeat(65)));
    }

    /// Six conversations about one widget carry one title between them; what
    /// tells them apart is what was asked first.
    #[test]
    fn the_preview_is_the_first_thing_the_person_said() {
        let payload = serde_json::json!({
            "bubbles": [
                { "role": "system", "text": "Opened" },
                { "role": "user", "text": "
  make the background green
and bigger" },
                { "role": "user", "text": "later" },
            ]
        });
        assert_eq!(
            first_request(&payload).as_deref(),
            Some("make the background green"),
            "a host note is not a request, and only the first line is a label",
        );

        assert_eq!(
            first_request(&serde_json::json!({ "bubbles": [] })),
            None,
            "a conversation nobody has spoken in has nothing to show",
        );
        assert_eq!(
            first_request(&serde_json::json!({})),
            None,
            "and neither has an old payload"
        );

        // A cut that lands inside a multi-byte character panics on a byte slice,
        // and this text is whatever somebody typed.
        let long = serde_json::json!({
            "bubbles": [{ "role": "user", "text": "ä".repeat(200) }]
        });
        let cut = first_request(&long).unwrap();
        assert!(cut.ends_with('…'));
        assert_eq!(cut.chars().count(), 81);
    }
}
