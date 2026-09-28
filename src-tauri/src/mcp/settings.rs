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
}

impl Default for McpServerConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            port: DEFAULT_PORT,
        }
    }
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
        };
        assert_eq!(round_trip(&config), config);
    }

    #[test]
    fn valid_config_round_trips_and_unknown_fields_fail_closed() {
        let config = McpServerConfig {
            enabled: true,
            port: 45_000,
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
        };
        assert_eq!(round_trip(&good), good);
    }
}
