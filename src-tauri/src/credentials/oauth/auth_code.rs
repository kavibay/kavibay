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
use crate::credentials::types::{AuthCodeDef, AuthKind, ClientSource};

use super::host_id::host_id;
use super::{
    claim_generation_locked, client_credentials, client_form, finish_pending, http_client,
    probe_identity, save_login, set_last_error, slot, tokens_from_response, PendingAuth,
    TokenResponse,
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
    /// The client id issued by an earlier sign-in (`ClientSource::Dynamic`).
    saved_client_id: Option<String>,
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

/// Loopback bind address: ephemeral unless the type pins a port (Spotify).
fn loopback_bind_addr(auth: &AuthCodeDef) -> String {
    match auth.loopback_port {
        Some(port) => format!("127.0.0.1:{port}"),
        None => "127.0.0.1:0".into(),
    }
}

/// Redirect URI sent to the provider. Spotify requires a path (`/callback`);
/// Google uses `/`.
fn loopback_redirect_uri(auth: &AuthCodeDef, port: u16) -> String {
    let path = auth.loopback_path.unwrap_or("/");
    format!("http://127.0.0.1:{port}{path}")
}

/// Per-attempt values for the type's `AuthCodeExtras`: all empty for every
/// type that does not declare them.
#[derive(Debug, Default)]
pub(super) struct AuthExtras {
    pub nonce: Option<String>,
    pub host_id: Option<String>,
    /// No client id has been issued yet, so the name hint is sent.
    pub first_login: bool,
}

/// Builds the consent-screen URL with PKCE plus the type's extra params.
fn build_auth_url(
    auth: &AuthCodeDef,
    client_id: &str,
    redirect_uri: &str,
    code_challenge: &str,
    state: &str,
    extras: &AuthExtras,
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
        if let Some(resource) = auth.extras.resource {
            query.append_pair("resource", resource);
        }
        if let Some(nonce) = &extras.nonce {
            query.append_pair("nonce", nonce);
        }
        if let Some(host_id) = &extras.host_id {
            query.append_pair("ext_agent_host_id", host_id);
        }
        if let (Some(hint), true) = (auth.extras.name_hint, extras.first_login) {
            query.append_pair("agent_name_hint", hint);
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

    let extras = AuthExtras {
        // Same shape as `state`; OpenID only needs it unguessable.
        nonce: auth.extras.send_nonce.then(generate_state),
        host_id: if auth.extras.send_host_id {
            Some(host_id(app)?)
        } else {
            None
        },
        first_login: secret.issued_client_id.is_none(),
    };
    let auth_url = build_auth_url(
        &auth,
        &client_id,
        &redirect_uri,
        &challenge,
        &state_token,
        &extras,
    )?;
    open::that(&auth_url).map_err(|e| format!("could not open the browser: {e}"))?;

    // A fresh start supersedes whatever was running before. Claim a new
    // generation while still holding the lock, so the flow we are about to
    // spawn has an id to check against before it persists anything.
    let credential_slot = slot(app, credential_id);
    let generation = {
        let mut inner = credential_slot.lock().unwrap();
        claim_generation_locked(&mut inner)
    };
    set_last_error(app, credential_id, None);

    let params = FlowParams {
        credential_id: credential_id.to_string(),
        auth,
        client_id,
        client_secret,
        redirect_uri,
        code_verifier,
        state_token,
        saved_client_id: secret.issued_client_id.clone(),
        generation,
    };

    let app_for_task = app.clone();
    let id_for_task = credential_id.to_string();
    let handle = tauri::async_runtime::spawn(async move {
        if let Err(error) = run_flow(&app_for_task, listener, params).await {
            eprintln!("[credentials] sign-in failed for {id_for_task}: {error}");
            set_last_error(&app_for_task, &id_for_task, Some(error));
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
    let callback = wait_for_callback(listener, &params.state_token).await?;
    let issued_client_id = accept_issued_client_id(
        &params.auth,
        callback.client_id.as_deref(),
        params.saved_client_id.as_deref(),
    )?;
    let client_id = issued_client_id
        .clone()
        .unwrap_or_else(|| params.client_id.clone());
    let client = http_client(app);

    let token = exchange_code(&client, &params, &client_id, &callback.code).await?;
    check_required_scope(params.auth.extras.required_scope, token.scope.as_deref())?;
    let email = token.id_token.as_deref().and_then(id_token_email);

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
        None => (email, serde_json::Map::new()),
    };

    save_login(
        app,
        &params.credential_id,
        params.generation,
        tokens,
        identity,
        issued_client_id,
    )
}

/// The client id a dynamic-client provider issued on the redirect.
///
/// Fail closed: a dynamic type must end the flow with a usable id, it must not
/// be the placeholder, and a connection that already has one keeps it — a
/// redirect naming another client is not this sign-in. Other types never take
/// a client id from the redirect.
fn accept_issued_client_id(
    auth: &AuthCodeDef,
    received: Option<&str>,
    saved: Option<&str>,
) -> Result<Option<String>, String> {
    let ClientSource::Dynamic { placeholder } = auth.client else {
        return Ok(None);
    };
    let Some(received) = received else {
        return saved
            .map(|id| Some(id.to_string()))
            .ok_or_else(|| "the sign-in redirect carried no client id".to_string());
    };
    let well_formed = (1..=200).contains(&received.len())
        && received
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if !well_formed || received == placeholder {
        return Err("the sign-in redirect carried an invalid client id".into());
    }
    if saved.is_some_and(|saved| saved != received) {
        return Err("the sign-in redirect named a different client than this connection".into());
    }
    Ok(Some(received.to_string()))
}

/// Refuses a login that did not grant the type's required scope. ChatGPT only
/// shares a plan through `chatgpt.tokens.use.direct`; without it the tokens
/// would fail on the first request, so nothing is saved.
fn check_required_scope(required: Option<&str>, granted: Option<&str>) -> Result<(), String> {
    let Some(required) = required else {
        return Ok(());
    };
    if granted.is_some_and(|granted| granted.split_whitespace().any(|scope| scope == required)) {
        return Ok(());
    }
    Err(
        "ChatGPT plan usage isn't available for this account or workspace. Use an API key instead."
            .into(),
    )
}

/// The `email` claim of an id token, for the account label only.
///
/// The signature is not checked: the token came straight from the token
/// endpoint over TLS in this process, which OpenID Connect Core §3.1.3.7
/// accepts in place of it, and nothing is decided on the value — it is shown.
fn id_token_email(id_token: &str) -> Option<String> {
    let payload = id_token.split('.').nth(1)?;
    let bytes = URL_SAFE_NO_PAD.decode(payload).ok()?;
    let claims: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    claims["email"].as_str().map(str::to_string)
}

/// Accepts loopback connections until one carries our `state` token (or the
/// overall timeout elapses), parses the `code`/`state`/`error` query params from
/// the request line, and replies with a tiny "you can close this window" page.
///
/// Looping (rather than failing on the first connection) tolerates stray or
/// malformed requests hitting the ephemeral port without aborting a login that
/// is still legitimately in flight.
/// What the redirect carried: the code, and the client id a dynamic-client
/// provider (ChatGPT) issued during this sign-in.
struct Callback {
    code: String,
    client_id: Option<String>,
}

async fn wait_for_callback(
    listener: TcpListener,
    expected_state: &str,
) -> Result<Callback, String> {
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
        let code = params
            .get("code")
            .cloned()
            .ok_or_else(|| "missing authorization code in redirect".to_string())?;
        return Ok(Callback {
            code,
            client_id: params.get("client_id").cloned(),
        });
    }
}

/// Exchanges an authorization code (+ PKCE verifier) for tokens.
async fn exchange_code(
    client: &Client,
    params: &FlowParams,
    client_id: &str,
    code: &str,
) -> Result<TokenResponse, String> {
    let mut form: Vec<(String, String)> = vec![
        ("code".into(), code.to_string()),
        ("redirect_uri".into(), params.redirect_uri.clone()),
        ("grant_type".into(), "authorization_code".into()),
        ("code_verifier".into(), params.code_verifier.clone()),
    ];
    form.extend(client_form(
        client_id.to_string(),
        params.client_secret.clone(),
    ));
    if let Some(resource) = params.auth.extras.resource {
        form.push(("resource".into(), resource.to_string()));
    }

    let response = client
        .post(params.auth.token_url)
        .form(&form)
        .send()
        .await
        .map_err(|e| e.to_string())?;

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

    fn chatgpt_auth() -> AuthCodeDef {
        match registry::require(registry::OPENAI_CHATGPT).unwrap().auth {
            AuthKind::OAuth2AuthCode(auth) => auth,
            _ => panic!("ChatGPT must use the authorization-code flow"),
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
            &AuthExtras::default(),
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
            &AuthExtras::default(),
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
    fn loopback_bind_addr_is_ephemeral_unless_the_type_pins_a_port() {
        assert_eq!(loopback_bind_addr(&google_auth()), "127.0.0.1:0");
        assert_eq!(loopback_bind_addr(&spotify_auth()), "127.0.0.1:17444");
        assert_eq!(loopback_bind_addr(&fitbit_auth()), "127.0.0.1:0");
    }

    #[test]
    fn loopback_redirect_uri_uses_the_type_path() {
        assert_eq!(
            loopback_redirect_uri(&google_auth(), 1234),
            "http://127.0.0.1:1234/"
        );
        assert_eq!(
            loopback_redirect_uri(&spotify_auth(), 17444),
            "http://127.0.0.1:17444/callback"
        );
    }

    #[test]
    fn chatgpt_auth_url_carries_resource_nonce_host_and_hint_on_first_login() {
        let url = build_auth_url(
            &chatgpt_auth(),
            "dynamic_agent_client",
            "http://127.0.0.1:5555/auth/callback",
            "ch",
            "st",
            &AuthExtras {
                nonce: Some("n1".into()),
                host_id: Some("urn:uuid:abc".into()),
                first_login: true,
            },
        )
        .unwrap();
        assert!(url.starts_with("https://auth.openai.com/api/accounts/authorize?"));
        for part in [
            "client_id=dynamic_agent_client",
            "resource=https%3A%2F%2Fapi.openai.com%2Fv1",
            "scope=openid+profile+email+offline_access+resource.invoke+chatgpt.tokens.use.direct",
            "nonce=n1",
            "ext_agent_host_id=urn%3Auuid%3Aabc",
            "agent_name_hint=Kavibay",
            "code_challenge_method=S256",
            "redirect_uri=http%3A%2F%2F127.0.0.1%3A5555%2Fauth%2Fcallback",
        ] {
            assert!(url.contains(part), "missing {part} in {url}");
        }
    }

    #[test]
    fn chatgpt_relogin_sends_no_name_hint() {
        let url = build_auth_url(
            &chatgpt_auth(),
            "app_123",
            "http://127.0.0.1:5555/auth/callback",
            "ch",
            "st",
            &AuthExtras {
                nonce: Some("n1".into()),
                host_id: Some("urn:uuid:abc".into()),
                first_login: false,
            },
        )
        .unwrap();
        assert!(url.contains("client_id=app_123"));
        assert!(!url.contains("agent_name_hint"));
    }

    #[test]
    fn other_types_auth_urls_gain_no_new_params() {
        for auth in [google_auth(), spotify_auth(), fitbit_auth()] {
            let url = build_auth_url(
                &auth,
                "cid",
                "http://127.0.0.1:1234/",
                "ch",
                "st",
                &AuthExtras::default(),
            )
            .unwrap();
            for param in [
                "resource=",
                "nonce=",
                "ext_agent_host_id=",
                "agent_name_hint=",
            ] {
                assert!(!url.contains(param), "{param} leaked into {url}");
            }
        }
    }

    #[test]
    fn chatgpt_redirects_to_its_callback_path_on_any_port() {
        assert_eq!(loopback_bind_addr(&chatgpt_auth()), "127.0.0.1:0");
        assert_eq!(
            loopback_redirect_uri(&chatgpt_auth(), 5555),
            "http://127.0.0.1:5555/auth/callback"
        );
    }

    #[test]
    fn issued_client_id_is_validated_for_dynamic_types() {
        let chatgpt = chatgpt_auth();
        assert!(accept_issued_client_id(&chatgpt, Some("dynamic_agent_client"), None).is_err());
        assert!(accept_issued_client_id(&chatgpt, Some("bad id!"), None).is_err());
        assert!(accept_issued_client_id(&chatgpt, Some(&"a".repeat(201)), None).is_err());
        assert_eq!(
            accept_issued_client_id(&chatgpt, Some("app_1"), None).unwrap(),
            Some("app_1".to_string())
        );
        assert!(
            accept_issued_client_id(&chatgpt, Some("app_2"), Some("app_1")).is_err(),
            "a different client id than the saved one is refused"
        );
        assert_eq!(
            accept_issued_client_id(&chatgpt, None, Some("app_1")).unwrap(),
            Some("app_1".to_string())
        );
        assert!(accept_issued_client_id(&chatgpt, None, None).is_err());
        // Other types never take a client id from the redirect.
        assert_eq!(
            accept_issued_client_id(&google_auth(), Some("app_1"), None).unwrap(),
            None
        );
    }

    #[test]
    fn a_login_without_plan_sharing_fails_with_a_sentence() {
        let error = check_required_scope(
            Some("chatgpt.tokens.use.direct"),
            Some("openid profile email offline_access"),
        )
        .unwrap_err();
        assert_eq!(
            error,
            "ChatGPT plan usage isn't available for this account or workspace. Use an API key instead."
        );
        assert!(check_required_scope(Some("chatgpt.tokens.use.direct"), None).is_err());
        assert!(check_required_scope(
            Some("chatgpt.tokens.use.direct"),
            Some("openid resource.invoke chatgpt.tokens.use.direct")
        )
        .is_ok());
        assert!(check_required_scope(None, None).is_ok());
    }

    #[test]
    fn id_token_email_reads_the_payload_claim() {
        let payload = URL_SAFE_NO_PAD.encode(br#"{"sub":"u1","email":"a@b.c"}"#);
        assert_eq!(
            id_token_email(&format!("e30.{payload}.sig")),
            Some("a@b.c".to_string())
        );
        assert_eq!(id_token_email("garbage"), None);
        assert_eq!(id_token_email("a.!!!.c"), None);
    }
}
