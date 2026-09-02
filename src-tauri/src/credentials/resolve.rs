//! The single entry point integrations use to obtain credentials.
//!
//! API modules never open a credential database, never decrypt, and never see
//! a refresh token: they call [`resolve_for_type`] (or [`resolve`] with an
//! explicit id) and either read a field or hand the resulting bundle to
//! [`ResolvedCredential::apply`], which injects the secret exactly as the type
//! definition declares.

use reqwest::RequestBuilder;
use tauri::AppHandle;

use super::db::{self, CredentialRecord, CredentialState, SecretData};
use super::registry;
use super::types::{render_template, AuthKind, CredentialTypeDef, Injection};

/// Why a credential could not be resolved.
///
/// `NotConfigured` is separate from `Failed` because widgets render a "set this
/// up" state for the former and an error for the latter.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolveError {
    /// No credential of this type exists, or required fields are missing.
    NotConfigured,
    /// Tokens exist but the provider rejected them; the user must reconnect.
    NeedsReauth,
    Failed(String),
}

impl std::fmt::Display for ResolveError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ResolveError::NotConfigured => write!(f, "not_configured"),
            ResolveError::NeedsReauth => write!(f, "needs_reauth"),
            ResolveError::Failed(message) => write!(f, "{message}"),
        }
    }
}

impl From<ResolveError> for String {
    fn from(error: ResolveError) -> Self {
        error.to_string()
    }
}

impl From<String> for ResolveError {
    fn from(message: String) -> Self {
        ResolveError::Failed(message)
    }
}

/// A ready-to-use credential. Backend-only: it holds plaintext secrets and is
/// deliberately not `Serialize`.
pub struct ResolvedCredential {
    pub type_def: &'static CredentialTypeDef,
    pub record: CredentialRecord,
    secret: SecretData,
}

impl ResolvedCredential {
    /// Non-empty value of a declared field.
    pub fn field(&self, key: &str) -> Option<&str> {
        self.secret.field(key)
    }

    /// Field value or a configuration error naming the field.
    pub fn require_field(&self, key: &str) -> Result<&str, ResolveError> {
        self.field(key).ok_or(ResolveError::NotConfigured)
    }

    /// Current OAuth access token (already refreshed by `resolve`).
    pub fn access_token(&self) -> Option<&str> {
        self.secret
            .oauth
            .as_ref()
            .map(|tokens| tokens.access_token.as_str())
            .filter(|token| !token.is_empty())
    }

    /// Resolves a `{{key}}` template against fields + the synthetic
    /// `accessToken`.
    fn render(&self, template: &str) -> Result<String, ResolveError> {
        render_template(template, |key| {
            if key == "accessToken" {
                return self.access_token().map(str::to_string);
            }
            self.field(key).map(str::to_string)
        })
        .map_err(ResolveError::Failed)
    }

    /// Attaches the credential to a request as the type definition declares.
    pub fn apply(&self, request: RequestBuilder) -> Result<RequestBuilder, ResolveError> {
        match self.type_def.inject {
            Injection::Bearer {
                value,
                extra_headers,
            } => {
                let mut request = request.bearer_auth(self.render(value)?);
                for (name, header) in extra_headers {
                    request = request.header(*name, *header);
                }
                Ok(request)
            }
            Injection::Header { name, value } => Ok(request.header(name, self.render(value)?)),
            Injection::Query { params } => {
                let mut pairs: Vec<(&str, String)> = Vec::with_capacity(params.len());
                for (name, template) in params.iter() {
                    pairs.push((*name, self.render(template)?));
                }
                Ok(request.query(&pairs))
            }
        }
    }

    /// Test helper: a resolved credential with metadata and fields, no store.
    #[cfg(test)]
    pub fn for_test(
        type_def: &'static CredentialTypeDef,
        metadata: serde_json::Map<String, serde_json::Value>,
        fields: &[(&str, &str)],
    ) -> Self {
        use crate::credentials::db::{CredentialRecord, CredentialState};
        let mut secret = SecretData::default();
        for (key, value) in fields {
            secret.fields.insert((*key).into(), (*value).into());
        }
        Self {
            type_def,
            record: CredentialRecord {
                id: "test".into(),
                type_id: type_def.id.into(),
                name: "test".into(),
                account_label: None,
                state: CredentialState::Connected,
                metadata,
                created_at: 0,
                updated_at: 0,
            },
            secret,
        }
    }
}

/// A field's value: stored first, then the type's declared environment
/// override (the per-integration developer/CI escape hatch that existed before
/// this layer, e.g. `KAVIBAY_GOOGLE_CALENDAR_CLIENT_ID`).
pub fn field_value(type_def: &CredentialTypeDef, secret: &SecretData, key: &str) -> Option<String> {
    if let Some(value) = secret.field(key) {
        return Some(value.to_string());
    }
    let env = type_def.field(key)?.env?;
    std::env::var(env)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// True when every required field of the type has a value.
pub fn has_required_fields(type_def: &CredentialTypeDef, secret: &SecretData) -> bool {
    type_def
        .required_field_keys()
        .all(|key| field_value(type_def, secret, key).is_some())
}

/// Resolves the credential bound to `credential_id`.
pub async fn resolve(
    app: &AppHandle,
    credential_id: &str,
) -> Result<ResolvedCredential, ResolveError> {
    let conn = db::open_db(app)?;
    // A widget may poll before Settings was ever opened, so the one-time import
    // of the pre-abstraction stores has to be reachable from this path too.
    super::import::run_pending_imports(app, &conn);
    let record = db::load(&conn, credential_id)?.ok_or(ResolveError::NotConfigured)?;
    let type_def = registry::require(&record.type_id)?;
    let mut secret = db::load_secret(&conn, credential_id)?.unwrap_or_default();
    drop(conn);

    if !has_required_fields(type_def, &secret) {
        return Err(ResolveError::NotConfigured);
    }

    match type_def.auth {
        AuthKind::Static => {}
        AuthKind::OAuth2AuthCode(_) | AuthKind::OAuth2DeviceCode(_) => {
            if record.state == CredentialState::NeedsReauth {
                return Err(ResolveError::NeedsReauth);
            }
            if secret.oauth.is_none() {
                return Err(ResolveError::NotConfigured);
            }
            // Refresh-on-read: callers always get a token that is valid right
            // now, so no integration has to reason about expiry.
            secret = super::oauth::ensure_fresh(app, &record).await?;
        }
    }

    Ok(ResolvedCredential {
        type_def,
        record,
        secret,
    })
}

/// Resolves the credential of a given type. While the UI is single-credential
/// per type this is what integrations call.
pub async fn resolve_for_type(
    app: &AppHandle,
    type_id: &str,
) -> Result<ResolvedCredential, ResolveError> {
    let conn = db::open_db(app)?;
    super::import::run_pending_imports(app, &conn);
    let record = db::find_by_type(&conn, type_id)?.ok_or(ResolveError::NotConfigured)?;
    drop(conn);
    resolve(app, &record.id).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::credentials::db::{CredentialRecord, CredentialState};
    use crate::credentials::registry::{CLOUDFLARE_WORKERS_AI, GITHUB_PAT, NOTION_API, TRELLO_API};

    fn secret_with(pairs: &[(&str, &str)]) -> SecretData {
        let mut data = SecretData::default();
        for (key, value) in pairs {
            data.fields.insert((*key).into(), (*value).into());
        }
        data
    }

    fn dummy_record(type_id: &str) -> CredentialRecord {
        CredentialRecord {
            id: "c".into(),
            type_id: type_id.into(),
            name: "test".into(),
            account_label: None,
            state: CredentialState::Connected,
            metadata: Default::default(),
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn required_fields_gate_resolution() {
        let github = registry::require(GITHUB_PAT).unwrap();
        assert!(!has_required_fields(github, &SecretData::default()));
        assert!(has_required_fields(github, &secret_with(&[("token", "t")])));

        let cloudflare = registry::require(CLOUDFLARE_WORKERS_AI).unwrap();
        assert!(!has_required_fields(
            cloudflare,
            &secret_with(&[("accountId", "acc")])
        ));
        assert!(has_required_fields(
            cloudflare,
            &secret_with(&[("accountId", "acc"), ("apiToken", "tok")])
        ));
    }

    /// Trello's broker must append `key` and `token` without dropping filters
    /// the provider already put on the URL.
    #[test]
    fn trello_query_injection_appends_without_replacing() {
        let cred = ResolvedCredential {
            type_def: registry::require(TRELLO_API).unwrap(),
            record: dummy_record(TRELLO_API),
            secret: secret_with(&[("apiKey", "k"), ("token", "t")]),
        };
        let built = cred
            .apply(
                reqwest::Client::new().get("https://api.trello.com/1/boards/1/cards?filter=open"),
            )
            .unwrap()
            .build()
            .unwrap();
        let url = built.url();
        let pairs: Vec<(String, String)> = url
            .query_pairs()
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect();
        assert!(
            pairs.iter().any(|(k, v)| k == "filter" && v == "open"),
            "existing query params survive: {pairs:?}"
        );
        assert!(
            pairs.iter().any(|(k, v)| k == "key" && v == "k"),
            "apiKey is sent as key: {pairs:?}"
        );
        assert!(
            pairs.iter().any(|(k, v)| k == "token" && v == "t"),
            "token is sent as token: {pairs:?}"
        );
    }

    /// Notion's version header is attached with the token, not only on Test.
    #[test]
    fn notion_version_header_is_on_every_injected_request() {
        let cred = ResolvedCredential {
            type_def: registry::require(NOTION_API).unwrap(),
            record: dummy_record(NOTION_API),
            secret: secret_with(&[("token", "ntn_test")]),
        };
        let built = cred
            .apply(reqwest::Client::new().get("https://api.notion.com/v1/users/me"))
            .unwrap()
            .build()
            .unwrap();
        assert_eq!(
            built
                .headers()
                .get("Notion-Version")
                .and_then(|v| v.to_str().ok()),
            Some("2022-06-28")
        );
        assert_eq!(
            built
                .headers()
                .get(reqwest::header::AUTHORIZATION)
                .and_then(|v| v.to_str().ok()),
            Some("Bearer ntn_test")
        );
    }

    #[test]
    fn errors_stringify_to_stable_codes() {
        assert_eq!(String::from(ResolveError::NotConfigured), "not_configured");
        assert_eq!(String::from(ResolveError::NeedsReauth), "needs_reauth");
        assert_eq!(
            String::from(ResolveError::Failed("boom".into())),
            "boom".to_string()
        );
    }
}
