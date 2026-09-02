//! Executing a package's declared endpoint.
//!
//! Design: `docs/superpowers/specs/2026-08-01-declarative-http-api-design.md` §6–7.
//!
//! Everything a package can influence has already been validated by the time a
//! request is built here: the declaration comes from disk (`api_declaration`),
//! the arguments were bound and encoded (`binding`), the grant was read from the
//! backend's own store (`installs`), and the resolved address was classified
//! (`net_guard`). This module's job is to keep it that way while talking to the
//! network — no redirects, hard timeout, hard size cap, pinned address.

use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use futures_util::StreamExt;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::credentials::{oauth, resolve_for_type, ResolveError, ResolvedCredential};

use super::api_declaration::{self, Endpoint};
use super::binding::{self, BoundBody, BoundRequest};
use super::first_party;
use super::installs;
use super::limits::{LimitRejection, LimitState};
use super::net_guard::{address_blocked, AddressPolicy};

/// Permission an endpoint call requires.
const NETWORK_DECLARED: &str = "network.declared";

/// Mirrors `protocol.rs`: the Wizard previews a draft under this prefix.
const DRAFT_PREFIX: &str = "__draft__";

/// Who is calling. First-party code is compiled into the app and already runs in
/// the privileged webview, so it holds no grants; runtime packages hold both a
/// permission and, for credential endpoints, a per-credential grant.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Caller {
    RuntimePackage,
    /// An unsaved draft, previewed in the Widget Wizard.
    ///
    /// It has no install record, so there is no permission to check and no
    /// consent hash to match — and, deliberately, no credential grant it could
    /// ever hold. See `call_endpoint`.
    Draft,
    FirstParty,
}

/// Hard ceilings the package cannot raise.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_RESPONSE_BYTES: usize = 1024 * 1024;

/// Shared call state (rate limits, budget, response cache).
#[derive(Default)]
pub struct RuntimeHttpState {
    limits: Mutex<LimitState>,
}

impl RuntimeHttpState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Drops a package's limits and cache — call when it is disabled or removed.
    pub fn forget(&self, ext_id: &str) {
        self.limits.lock().unwrap().forget(ext_id);
    }

    /// Carries a package's limits and cache to its new id — call on rename.
    pub fn rename(&self, from: &str, to: &str) {
        self.limits.lock().unwrap().rename(from, to);
    }
}

/// Result handed back to the package. Never carries anything the host knows and
/// the package should not (no resolved addresses, no credential material).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpCallResult {
    pub ok: bool,
    /// Provider status when a response was received.
    pub status: Option<u16>,
    /// Parsed JSON body, or the raw text when the body is not JSON.
    pub data: Option<Value>,
    /// Stable error code (design §7) — `None` when `ok`.
    pub code: Option<String>,
    /// Detail for `invalid_arguments`, e.g. `missing_argument:latitude`.
    pub detail: Option<String>,
    /// Seconds to wait, for `rate_limited`.
    pub retry_after_secs: Option<u64>,
    /// True when the body came from the host-side cache.
    pub from_cache: bool,
}

impl HttpCallResult {
    fn failure(code: &str) -> Self {
        Self {
            ok: false,
            status: None,
            data: None,
            code: Some(code.to_string()),
            detail: None,
            retry_after_secs: None,
            from_cache: false,
        }
    }

    fn with_detail(code: &str, detail: String) -> Self {
        Self {
            detail: Some(detail),
            ..Self::failure(code)
        }
    }
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or(0)
}

/// Parses a body as JSON, falling back to a string so a package always gets
/// *something* it can render.
fn body_to_value(body: &str) -> Value {
    serde_json::from_str(body).unwrap_or_else(|_| Value::String(body.to_string()))
}

/// Looks up one endpoint of one package, reading the declaration from disk.
///
/// The frontend supplies only ids; the declaration itself always comes from the
/// package directory, so a renderer cannot describe a request of its own making.
/// The package directory for an id, including the Wizard's draft prefix.
///
/// `protocol.rs` has the same two-case resolution for serving a draft's files;
/// this is the same rule for reading its declaration, and both refuse anything
/// that is neither.
fn root_for(app: &AppHandle, ext_id: &str) -> Option<std::path::PathBuf> {
    match ext_id.strip_prefix(DRAFT_PREFIX) {
        Some(draft_id) => super::drafts::draft_package_dir(app, draft_id),
        None => super::package_root_for(app, ext_id),
    }
}

/// Whether a draft declares exactly the endpoints its widget was granted for.
///
/// Compared as bytes, like `consent_matches_declaration`: the question is not
/// whether the draft looks similar to what was approved, it is whether it *is*
/// what was approved.
fn draft_declaration_is_the_consented_one(
    app: &AppHandle,
    base_id: &str,
    draft_ext_id: &str,
) -> bool {
    let Some(root) = root_for(app, draft_ext_id) else {
        return false;
    };
    let Ok(text) = std::fs::read_to_string(root.join("api.json")) else {
        return false;
    };
    installs::consented_api_hash(app, base_id) == Some(super::declaration_hash(&text))
}

/// Why an endpoint could not be found, in the four ways that matter.
enum DeclarationState {
    Ok,
    /// The file is there and the parser refused it — the reason is the fix.
    Invalid(String),
    /// The file is fine; the id is not in it.
    NoSuchEndpoint,
    /// No `api.json` at all. This package was never going to reach the network.
    Missing,
}

fn declaration_state(app: &AppHandle, ext_id: &str, endpoint_id: &str) -> DeclarationState {
    let Some(root) = root_for(app, ext_id) else {
        return DeclarationState::Missing;
    };
    let Ok(text) = std::fs::read_to_string(root.join("api.json")) else {
        return DeclarationState::Missing;
    };
    let raw: Value = match serde_json::from_str(&text) {
        Ok(raw) => raw,
        Err(error) => return DeclarationState::Invalid(error.to_string()),
    };
    match api_declaration::parse_api_declaration(&raw) {
        Err(error) => DeclarationState::Invalid(error),
        Ok(declaration) => {
            if declaration.endpoints.iter().any(|e| e.id == endpoint_id) {
                DeclarationState::Ok
            } else {
                DeclarationState::NoSuchEndpoint
            }
        }
    }
}

fn load_endpoint(app: &AppHandle, ext_id: &str, endpoint_id: &str) -> Option<Endpoint> {
    let package_root = root_for(app, ext_id)?;
    let text = std::fs::read_to_string(package_root.join("api.json")).ok()?;
    let raw: Value = serde_json::from_str(&text).ok()?;
    let declaration = api_declaration::parse_api_declaration(&raw).ok()?;
    declaration
        .endpoints
        .into_iter()
        .find(|endpoint| endpoint.id == endpoint_id)
}

/// Resolves a url's host and returns the first address that is allowed to be
/// dialled.
///
/// Resolving here (rather than letting the HTTP client do it) is what makes the
/// classification meaningful: the address that passed the check is the address
/// the connection is pinned to, so a name that resolves differently a moment
/// later cannot be substituted underneath us.
pub(crate) async fn vetted_address(url: &url::Url) -> Result<std::net::SocketAddr, String> {
    vetted_address_with(url, AddressPolicy::PublicOnly).await
}

/// Same as [`vetted_address`], with an explicit address policy.
pub(crate) async fn vetted_address_with(
    url: &url::Url,
    policy: AddressPolicy,
) -> Result<std::net::SocketAddr, String> {
    let host = url.host_str().ok_or("network_error")?.to_string();
    let port = url.port_or_known_default().unwrap_or(443);

    let resolved = tokio::net::lookup_host((host.as_str(), port))
        .await
        .map_err(|_| "network_error".to_string())?;

    // One bad answer is enough to refuse: a name that resolves to a private
    // address is either misconfigured or hostile, and picking a "good" sibling
    // address would paper over both. Every answer is inspected before any is
    // accepted — an earlier version returned on the first address, so a
    // forbidden sibling behind it was never seen.
    let mut first_allowed = None;
    for address in resolved {
        if address_blocked(address.ip(), policy) {
            return Err("blocked_address".to_string());
        }
        if first_allowed.is_none() {
            first_allowed = Some(address);
        }
    }
    first_allowed.ok_or_else(|| "network_error".to_string())
}

/// Sends one bound request to one url. Returns `(status, body)`.
///
/// The credential, when there is one, is attached here through the type's
/// declared injection — the package never sees it, and it is applied last so a
/// declared header cannot shadow it.
async fn send_once(
    request: &BoundRequest,
    url_text: &str,
    credential: Option<&ResolvedCredential>,
) -> Result<(u16, String), String> {
    let url = url::Url::parse(url_text).map_err(|_| "network_error".to_string())?;
    let address = vetted_address(&url).await?;
    let host = url.host_str().ok_or("network_error")?.to_string();

    // A fresh client per call so the vetted address can be pinned for this
    // connection. Connection pooling is worth less here than knowing exactly
    // which address is dialled; declared endpoints are rate-limited anyway.
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(REQUEST_TIMEOUT)
        .resolve(&host, address)
        .user_agent(
            request
                .user_agent
                .clone()
                .unwrap_or_else(|| "kavibay-extension".to_string()),
        )
        .build()
        .map_err(|_| "network_error".to_string())?;

    let mut builder = match request.method {
        api_declaration::Method::Get => client.get(url.clone()),
        api_declaration::Method::Post => client.post(url.clone()),
    };
    for (name, value) in &request.headers {
        builder = builder.header(name, value);
    }
    builder = match &request.body {
        None => builder,
        Some(BoundBody::Json(value)) => builder.json(value),
        Some(BoundBody::Form(pairs)) => builder.form(pairs),
    };
    if let Some(credential) = credential {
        builder = credential
            .apply(builder)
            .map_err(|_| "credential_error".to_string())?;
    }

    let response = builder.send().await.map_err(|error| {
        if error.is_timeout() {
            "timeout".to_string()
        } else {
            "network_error".to_string()
        }
    })?;

    let status = response.status().as_u16();

    // Stream the body so an oversized response is abandoned instead of buffered.
    let mut collected: Vec<u8> = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "network_error".to_string())?;
        if collected.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err("too_large".to_string());
        }
        collected.extend_from_slice(&chunk);
    }

    let body = String::from_utf8_lossy(&collected).to_string();
    Ok((status, body))
}

/// Caches a successful body when the endpoint declares a ttl, and builds the
/// result. Shared by the first attempt and the post-refresh retry.
fn success(
    app: &AppHandle,
    ext_id: &str,
    endpoint: &Endpoint,
    primary_url: &str,
    status: u16,
    body: &str,
    now: i64,
) -> HttpCallResult {
    if let Some(ttl) = endpoint.cache_ttl_secs {
        if ttl > 0 {
            app.state::<RuntimeHttpState>()
                .limits
                .lock()
                .unwrap()
                .store(ext_id, &endpoint.id, primary_url, status, body, now);
        }
    }
    HttpCallResult {
        ok: true,
        status: Some(status),
        data: Some(body_to_value(body)),
        code: None,
        detail: None,
        retry_after_secs: None,
        from_cache: false,
    }
}

/// Executes a declared endpoint for a package.
///
/// `ext_id` is bound host-side by the caller (frame identity), never taken from
/// a message payload.
pub async fn call_endpoint(
    app: &AppHandle,
    ext_id: &str,
    endpoint_id: &str,
    args: Value,
) -> HttpCallResult {
    /**/
    // A DRAFT MAY CALL ITS OWN DECLARED ENDPOINTS.
    //
    // It could not, and the comment in `protocol.rs` stated that as a property:
    // "it renders; it cannot reach anything." That was right while a draft had
    // nothing worth reaching. Now that a widget can declare endpoints, it means
    // the one thing the preview exists for — deciding whether to keep this
    // widget — cannot be done for any widget that uses the network. The person
    // would have to keep it, enable it and review it before finding out it does
    // not work, which is not a preview.
    //
    // What a draft still cannot do is the part that was ever protected:
    // **reach a credential it was not already granted.** A draft of a widget
    // that was never kept has no install record and therefore no grant, and
    // `execute` refuses it. A draft of an installed widget reaches that
    // widget's grant only while its `api.json` is byte-identical to the
    // declaration the grant was given for — see the credential branch in
    // `execute`, which is where that rule lives. Everything else —
    // the declaration parse, the parameter binding, https-only, no redirects,
    // the private-address refusal, the size cap, the timeout, the daily budget
    // — is the same code path a kept package takes.
    if let Some(draft_id) = ext_id.strip_prefix(DRAFT_PREFIX) {
        let Some(endpoint) = load_endpoint(app, ext_id, endpoint_id) else {
            // A draft is the case where a bad `api.json` is most likely — the
            // model just wrote it — so the reason has to be the answer.
            return match declaration_state(app, ext_id, endpoint_id) {
                DeclarationState::Invalid(why) => HttpCallResult::with_detail(
                    "invalid_declaration",
                    format!("this widget's api.json could not be read: {why}"),
                ),
                DeclarationState::NoSuchEndpoint => HttpCallResult::with_detail(
                    "unknown_endpoint",
                    format!("no endpoint named {endpoint_id} in this widget's api.json"),
                ),
                _ => HttpCallResult::with_detail(
                    "unknown_endpoint",
                    "this widget ships no api.json".to_string(),
                ),
            };
        };
        // The budget is keyed by the id as given, so a draft spends its own and
        // cannot exhaust the kept package it will become.
        let _ = draft_id;
        return execute(app, ext_id, &endpoint, args, Caller::Draft).await;
    }

    if !installs::has_permission(app, ext_id, NETWORK_DECLARED) {
        // Three different situations wore one code, and the message named none
        // of them. Finding 21's lesson: a message pointing at the wrong thing
        // costs more than no message — somebody goes looking for a permission
        // to add when the actual fault is a typo in a file.
        return match declaration_state(app, ext_id, endpoint_id) {
            DeclarationState::Ok => HttpCallResult::with_detail(
                "needs_review",
                "this widget declares endpoints it has not been enabled for — save it and review them"
                    .to_string(),
            ),
            DeclarationState::Invalid(why) => HttpCallResult::with_detail(
                "invalid_declaration",
                format!("this widget's api.json could not be read: {why}"),
            ),
            DeclarationState::NoSuchEndpoint => HttpCallResult::with_detail(
                "unknown_endpoint",
                format!("no endpoint named {endpoint_id} in this widget's api.json"),
            ),
            // Carries a detail like every other branch, so there is no answer
            // left that says only "permission_denied". That matters beyond
            // politeness: a bare code is now proof that the binary predates
            // this code, which is a diagnosis the panel can make on its own
            // instead of somebody guessing at it for three rounds.
            DeclarationState::Missing => HttpCallResult::with_detail(
                "permission_denied",
                format!("{ext_id} ships no api.json, so it has no endpoints to call"),
            ),
        };
    }

    // The consent was given for a specific set of endpoints. If the declaration
    // changed since, the user has not seen what this package would call now.
    if !installs::consent_matches_declaration(app, ext_id) {
        return HttpCallResult::failure("consent_stale");
    }

    let Some(endpoint) = load_endpoint(app, ext_id, endpoint_id) else {
        return HttpCallResult::failure("unknown_endpoint");
    };

    execute(app, ext_id, &endpoint, args, Caller::RuntimePackage).await
}

/// Runs one already-resolved endpoint: bind, check limits, send.
///
/// Shared by runtime packages and first-party extensions so both get the same
/// encoding, the same address checks and the same budget — the only difference
/// is where the declaration came from and whether a grant was required.
async fn execute(
    app: &AppHandle,
    ext_id: &str,
    endpoint: &Endpoint,
    args: Value,
    caller: Caller,
) -> HttpCallResult {
    let endpoint_id = endpoint.id.as_str();

    // A credential endpoint needs its own grant: owning a credential is not the
    // same as letting every package use it.
    if let Some(credential_type) = &endpoint.credential {
        // A draft of a widget that is already installed is that widget being
        // edited, not a stranger. Refusing every draft outright meant the one
        // endpoint such a widget exists for could not be tried in the preview
        // at all: the person had to save an untested change to find out whether
        // it works, which is the loop the API tab was built to remove.
        //
        // Two things are *not* relaxed, and together they are the whole rule.
        // The grant still has to exist on this id's install record — a draft of
        // something never kept reaches nothing, exactly as before. And the
        // draft's own `api.json` has to be byte-identical to the declaration
        // that grant was given for: a regenerated declaration is a different
        // set of requests, so a model that rewrites it cannot point a granted
        // credential at a host nobody approved. That is `consent_stale`, which
        // is the same answer a kept package gets for the same change.
        if caller == Caller::Draft {
            let base_id = ext_id.strip_prefix(DRAFT_PREFIX).unwrap_or(ext_id);
            if !installs::has_credential_grant(app, base_id, credential_type) {
                return HttpCallResult::with_detail(
                    "credential_not_granted",
                    "a preview can only use a credential this widget was already granted — keep this widget and enable it"
                        .to_string(),
                );
            }
            if !draft_declaration_is_the_consented_one(app, base_id, ext_id) {
                return HttpCallResult::with_detail(
                    "consent_stale",
                    "this draft's api.json is not the one you approved, so its credential is not available in the preview"
                        .to_string(),
                );
            }
        }
        if caller == Caller::RuntimePackage
            && !installs::has_credential_grant(app, ext_id, credential_type)
        {
            return HttpCallResult::failure("credential_not_granted");
        }
    }

    let bound = match binding::bind(endpoint, &args) {
        Ok(bound) => bound,
        Err(detail) => return HttpCallResult::with_detail("invalid_arguments", detail),
    };
    let primary_url = bound.urls.first().cloned().unwrap_or_default();
    let now = now_secs();
    let state = app.state::<RuntimeHttpState>();

    // A cache hit answers without touching the network or the budget.
    if let Some((status, body)) = state.limits.lock().unwrap().cached(
        ext_id,
        endpoint_id,
        &primary_url,
        endpoint.cache_ttl_secs,
        now,
    ) {
        return HttpCallResult {
            ok: true,
            status: Some(status),
            data: Some(body_to_value(&body)),
            code: None,
            detail: None,
            retry_after_secs: None,
            from_cache: true,
        };
    }

    let budget = installs::daily_budget(app);
    if let Err(rejection) = state.limits.lock().unwrap().check(
        ext_id,
        endpoint_id,
        endpoint.min_interval_secs,
        budget,
        now,
    ) {
        return match rejection {
            LimitRejection::TooSoon { retry_after_secs } => HttpCallResult {
                retry_after_secs: Some(retry_after_secs),
                ..HttpCallResult::failure("rate_limited")
            },
            LimitRejection::BudgetExhausted => HttpCallResult::failure("budget_exhausted"),
        };
    }

    // Resolved after the limit check so a package cannot spin the credential
    // layer (and its token refreshes) faster than its own rate limit.
    let mut credential = match &endpoint.credential {
        None => None,
        Some(credential_type) => match resolve_for_type(app, credential_type).await {
            Ok(resolved) => Some(resolved),
            Err(ResolveError::NotConfigured) => {
                return HttpCallResult::failure("credential_not_configured")
            }
            Err(ResolveError::NeedsReauth) => {
                return HttpCallResult::failure("credential_needs_reauth")
            }
            Err(ResolveError::Failed(message)) => {
                return HttpCallResult::with_detail("credential_error", message)
            }
        },
    };
    let credential_id = credential
        .as_ref()
        .map(|resolved| resolved.record.id.clone());

    // The attempt is counted before the request goes out, so a failing endpoint
    // cannot be retried without limit.
    state
        .limits
        .lock()
        .unwrap()
        .record_call(ext_id, endpoint_id, now);

    // Every path after a 401 refresh either returns or gives up, so this stays
    // false: it documents that the retry happens at most once.
    let refreshed_once = false;
    let mut last_failure = HttpCallResult::failure("network_error");
    for url_text in &bound.urls {
        match send_once(&bound, url_text, credential.as_ref()).await {
            Ok((status, body)) => {
                if (500..600).contains(&status) {
                    // Server-side failure: worth trying the declared alternate.
                    last_failure = HttpCallResult {
                        status: Some(status),
                        ..HttpCallResult::failure("http_error")
                    };
                    continue;
                }
                // A 401 on a credential endpoint may just be a token the
                // provider revoked early. Only the host can refresh it, so it
                // does — exactly once, then gives up.
                if status == 401 && !refreshed_once {
                    if let Some(credential_id) = &credential_id {
                        match oauth::force_refresh(app, credential_id).await {
                            Ok(_) => match resolve_for_type(
                                app,
                                endpoint.credential.as_deref().unwrap_or_default(),
                            )
                            .await
                            {
                                Ok(resolved) => {
                                    credential = Some(resolved);
                                    match send_once(&bound, url_text, credential.as_ref()).await {
                                        Ok((retry_status, retry_body)) => {
                                            if (200..300).contains(&retry_status) {
                                                return success(
                                                    app,
                                                    ext_id,
                                                    endpoint,
                                                    &primary_url,
                                                    retry_status,
                                                    &retry_body,
                                                    now,
                                                );
                                            }
                                            return HttpCallResult {
                                                status: Some(retry_status),
                                                ..HttpCallResult::failure("http_error")
                                            };
                                        }
                                        Err(code) => return HttpCallResult::failure(&code),
                                    }
                                }
                                Err(_) => {
                                    return HttpCallResult::failure("credential_needs_reauth")
                                }
                            },
                            Err(_) => return HttpCallResult::failure("credential_needs_reauth"),
                        }
                    }
                }
                if !(200..300).contains(&status) {
                    // 4xx is about this request, not this host — do not retry.
                    return HttpCallResult {
                        status: Some(status),
                        ..HttpCallResult::failure("http_error")
                    };
                }
                return success(app, ext_id, endpoint, &primary_url, status, &body, now);
            }
            Err(code) => {
                // A blocked address is a property of the declaration, not of a
                // transient outage — do not try the next url with it.
                if code == "blocked_address" {
                    return HttpCallResult::failure("blocked_address");
                }
                last_failure = HttpCallResult::failure(&code);
            }
        }
    }
    last_failure
}

/// The configured budget plus what each package has used today.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BudgetStatus {
    pub daily_budget: u32,
    /// `(package id, calls today)`, only for packages that called at all.
    pub usage: Vec<(String, u32)>,
}

/// Budget and current usage, for the Settings view.
#[tauri::command]
pub fn runtime_extensions_budget_status(app: AppHandle) -> Result<BudgetStatus, String> {
    let usage = app
        .state::<RuntimeHttpState>()
        .limits
        .lock()
        .unwrap()
        .usage_today(now_secs());
    Ok(BudgetStatus {
        daily_budget: installs::daily_budget(&app),
        usage,
    })
}

/// Calls a declared endpoint of a **first-party** extension.
///
/// No grant is consulted: first-party code is compiled into the app and already
/// runs in the privileged webview (AGENTS.md invariant 7). The value here is the
/// shared encoding, address checks and limits — plus not needing a
/// `connect-src` entry in the main-window CSP.
#[tauri::command(rename_all = "camelCase")]
pub async fn extension_http_call(
    app: AppHandle,
    ext_id: String,
    endpoint_id: String,
    args: Value,
) -> Result<HttpCallResult, String> {
    let Some(endpoint) = first_party::endpoint(&ext_id, &endpoint_id) else {
        return Ok(HttpCallResult::failure("unknown_endpoint"));
    };
    Ok(execute(&app, &ext_id, &endpoint, args, Caller::FirstParty).await)
}

/// Calls a declared endpoint of a runtime package.
///
/// Only first-party host code invokes this: the bridge resolves the calling
/// frame to an `extId` and passes it in. It is *not* safe to expose to a
/// sandboxed frame directly, which is exactly why runtime packages reach it
/// through `postMessage` instead of Tauri IPC.
#[tauri::command(rename_all = "camelCase")]
pub async fn runtime_extensions_http_call(
    app: AppHandle,
    ext_id: String,
    endpoint_id: String,
    args: Value,
) -> Result<HttpCallResult, String> {
    Ok(call_endpoint(&app, &ext_id, &endpoint_id, args).await)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bodies_fall_back_to_text_when_they_are_not_json() {
        assert_eq!(body_to_value("{\"a\":1}"), serde_json::json!({ "a": 1 }));
        assert_eq!(body_to_value("not json"), Value::String("not json".into()));
    }

    #[test]
    fn failures_carry_a_code_and_no_data() {
        let failure = HttpCallResult::failure("timeout");
        assert!(!failure.ok);
        assert_eq!(failure.code.as_deref(), Some("timeout"));
        assert!(failure.data.is_none());
        assert!(!failure.from_cache);
    }

    #[test]
    fn detail_is_carried_for_argument_errors() {
        let failure =
            HttpCallResult::with_detail("invalid_arguments", "missing_argument:lat".into());
        assert_eq!(failure.code.as_deref(), Some("invalid_arguments"));
        assert_eq!(failure.detail.as_deref(), Some("missing_argument:lat"));
    }

    /// The result shape is what a package sees; it must never gain a field that
    /// leaks host knowledge (resolved address, credential, local paths).
    #[test]
    fn the_result_shape_stays_minimal() {
        let value = serde_json::to_value(HttpCallResult {
            ok: true,
            status: Some(200),
            data: Some(serde_json::json!({ "a": 1 })),
            code: None,
            detail: None,
            retry_after_secs: None,
            from_cache: true,
        })
        .unwrap();
        // `serde_json` maps are sorted, so compare the set, not the order.
        let keys: Vec<_> = value.as_object().unwrap().keys().cloned().collect();
        assert_eq!(
            keys,
            vec![
                "code",
                "data",
                "detail",
                "fromCache",
                "ok",
                "retryAfterSecs",
                "status"
            ]
        );
    }
}
