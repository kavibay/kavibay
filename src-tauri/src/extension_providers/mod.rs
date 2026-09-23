//! HTTP broker for extension-host providers (Phase 2).
//!
//! Finding 8 removed `getAccessToken()` from `ProviderHostContext`, so provider
//! code — which is TypeScript running in the webview — can no longer hold a
//! token. Something host-side has to attach the auth instead, and that is this
//! module.
//!
//! WHY THE ALLOWLIST IS COMPILED IN AND NOT READ FROM A MANIFEST. A provider's
//! declared `hosts` is the auth boundary: it decides where this app is willing
//! to send a credential. A value the webview supplies cannot decide that — same
//! rule as finding 7, the wire never carries what the host can derive. So the
//! compiled declaration is the authority, and `ProviderDefinition.hosts` in
//! TypeScript is documentation that must agree with it. Self-hosted providers
//! declare `HostRule::FromCredential` instead of a hostname list: the rule is
//! compiled in, the value is the origin the person typed.
//!
//! WHERE THE DECLARATIONS ARE. Not here. This module is the machinery — the
//! types, the host check, the send path, the three commands — and it names no
//! extension.
//!
//! Provider declarations are **generated** into `extensions::generated` from
//! `extensions/*/provider.ts`, which is now the single place a provider is
//! described (FINDINGS §28). They were hand-written in each extension's own
//! Rust module, which was one statement of a fact the TypeScript already made —
//! and this file's findings list is largely about what two statements of one
//! fact do to each other. Capability hosts stay hand-written per extension:
//! they belong to a widget, not to a provider, and there is no TypeScript
//! declaration to derive them from.
//!
//! WHAT THIS DELIBERATELY DOES NOT REBUILD. Address vetting is
//! `runtime_extensions::net_guard`, which is already exhaustively tested, and
//! credential storage/refresh/injection is `credentials::resolve`, which
//! AGENTS.md invariant 5 makes the only legal path for a secret. The reference
//! handoff suggests the `keyring` crate; that would be a second credential
//! system in a repo whose contributor guide forbids exactly that.

use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

use crate::credentials::resolve::{
    resolve_for_connection, resolve_for_owner, ResolveError, ResolvedCredential,
};
use crate::runtime_extensions::http::vetted_address_with;
use crate::runtime_extensions::net_guard::{is_user_network, AddressPolicy};

/// Hops an image fetch may take. Enough for a CDN, few enough to end.
const MAX_IMAGE_REDIRECTS: usize = 3;

const REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

/// Where a provider may send its credential.
///
/// `Exact` is a compiled hostname list (GitHub, Linear). `FromCredential` is
/// the compiled *rule* that the host must be the instance URL stored on the
/// credential (n8n). The webview cannot pick which of those a provider is.
pub enum HostRule {
    Exact(&'static [&'static str]),
    FromCredential { field: &'static str },
}

/// One provider the extension host may execute requests for.
pub struct ProviderDef {
    /// Matches `ProviderId` in the TypeScript contract: `<extension>/<name>`.
    pub id: &'static str,
    pub host_rule: HostRule,
    /// Credential type from `credentials::registry`, or `None` for a provider
    /// that needs no auth.
    pub credential_type: Option<&'static str>,
    /// Hosts this provider's pictures may be fetched from, for `kavibay-img`.
    ///
    /// Never merged with `host_rule`: no credential is attached on the picture
    /// path, and a list that served both purposes would be one edit away from
    /// sending a token to a CDN. Empty means this provider has no pictures,
    /// which is a refusal like any other.
    pub image_hosts: &'static [&'static str],
    /// Hostnames this provider's records live on, for `openExternal`.
    ///
    /// Separate from both other lists for the same reason they are separate
    /// from each other: `hosts` receives the credential, `image_hosts` is
    /// fetched by the host process, and this one is handed to the *user's
    /// browser*. A list serving two of those purposes is one edit away from
    /// sending a token somewhere it was never meant to go. Empty means this
    /// provider's widgets open nothing.
    pub link_hosts: &'static [&'static str],
}

impl ProviderDef {
    /// Exact hostnames, or empty when the host comes from the credential.
    pub fn exact_hosts(&self) -> &'static [&'static str] {
        match self.host_rule {
            HostRule::Exact(hosts) => hosts,
            HostRule::FromCredential { .. } => &[],
        }
    }

    fn address_policy(&self) -> AddressPolicy {
        match self.host_rule {
            HostRule::Exact(_) => AddressPolicy::PublicOnly,
            HostRule::FromCredential { .. } => AddressPolicy::UserSupplied,
        }
    }

    fn allows_cleartext_lan(&self) -> bool {
        matches!(self.host_rule, HostRule::FromCredential { .. })
    }
}

/// Hosts one extension may reach through its declared `http` capability.
///
/// A separate type from `ProviderDef` on purpose: no credential is ever
/// attached on this path, so unlike a provider's list this is not an auth
/// boundary — finding 11. Keeping them apart means a capability host cannot be
/// passed where a provider is expected and quietly gain a token.
pub struct CapabilityHosts {
    /// The extension id, not a provider id: capabilities belong to the widget.
    pub extension_id: &'static str,
    pub hosts: &'static [&'static str],
}

pub fn find(provider_id: &str) -> Option<&'static ProviderDef> {
    crate::extensions::providers().find(|provider| provider.id == provider_id)
}

pub fn capability_hosts(extension_id: &str) -> Option<&'static [&'static str]> {
    crate::extensions::capabilities()
        .find(|entry| entry.extension_id == extension_id)
        .map(|entry| entry.hosts)
}

/// Exact, case-insensitive hostname match against an `Exact` host rule.
///
/// `FromCredential` providers never match here: allowing a bare hostname
/// without the stored origin would be the webview choosing the host.
pub fn host_allowed(provider: &ProviderDef, host: &str) -> bool {
    listed(provider.exact_hosts(), host)
}

/// Whether this request may carry the provider's credential.
///
/// For `Exact`, the hostname must be on the compiled list. For
/// `FromCredential`, the request origin must match the stored instance URL.
pub fn request_allowed(
    provider: &ProviderDef,
    url: &url::Url,
    credential: Option<&ResolvedCredential>,
) -> bool {
    match provider.host_rule {
        HostRule::Exact(_) => host_allowed(provider, url.host_str().unwrap_or("")),
        HostRule::FromCredential { field } => {
            let Some(credential) = credential else {
                return false;
            };
            let Some(origin) = instance_origin(credential, field) else {
                return false;
            };
            origins_match(&origin, url)
        }
    }
}

fn instance_origin(credential: &ResolvedCredential, field: &str) -> Option<String> {
    credential
        .record
        .metadata
        .get(field)
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| credential.field(field).map(str::to_string))
}

fn origins_match(instance: &str, request: &url::Url) -> bool {
    let Ok(base) = url::Url::parse(instance) else {
        return false;
    };
    base.origin().ascii_serialization() == request.origin().ascii_serialization()
}

/// What the webview gets back. Carries no credential material and no resolved
/// address — nothing the host knows and the caller should not.
#[derive(Serialize)]
pub struct ProviderFetchResult {
    pub status: u16,
    pub body: Value,
}

/// Parses a body as JSON, falling back to a string so the caller always gets
/// something it can render.
fn body_to_value(body: &str) -> Value {
    serde_json::from_str(body).unwrap_or_else(|_| Value::String(body.to_string()))
}

/// Exact, case-insensitive match against a host list.
///
/// `pub(crate)` so an extension module can pin its own capability list without
/// having a provider to hand it.
pub(crate) fn listed(hosts: &[&str], host: &str) -> bool {
    hosts
        .iter()
        .any(|allowed| allowed.eq_ignore_ascii_case(host))
}

/// Fills `{{key}}` in a provider url from the credential's **metadata only**.
///
/// FINDING 13. The real Tado API is `/homes/{homeId}/zones`, and the home id is
/// credential-bound — finding 8 correctly put it out of provider reach, and
/// took the ability to address the API with it. A provider now writes the
/// placeholder and the host fills it in, so nothing credential-derived enters
/// the webview.
///
/// DELIBERATELY NOT `ResolvedCredential::render`, which also resolves
/// `{{accessToken}}`. A provider that could template that into its own url
/// would have a sanctioned way to send the token to a host it declared — the
/// exact hole finding 8 closed, reopened through the front door. Only the
/// identity probe's non-secret extras are available here, and nothing else.
///
/// Substitution happens *before* the scheme, host and address checks, so a
/// metadata value that changes where the request lands is still checked.
fn substitute_metadata(
    template: &str,
    metadata: Option<&serde_json::Map<String, Value>>,
) -> Result<String, String> {
    let mut out = String::with_capacity(template.len());
    let mut rest = template;

    while let Some(start) = rest.find("{{") {
        let end = rest[start..]
            .find("}}")
            .ok_or_else(|| "unterminated_placeholder".to_string())?;
        out.push_str(&rest[..start]);

        let key = rest[start + 2..start + end].trim();
        let value = metadata
            .and_then(|map| map.get(key))
            .ok_or_else(|| format!("unknown_placeholder:{key}"))?;
        match value {
            Value::String(text) => out.push_str(text),
            Value::Number(number) => out.push_str(&number.to_string()),
            // Anything else would stringify into something nobody intended in
            // a url — an object becomes `{...}`, a null becomes `null`.
            _ => return Err(format!("unusable_placeholder:{key}")),
        }
        rest = &rest[start + end + 2..];
    }

    out.push_str(rest);

    // A percent-encoded placeholder means the caller normalised the url through
    // a URL parser before sending it, which encodes `{{` into `%7B%7B` and
    // leaves nothing for the loop above to find. Saying so is the difference
    // between a named failure here and a remote 403 about "home 0" that takes
    // four rounds to trace back.
    if out.to_ascii_uppercase().contains("%7B%7B") {
        return Err("encoded_placeholder".to_string());
    }
    Ok(out)
}

/// Methods a provider fetch may use. PUT is here because Spotify play/pause
/// is PUT; DELETE and PATCH stay refused until a provider needs them.
fn provider_http_method(method: &str) -> Result<(), String> {
    match method.to_ascii_uppercase().as_str() {
        "GET" | "POST" | "PUT" => Ok(()),
        _ => Err("method_not_allowed".to_string()),
    }
}

/// Widget-capability fetches stay GET/POST. A widget never declared PUT.
fn capability_http_method(method: &str) -> Result<(), String> {
    match method.to_ascii_uppercase().as_str() {
        "GET" | "POST" => Ok(()),
        _ => Err("method_not_allowed".to_string()),
    }
}

/// The shared send path. Both entry points do their own authorisation first and
/// then hand over here, so address vetting, pinning and redirect policy cannot
/// drift apart between them.
async fn send_raw(
    url: &str,
    method: &str,
    body: Option<&Value>,
    credential: Option<crate::credentials::resolve::ResolvedCredential>,
    policy: AddressPolicy,
    allow_cleartext_lan: bool,
) -> Result<RawResponse, String> {
    let parsed = url::Url::parse(url).map_err(|_| "invalid_url".to_string())?;
    let host = parsed.host_str().ok_or("invalid_url")?.to_string();

    // Resolve first, then pin: the address that passed the check is the address
    // the connection uses, so a name cannot resolve elsewhere a moment later.
    let address = vetted_address_with(&parsed, policy).await?;

    if parsed.scheme() == "http" {
        if !(allow_cleartext_lan && is_user_network(address.ip())) {
            return Err("not_https".to_string());
        }
    } else if parsed.scheme() != "https" {
        return Err("not_https".to_string());
    }

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(REQUEST_TIMEOUT)
        .resolve(&host, address)
        .user_agent("kavibay-extension-host")
        .build()
        .map_err(|_| "network_error".to_string())?;

    let mut builder = match method.to_ascii_uppercase().as_str() {
        "GET" => client.get(parsed.clone()),
        "POST" => client.post(parsed.clone()),
        "PUT" => client.put(parsed.clone()),
        _ => return Err("method_not_allowed".to_string()),
    };
    // `Value::Null` is not a body. The webview sends `body: null` for a GET,
    // and serde turns that into `Some(Null)` rather than `None` — which made
    // every GET carry a JSON body of `null` and a Content-Type to match. tado°
    // answers such a request with 403, and the widget reported
    // "permission-denied", which is a very convincing wrong explanation.
    if let Some(payload) = body.filter(|value| !value.is_null()) {
        builder = builder.json(payload);
    }

    // Applied last, so nothing the caller sent can shadow the auth header.
    if let Some(credential) = credential {
        builder = builder.apply_credential(credential)?;
    }

    let response = builder
        .send()
        .await
        .map_err(|_| "network_error".to_string())?;
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let location = response
        .headers()
        .get(reqwest::header::LOCATION)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let body = response.bytes().await.unwrap_or_default().to_vec();

    Ok(RawResponse {
        status,
        content_type,
        location,
        body,
    })
}

/// A response before anything decides what it is.
///
/// Two callers want two different things from one fetch: a provider query wants
/// JSON, a picture wants bytes it must not touch. Splitting *after* the shared
/// send is what keeps address vetting, pinning and the redirect policy from
/// drifting apart between them — the mistake this module already warns about
/// once, and a second fetch path written beside this one would be it happening.
pub struct RawResponse {
    pub status: u16,
    pub content_type: Option<String>,
    /// `Location`, kept because the client refuses to follow redirects itself.
    ///
    /// Not following them is the point: `Policy::none()` is what stops a
    /// vetted, pinned address from handing the connection to an unvetted one.
    /// A caller that must follow one re-runs its own checks per hop, which is
    /// what `extension_provider_image` does.
    pub location: Option<String>,
    pub body: Vec<u8>,
}

/// The JSON-shaped view, for provider queries and capability calls.
async fn send(
    url: &str,
    method: &str,
    body: Option<&Value>,
    credential: Option<crate::credentials::resolve::ResolvedCredential>,
    policy: AddressPolicy,
    allow_cleartext_lan: bool,
) -> Result<ProviderFetchResult, String> {
    let raw = send_raw(url, method, body, credential, policy, allow_cleartext_lan).await?;
    let text = String::from_utf8_lossy(&raw.body);
    Ok(ProviderFetchResult {
        status: raw.status,
        body: body_to_value(&text),
    })
}

/// Executes one provider request with the credential attached host-side.
///
/// `provider_id` is checked against the provider table; an unknown provider is
/// refused rather than treated as unauthenticated, so a typo cannot silently
/// downgrade a request to anonymous.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn extension_provider_fetch(
    app: AppHandle,
    provider_id: String,
    url: String,
    method: String,
    body: Option<Value>,
    owner: Option<String>,
    credential_id: Option<String>,
    package_id: Option<String>,
) -> Result<ProviderFetchResult, String> {
    let provider = find(&provider_id).ok_or("unknown_provider")?;
    provider_http_method(&method)?;

    // Resolve before checking: the url may still contain placeholders, and what
    // matters is that the *final* url passes every check (finding 13).
    let credential = match provider.credential_type {
        None => None,
        Some(type_id) => {
            let binding = crate::credentials::bindings::selection(
                &crate::credentials::db::open_db(&app)?,
                owner.as_deref().ok_or("connection_required")?,
                type_id,
            )?;
            let credential_id = bound_connection(&binding, credential_id.as_deref())?;
            if let Some(package_id) = &package_id {
                if !crate::runtime_extensions::installs::has_credential_grant(
                    &app,
                    base_package_id(package_id),
                    &credential_id,
                ) {
                    return Err("credential_not_granted".into());
                }
            }
            Some(
                resolve_for_connection(&app, type_id, &credential_id)
                    .await
                    .map_err(|error| match error {
                        ResolveError::NotConfigured => "disconnected".to_string(),
                        other => other.to_string(),
                    })?,
            )
        }
    };

    let url = substitute_metadata(&url, credential.as_ref().map(|c| &c.record.metadata))?;

    let parsed = url::Url::parse(&url).map_err(|_| "invalid_url".to_string())?;
    match parsed.scheme() {
        "https" => {}
        "http" if provider.allows_cleartext_lan() => {}
        _ => return Err("not_https".to_string()),
    }
    if !request_allowed(provider, &parsed, credential.as_ref()) {
        return Err("host_not_allowed".to_string());
    }

    send(
        &url,
        &method,
        body.as_ref(),
        credential,
        provider.address_policy(),
        provider.allows_cleartext_lan(),
    )
    .await
}

/// Fetches one picture for `kavibay-img`, with no credential of any kind.
///
/// Separate from both entry points above rather than a flag on either. The
/// difference is not "which allowlist" but "may a credential go at all", and
/// that answer is no here — a cover url is public, and the one thing that must
/// never happen is a token reaching an image CDN because a list was reused.
///
/// The url arrives from a vendor response by way of the webview, so it is
/// checked here and not before: `send` re-resolves and pins the address, which
/// is what keeps a url the vendor chose from naming something on the loopback.
pub async fn extension_provider_image(provider_id: &str, url: &str) -> Result<RawResponse, String> {
    let provider = find(provider_id).ok_or("unknown_provider")?;
    let mut current = url.to_string();
    // Image CDNs redirect — between regions, and from a bare path to a sized
    // variant. Refusing outright would fail on the first cover, and letting
    // reqwest follow would hand a vetted, pinned address to an unvetted one.
    // So each hop is a fresh request that passes the same checks as the first.
    for _ in 0..MAX_IMAGE_REDIRECTS {
        let parsed = url::Url::parse(&current).map_err(|_| "invalid_url".to_string())?;
        if parsed.scheme() != "https" {
            return Err("not_https".to_string());
        }
        let host = parsed.host_str().ok_or("invalid_url")?;
        if !listed(provider.image_hosts, host) {
            return Err("host_not_allowed".to_string());
        }
        let raw = send_raw(
            &current,
            "GET",
            None,
            None,
            AddressPolicy::PublicOnly,
            false,
        )
        .await?;
        let redirecting = matches!(raw.status, 301 | 302 | 303 | 307 | 308);
        match raw.location.clone().filter(|_| redirecting) {
            // Resolved against the url it came from, so a relative `Location`
            // reaches the same check a absolute one does.
            Some(location) => {
                current = parsed
                    .join(&location)
                    .map_err(|_| "invalid_url".to_string())?
                    .to_string()
            }
            None => return Ok(raw),
        }
    }
    Err("too_many_redirects".into())
}

/// Executes one widget-capability request. No credential is resolved on this
/// path, ever — that is the whole difference from the provider entry point.
#[tauri::command]
pub async fn extension_capability_fetch(
    extension_id: String,
    url: String,
    method: String,
    body: Option<Value>,
) -> Result<ProviderFetchResult, String> {
    let hosts = capability_hosts(&extension_id).ok_or("unknown_extension")?;
    capability_http_method(&method)?;
    let parsed = url::Url::parse(&url).map_err(|_| "invalid_url".to_string())?;
    if parsed.scheme() != "https" {
        return Err("not_https".to_string());
    }
    if !listed(hosts, parsed.host_str().ok_or("invalid_url")?) {
        return Err("host_not_allowed".to_string());
    }

    send(
        &url,
        &method,
        body.as_ref(),
        None,
        AddressPolicy::PublicOnly,
        false,
    )
    .await
}

/// Backs `ProviderHostContext.credentials.isConnected()`.
///
/// Returns a boolean and nothing else — the one thing provider code may know
/// about a credential is whether it exists.
#[tauri::command]
pub async fn extension_provider_is_connected(
    app: AppHandle,
    provider_id: String,
    owner: String,
) -> Result<bool, String> {
    let provider = find(&provider_id).ok_or("unknown_provider")?;
    let Some(type_id) = provider.credential_type else {
        return Ok(true); // nothing to connect
    };
    Ok(resolve_for_owner(&app, type_id, &owner).await.is_ok())
}

#[tauri::command]
pub fn extension_provider_connection(
    app: AppHandle,
    provider_id: String,
    owner: String,
    package_id: Option<String>,
) -> Result<Option<crate::credentials::bindings::ConnectionBinding>, String> {
    let provider = find(&provider_id).ok_or("unknown_provider")?;
    let mut binding = provider
        .credential_type
        .map(|type_id| {
            crate::credentials::bindings::selection(
                &crate::credentials::db::open_db(&app)?,
                &owner,
                type_id,
            )
        })
        .transpose()?;
    if let (Some(package_id), Some(binding)) = (package_id, binding.as_mut()) {
        let package_id = base_package_id(&package_id);
        binding.available &= binding.credential_id.as_ref().is_some_and(|id| {
            crate::runtime_extensions::installs::has_credential_grant(&app, package_id, id)
        });
    }
    Ok(binding)
}

/// A draft of an installed widget is that widget being edited, not a stranger,
/// so its grants are the kept package's.
///
/// Both the status check above and `extension_provider_fetch` have to agree on
/// this. They did not: the fetch path stripped the prefix and the status path
/// did not, so a preview of a granted widget reported itself disconnected and
/// never got as far as the request that would have worked.
fn base_package_id(package_id: &str) -> &str {
    package_id
        .strip_prefix(crate::runtime_extensions::http::DRAFT_PREFIX)
        .unwrap_or(package_id)
}

/// The account a provider request may use: the one bound to its owner.
///
/// The webview also names the account it expects, because its cache is keyed
/// by it — but the account comes from the binding, not from the wire
/// (CLAUDE.md invariant 4); the wire only has to agree. Taking the wire's id
/// let a caller that sent no package id spend any saved account, not just
/// the one its owner is bound to. A mismatch is either an
/// owner that switched accounts after the host read its connection, where
/// answering would file one account's rows under the other's key, or an id
/// that was never this owner's.
fn bound_connection(
    binding: &crate::credentials::bindings::ConnectionBinding,
    requested: Option<&str>,
) -> Result<String, String> {
    let bound = binding.credential_id.as_deref().ok_or("disconnected")?;
    if requested != Some(bound) {
        return Err("connection_changed".into());
    }
    Ok(bound.to_string())
}

/// Hands one provider-vouched url to the OS browser.
///
/// Two checks guard this, deliberately at different altitudes. The precise one
/// — *which* providers this particular widget declares — is the host's, because
/// a draft being previewed in the Wizard has no package on disk whose manifest
/// could be read here. This is the backstop underneath it: a url whose host no
/// shipped provider vouches for is refused whatever asked for it, and that list
/// is compiled in, so neither a generated widget nor the host process can widen
/// it.
///
/// The url itself is data from a vendor response, which is exactly why the
/// check is on the *host* rather than on the path that produced it.
#[tauri::command]
pub fn extension_open_external(url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|_| "invalid_url".to_string())?;
    if parsed.scheme() != "https" {
        return Err("not_https".into());
    }
    let host = parsed.host_str().ok_or("invalid_url")?;
    if !crate::extensions::providers().any(|provider| listed(provider.link_hosts, host)) {
        return Err("host_not_allowed".into());
    }
    crate::extensions::app_launcher::launch_path(parsed.to_string())
}

/// Lets `ResolvedCredential::apply` be used in a builder chain.
trait ApplyCredential {
    fn apply_credential(
        self,
        credential: crate::credentials::resolve::ResolvedCredential,
    ) -> Result<reqwest::RequestBuilder, String>;
}

impl ApplyCredential for reqwest::RequestBuilder {
    fn apply_credential(
        self,
        credential: crate::credentials::resolve::ResolvedCredential,
    ) -> Result<reqwest::RequestBuilder, String> {
        credential.apply(self).map_err(|error| error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::credentials::registry as credential_registry;

    /// One provider's allowlist must not admit another's hosts, or a credential
    /// could be attached to the wrong service. Stated over the gathered list
    /// rather than about two named providers, so it keeps holding as extensions
    /// are added — which is the property the old hand-written pair could not
    /// have.
    #[test]
    fn providers_do_not_share_allowlists() {
        for provider in crate::extensions::providers() {
            for other in crate::extensions::providers() {
                if provider.id == other.id {
                    continue;
                }
                for host in other.exact_hosts() {
                    assert!(
                        !host_allowed(provider, host),
                        "{} admits {}'s host {host}",
                        provider.id,
                        other.id
                    );
                }
            }
        }
    }

    /// Two extensions must not claim the same provider id: `find` returns the
    /// first, so the second would be silently unreachable.
    #[test]
    fn provider_ids_are_unique() {
        let all: Vec<_> = crate::extensions::providers().collect();
        for (index, provider) in all.iter().enumerate() {
            assert!(
                !all[..index].iter().any(|earlier| earlier.id == provider.id),
                "duplicate provider id {}",
                provider.id
            );
        }
    }

    /// Same for capability declarations, for the same reason.
    #[test]
    fn capability_extension_ids_are_unique() {
        let all: Vec<_> = crate::extensions::capabilities().collect();
        for (index, entry) in all.iter().enumerate() {
            assert!(
                !all[..index]
                    .iter()
                    .any(|earlier| earlier.extension_id == entry.extension_id),
                "duplicate capability extension id {}",
                entry.extension_id
            );
        }
    }

    /// Providers may PUT (Spotify play/pause). Widget capabilities may not —
    /// that path never carries a credential, but it also must not grow methods
    /// a widget did not declare.
    #[test]
    fn provider_fetch_allows_put_and_capability_fetch_does_not() {
        assert!(provider_http_method("PUT").is_ok());
        assert!(provider_http_method("put").is_ok());
        assert!(provider_http_method("GET").is_ok());
        assert!(provider_http_method("POST").is_ok());
        assert_eq!(
            provider_http_method("DELETE").unwrap_err(),
            "method_not_allowed"
        );
        assert_eq!(
            capability_http_method("PUT").unwrap_err(),
            "method_not_allowed"
        );
        assert!(capability_http_method("GET").is_ok());
        assert!(capability_http_method("POST").is_ok());
    }

    /// A GET must not carry a body. The webview sends `body: null` for one, and
    /// `Option<Value>` reads that as `Some(Null)` — so without the filter every
    /// GET went out with a JSON `null` payload and a Content-Type, which tado°
    /// answers with 403.
    #[test]
    fn an_explicit_null_is_not_a_body() {
        let null = Some(Value::Null);
        assert!(
            null.filter(|value| !value.is_null()).is_none(),
            "null is no body"
        );

        let real = Some(serde_json::json!({ "temperature": 21 }));
        assert!(
            real.filter(|value| !value.is_null()).is_some(),
            "an object still is"
        );

        let absent: Option<Value> = None;
        assert!(absent.filter(|value| !value.is_null()).is_none());
    }

    /// The failure that reached a user: a caller ran the url through a URL
    /// parser, `{{homeId}}` became `%7B%7BhomeId%7D%7D`, no substitution
    /// happened, and tado° replied 403 "not allowed to access home 0".
    #[test]
    fn a_percent_encoded_placeholder_is_refused_rather_than_sent() {
        let map = metadata(&[("homeId", Value::from(12345))]);
        let error = substitute_metadata(
            "https://my.tado.com/api/v2/homes/%7B%7BhomeId%7D%7D/zones",
            Some(&map),
        )
        .expect_err("must refuse");
        assert_eq!(error, "encoded_placeholder");

        // Lowercase encoding is the same mistake.
        assert!(substitute_metadata("https://h/%7b%7bhomeId%7d%7d", Some(&map)).is_err());
    }

    #[test]
    fn unknown_provider_is_not_found() {
        assert!(find("kavibay.ghost/gone").is_none());
    }

    fn metadata(pairs: &[(&str, Value)]) -> serde_json::Map<String, Value> {
        pairs
            .iter()
            .map(|(key, value)| ((*key).to_string(), value.clone()))
            .collect()
    }

    #[test]
    fn placeholders_are_filled_from_metadata() {
        let map = metadata(&[
            ("homeId", Value::from(12345)),
            ("homeName", Value::from("Zuhause")),
        ]);
        assert_eq!(
            substitute_metadata(
                "https://my.tado.com/api/v2/homes/{{homeId}}/zones",
                Some(&map)
            )
            .expect("substitutes"),
            "https://my.tado.com/api/v2/homes/12345/zones"
        );
        // More than one, and text as well as numbers.
        assert_eq!(
            substitute_metadata("https://h/{{homeId}}/{{homeName}}", Some(&map)).expect("both"),
            "https://h/12345/Zuhause"
        );
        // A url without placeholders must survive untouched.
        assert_eq!(
            substitute_metadata("https://my.tado.com/api/v2/me", Some(&map)).expect("plain"),
            "https://my.tado.com/api/v2/me"
        );
    }

    /// The load-bearing one. Templating the token would be a sanctioned way to
    /// send it to a declared host — finding 8 reopened through the front door.
    #[test]
    fn the_access_token_is_not_a_placeholder() {
        let map = metadata(&[("homeId", Value::from(1))]);
        let error = substitute_metadata("https://my.tado.com/x?t={{accessToken}}", Some(&map))
            .expect_err("must refuse");
        assert!(error.contains("unknown_placeholder"), "got {error}");
    }

    #[test]
    fn unresolvable_placeholders_are_refused_rather_than_left_in_the_url() {
        let map = metadata(&[("homeId", Value::from(1))]);
        assert!(substitute_metadata("https://h/{{nope}}", Some(&map)).is_err());
        assert!(
            substitute_metadata("https://h/{{homeId}}", None).is_err(),
            "no credential"
        );
        assert!(substitute_metadata("https://h/{{unclosed", Some(&map)).is_err());
        // An object or null would stringify into nonsense inside a url.
        let odd = metadata(&[("homeId", Value::Null)]);
        assert!(substitute_metadata("https://h/{{homeId}}", Some(&odd)).is_err());
    }

    /// Substitution runs before the host check, so metadata cannot redirect a
    /// request past the allowlist — the check sees the final url.
    #[test]
    fn a_substituted_host_is_still_checked() {
        // A provider made up here rather than a shipped one: this pins the
        // machinery, and borrowing a real extension's allowlist would make the
        // test fail for the unrelated reason that the extension changed.
        let provider = ProviderDef {
            id: "test/provider",
            host_rule: HostRule::Exact(&["allowed.example"]),
            credential_type: None,
            image_hosts: &[],
            link_hosts: &[],
        };
        let map = metadata(&[("homeId", Value::from("evil.example.com/x"))]);
        let final_url = substitute_metadata("https://{{homeId}}", Some(&map)).expect("substitutes");
        let parsed = url::Url::parse(&final_url).expect("parses");
        assert!(
            !host_allowed(&provider, parsed.host_str().expect("host")),
            "a metadata-supplied host must not pass the allowlist"
        );
    }

    /// An extension that declares no capability gets `None`, not an empty
    /// allowlist that reads as "declared, allows nothing".
    #[test]
    fn an_undeclared_extension_has_no_capability_hosts() {
        assert!(capability_hosts("kavibay.nothing-declared").is_none());
    }

    /// The two declarations answer different questions. A capability host must
    /// never be reachable on the provider path, where a credential is attached
    /// — and no provider host may be reachable capability-side either.
    ///
    /// SCOPED TO PROVIDERS THAT CARRY A CREDENTIAL, which every provider did
    /// when this was written. Both assertions below state a credential as their
    /// reason — "would attach a credential to", "may reach it without one" —
    /// and for `credential_type: None` neither sentence is true: nothing is
    /// attached on either path, so the two lists describe the same, weaker
    /// thing (a CSP and SSRF boundary) and overlapping is not a leak.
    ///
    /// Weather is the first such provider. Open-Meteo needs no key, and it is a
    /// provider because the Widget Wizard can only offer a person a provider —
    /// so its hosts are legitimately reachable both ways, by the same extension,
    /// with no secret in play either time. Narrowing here rather than deleting:
    /// `a_credentialed_provider_still_may_not_share_a_capability_host` below
    /// keeps the real rule under test.
    #[test]
    fn capability_hosts_are_not_provider_hosts() {
        for entry in crate::extensions::capabilities() {
            for provider in crate::extensions::providers() {
                if provider.credential_type.is_none() {
                    continue;
                }
                for host in entry.hosts {
                    assert!(
                        !host_allowed(provider, host),
                        "{} would attach a credential to {host}, declared by {}",
                        provider.id,
                        entry.extension_id
                    );
                }
                for host in provider.exact_hosts() {
                    assert!(
                        !listed(entry.hosts, host),
                        "{} may reach {}'s host {host} without one",
                        entry.extension_id,
                        provider.id
                    );
                }
            }
        }
    }

    /// The rule the test above narrows, kept under test on synthetic values.
    ///
    /// Synthetic on purpose: the check it exercises is the one that runs over
    /// the shipped declarations, but pinning it to whichever extension happens
    /// to overlap today would make it fail for the unrelated reason that an
    /// extension changed. What must never be allowed to drift is the direction
    /// of the rule — a provider that *does* attach a credential may not share a
    /// host with any capability list.
    #[test]
    fn a_credentialed_provider_still_may_not_share_a_capability_host() {
        let provider = ProviderDef {
            id: "test/credentialed",
            host_rule: HostRule::Exact(&["shared.example"]),
            credential_type: Some("someToken"),
            image_hosts: &[],
            link_hosts: &[],
        };
        let capability = CapabilityHosts {
            extension_id: "test.other",
            hosts: &["shared.example"],
        };

        assert!(
            provider.credential_type.is_some(),
            "the premise of the rule"
        );
        assert!(
            host_allowed(&provider, capability.hosts[0]),
            "the overlap this must catch is exactly host_allowed returning true",
        );
        assert!(
            listed(capability.hosts, provider.exact_hosts()[0]),
            "and the reverse direction"
        );
    }

    /// A request spends the account bound to its owner and no other, whatever
    /// id the webview puts next to it.
    #[test]
    fn a_request_can_only_spend_its_owners_account() {
        let binding = |id: Option<&str>| crate::credentials::bindings::ConnectionBinding {
            type_id: "linearApi".into(),
            credential_id: id.map(str::to_string),
            available: true,
            revision: 1,
        };
        assert_eq!(
            bound_connection(&binding(Some("work")), Some("work")),
            Ok("work".to_string())
        );
        assert_eq!(
            bound_connection(&binding(Some("work")), Some("personal")),
            Err("connection_changed".to_string()),
            "another saved account is refused, not used",
        );
        assert_eq!(
            bound_connection(&binding(Some("work")), None),
            Err("connection_changed".to_string()),
            "naming no account does not mean \"any\"",
        );
        assert_eq!(
            bound_connection(&binding(None), Some("work")),
            Err("disconnected".to_string()),
            "an owner with no account chosen gets none",
        );
    }

    /// Linear issues live on `linear.app`, not `api.linear.app`. The backstop
    /// under `openExternal` is this compiled list, and a click that reached
    /// the OS for a host nobody vouched for would be the failure the host
    /// check exists to prevent.
    #[test]
    fn a_vouched_link_host_is_not_the_api_host() {
        let linear = crate::extensions::providers()
            .find(|provider| provider.id == "kavibay.linear/linear")
            .expect("linear ships");
        assert!(
            listed(linear.link_hosts, "linear.app"),
            "issue pages live on linear.app",
        );
        assert!(
            !listed(linear.link_hosts, "api.linear.app"),
            "the API host is where the credential goes, not the browser",
        );
        assert!(
            !crate::extensions::providers()
                .any(|provider| listed(provider.link_hosts, "evil.example")),
            "a host nobody declared must not open",
        );
    }

    /// A declaration with no hosts allows nothing and is a mistake either way.
    #[test]
    fn every_capability_declares_at_least_one_host() {
        for entry in crate::extensions::capabilities() {
            assert!(
                !entry.hosts.is_empty(),
                "{} declares no hosts",
                entry.extension_id
            );
        }
    }

    /// Every declared credential type must exist in the credential registry,
    /// otherwise a request would resolve nothing and silently go out anonymous.
    #[test]
    fn declared_credential_types_are_registered() {
        for provider in crate::extensions::providers() {
            if let Some(type_id) = provider.credential_type {
                assert!(
                    credential_registry::find(type_id).is_some(),
                    "{} declares unknown credential type {type_id}",
                    provider.id
                );
            }
        }
    }

    /// FromCredential matches the stored origin, never a hostname the webview
    /// picked, and a missing credential is a refusal rather than an open relay.
    #[test]
    fn from_credential_matches_the_stored_origin_only() {
        use crate::credentials::registry::N8N_API;
        let provider = ProviderDef {
            id: "test/n8n",
            host_rule: HostRule::FromCredential { field: "origin" },
            credential_type: Some(N8N_API),
            image_hosts: &[],
            link_hosts: &[],
        };
        let mut metadata = serde_json::Map::new();
        metadata.insert(
            "origin".into(),
            Value::String("https://n8n.example.com".into()),
        );
        let cred = ResolvedCredential::for_test(
            credential_registry::require(N8N_API).unwrap(),
            metadata,
            &[("origin", "https://n8n.example.com"), ("apiKey", "k")],
        );
        let ok = url::Url::parse("https://n8n.example.com/api/v1/workflows").unwrap();
        let other = url::Url::parse("https://evil.example/api/v1/workflows").unwrap();
        assert!(request_allowed(&provider, &ok, Some(&cred)));
        assert!(!request_allowed(&provider, &other, Some(&cred)));
        assert!(!request_allowed(&provider, &ok, None));
        assert!(
            !host_allowed(&provider, "n8n.example.com"),
            "a bare hostname must not pass without the stored origin"
        );
    }

    /// A declaration with no hosts allows nothing and is a mistake either way
    /// — unless the host is the instance URL on the credential, which is the
    /// compiled rule rather than an empty list.
    #[test]
    fn every_provider_declares_where_it_may_send() {
        for provider in crate::extensions::providers() {
            match provider.host_rule {
                HostRule::Exact(hosts) => {
                    assert!(!hosts.is_empty(), "{} declares no hosts", provider.id)
                }
                HostRule::FromCredential { field } => assert!(
                    !field.is_empty(),
                    "{} declares FromCredential with an empty field",
                    provider.id
                ),
            }
        }
    }
}
