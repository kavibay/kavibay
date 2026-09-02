//! OAuth 2.0 device-authorization flow (RFC 8628).
//!
//! Flow: [`start`] asks the provider for a device code and returns the
//! "go to this URL and enter this code" details for the UI, then polls the
//! token endpoint in the background until the user approves (or the code
//! expires). Success runs the type's identity probe and persists tokens
//! through the same generation-guarded save the browser flow uses, so a
//! cancel/disconnect/superseding login can never be clobbered.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::credentials::db;
use crate::credentials::now_secs;
use crate::credentials::registry;
use crate::credentials::types::{AuthKind, DeviceCodeDef};

use super::{
    claim_generation_locked, client_credentials, finish_pending, http_client, probe_identity,
    save_login, set_last_error, slot, tokens_from_response, PendingAuth, TokenResponse,
};

/// RFC 8628 `slow_down`: increase the poll interval by this many seconds.
const SLOW_DOWN_INCREMENT_SECS: u64 = 5;

/// What the user has to do, handed back to the UI by [`start`].
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceVerification {
    pub verification_uri_complete: String,
    pub user_code: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Debug, Deserialize)]
struct DeviceAuthorizeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    #[serde(default)]
    verification_uri_complete: Option<String>,
    expires_in: u64,
    interval: u64,
}

#[derive(Debug, Deserialize)]
struct TokenErrorResponse {
    error: String,
}

/// Appends `client_id` to `url_str` when the provider's URL omits it. Falls
/// back to the input unchanged if it doesn't parse as a URL.
fn ensure_client_id_param(url_str: &str, client_id: &str) -> String {
    match url::Url::parse(url_str) {
        Ok(mut url) => {
            let has_client_id = url.query_pairs().any(|(k, _)| k == "client_id");
            if !has_client_id {
                url.query_pairs_mut().append_pair("client_id", client_id);
            }
            url.to_string()
        }
        Err(_) => url_str.to_string(),
    }
}

/// Starts the device flow and spawns the poller that waits for approval.
pub async fn start(app: &AppHandle, credential_id: &str) -> Result<DeviceVerification, String> {
    let (type_def, secret) = {
        let conn = db::open_db(app)?;
        let record = db::load(&conn, credential_id)?.ok_or("credential not found")?;
        let type_def = registry::require(&record.type_id)?;
        let secret = db::load_secret(&conn, credential_id)?.unwrap_or_default();
        (type_def, secret)
    };

    let AuthKind::OAuth2DeviceCode(device) = type_def.auth else {
        return Err(format!(
            "{} does not use a device sign-in flow",
            type_def.display_name
        ));
    };
    let (client_id, _client_secret) = client_credentials(type_def, &secret)?;

    let client = http_client(app);
    let response = client
        .post(device.device_url)
        .form(&[("client_id", client_id.as_str()), ("scope", device.scopes)])
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!(
            "device authorization failed: HTTP {}",
            response.status()
        ));
    }
    let body: DeviceAuthorizeResponse = response.json().await.map_err(|e| e.to_string())?;

    let verification_uri_complete = body
        .verification_uri_complete
        .clone()
        .unwrap_or_else(|| format!("{}?user_code={}", body.verification_uri, body.user_code));
    let verification_uri_complete = ensure_client_id_param(&verification_uri_complete, &client_id);

    let deadline = now_secs() + body.expires_in as i64;
    let interval = body.interval.max(1);

    // A fresh start supersedes whatever was running before; claim the
    // generation while holding the lock so the poller has an id to check.
    let credential_slot = slot(app, credential_id);
    let generation = {
        let mut inner = credential_slot.lock().unwrap();
        claim_generation_locked(&mut inner)
    };
    set_last_error(app, credential_id, None);

    let app_for_task = app.clone();
    let id_for_task = credential_id.to_string();
    let device_code = body.device_code.clone();
    let handle = tauri::async_runtime::spawn(async move {
        let result = poll_for_tokens(
            &app_for_task,
            &id_for_task,
            device,
            client_id,
            device_code,
            interval,
            deadline,
            generation,
        )
        .await;
        if let Err(error) = result {
            eprintln!("[credentials] device sign-in failed for {id_for_task}: {error}");
            set_last_error(&app_for_task, &id_for_task, Some(error));
        }
        finish_pending(&app_for_task, &id_for_task, generation);
    });

    {
        let mut inner = credential_slot.lock().unwrap();
        if super::inner_is_current(&inner, generation) {
            inner.pending = Some(PendingAuth { join: handle });
        } else {
            handle.abort();
        }
    }

    Ok(DeviceVerification {
        verification_uri_complete,
        user_code: body.user_code,
        expires_in: body.expires_in,
        interval,
    })
}

/// Polls the token endpoint until the user approves the code, then persists.
///
/// Cancellation is handled by the caller aborting our `JoinHandle`, so the loop
/// needs no cancel flag of its own.
#[allow(clippy::too_many_arguments)]
async fn poll_for_tokens(
    app: &AppHandle,
    credential_id: &str,
    device: DeviceCodeDef,
    client_id: String,
    device_code: String,
    mut interval: u64,
    deadline: i64,
    generation: u64,
) -> Result<(), String> {
    let client = http_client(app);

    loop {
        tokio::time::sleep(std::time::Duration::from_secs(interval)).await;

        if now_secs() >= deadline {
            return Err("the sign-in code expired — start again".to_string());
        }

        let response = client
            .post(device.token_url)
            .form(&[
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
                ("device_code", device_code.as_str()),
                ("client_id", client_id.as_str()),
            ])
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if response.status().is_success() {
            let parsed: TokenResponse = response.json().await.map_err(|e| e.to_string())?;
            let tokens = tokens_from_response(parsed, None, now_secs())?;

            let identity = match device.identity {
                Some(probe) => probe_identity(&client, &probe, &tokens.access_token).await?,
                None => (None, serde_json::Map::new()),
            };

            return save_login(app, credential_id, generation, tokens, identity);
        }

        let error: TokenErrorResponse = response.json().await.map_err(|e| e.to_string())?;
        match error.error.as_str() {
            // The user hasn't approved yet — keep waiting.
            "authorization_pending" => continue,
            "slow_down" => {
                interval += SLOW_DOWN_INCREMENT_SECS;
                continue;
            }
            other => return Err(other.to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ensure_client_id_param_appends_when_missing() {
        let out = ensure_client_id_param("https://login.tado.com/x?user_code=ABC", "cid-1");
        assert!(out.contains("client_id=cid-1"));
        assert!(out.contains("user_code=ABC"));
    }

    #[test]
    fn ensure_client_id_param_leaves_existing_untouched() {
        let out =
            ensure_client_id_param("https://login.tado.com/x?client_id=already-there", "cid-1");
        assert_eq!(out.matches("client_id=").count(), 1);
        assert!(out.contains("client_id=already-there"));
    }

    #[test]
    fn ensure_client_id_param_passes_through_unparseable_urls() {
        assert_eq!(ensure_client_id_param("not a url", "cid"), "not a url");
    }

    /// The verification URL the UI shows must be complete even when the
    /// provider only sends the bare URI plus a code.
    #[test]
    fn fallback_verification_url_carries_the_user_code() {
        let body_uri = "https://login.tado.com/device";
        let composed = format!("{body_uri}?user_code={}", "ABCD-1234");
        let out = ensure_client_id_param(&composed, "cid-1");
        assert!(out.contains("user_code=ABCD-1234"));
        assert!(out.contains("client_id=cid-1"));
    }
}
