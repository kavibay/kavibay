//! Declarative credential type model.
//!
//! A credential *type* describes what a user has to enter and how the resulting
//! secret reaches an HTTP request — as data, not code. The registry
//! (`registry.rs`) holds one `CredentialTypeDef` per integration; the store
//! (`db.rs`) holds user-entered values; `resolve.rs` turns the two into a usable
//! secret bundle.
//!
//! Only [`CredentialTypeSchema`] (labels, field kinds, urls) is ever serialized
//! to the frontend — never a value. See AGENTS.md invariant 5.

use serde::Serialize;

/// One input rendered by the generic credential editor.
#[derive(Debug, Clone, Copy)]
pub struct FieldDef {
    /// Stable key inside the credential's secret blob (`"clientId"`, `"token"`).
    pub key: &'static str,
    pub label: &'static str,
    pub kind: FieldKind,
    pub required: bool,
    pub placeholder: Option<&'static str>,
    pub help: Option<&'static str>,
    /// Environment variable consulted when no value is stored — the
    /// developer/CI override that existed per integration before this layer.
    pub env: Option<&'static str>,
}

/// How the editor renders a field. `Password` values are additionally never
/// echoed back to the frontend once saved.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FieldKind {
    Text,
    Password,
}

impl FieldKind {
    /// Wire name used by the frontend schema.
    pub fn as_str(self) -> &'static str {
        match self {
            FieldKind::Text => "text",
            FieldKind::Password => "password",
        }
    }

    /// True when the value must stay backend-only after saving.
    pub fn is_secret(self) -> bool {
        matches!(self, FieldKind::Password)
    }
}

/// Where an OAuth client id/secret comes from.
#[derive(Debug, Clone, Copy)]
pub enum ClientSource {
    /// The user registers their own app (Google): values live in these fields.
    Fields {
        id_key: &'static str,
        /// `None` for public clients that only use PKCE.
        secret_key: Option<&'static str>,
    },
    /// The provider publishes a fixed public client id (Tado).
    BuiltIn { client_id: &'static str },
}

/// Post-login request that names the connected account for the UI.
#[derive(Debug, Clone, Copy)]
pub struct IdentityProbe {
    pub url: &'static str,
    /// JSON pointer (RFC 6901) to the display label, e.g. `/email`.
    pub label_pointer: &'static str,
    /// Extra non-secret values copied into the credential's metadata, as
    /// `(metadata key, JSON pointer)` — e.g. Tado's home id/name.
    pub extras: &'static [(&'static str, &'static str)],
}

/// How the token endpoint authenticates the OAuth client.
///
/// Google and Spotify accept `client_id` / `client_secret` in the form body.
/// Fitbit Personal/Server apps require `Authorization: Basic` and reject a
/// request that only puts the secret in the form.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenAuth {
    Form,
    Basic,
}

/// OAuth 2.0 authorization-code flow with PKCE and a loopback redirect.
#[derive(Debug, Clone, Copy)]
pub struct AuthCodeDef {
    pub auth_url: &'static str,
    pub token_url: &'static str,
    pub scopes: &'static str,
    pub client: ClientSource,
    pub identity: Option<IdentityProbe>,
    /// Provider-specific consent params (`access_type=offline`, `prompt=consent`).
    pub extra_auth_params: &'static [(&'static str, &'static str)],
    pub token_auth: TokenAuth,
    /// When set, bind this loopback port instead of an ephemeral one.
    ///
    /// Fitbit and Spotify dashboards match the redirect URI including the port,
    /// so a `:0` bind cannot be pre-registered. Google leaves this `None`.
    pub loopback_port: Option<u16>,
    /// Path on the loopback URI (`/callback` for Spotify). `None` is `/`.
    pub loopback_path: Option<&'static str>,
}

/// OAuth 2.0 device-authorization flow (RFC 8628).
#[derive(Debug, Clone, Copy)]
pub struct DeviceCodeDef {
    pub device_url: &'static str,
    pub token_url: &'static str,
    pub scopes: &'static str,
    pub client: ClientSource,
    pub identity: Option<IdentityProbe>,
}

/// The auth shape of a credential type. Adding a provider style means adding a
/// variant here — deliberately a closed enum, not a plugin system.
#[derive(Debug, Clone, Copy)]
pub enum AuthKind {
    /// The fields alone are the credential (API key / PAT).
    Static,
    OAuth2AuthCode(AuthCodeDef),
    OAuth2DeviceCode(DeviceCodeDef),
}

impl AuthKind {
    /// Wire name used by the frontend schema.
    pub fn as_str(&self) -> &'static str {
        match self {
            AuthKind::Static => "static",
            AuthKind::OAuth2AuthCode(_) => "oauth2AuthCode",
            AuthKind::OAuth2DeviceCode(_) => "oauth2DeviceCode",
        }
    }

    /// True when connecting requires a sign-in round-trip. Used by the registry
    /// invariant test that keeps `{{accessToken}}` out of static types.
    #[cfg(test)]
    pub fn is_oauth(&self) -> bool {
        !matches!(self, AuthKind::Static)
    }
}

/// How the resolved secret is attached to an outgoing request.
///
/// Templates use `{{key}}` placeholders resolved against the credential's
/// fields plus the synthetic `accessToken` key for OAuth types. A provider that
/// wants its key in a custom header or query string gets a new variant here —
/// deliberately not generalized before something needs it.
#[derive(Debug, Clone, Copy)]
pub enum Injection {
    /// `Authorization: Bearer <template>`. `extra_headers` are constants, not
    /// secrets — Notion needs `Notion-Version` on every request.
    Bearer {
        value: &'static str,
        extra_headers: &'static [(&'static str, &'static str)],
    },
    /// A named header, for providers that do not use `Authorization` at all
    /// (Anthropic wants `x-api-key`). Sending a Bearer token to those is not a
    /// smaller mistake than sending none: it authenticates as nobody.
    Header {
        name: &'static str,
        value: &'static str,
    },
    /// Query parameters appended to the request URL (Trello's `key` + `token`).
    Query {
        params: &'static [(&'static str, &'static str)],
    },
}

impl Injection {
    /// Every `{{key}}` template this injection renders.
    #[cfg(test)]
    pub fn templates(&self) -> Vec<&'static str> {
        match self {
            Injection::Bearer {
                value,
                extra_headers: _,
            } => vec![*value],
            Injection::Header { value, .. } => vec![*value],
            Injection::Query { params } => params.iter().map(|(_, value)| *value).collect(),
        }
    }
}

/// Optional "Test connection" request for the editor.
#[derive(Debug, Clone, Copy)]
pub struct TestRequest {
    /// URL template, e.g. `https://api.cloudflare.com/client/v4/accounts/{{accountId}}`.
    pub url: &'static str,
    /// Extra headers required by the provider (GitHub's `Accept`, …).
    pub headers: &'static [(&'static str, &'static str)],
    /// Human-readable success message shown in the editor.
    pub success: &'static str,
    /// When set, the test is POST with this body; otherwise GET.
    ///
    /// Linear's GraphQL API has no GET probe, so a personal-key type has to
    /// POST `{ viewer { id } }` or it cannot offer "Test connection" at all.
    pub body: Option<&'static str>,
}

/// One integration's credential contract.
#[derive(Debug, Clone, Copy)]
pub struct CredentialTypeDef {
    /// Stable id referenced by manifests and stored rows (`"githubPat"`).
    pub id: &'static str,
    pub display_name: &'static str,
    /// Short line under the title in the editor.
    pub description: &'static str,
    pub docs_url: Option<&'static str>,
    pub fields: &'static [FieldDef],
    pub auth: AuthKind,
    pub inject: Injection,
    pub test: Option<TestRequest>,
    /// When set, this text field is the instance URL of a self-hosted
    /// provider. It is normalized on save and copied into metadata as
    /// `origin` so provider URLs can use `{{origin}}` without the webview
    /// ever choosing the host.
    pub instance_url_field: Option<&'static str>,
}

impl CredentialTypeDef {
    /// Field definition for `key`, if the type declares one.
    pub fn field(&self, key: &str) -> Option<&'static FieldDef> {
        self.fields.iter().find(|field| field.key == key)
    }

    /// Keys the user must fill in before the credential can be used.
    pub fn required_field_keys(&self) -> impl Iterator<Item = &'static str> + '_ {
        self.fields
            .iter()
            .filter(|field| field.required)
            .map(|field| field.key)
    }

    /// Frontend-safe projection: schema only, never values.
    pub fn schema(&self) -> CredentialTypeSchema {
        CredentialTypeSchema {
            id: self.id,
            display_name: self.display_name,
            description: self.description,
            docs_url: self.docs_url,
            auth_kind: self.auth.as_str(),
            fields: self.fields.iter().map(FieldSchema::from).collect(),
            supports_test: self.test.is_some(),
        }
    }
}

/// Frontend-facing type schema (no secret values, ever).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialTypeSchema {
    pub id: &'static str,
    pub display_name: &'static str,
    pub description: &'static str,
    pub docs_url: Option<&'static str>,
    /// `"static" | "oauth2AuthCode" | "oauth2DeviceCode"`.
    pub auth_kind: &'static str,
    pub fields: Vec<FieldSchema>,
    pub supports_test: bool,
}

/// Frontend-facing field schema.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldSchema {
    pub key: &'static str,
    pub label: &'static str,
    /// `"text" | "password"`.
    pub kind: &'static str,
    pub required: bool,
    pub placeholder: Option<&'static str>,
    pub help: Option<&'static str>,
}

impl From<&FieldDef> for FieldSchema {
    fn from(field: &FieldDef) -> Self {
        FieldSchema {
            key: field.key,
            label: field.label,
            kind: field.kind.as_str(),
            required: field.required,
            placeholder: field.placeholder,
            help: field.help,
        }
    }
}

/// Substitutes `{{key}}` placeholders using `lookup`.
///
/// Unknown keys are an error rather than an empty substitution: a silently
/// empty `Authorization` header would surface as a confusing 401 instead of a
/// clear configuration problem.
pub fn render_template(
    template: &str,
    lookup: impl Fn(&str) -> Option<String>,
) -> Result<String, String> {
    let mut out = String::with_capacity(template.len());
    let mut rest = template;

    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        let end = after
            .find("}}")
            .ok_or_else(|| format!("unterminated placeholder in template: {template}"))?;
        let key = after[..end].trim();
        let value = lookup(key).ok_or_else(|| format!("missing value for {{{{{key}}}}}"))?;
        out.push_str(&value);
        rest = &after[end + 2..];
    }

    out.push_str(rest);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lookup_pair(key: &str) -> Option<String> {
        match key {
            "accountId" => Some("acc-1".to_string()),
            "accessToken" => Some("tok-1".to_string()),
            _ => None,
        }
    }

    #[test]
    fn renders_placeholders_and_literals() {
        let rendered = render_template("https://x/{{accountId}}/ai", lookup_pair).unwrap();
        assert_eq!(rendered, "https://x/acc-1/ai");
        assert_eq!(render_template("plain", lookup_pair).unwrap(), "plain");
        assert_eq!(
            render_template("{{accountId}}:{{accessToken}}", lookup_pair).unwrap(),
            "acc-1:tok-1"
        );
    }

    /// A missing value must fail loudly — an empty auth header would otherwise
    /// look like a provider-side 401.
    #[test]
    fn missing_value_is_an_error() {
        let error = render_template("{{nope}}", lookup_pair).unwrap_err();
        assert!(error.contains("nope"), "{error}");
    }

    #[test]
    fn unterminated_placeholder_is_an_error() {
        assert!(render_template("{{accountId", lookup_pair).is_err());
    }

    #[test]
    fn schema_exposes_field_kinds_as_wire_names() {
        let def = CredentialTypeDef {
            id: "t",
            display_name: "T",
            description: "d",
            docs_url: None,
            fields: &[FieldDef {
                key: "token",
                label: "Token",
                kind: FieldKind::Password,
                required: true,
                placeholder: None,
                help: None,
                env: None,
            }],
            auth: AuthKind::Static,
            inject: Injection::Bearer {
                value: "{{token}}",
                extra_headers: &[],
            },
            test: None,
            instance_url_field: None,
        };
        let schema = def.schema();
        assert_eq!(schema.auth_kind, "static");
        assert_eq!(schema.fields[0].kind, "password");
        assert!(!schema.supports_test);
    }
}
