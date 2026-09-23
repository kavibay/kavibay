//! Shared OAuth 2.0 machinery for every credential type that needs a login.
//!
//! This is the generalized form of the Google Calendar auth module: the flows
//! differ (authorization code + PKCE vs. device code), but token refresh,
//! disconnect, identity probing and — most importantly — the concurrency
//! discipline are identical, so they live here once.
//!
//! **The generation counters are the contract.** They close four races that a
//! naive implementation gets wrong (cancel, disconnect, superseding login, and
//! refresh-in-flight). Each helper documents the exact interleaving it
//! prevents; the regression tests at the bottom of this file are the proof.
//! When touching this module, keep the "check and persist under one lock
//! acquisition" property intact.

pub mod auth_code;
pub mod device_code;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use reqwest::Client;
use serde::Deserialize;
use serde_json::{Map, Value};
use tauri::{AppHandle, Manager};

use super::db::{self, CredentialRecord, CredentialState, OAuthTokens, SecretData};
use super::now_secs;
use super::registry;
use super::resolve::field_value;
use super::types::{AuthKind, ClientSource, CredentialTypeDef, IdentityProbe, TokenAuth};

/// Refresh access tokens this many seconds before they actually expire, so a
/// request started right before expiry doesn't race the server's clock.
pub(crate) const REFRESH_SKEW_SECS: i64 = 60;

/// Token endpoint success payload, shared by both flows.
#[derive(Debug, Deserialize)]
pub(crate) struct TokenResponse {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    pub expires_in: i64,
}

/// Handle to the currently-running login task for one credential, kept so it
/// can be aborted on cancel/disconnect or when a new login supersedes it.
struct PendingAuth {
    join: tauri::async_runtime::JoinHandle<()>,
}

#[derive(Default)]
pub(crate) struct Inner {
    pending: Option<PendingAuth>,
    /// Monotonic counter handing a fresh id to every login attempt.
    next_generation: u64,
    /// Id of the flow currently allowed to persist its result.
    /// Cancel/disconnect/supersede clear this immediately — *before* the
    /// running flow's task has necessarily observed its `JoinHandle::abort()`
    /// (abort only takes effect at the flow's next `.await`, so a flow already
    /// past its last await can otherwise run to completion). Flows re-check
    /// this against their own generation right before writing.
    active_generation: Option<u64>,
    /// Monotonic counter identifying the *current* set of persisted tokens.
    /// Bumped whenever stored tokens change identity: disconnect clears them,
    /// a successful login writes a fresh set, a successful refresh replaces
    /// them.
    ///
    /// A refresh snapshots this (under the credential's mutex, together with
    /// the secret it reads) *before* its HTTP round-trip and re-checks it —
    /// under the same lock it is about to save under — right before persisting.
    /// If the snapshot no longer matches, something else changed the
    /// credentials while this refresh was talking to the provider, so the
    /// now-stale save is dropped. One counter closes both the
    /// disconnect-during-refresh race and the
    /// login-completes-while-an-old-refresh-is-in-flight race.
    credential_generation: u64,
    /// Why the last sign-in attempt failed. Device-code logins fail in the
    /// background (expired code, denied approval), so the reason has to live
    /// somewhere the UI can poll for.
    last_error: Option<String>,
}

/// Shared OAuth state: one reusable HTTP client plus per-credential
/// bookkeeping. Each credential gets its own mutex, so a login for one account
/// never blocks a refresh for another — and every helper below keeps the
/// "check and persist under a single lock acquisition" property that the races
/// depend on.
pub struct OAuthState {
    client: Client,
    slots: Mutex<HashMap<String, Arc<Mutex<Inner>>>>,
}

impl OAuthState {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
            slots: Mutex::new(HashMap::new()),
        }
    }

    /// Shared HTTP client (cheap `Arc`-backed clone).
    pub(crate) fn client(&self) -> Client {
        self.client.clone()
    }

    /// Per-credential bookkeeping slot, created on first use.
    pub(crate) fn slot(&self, credential_id: &str) -> Arc<Mutex<Inner>> {
        let mut slots = self.slots.lock().unwrap();
        Arc::clone(
            slots
                .entry(credential_id.to_string())
                .or_insert_with(|| Arc::new(Mutex::new(Inner::default()))),
        )
    }
}

impl Default for OAuthState {
    fn default() -> Self {
        Self::new()
    }
}

/// Bookkeeping slot for a credential id.
pub(crate) fn slot(app: &AppHandle, credential_id: &str) -> Arc<Mutex<Inner>> {
    app.state::<OAuthState>().slot(credential_id)
}

/// Shared HTTP client.
pub(crate) fn http_client(app: &AppHandle) -> Client {
    app.state::<OAuthState>().client()
}

/// True once `expires_at` is within `REFRESH_SKEW_SECS` of `now` (or already
/// passed), i.e. the token should be refreshed before being used again.
pub fn access_expired(expires_at: i64, now: i64) -> bool {
    expires_at <= now + REFRESH_SKEW_SECS
}

/// Abort any in-flight login and disown its generation so it can no longer
/// persist tokens even if it races past the abort. Safe when nothing is pending.
fn cancel_pending_locked(inner: &mut Inner) {
    if let Some(pending) = inner.pending.take() {
        pending.join.abort();
    }
    inner.active_generation = None;
}

/// Cancels whatever flow was active and hands out a fresh generation id for a
/// brand-new login.
fn claim_generation_locked(inner: &mut Inner) -> u64 {
    cancel_pending_locked(inner);
    inner.next_generation = inner.next_generation.wrapping_add(1);
    inner.active_generation = Some(inner.next_generation);
    inner.next_generation
}

/// True if `generation` is still the flow allowed to persist its result.
fn inner_is_current(inner: &Inner, generation: u64) -> bool {
    inner.active_generation == Some(generation)
}

/// Runs `persist` only if `generation` is still the active flow, checking and
/// running it under the *same* lock acquisition, and hands the held `Inner` to
/// `persist` so a successful save can bump `credential_generation` in the same
/// critical section.
///
/// A check done in isolation, released, and only *then* followed by an
/// unguarded save leaves a window where a cancel/disconnect/superseding login
/// completes entirely in the gap and has its result clobbered by the "stale"
/// save that already passed its check.
fn run_if_current_locked<T>(
    inner: &Mutex<Inner>,
    generation: u64,
    persist: impl FnOnce(&mut Inner) -> T,
) -> Option<T> {
    let mut guard = inner.lock().unwrap();
    if !inner_is_current(&guard, generation) {
        return None;
    }
    // `guard` is still held here, so nothing that needs the lock can run
    // concurrently with `persist`.
    Some(persist(&mut guard))
}

/// The refresh analogue of [`run_if_current_locked`]: runs `persist` only if
/// `credential_generation` still matches the value snapshotted before the
/// refresh's HTTP round-trip, checked and run under a single lock acquisition.
///
/// Closes both races the counter guards: a disconnect clearing the tokens, and
/// a login (or another refresh) saving a fresh set, while this refresh was in
/// flight. In either case the generation moved past this refresh's snapshot, so
/// its save is dropped rather than resurrecting a disconnected account or
/// overwriting newer tokens.
fn save_refreshed_if_current_locked<T>(
    inner: &Mutex<Inner>,
    credential_generation: u64,
    persist: impl FnOnce(&mut Inner) -> T,
) -> Option<T> {
    let mut guard = inner.lock().unwrap();
    if guard.credential_generation != credential_generation {
        return None;
    }
    Some(persist(&mut guard))
}

/// Runs `clear` (the token clear) and bumps `credential_generation` inside the
/// *same* lock acquisition. `clear` is plain synchronous rusqlite I/O with no
/// `.await`, so holding the std `Mutex` across it is safe.
///
/// This closes the race where a refresh acquires the mutex strictly *between*
/// the generation bump and the clear: it would load the still-present tokens,
/// snapshot the already-bumped generation, and later save its refresh result
/// back under a generation that still matches — resurrecting what disconnect is
/// in the middle of clearing. Doing both under one continuous lock hold makes
/// that interleaving impossible.
fn clear_tokens_and_bump_generation_locked(
    inner: &Mutex<Inner>,
    clear: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let mut guard = inner.lock().unwrap();
    clear()?;
    guard.credential_generation = guard.credential_generation.wrapping_add(1);
    Ok(())
}

/// Records a login task's outcome and clears the pending marker. Called exactly
/// once per spawned flow; a no-op when the flow was cancelled/superseded.
fn finish_pending(app: &AppHandle, credential_id: &str, generation: u64) {
    let slot = slot(app, credential_id);
    let mut inner = slot.lock().unwrap();
    if inner.active_generation != Some(generation) {
        return;
    }
    inner.pending = None;
    inner.active_generation = None;
}

/// True while a login for this credential is waiting for the user.
pub fn is_pending(app: &AppHandle, credential_id: &str) -> bool {
    let slot = slot(app, credential_id);
    let inner = slot.lock().unwrap();
    inner.pending.is_some()
}

/// Why the last sign-in attempt failed, if it did.
pub fn last_error(app: &AppHandle, credential_id: &str) -> Option<String> {
    let slot = slot(app, credential_id);
    let inner = slot.lock().unwrap();
    inner.last_error.clone()
}

/// Records (or clears) the reason a background sign-in failed.
pub(crate) fn set_last_error(app: &AppHandle, credential_id: &str, error: Option<String>) {
    let slot = slot(app, credential_id);
    let mut inner = slot.lock().unwrap();
    inner.last_error = error;
}

/// Stops waiting for a login without touching stored tokens.
pub fn cancel_pending(app: &AppHandle, credential_id: &str) {
    let slot = slot(app, credential_id);
    let mut inner = slot.lock().unwrap();
    cancel_pending_locked(&mut inner);
}

/// Disconnects an account: stops any in-flight login and removes the stored
/// tokens, while keeping the user-entered fields (an OAuth app's client id and
/// secret survive a disconnect — only the account does not).
pub fn disconnect(app: &AppHandle, credential_id: &str) -> Result<(), String> {
    let slot = slot(app, credential_id);
    {
        let mut inner = slot.lock().unwrap();
        cancel_pending_locked(&mut inner);
        inner.last_error = None;
    }
    // See `clear_tokens_and_bump_generation_locked` for why the clear and the
    // bump must happen under one continuous lock hold.
    clear_tokens_and_bump_generation_locked(&slot, || {
        let conn = db::open_db(app)?;
        let mut secret = db::load_secret(&conn, credential_id)?.unwrap_or_default();
        secret.oauth = None;
        db::save_secret(&conn, credential_id, &secret)?;
        db::set_identity(&conn, credential_id, None, &Map::new(), now_secs())?;
        db::set_state(
            &conn,
            credential_id,
            CredentialState::Unconfigured,
            now_secs(),
        )
    })
}

/// The OAuth client id/secret for a credential, from wherever its type says
/// they live.
pub(crate) fn client_credentials(
    type_def: &CredentialTypeDef,
    secret: &SecretData,
) -> Result<(String, Option<String>), String> {
    let client = match type_def.auth {
        AuthKind::Static => return Err(format!("{} is not an OAuth credential", type_def.id)),
        AuthKind::OAuth2AuthCode(auth) => auth.client,
        AuthKind::OAuth2DeviceCode(device) => device.client,
    };
    match client {
        ClientSource::BuiltIn { client_id } => Ok((client_id.to_string(), None)),
        ClientSource::Fields { id_key, secret_key } => {
            let client_id = field_value(secret, id_key).ok_or_else(|| {
                format!(
                    "{} is not configured yet — enter the client details and save",
                    type_def.display_name
                )
            })?;
            let client_secret = match secret_key {
                None => None,
                Some(key) => Some(field_value(secret, key).ok_or_else(|| {
                    format!("{} is missing its client secret", type_def.display_name)
                })?),
            };
            Ok((client_id, client_secret))
        }
    }
}

/// Extra form fields and optional HTTP Basic credentials for a token request.
///
/// Fitbit Personal/Server apps require Basic and reject a secret that only
/// lives in the form. Google and Spotify stay on `TokenAuth::Form`.
pub(crate) struct TokenClientAuth {
    pub extra_form: Vec<(&'static str, String)>,
    pub basic: Option<(String, String)>,
}

pub(crate) fn token_request_client_auth(
    token_auth: TokenAuth,
    client_id: String,
    client_secret: Option<String>,
) -> Result<TokenClientAuth, String> {
    match token_auth {
        TokenAuth::Form => {
            let mut extra_form = vec![("client_id", client_id)];
            if let Some(secret) = client_secret {
                extra_form.push(("client_secret", secret));
            }
            Ok(TokenClientAuth {
                extra_form,
                basic: None,
            })
        }
        TokenAuth::Basic => {
            let secret = client_secret.ok_or_else(|| {
                "this sign-in flow needs a client secret for the token request".to_string()
            })?;
            Ok(TokenClientAuth {
                extra_form: Vec::new(),
                basic: Some((client_id, secret)),
            })
        }
    }
}

/// Runs the type's identity probe and returns `(account label, metadata)`.
pub(crate) async fn probe_identity(
    client: &Client,
    probe: &IdentityProbe,
    access_token: &str,
) -> Result<(Option<String>, Map<String, Value>), String> {
    let response = client
        .get(probe.url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!(
            "failed to read the connected account: HTTP {}",
            response.status()
        ));
    }

    let body: Value = response.json().await.map_err(|e| e.to_string())?;
    let label = body
        .pointer(probe.label_pointer)
        .and_then(|value| value.as_str())
        .map(str::to_string);

    let mut metadata = Map::new();
    for (key, pointer) in probe.extras {
        if let Some(value) = body.pointer(pointer) {
            metadata.insert((*key).to_string(), value.clone());
        }
    }
    Ok((label, metadata))
}

/// Turns a token endpoint response into stored tokens, keeping the previous
/// refresh token when the provider omits one (Google only returns it on
/// consent).
pub(crate) fn tokens_from_response(
    response: TokenResponse,
    previous_refresh: Option<&str>,
    now: i64,
) -> Result<OAuthTokens, String> {
    let refresh_token = match response.refresh_token {
        Some(token) if !token.is_empty() => token,
        _ => previous_refresh
            .filter(|token| !token.is_empty())
            .ok_or("the provider did not return a refresh token")?
            .to_string(),
    };
    Ok(OAuthTokens {
        access_token: response.access_token,
        refresh_token,
        expires_at: now + response.expires_in,
    })
}

/// Persists tokens + identity for a completed login, but only while
/// `generation` is still the active flow (see [`run_if_current_locked`]).
pub(crate) fn save_login(
    app: &AppHandle,
    credential_id: &str,
    generation: u64,
    tokens: OAuthTokens,
    identity: (Option<String>, Map<String, Value>),
) -> Result<(), String> {
    let slot = slot(app, credential_id);
    // Everything before this point awaited at least once (network calls), so a
    // cancel/disconnect/newer login racing us would already have hit our
    // `JoinHandle::abort()`. From here on it is synchronous DB work with no
    // further await for abort() to land on, so re-check right before writing —
    // atomically with the write, not as two separate steps.
    let saved = run_if_current_locked(&slot, generation, |inner| {
        let conn = db::open_db(app)?;
        let mut secret = db::load_secret(&conn, credential_id)?.unwrap_or_default();
        secret.oauth = Some(tokens);
        db::save_secret(&conn, credential_id, &secret)?;

        let now = now_secs();
        let (label, metadata) = identity;
        db::set_identity(&conn, credential_id, label.as_deref(), &metadata, now)?;
        db::set_state(&conn, credential_id, CredentialState::Connected, now)?;

        // A completed login establishes a fresh set of credentials. Bump the
        // generation so any refresh whose snapshot predates this save drops its
        // result instead of overwriting what we just wrote.
        inner.credential_generation = inner.credential_generation.wrapping_add(1);
        inner.last_error = None;
        Ok::<(), String>(())
    });

    match saved {
        Some(result) => result,
        None => Err("login was cancelled or superseded before saving tokens".to_string()),
    }
}

/// Returns the credential's secret with a valid access token, refreshing first
/// when the stored one is expired (or about to be).
pub async fn ensure_fresh(
    app: &AppHandle,
    record: &CredentialRecord,
) -> Result<SecretData, String> {
    let type_def = registry::require(&record.type_id)?;
    let slot = slot(app, &record.id);

    // Critical section: read the stored secret and snapshot the credential
    // generation together, so the refresh decision and the generation the save
    // is verified against are consistent. The lock is released before any
    // network I/O — it is never held across an `.await`.
    let (secret, credential_generation) = {
        let inner = slot.lock().unwrap();
        let conn = db::open_db(app)?;
        let secret = db::load_secret(&conn, &record.id)?.unwrap_or_default();
        (secret, inner.credential_generation)
    };

    let tokens = secret.oauth.clone().ok_or("Not connected")?;
    if !access_expired(tokens.expires_at, now_secs()) {
        return Ok(secret);
    }

    refresh(app, record, type_def, secret, credential_generation).await
}

/// Refreshes regardless of local expiry — used after a provider 401, where an
/// otherwise unexpired token may have been revoked server-side.
pub async fn force_refresh(app: &AppHandle, credential_id: &str) -> Result<String, String> {
    let slot = slot(app, credential_id);
    let (record, secret, credential_generation) = {
        let inner = slot.lock().unwrap();
        let conn = db::open_db(app)?;
        let record = db::load(&conn, credential_id)?.ok_or("Not connected")?;
        let secret = db::load_secret(&conn, credential_id)?.unwrap_or_default();
        (record, secret, inner.credential_generation)
    };
    let type_def = registry::require(&record.type_id)?;
    let refreshed = refresh(app, &record, type_def, secret, credential_generation).await?;
    refreshed
        .oauth
        .map(|tokens| tokens.access_token)
        .ok_or_else(|| "refresh produced no access token".to_string())
}

/// Performs the refresh-token grant and persists the replacement tokens.
///
/// On failure the stored tokens are left in place and the credential is marked
/// `needsReauth`, so the UI keeps showing which account is affected while
/// prompting to reconnect.
async fn refresh(
    app: &AppHandle,
    record: &CredentialRecord,
    type_def: &CredentialTypeDef,
    secret: SecretData,
    credential_generation: u64,
) -> Result<SecretData, String> {
    let tokens = secret.oauth.clone().ok_or("Not connected")?;
    let (client_id, client_secret) = client_credentials(type_def, &secret)?;
    let (token_url, token_auth) = match type_def.auth {
        AuthKind::OAuth2AuthCode(auth) => (auth.token_url, auth.token_auth),
        AuthKind::OAuth2DeviceCode(device) => (device.token_url, TokenAuth::Form),
        AuthKind::Static => return Err("not an OAuth credential".into()),
    };

    let mut form: Vec<(String, String)> = vec![
        ("grant_type".into(), "refresh_token".into()),
        ("refresh_token".into(), tokens.refresh_token.clone()),
    ];
    let client_auth = token_request_client_auth(token_auth, client_id, client_secret)?;
    form.extend(
        client_auth
            .extra_form
            .into_iter()
            .map(|(key, value)| (key.to_string(), value)),
    );

    let client = http_client(app);
    let mut request = client.post(token_url).form(&form);
    if let Some((id, secret)) = client_auth.basic {
        request = request.basic_auth(id, Some(secret));
    }
    let response = match request.send().await {
        Ok(response) => response,
        Err(error) => {
            mark_needs_reauth(app, record, credential_generation);
            return Err(error.to_string());
        }
    };

    if !response.status().is_success() {
        let detail = response.text().await.unwrap_or_default();
        mark_needs_reauth(app, record, credential_generation);
        return Err(format!("token refresh failed: {}", detail.trim()));
    }

    let parsed: TokenResponse = match response.json().await {
        Ok(parsed) => parsed,
        Err(error) => {
            mark_needs_reauth(app, record, credential_generation);
            return Err(error.to_string());
        }
    };

    let refreshed_tokens = tokens_from_response(parsed, Some(&tokens.refresh_token), now_secs())?;
    let mut refreshed = secret;
    refreshed.oauth = Some(refreshed_tokens);

    let slot = slot(app, &record.id);
    let to_save = refreshed.clone();
    let saved = save_refreshed_if_current_locked(&slot, credential_generation, |inner| {
        let conn = db::open_db(app)?;
        db::save_secret(&conn, &record.id, &to_save)?;
        db::set_state(&conn, &record.id, CredentialState::Connected, now_secs())?;
        // A successful refresh replaces the stored credentials; bump so any
        // *other* refresh whose snapshot predates this save is dropped in turn.
        inner.credential_generation = inner.credential_generation.wrapping_add(1);
        Ok::<(), String>(())
    });

    match saved {
        Some(result) => result?,
        // The credentials changed while we were refreshing (a disconnect, a
        // completing login, or another refresh); drop the result instead of
        // resurrecting a disconnected account or overwriting newer tokens.
        None => return Err("credentials changed during token refresh".to_string()),
    }
    Ok(refreshed)
}

/// Marks the credential as needing reconnection after a failed refresh — but
/// only if `credential_generation` still matches the snapshot taken before the
/// refresh started. A stale failure must not raise a reauth prompt for an
/// account that may no longer be connected (or already has newer tokens).
fn mark_needs_reauth(app: &AppHandle, record: &CredentialRecord, credential_generation: u64) {
    let slot = slot(app, &record.id);
    let inner = slot.lock().unwrap();
    if inner.credential_generation != credential_generation {
        return;
    }
    let result = db::open_db(app).and_then(|conn| {
        db::set_state(&conn, &record.id, CredentialState::NeedsReauth, now_secs())
    });
    if let Err(error) = result {
        eprintln!(
            "[credentials] could not mark {} for reauth: {error}",
            record.id
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Wraps a prepared `Inner` the way `OAuthState::slot` hands it out.
    fn slot_of(inner: Inner) -> Arc<Mutex<Inner>> {
        Arc::new(Mutex::new(inner))
    }

    #[test]
    fn access_not_expired_well_before_deadline() {
        let now = 1_000_000;
        assert!(!access_expired(now + 3600, now));
    }

    #[test]
    fn access_expired_within_refresh_skew() {
        let now = 1_000_000;
        assert!(access_expired(now + REFRESH_SKEW_SECS, now));
        assert!(access_expired(now + 10, now));
    }

    #[test]
    fn access_expired_when_already_past() {
        let now = 1_000_000;
        assert!(access_expired(now - 1, now));
    }

    #[test]
    fn each_credential_gets_its_own_slot() {
        let state = OAuthState::new();
        let a = state.slot("cred-a");
        let b = state.slot("cred-b");
        let a_again = state.slot("cred-a");
        assert!(Arc::ptr_eq(&a, &a_again), "same credential reuses its slot");
        assert!(
            !Arc::ptr_eq(&a, &b),
            "different credentials are independent"
        );
    }

    #[test]
    fn generation_no_longer_current_after_cancel() {
        let mut inner = Inner::default();
        let generation = claim_generation_locked(&mut inner);
        assert!(inner_is_current(&inner, generation));

        // Cancel/disconnect: the in-flight flow must stop being "current"
        // immediately, even before its task observes `JoinHandle::abort()`.
        cancel_pending_locked(&mut inner);
        assert!(!inner_is_current(&inner, generation));
    }

    #[test]
    fn stale_generation_no_longer_current_after_being_superseded() {
        let mut inner = Inner::default();
        let first = claim_generation_locked(&mut inner);
        let second = claim_generation_locked(&mut inner);

        assert_ne!(first, second);
        assert!(!inner_is_current(&inner, first));
        assert!(inner_is_current(&inner, second));
    }

    #[test]
    fn run_if_current_locked_runs_persist_when_generation_is_current() {
        let mut inner = Inner::default();
        let generation = claim_generation_locked(&mut inner);
        let slot = slot_of(inner);

        let mut ran = false;
        let result = run_if_current_locked(&slot, generation, |_inner| {
            ran = true;
            "saved"
        });

        assert!(ran, "persist should run while the generation is current");
        assert_eq!(result, Some("saved"));
    }

    #[test]
    fn login_save_bumps_credential_generation() {
        // A completed login must advance `credential_generation` so any older
        // in-flight refresh (whose snapshot predates the login) is dropped.
        let mut inner = Inner::default();
        let generation = claim_generation_locked(&mut inner);
        let before = inner.credential_generation;
        let slot = slot_of(inner);

        let result = run_if_current_locked(&slot, generation, |inner| {
            inner.credential_generation = inner.credential_generation.wrapping_add(1);
            "saved"
        });

        assert_eq!(result, Some("saved"));
        assert_eq!(
            slot.lock().unwrap().credential_generation,
            before.wrapping_add(1)
        );
    }

    #[test]
    fn run_if_current_locked_skips_persist_when_generation_already_cancelled() {
        let mut inner = Inner::default();
        let generation = claim_generation_locked(&mut inner);
        cancel_pending_locked(&mut inner);
        let slot = slot_of(inner);

        let mut ran = false;
        let result = run_if_current_locked(&slot, generation, |_inner| {
            ran = true;
        });

        assert!(!ran, "persist must not run for a stale generation");
        assert_eq!(result, None);
    }

    #[test]
    fn concurrent_disconnect_cannot_run_between_the_check_and_the_save() {
        // Regression test for the race this helper closes: a `disconnect`
        // racing a save must not be able to complete its own token clear
        // strictly *between* the save's generation check and the save itself
        // (which would let the save resurrect what disconnect just cleared).
        // `run_if_current_locked` closes this by holding the lock across both,
        // so a concurrent cancel can only run fully *before* or fully *after* —
        // never during — the save.
        //
        // This isn't timing-dependent: as long as the disconnect thread has
        // started trying to acquire the lock before the persist closure
        // returns, mutual exclusion guarantees it can't have finished yet.
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Barrier;

        for _ in 0..50 {
            let mut inner = Inner::default();
            let generation = claim_generation_locked(&mut inner);
            let slot = slot_of(inner);

            let disconnect_started = Arc::new(Barrier::new(2));
            let disconnect_finished = Arc::new(AtomicBool::new(false));

            let slot_for_disconnect = Arc::clone(&slot);
            let barrier_for_disconnect = Arc::clone(&disconnect_started);
            let finished_for_disconnect = Arc::clone(&disconnect_finished);
            let disconnect_thread = std::thread::spawn(move || {
                barrier_for_disconnect.wait();
                let mut guard = slot_for_disconnect.lock().unwrap();
                cancel_pending_locked(&mut guard);
                finished_for_disconnect.store(true, Ordering::SeqCst);
            });

            let saved = run_if_current_locked(&slot, generation, |_inner| {
                disconnect_started.wait();
                std::thread::sleep(std::time::Duration::from_millis(20));
                // The disconnect thread cannot have finished: it is blocked on
                // the same lock this closure runs under.
                assert!(!disconnect_finished.load(Ordering::SeqCst));
                "saved"
            });

            disconnect_thread.join().unwrap();

            assert_eq!(saved, Some("saved"));
            assert!(disconnect_finished.load(Ordering::SeqCst));
            assert!(!inner_is_current(&slot.lock().unwrap(), generation));
        }
    }

    #[test]
    fn disconnect_bumps_credential_generation_past_a_snapshot_taken_before_it() {
        let mut inner = Inner::default();
        let snapshot = inner.credential_generation;

        cancel_pending_locked(&mut inner);
        inner.credential_generation = inner.credential_generation.wrapping_add(1);

        assert_ne!(inner.credential_generation, snapshot);
    }

    #[test]
    fn save_refreshed_if_current_locked_runs_persist_when_generation_unchanged() {
        let inner = Inner::default();
        let credential_generation = inner.credential_generation;
        let slot = slot_of(inner);

        let mut ran = false;
        let result = save_refreshed_if_current_locked(&slot, credential_generation, |inner| {
            ran = true;
            inner.credential_generation = inner.credential_generation.wrapping_add(1);
            "saved"
        });

        assert!(ran, "persist should run when the generation is unchanged");
        assert_eq!(result, Some("saved"));
        assert_eq!(
            slot.lock().unwrap().credential_generation,
            credential_generation.wrapping_add(1)
        );
    }

    #[test]
    fn refresh_save_dropped_when_disconnect_changed_generation_between_load_and_save() {
        // A disconnect happens between the refresh's load (which snapshotted
        // the generation) and the refresh's save. The save must be dropped —
        // persist never runs — so it can't resurrect cleared tokens.
        let mut inner = Inner::default();
        let snapshot = inner.credential_generation;
        inner.credential_generation = inner.credential_generation.wrapping_add(1);
        let slot = slot_of(inner);

        let mut ran = false;
        let result = save_refreshed_if_current_locked(&slot, snapshot, |_inner| {
            ran = true;
        });

        assert!(
            !ran,
            "a refresh with a stale generation snapshot must not save"
        );
        assert_eq!(result, None);
    }

    #[test]
    fn old_refresh_does_not_overwrite_a_completed_login() {
        // A login completes (saving fresh tokens and bumping the generation)
        // while an older refresh is still in flight. The old refresh
        // snapshotted the pre-login generation, so its save must be dropped.
        let mut inner = Inner::default();
        let login_generation = claim_generation_locked(&mut inner);
        let refresh_snapshot = inner.credential_generation;
        let slot = slot_of(inner);

        let login = run_if_current_locked(&slot, login_generation, |inner| {
            inner.credential_generation = inner.credential_generation.wrapping_add(1);
            "login-saved"
        });
        assert_eq!(login, Some("login-saved"));

        let mut refresh_ran = false;
        let refresh = save_refreshed_if_current_locked(&slot, refresh_snapshot, |_inner| {
            refresh_ran = true;
        });

        assert!(
            !refresh_ran,
            "an old refresh must not overwrite a completed login"
        );
        assert_eq!(refresh, None);
    }

    #[test]
    fn concurrent_disconnect_cannot_run_between_the_refresh_check_and_the_save() {
        // `disconnect` clears the tokens while a refresh's HTTP round-trip is
        // in flight, then the refresh finishes and (without this guard) would
        // save the refreshed tokens right back — resurrecting the account
        // disconnect just tore down.
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Barrier;

        for _ in 0..50 {
            let inner = Inner::default();
            let credential_generation = inner.credential_generation;
            let slot = slot_of(inner);

            let disconnect_started = Arc::new(Barrier::new(2));
            let disconnect_finished = Arc::new(AtomicBool::new(false));

            let slot_for_disconnect = Arc::clone(&slot);
            let barrier_for_disconnect = Arc::clone(&disconnect_started);
            let finished_for_disconnect = Arc::clone(&disconnect_finished);
            let disconnect_thread = std::thread::spawn(move || {
                barrier_for_disconnect.wait();
                let mut guard = slot_for_disconnect.lock().unwrap();
                guard.credential_generation = guard.credential_generation.wrapping_add(1);
                finished_for_disconnect.store(true, Ordering::SeqCst);
            });

            let saved = save_refreshed_if_current_locked(&slot, credential_generation, |inner| {
                disconnect_started.wait();
                std::thread::sleep(std::time::Duration::from_millis(20));
                assert!(!disconnect_finished.load(Ordering::SeqCst));
                inner.credential_generation = inner.credential_generation.wrapping_add(1);
                "saved"
            });

            disconnect_thread.join().unwrap();

            assert_eq!(saved, Some("saved"));
            assert!(disconnect_finished.load(Ordering::SeqCst));
            assert_ne!(
                slot.lock().unwrap().credential_generation,
                credential_generation
            );
        }
    }

    #[test]
    fn disconnect_clears_tokens_and_bumps_generation_atomically() {
        // Before this discipline existed, `disconnect` bumped the generation
        // and released the lock *before* clearing the tokens, which let a
        // refresh racing for the lock land in that gap: it would load the
        // still-present tokens, snapshot the already-bumped generation, and
        // later save its result back under a generation that still matched.
        //
        // `cleared` stands in for the stored tokens' presence. A concurrent
        // "refresh load + snapshot" (reading both under the same lock, exactly
        // as `ensure_fresh` does) must never observe the generation already
        // bumped while `cleared` is still false.
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Barrier;

        for _ in 0..50 {
            let slot = slot_of(Inner::default());
            let cleared = Arc::new(AtomicBool::new(false));
            let started = Arc::new(Barrier::new(2));

            let slot_for_disconnect = Arc::clone(&slot);
            let cleared_for_disconnect = Arc::clone(&cleared);
            let started_for_disconnect = Arc::clone(&started);
            let disconnect_thread = std::thread::spawn(move || {
                started_for_disconnect.wait();
                clear_tokens_and_bump_generation_locked(&slot_for_disconnect, || {
                    cleared_for_disconnect.store(true, Ordering::SeqCst);
                    Ok(())
                })
            });

            started.wait();
            let (observed_cleared, observed_generation) = {
                let guard = slot.lock().unwrap();
                (cleared.load(Ordering::SeqCst), guard.credential_generation)
            };

            disconnect_thread.join().unwrap().unwrap();

            let generation_bumped = observed_generation != 0;
            assert!(
                !generation_bumped || observed_cleared,
                "observed a bumped generation ({observed_generation}) without the clear having happened"
            );
        }
    }

    #[test]
    fn needs_reauth_is_gated_on_a_current_generation_snapshot() {
        // A refresh failure whose snapshot is stale (a disconnect, a completed
        // login, or another refresh landed while this refresh was in flight)
        // must not mark the credential for reauth. Mirrors `mark_needs_reauth`'s
        // gate, which itself needs an `AppHandle`.
        let mut inner = Inner::default();
        let stale_snapshot = inner.credential_generation;
        inner.credential_generation = inner.credential_generation.wrapping_add(1);

        let mut marked = false;
        if inner.credential_generation == stale_snapshot {
            marked = true;
        }
        assert!(!marked, "a stale refresh failure must not mark reauth");

        let current_snapshot = inner.credential_generation;
        if inner.credential_generation == current_snapshot {
            marked = true;
        }
        assert!(marked, "a current refresh failure must mark reauth");
    }

    #[test]
    fn tokens_keep_the_previous_refresh_token_when_the_provider_omits_one() {
        let response = TokenResponse {
            access_token: "new-access".into(),
            refresh_token: None,
            expires_in: 3600,
        };
        let tokens = tokens_from_response(response, Some("old-refresh"), 1_000).unwrap();
        assert_eq!(tokens.access_token, "new-access");
        assert_eq!(tokens.refresh_token, "old-refresh");
        assert_eq!(tokens.expires_at, 4_600);
    }

    #[test]
    fn tokens_prefer_a_freshly_issued_refresh_token() {
        let response = TokenResponse {
            access_token: "a".into(),
            refresh_token: Some("new-refresh".into()),
            expires_in: 60,
        };
        let tokens = tokens_from_response(response, Some("old-refresh"), 0).unwrap();
        assert_eq!(tokens.refresh_token, "new-refresh");
    }

    #[test]
    fn tokens_without_any_refresh_token_are_an_error() {
        let response = TokenResponse {
            access_token: "a".into(),
            refresh_token: None,
            expires_in: 60,
        };
        assert!(tokens_from_response(response, None, 0).is_err());
    }

    #[test]
    fn client_credentials_come_from_the_declared_source() {
        let google = registry::require(registry::GOOGLE_CALENDAR_OAUTH2).unwrap();
        let mut secret = SecretData::default();
        assert!(
            client_credentials(google, &secret).is_err(),
            "unconfigured client must fail closed"
        );
        secret.fields.insert("clientId".into(), "cid".into());
        secret
            .fields
            .insert("clientSecret".into(), "csecret".into());
        assert_eq!(
            client_credentials(google, &secret).unwrap(),
            ("cid".to_string(), Some("csecret".to_string()))
        );

        // Tado publishes a fixed public client, so no fields are needed.
        let tado = registry::require(registry::TADO_OAUTH2).unwrap();
        let (client_id, client_secret) = client_credentials(tado, &SecretData::default()).unwrap();
        assert!(!client_id.is_empty());
        assert_eq!(client_secret, None);

        // Spotify is a user-registered public client: Client ID, no secret.
        let spotify = registry::require(registry::SPOTIFY_OAUTH2).unwrap();
        let mut spotify_secret = SecretData::default();
        spotify_secret
            .fields
            .insert("clientId".into(), "spot-cid".into());
        assert_eq!(
            client_credentials(spotify, &spotify_secret).unwrap(),
            ("spot-cid".to_string(), None)
        );

        let fitbit = registry::require(registry::FITBIT_OAUTH2).unwrap();
        let mut fitbit_secret = SecretData::default();
        fitbit_secret
            .fields
            .insert("clientId".into(), "fit-cid".into());
        fitbit_secret
            .fields
            .insert("clientSecret".into(), "fit-secret".into());
        assert_eq!(
            client_credentials(fitbit, &fitbit_secret).unwrap(),
            ("fit-cid".to_string(), Some("fit-secret".to_string()))
        );
    }

    #[test]
    fn token_request_client_auth_form_puts_the_secret_in_the_body() {
        let auth = token_request_client_auth(TokenAuth::Form, "cid".into(), Some("csecret".into()))
            .unwrap();
        assert_eq!(
            auth.extra_form,
            vec![
                ("client_id", "cid".into()),
                ("client_secret", "csecret".into())
            ]
        );
        assert!(auth.basic.is_none());
    }

    #[test]
    fn token_request_client_auth_basic_omits_the_form_secret() {
        let auth =
            token_request_client_auth(TokenAuth::Basic, "cid".into(), Some("csecret".into()))
                .unwrap();
        assert!(
            auth.extra_form.is_empty(),
            "Fitbit's token body does not repeat the secret"
        );
        assert_eq!(auth.basic, Some(("cid".into(), "csecret".into())));
        assert!(token_request_client_auth(TokenAuth::Basic, "cid".into(), None).is_err());
    }

    #[test]
    fn static_types_have_no_oauth_client() {
        let github = registry::require(registry::GITHUB_PAT).unwrap();
        assert!(client_credentials(github, &SecretData::default()).is_err());
    }
}
