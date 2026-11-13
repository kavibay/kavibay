//! This installation's agent host id for ChatGPT sign-in.
//!
//! OpenAI ties the client it registers during sign-in to the host that asked
//! (`ext_agent_host_id`), so the id is created once and kept: in the data
//! directory, not the cache, because regenerating it would look like a new
//! machine. One per installation, shared by every ChatGPT account on it.

use std::fs;

use serde_json::{json, Value};
use tauri::{AppHandle, Runtime};

const FILE_NAME: &str = "chatgpt-host.json";

/// The saved host id, created on first use.
pub fn host_id<R: Runtime>(app: &AppHandle<R>) -> Result<String, String> {
    let path = crate::paths::data_dir(app)?.join(FILE_NAME);
    if let Ok(raw) = fs::read_to_string(&path) {
        let saved = serde_json::from_str::<Value>(&raw)
            .ok()
            .and_then(|value| value["hostId"].as_str().map(str::to_string));
        if let Some(id) = saved.filter(|id| id.starts_with("urn:uuid:")) {
            return Ok(id);
        }
    }
    let mut bytes = [0u8; 16];
    rand::fill(&mut bytes);
    let id = format_uuid_v4(bytes);
    fs::write(&path, json!({ "hostId": id }).to_string())
        .map_err(|error| format!("could not save {FILE_NAME}: {error}"))?;
    Ok(id)
}

/// RFC 9562 version-4 layout of 16 random bytes, as a URN.
fn format_uuid_v4(mut bytes: [u8; 16]) -> String {
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    format!(
        "urn:uuid:{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uuid_v4_sets_version_and_variant_bits() {
        assert_eq!(
            format_uuid_v4([0; 16]),
            "urn:uuid:00000000-0000-4000-8000-000000000000"
        );
        assert_eq!(
            format_uuid_v4([0xff; 16]),
            "urn:uuid:ffffffff-ffff-4fff-bfff-ffffffffffff"
        );
    }
}
