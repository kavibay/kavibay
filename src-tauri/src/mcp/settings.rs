//! Backend-owned MCP server configuration.
//!
//! The listener can start before the WebView exists, so this preference lives
//! beside the other AppData settings rather than in browser storage.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

use crate::settings_store;

pub const DEFAULT_PORT: u16 = 43_127;

/// Section of `settings.json` this config lives in.
const SECTION: &str = "mcpServer";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpServerConfig {
    pub enabled: bool,
    pub port: u16,
    /// SHA-256 of the bearer token clients must send, or `None` for no token.
    ///
    /// Only the digest is kept: the token is shown once when generated and
    /// never stored, so `settings.json` holds nothing a reader could replay.
    #[serde(default, with = "hex_digest", skip_serializing_if = "Option::is_none")]
    pub token_sha256: Option<[u8; 32]>,
}

impl Default for McpServerConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            port: DEFAULT_PORT,
            token_sha256: None,
        }
    }
}

/// Lower-case hex for the token digest; anything else fails the whole config
/// closed, like every other malformed field.
mod hex_digest {
    use serde::{de::Error, Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(value: &Option<[u8; 32]>, serializer: S) -> Result<S::Ok, S::Error> {
        match value {
            Some(bytes) => serializer.serialize_some(
                &bytes.iter().map(|byte| format!("{byte:02x}")).collect::<String>(),
            ),
            None => serializer.serialize_none(),
        }
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<[u8; 32]>, D::Error> {
        let Some(text) = Option::<String>::deserialize(deserializer)? else {
            return Ok(None);
        };
        if text.len() != 64 || !text.bytes().all(|c| c.is_ascii_hexdigit()) {
            return Err(D::Error::custom("token digest must be 64 hex characters"));
        }
        let mut digest = [0u8; 32];
        for (index, byte) in digest.iter_mut().enumerate() {
            *byte = u8::from_str_radix(&text[index * 2..index * 2 + 2], 16).map_err(D::Error::custom)?;
        }
        Ok(Some(digest))
    }
}

/// A new bearer token and the digest to store for it.
///
/// 32 random bytes, base64url: the same strength and alphabet as the OAuth
/// verifiers in `credentials`. The `kvb_` prefix makes a leaked one
/// recognisable for what it is.
pub fn generate_token() -> (String, [u8; 32]) {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    let mut bytes = [0u8; 32];
    rand::fill(&mut bytes);
    let token = format!("kvb_{}", URL_SAFE_NO_PAD.encode(bytes));
    let digest = token_digest(&token);
    (token, digest)
}

pub fn token_digest(token: &str) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    Sha256::digest(token.as_bytes()).into()
}

/// Whether a presented token matches the stored digest.
///
/// Compares digests in constant time, so response timing says nothing about
/// how much of a guess was right.
pub fn token_matches(presented: &str, expected: &[u8; 32]) -> bool {
    token_digest(presented)
        .iter()
        .zip(expected)
        .fold(0u8, |diff, (a, b)| diff | (a ^ b))
        == 0
}

impl McpServerConfig {
    /// Invalid or unreadable preferences must not enable a listener.
    pub fn disabled() -> Self {
        Self {
            enabled: false,
            ..Self::default()
        }
    }
}

pub fn valid_port(port: u16) -> bool {
    (1024..=u16::MAX).contains(&port)
}

pub fn validate_port(port: u16) -> Result<(), String> {
    if valid_port(port) {
        Ok(())
    } else {
        Err("invalid_port".into())
    }
}

/// Corrupt, incomplete, unknown or out-of-range config fails closed.
pub fn parse_config(raw: &str) -> McpServerConfig {
    match serde_json::from_str::<McpServerConfig>(raw) {
        Ok(config) if valid_port(config.port) => config,
        _ => McpServerConfig::disabled(),
    }
}

pub fn load<R: Runtime>(app: &AppHandle<R>) -> Result<McpServerConfig, String> {
    Ok(match settings_store::read_section(app, SECTION)? {
        Some(value) => parse_config(&value.to_string()),
        None => McpServerConfig::default(),
    })
}

pub fn save<R: Runtime>(app: &AppHandle<R>, config: &McpServerConfig) -> Result<(), String> {
    validate_port(config.port)?;
    let value = serde_json::to_value(config)
        .map_err(|error| format!("could not serialize mcp config: {error}"))?;
    settings_store::write_section(app, SECTION, value)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// What `save` puts into the section, as `load` would read it back.
    fn round_trip(config: &McpServerConfig) -> McpServerConfig {
        parse_config(&serde_json::to_value(config).unwrap().to_string())
    }

    #[test]
    fn a_missing_section_is_the_default_config() {
        // `load` maps an absent preference to an enabled local listener.
        assert!(McpServerConfig::default().enabled);
        assert_eq!(McpServerConfig::default().port, DEFAULT_PORT);
    }

    #[test]
    fn corrupt_incomplete_or_out_of_range_config_defaults_safely() {
        assert!(!McpServerConfig::disabled().enabled);
        assert_eq!(
            parse_config(r#"{"enabled":"yes","port":80,"extra":true}"#),
            McpServerConfig::disabled()
        );
        assert_eq!(
            parse_config(r#"{"enabled":true}"#),
            McpServerConfig::disabled()
        );
        assert_eq!(
            parse_config(r#"{"enabled":true,"port":80}"#),
            McpServerConfig::disabled(),
            "a privileged port is out of range and must not be honoured"
        );
        assert_eq!(parse_config("not json"), McpServerConfig::disabled());
    }

    #[test]
    fn explicitly_disabled_config_stays_disabled() {
        let config = McpServerConfig {
            enabled: false,
            port: 45_000,
            token_sha256: None,
        };
        assert_eq!(round_trip(&config), config);
    }

    #[test]
    fn valid_config_round_trips_and_unknown_fields_fail_closed() {
        let config = McpServerConfig {
            enabled: true,
            port: 45_000,
            token_sha256: None,
        };
        assert_eq!(round_trip(&config), config);

        // A section written by a newer build carrying a field this one does not
        // know is refused rather than half-read — `deny_unknown_fields`.
        assert_eq!(
            parse_config(r#"{"enabled":true,"port":45000,"future":1}"#),
            McpServerConfig::disabled()
        );
    }

    #[test]
    fn a_token_digest_round_trips_and_an_old_config_has_none() {
        let (token, digest) = generate_token();
        assert!(token.starts_with("kvb_"));
        let config = McpServerConfig {
            enabled: true,
            port: 45_000,
            token_sha256: Some(digest),
        };
        assert_eq!(round_trip(&config), config);
        assert!(!serde_json::to_string(&config).unwrap().contains(&token[4..]));

        // Written before tokens existed: no field, no token.
        assert_eq!(
            parse_config(r#"{"enabled":true,"port":45000}"#).token_sha256,
            None
        );
        // A mangled digest must not quietly become "no token required".
        assert_eq!(
            parse_config(r#"{"enabled":true,"port":45000,"tokenSha256":"nope"}"#),
            McpServerConfig::disabled()
        );
    }

    #[test]
    fn only_the_generated_token_matches_its_digest() {
        let (token, digest) = generate_token();
        assert!(token_matches(&token, &digest));
        assert!(!token_matches("kvb_guess", &digest));
        assert!(!token_matches("", &digest));
        let (other, _) = generate_token();
        assert_ne!(token, other, "every generation is a fresh token");
    }

    #[test]
    fn invalid_ports_are_rejected_before_anything_is_written() {
        assert_eq!(validate_port(1023).unwrap_err(), "invalid_port");
        assert_eq!(validate_port(0).unwrap_err(), "invalid_port");
        assert!(validate_port(1024).is_ok());
        assert!(validate_port(DEFAULT_PORT).is_ok());

        // `save` calls `validate_port` first, so a good section stays good: the
        // rejected value never reaches `write_section`.
        let good = McpServerConfig {
            enabled: true,
            port: 45_000,
            token_sha256: None,
        };
        assert_eq!(round_trip(&good), good);
    }
}
