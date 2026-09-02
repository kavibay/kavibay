//! OAuth 2.0 authorization-code flow with PKCE and a loopback redirect.
//!
//! Flow: [`start`] opens the system browser at the provider's consent screen
//! and spawns a background task that binds an ephemeral `127.0.0.1` port, waits
//! for the redirect carrying the authorization code, exchanges it (with the
//! PKCE verifier) for tokens, runs the type's identity probe, and persists
//! everything. Refresh and disconnect live in the parent module, shared with
//! the device-code flow.

use std::collections::HashMap;
use std::time::Duration;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use reqwest::Client;
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use crate::credentials::db;
use crate::credentials::now_secs;
use crate::credentials::registry;
use crate::credentials::types::{AuthCodeDef, AuthKind};

use super::{
    claim_generation_locked, client_credentials, finish_pending, http_client, probe_identity,
    save_login, slot, token_request_client_auth, tokens_from_response, PendingAuth, TokenResponse,
};

/// How long to wait for the browser to complete the redirect before giving up.
const LOOPBACK_TIMEOUT_SECS: u64 = 300;

const REDIRECT_HTML_BODY: &str = "<html><body>You can close this window.</body></html>";

/// Parameters captured at [`start`] time and carried into the background task.
struct FlowParams {
    credential_id: String,
    auth: AuthCodeDef,
    client_id: String,
    client_secret: Option<String>,
    redirect_uri: String,
    code_verifier: String,
    state_token: String,
    /// This flow's id, checked against the credential's `active_generation`
    /// right before persisting tokens.
    generation: u64,
}

/// RFC 7636 PKCE code verifier: 32 random bytes, base64url (no padding) ⇒ 43
/// characters, within the required 43–128 length range and unreserved charset.
fn generate_code_verifier() -> String {
    let mut bytes = [0u8; 32];
    rand::fill(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

/// RFC 7636 S256 code challenge: base64url (no padding) of the SHA-256 of the
/// verifier's ASCII bytes.
fn code_challenge(verifier: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(hasher.finalize())
}

/// A random opaque value echoed back in the redirect, used to reject callbacks
/// that don't belong to the request we just made.
fn generate_state() -> String {
    let mut bytes = [0u8; 16];
    rand::fill(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Loopback bind address: ephemeral unless the type pins a port (Fitbit, Spotify).
fn loopback_bind_addr(auth: &AuthCodeDef) -> String {
    match auth.loopback_port {
        Some(port) => format!("127.0.0.1:{port}"),
        None => "127.0.0.1:0".into(),
    }
}

/// Redirect URI sent to the provider. Spotify requires a path (`/callback`);
/// Google and Fitbit use `/`.
fn loopback_redirect_uri(auth: &AuthCodeDef, port: u16) -> String {
    let path = auth.loopback_path.unwrap_or("/");
    format!("http://127.0.0.1:{port}{path}")
}

/// Builds the consent-screen URL with PKCE plus the type's extra params.
fn build_auth_url(
    auth: &AuthCodeDef,
    client_id: &str,
    redirect_uri: &str,
    code_challenge: &str,
    state: &str,
) -> Result<String, String> {
    let mut url = url::Url::parse(auth.auth_url)
        .map_err(|error| format!("invalid authorization url: {error}"))?;
    {
        let mut query = url.query_pairs_mut();
        query
            .append_pair("client_id", client_id)
            .append_pair("redirect_uri", redirect_uri)
            .append_pair("response_type", "code")
            .append_pair("scope", auth.scopes)
            .append_pair("code_challenge", code_challenge)
            .append_pair("code_challenge_method", "S256")
            .append_pair("state", state);
        for (key, value) in auth.extra_auth_params {
            query.append_pair(key, value);
        }
    }
    Ok(url.to_string())
}

/// Starts the consent flow for `credential_id`: builds the PKCE challenge,
/// binds the loopback listener, opens the browser, and spawns the background
/// task that waits for the redirect. Returns as soon as the browser has been
/// launched; poll `credentials_status` for completion.
pub async fn start(app: &AppHandle, credential_id: &str) -> Result<(), String> {
    let (type_def, secret) = {
        let conn = db::open_db(app)?;
        let record = db::load(&conn, credential_id)?.ok_or("credential not found")?;
        let type_def = registry::require(&record.type_id)?;
        let secret = db::load_secret(&conn, credential_id)?.unwrap_or_default();
        (type_def, secret)
    };

    let AuthKind::OAuth2AuthCode(auth) = type_def.auth else {
        return Err(format!(
            "{} does not use a browser sign-in flow",
            type_def.display_name
        ));
    };
    let (client_id, client_secret) = client_credentials(type_def, &secret)?;

    let bind = loopback_bind_addr(&auth);
    let listener = TcpListener::bind(&bind)
        .await
        .map_err(|e| format!("could not open {bind} for the OAuth redirect: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = loopback_redirect_uri(&auth, port);

    let code_verifier = generate_code_verifier();
    let challenge = code_challenge(&code_verifier);
    let state_token = generate_state();

    let auth_url = build_auth_url(&auth, &client_id, &redirect_uri, &challenge, &state_token)?;
    open::that(&auth_url).map_err(|e| format!("could not open the browser: {e}"))?;

    // A fresh start supersedes whatever was running before. Claim a new
    // generation while still holding the lock, so the flow we are about to
    // spawn has an id to check against before it persists anything.
    let credential_slot = slot(app, credential_id);
    let generation = {
        let mut inner = credential_slot.lock().unwrap();
        claim_generation_locked(&mut inner)
    };

    let params = FlowParams {
        credential_id: credential_id.to_string(),
        auth,
        client_id,
        client_secret,
        redirect_uri,
        code_verifier,
        state_token,
        generation,
    };

    let app_for_task = app.clone();
    let id_for_task = credential_id.to_string();
    let handle = tauri::async_runtime::spawn(async move {
        if let Err(error) = run_flow(&app_for_task, listener, params).await {
            eprintln!("[credentials] sign-in failed for {id_for_task}: {error}");
        }
        finish_pending(&app_for_task, &id_for_task, generation);
    });

    let mut inner = credential_slot.lock().unwrap();
    if super::inner_is_current(&inner, generation) {
        inner.pending = Some(PendingAuth { join: handle });
    } else {
        // Cancelled/disconnected/superseded in the brief window between
        // claiming the generation and getting here; don't let this now-unwanted
        // flow's handle linger.
        handle.abort();
    }
    Ok(())
}

/// Background task body: wait for the redirect, exchange the code, read the
/// account identity, and persist the tokens.
///
/// Cancellation is handled by the caller aborting our `JoinHandle`, which drops
/// the listener/socket cleanly.
async fn run_flow(
    app: &AppHandle,
    listener: TcpListener,
    params: FlowParams,
) -> Result<(), String> {
    let code = wait_for_callback(listener, &params.state_token).await?;
    let client = http_client(app);

    let token = exchange_code(&client, &params, &code).await?;

    // The provider may only return a refresh token on first consent; fall back
    // to the stored one when it does not.
    let previous_refresh = {
        let conn = db::open_db(app)?;
        db::load_secret(&conn, &params.credential_id)?
            .unwrap_or_default()
            .oauth
            .map(|tokens| tokens.refresh_token)
    };
    let tokens = tokens_from_response(token, previous_refresh.as_deref(), now_secs())?;

    let identity = match params.auth.identity {
        Some(probe) => probe_identity(&client, &probe, &tokens.access_token).await?,
        None => (None, serde_json::Map::new()),
    };

    save_login(
        app,
        &params.credential_id,
        params.generation,
        tokens,
        identity,
    )
}

/// Accepts loopback connections until one carries our `state` token (or the
/// overall timeout elapses), parses the `code`/`state`/`error` query params from
/// the request line, and replies with a tiny "you can close this window" page.
///
/// Looping (rather than failing on the first connection) tolerates stray or
/// malformed requests hitting the ephemeral port without aborting a login that
/// is still legitimately in flight.
async fn wait_for_callback(listener: TcpListener, expected_state: &str) -> Result<String, String> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(LOOPBACK_TIMEOUT_SECS);

    loop {
        let (mut stream, _addr) = tokio::time::timeout_at(deadline, listener.accept())
            .await
            .map_err(|_| "timed out waiting for the sign-in redirect".to_string())?
            .map_err(|e| e.to_string())?;

        // Read until the full HTTP request line (terminated by CRLF) has
        // arrived rather than assuming a single `read()` delivers it: a client
        // may split the request across TCP segments, in which case the first
        // read can miss the `code`/`state` query. Bounded by
        // `MAX_REQUEST_BYTES` and by the same deadline as `accept()` — a
        // connection that is accepted but never finishes sending could
        // otherwise block here well past the timeout.
        const MAX_REQUEST_BYTES: usize = 8192;
        let mut buf: Vec<u8> = Vec::with_capacity(1024);
        loop {
            if buf.windows(2).any(|w| w == b"\r\n") || buf.len() >= MAX_REQUEST_BYTES {
                break;
            }
            let mut chunk = [0u8; 1024];
            let read = tokio::time::timeout_at(deadline, stream.read(&mut chunk))
                .await
                .map_err(|_| "timed out waiting for the sign-in redirect".to_string())?
                .map_err(|e| e.to_string())?;
            if read == 0 {
                break; // client closed the connection before sending more
            }
            buf.extend_from_slice(&chunk[..read]);
        }

        let request = String::from_utf8_lossy(&buf);
        let request_line = request.lines().next().unwrap_or("");
        let Some(path) = request_line.split_whitespace().nth(1) else {
            continue; // malformed request line; keep waiting
        };
        let Ok(url) = url::Url::parse(&format!("http://127.0.0.1{path}")) else {
            continue; // unparseable query; keep waiting
        };
        let params: HashMap<String, String> = url.query_pairs().into_owned().collect();

        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            REDIRECT_HTML_BODY.len(),
            REDIRECT_HTML_BODY,
        );
        let _ = stream.write_all(response.as_bytes()).await;
        let _ = stream.shutdown().await;

        // Check `state` *before* trusting `error`: a connection whose state
        // doesn't match ours isn't the redirect we're waiting for, even if it
        // carries `error=...`. A stray or spoofed request hitting the ephemeral
        // port must not be able to abort a login that is still legitimately in
        // flight just by claiming an error.
        match params.get("state") {
            Some(state) if state == expected_state => {}
            _ => continue,
        }
        if let Some(error) = params.get("error") {
            return Err(format!("sign-in was cancelled or denied: {error}"));
        }
        return params
            .get("code")
            .cloned()
            .ok_or_else(|| "missing authorization code in redirect".to_string());
    }
}

/// Exchanges an authorization code (+ PKCE verifier) for tokens.
async fn exchange_code(
    client: &Client,
    params: &FlowParams,
    code: &str,
) -> Result<TokenResponse, String> {
    let mut form: Vec<(String, String)> = vec![
        ("code".into(), code.to_string()),
        ("redirect_uri".into(), params.redirect_uri.clone()),
        ("grant_type".into(), "authorization_code".into()),
        ("code_verifier".into(), params.code_verifier.clone()),
    ];
    let client_auth = token_request_client_auth(
        params.auth.token_auth,
        params.client_id.clone(),
        params.client_secret.clone(),
    )?;
    form.extend(
        client_auth
            .extra_form
            .into_iter()
            .map(|(key, value)| (key.to_string(), value)),
    );

    let mut request = client.post(params.auth.token_url).form(&form);
    if let Some((id, secret)) = client_auth.basic {
        request = request.basic_auth(id, Some(secret));
    }
    let response = request.send().await.map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let detail = response.text().await.unwrap_or_default();
        return Err(format!("token exchange failed: {}", detail.trim()));
    }
    response.json().await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::credentials::types::AuthKind;

    fn google_auth() -> AuthCodeDef {
        match registry::require(registry::GOOGLE_CALENDAR_OAUTH2)
            .unwrap()
            .auth
        {
            AuthKind::OAuth2AuthCode(auth) => auth,
            _ => panic!("google calendar must use the authorization-code flow"),
        }
    }

    fn spotify_auth() -> AuthCodeDef {
        match registry::require(registry::SPOTIFY_OAUTH2).unwrap().auth {
            AuthKind::OAuth2AuthCode(auth) => auth,
            _ => panic!("spotify must use the authorization-code flow"),
        }
    }

    fn fitbit_auth() -> AuthCodeDef {
        match registry::require(registry::FITBIT_OAUTH2).unwrap().auth {
            AuthKind::OAuth2AuthCode(auth) => auth,
            _ => panic!("fitbit must use the authorization-code flow"),
        }
    }

    #[test]
    fn code_verifier_has_valid_length_and_charset() {
        let verifier = generate_code_verifier();
        assert!((43..=128).contains(&verifier.len()));
        assert!(verifier
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
    }

    #[test]
    fn code_verifier_is_random_each_call() {
        assert_ne!(generate_code_verifier(), generate_code_verifier());
    }

    #[test]
    fn code_challenge_is_base64url_without_padding() {
        let verifier = generate_code_verifier();
        let challenge = code_challenge(&verifier);
        assert!(!challenge.contains(['=', '+', '/']));
        // SHA-256 digest is 32 bytes -> 43 base64url chars (no padding).
        assert_eq!(challenge.len(), 43);
    }

    #[test]
    fn code_challenge_matches_known_rfc7636_vector() {
        // RFC 7636 Appendix B example verifier/challenge pair.
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        let challenge = code_challenge(verifier);
        assert_eq!(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn state_tokens_are_random() {
        assert_ne!(generate_state(), generate_state());
    }

    #[test]
    fn build_auth_url_includes_pkce_and_type_specific_params() {
        let url = build_auth_url(
            &google_auth(),
            "cid",
            "http://127.0.0.1:1234/",
            "challenge123",
            "state456",
        )
        .unwrap();
        assert!(url.contains("client_id=cid"));
        assert!(url.contains("code_challenge=challenge123"));
        assert!(url.contains("code_challenge_method=S256"));
        // Declared by the type, not hardcoded in the flow.
        assert!(url.contains("access_type=offline"));
        assert!(url.contains("prompt=consent"));
        assert!(url.contains("state=state456"));
        assert!(url.contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A1234%2F"));
    }

    #[test]
    fn spotify_auth_url_is_pkce_without_google_params() {
        let url = build_auth_url(
            &spotify_auth(),
            "spot-cid",
            "http://127.0.0.1:1234/",
            "challenge123",
            "state456",
        )
        .unwrap();
        assert!(url.starts_with("https://accounts.spotify.com/authorize?"));
        assert!(url.contains("client_id=spot-cid"));
        assert!(url.contains("code_challenge=challenge123"));
        assert!(url.contains("code_challenge_method=S256"));
        assert!(
            !url.contains("access_type="),
            "Spotify does not use Google's offline/consent extras"
        );
        assert!(!url.contains("prompt="));
    }

    #[test]
    fn fitbit_auth_url_is_pkce_on_www_fitbit() {
        let url = build_auth_url(
            &fitbit_auth(),
            "fit-cid",
            "http://127.0.0.1:17443/",
            "challenge123",
            "state456",
        )
        .unwrap();
        assert!(url.starts_with("https://www.fitbit.com/oauth2/authorize?"));
        assert!(url.contains("client_id=fit-cid"));
        assert!(url.contains("code_challenge=challenge123"));
        assert!(url.contains("scope=activity"));
        assert!(url.contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A17443%2F"));
    }

    #[test]
    fn loopback_bind_addr_is_ephemeral_unless_the_type_pins_a_port() {
        assert_eq!(loopback_bind_addr(&google_auth()), "127.0.0.1:0");
        assert_eq!(loopback_bind_addr(&spotify_auth()), "127.0.0.1:17444");
        assert_eq!(loopback_bind_addr(&fitbit_auth()), "127.0.0.1:17443");
    }

    #[test]
    fn loopback_redirect_uri_uses_the_type_path() {
        assert_eq!(
            loopback_redirect_uri(&google_auth(), 1234),
            "http://127.0.0.1:1234/"
        );
        assert_eq!(
            loopback_redirect_uri(&fitbit_auth(), 17443),
            "http://127.0.0.1:17443/"
        );
        assert_eq!(
            loopback_redirect_uri(&spotify_auth(), 17444),
            "http://127.0.0.1:17444/callback"
        );
    }
}
