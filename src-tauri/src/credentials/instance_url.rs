//! Instance URLs for self-hosted providers (n8n, later Home Assistant).
//!
//! The person types an address when connecting. SSRF is the app being tricked
//! into a request they did not intend; this value is one they typed, so the
//! host check is "did this come from the credential" rather than "is this
//! a public address". See `docs/extension-host.md` → self-hosted providers.
//!
//! What is stored is a normalized base: scheme, host, port, and an optional
//! path prefix (`N8N_PATH`). Userinfo, query and fragment are refused or
//! dropped so a password cannot hitch a ride in the URL.

use serde_json::{Map, Value};

use super::db::SecretData;
use super::types::CredentialTypeDef;

/// Turns a typed-in instance address into the base provider URLs may use.
pub fn normalize_instance_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("instance URL is empty".into());
    }
    let with_scheme = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let mut url = url::Url::parse(&with_scheme).map_err(|_| "invalid instance URL".to_string())?;
    match url.scheme() {
        "http" | "https" => {}
        _ => return Err("instance URL must be http or https".into()),
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("instance URL must not contain a username or password".into());
    }
    if url.host_str().is_none() {
        return Err("instance URL has no host".into());
    }
    url.set_query(None);
    url.set_fragment(None);

    let mut path = url.path().to_string();
    if let Some(index) = path.find("/api/v1") {
        path.truncate(index);
    }
    if path == "/" {
        path.clear();
    } else {
        path = path.trim_end_matches('/').to_string();
    }

    let origin = url.origin().ascii_serialization();
    if path.is_empty() {
        Ok(origin)
    } else {
        Ok(format!("{origin}{path}"))
    }
}

/// Host[:port] from a normalized instance URL — the Settings account label.
pub fn instance_label(normalized: &str) -> String {
    url::Url::parse(normalized)
        .ok()
        .and_then(|parsed| {
            let host = parsed.host_str()?.to_string();
            Some(match parsed.port() {
                Some(port) => format!("{host}:{port}"),
                None => host,
            })
        })
        .unwrap_or_else(|| normalized.to_string())
}

/// Normalizes the type's instance-URL field and copies it into metadata as
/// `origin`, which is what provider URLs substitute via `{{origin}}`.
pub fn sync_instance_url(
    type_def: &CredentialTypeDef,
    secret: &mut SecretData,
    metadata: &mut Map<String, Value>,
    account_label: &mut Option<String>,
) -> Result<(), String> {
    let Some(key) = type_def.instance_url_field else {
        return Ok(());
    };
    let Some(raw) = secret.field(key) else {
        metadata.remove("origin");
        return Ok(());
    };
    let origin = normalize_instance_url(raw)?;
    secret.fields.insert(key.to_string(), origin.clone());
    metadata.insert("origin".into(), Value::String(origin.clone()));
    *account_label = Some(instance_label(&origin));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::credentials::db::SecretData;
    use crate::credentials::types::{AuthKind, CredentialTypeDef, FieldDef, FieldKind, Injection};

    fn n8n_like() -> CredentialTypeDef {
        CredentialTypeDef {
            id: "n8nApi",
            display_name: "n8n",
            description: "d",
            docs_url: None,
            fields: &[FieldDef {
                key: "origin",
                label: "Instance URL",
                kind: FieldKind::Text,
                required: true,
                placeholder: None,
                help: None,
                env: None,
            }],
            auth: AuthKind::Static,
            inject: Injection::Header {
                name: "X-N8N-API-KEY",
                value: "{{apiKey}}",
            },
            test: None,
            instance_url_field: Some("origin"),
        }
    }

    #[test]
    fn https_origin_drops_path_query_and_slash() {
        assert_eq!(
            normalize_instance_url("https://n8n.example.com/foo?x=1#y").unwrap(),
            "https://n8n.example.com/foo"
        );
        assert_eq!(
            normalize_instance_url("https://n8n.example.com/").unwrap(),
            "https://n8n.example.com"
        );
    }

    #[test]
    fn missing_scheme_is_https() {
        assert_eq!(
            normalize_instance_url("n8n.example.com").unwrap(),
            "https://n8n.example.com"
        );
    }

    #[test]
    fn api_v1_suffix_is_the_api_root_not_the_instance() {
        assert_eq!(
            normalize_instance_url("https://n8n.example.com/api/v1/workflows").unwrap(),
            "https://n8n.example.com"
        );
        assert_eq!(
            normalize_instance_url("https://example.com/n8n/api/v1").unwrap(),
            "https://example.com/n8n"
        );
    }

    #[test]
    fn http_lan_keeps_scheme_and_port() {
        assert_eq!(
            normalize_instance_url("http://192.168.1.10:5678/").unwrap(),
            "http://192.168.1.10:5678"
        );
    }

    #[test]
    fn userinfo_is_refused() {
        assert!(normalize_instance_url("https://user:pass@n8n.example.com").is_err());
    }

    #[test]
    fn ftp_is_refused() {
        assert!(normalize_instance_url("ftp://n8n.example.com").is_err());
    }

    #[test]
    fn empty_is_refused() {
        assert!(normalize_instance_url("   ").is_err());
    }

    #[test]
    fn sync_writes_origin_metadata_and_a_host_label() {
        let def = n8n_like();
        let mut secret = SecretData::default();
        secret
            .fields
            .insert("origin".into(), "n8n.example.com/api/v1/".into());
        let mut metadata = Map::new();
        let mut label = None;
        sync_instance_url(&def, &mut secret, &mut metadata, &mut label).unwrap();
        assert_eq!(secret.field("origin"), Some("https://n8n.example.com"));
        assert_eq!(
            metadata.get("origin").and_then(Value::as_str),
            Some("https://n8n.example.com")
        );
        assert_eq!(label.as_deref(), Some("n8n.example.com"));
    }
}
