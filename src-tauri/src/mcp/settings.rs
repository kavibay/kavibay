//! Backend-owned MCP server configuration.
//!
//! The listener can start before the WebView exists, so this preference lives
//! beside the other AppData settings rather than in browser storage.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

pub const DEFAULT_PORT: u16 = 43_127;
pub const CONFIG_FILE: &str = "mcp-server.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpServerConfig {
    pub enabled: bool,
    pub port: u16,
}

impl Default for McpServerConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            port: DEFAULT_PORT,
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
        _ => McpServerConfig::default(),
    }
}

pub fn config_path_for(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(CONFIG_FILE)
}

pub fn load_from_path(path: &Path) -> Result<McpServerConfig, String> {
    match fs::read_to_string(path) {
        Ok(raw) => Ok(parse_config(&raw)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(McpServerConfig::default())
        }
        Err(error) => Err(error.to_string()),
    }
}

pub fn save_to_path(path: &Path, config: &McpServerConfig) -> Result<(), String> {
    validate_port(config.port)?;
    let parent = path
        .parent()
        .ok_or_else(|| "config_parent_missing".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let json = serde_json::to_string_pretty(config).map_err(|error| error.to_string())?;
    fs::write(path, json).map_err(|error| error.to_string())
}

pub fn load<R: Runtime>(app: &AppHandle<R>) -> Result<McpServerConfig, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    load_from_path(&config_path_for(&app_data_dir))
}

pub fn save<R: Runtime>(app: &AppHandle<R>, config: &McpServerConfig) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    save_to_path(&config_path_for(&app_data_dir), config)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_path() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "kavibay_mcp_settings_{}_{}",
            std::process::id(),
            nanos
        ))
    }

    #[test]
    fn corrupt_or_missing_config_defaults_safely() {
        let root = temp_path();
        let path = config_path_for(&root);
        assert_eq!(load_from_path(&path).unwrap(), McpServerConfig::default());
        fs::create_dir_all(&root).unwrap();
        fs::write(&path, r#"{"enabled":"yes","port":80,"extra":true}"#).unwrap();
        assert_eq!(load_from_path(&path).unwrap(), McpServerConfig::default());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn valid_config_round_trips_and_unknown_fields_fail_closed() {
        let root = temp_path();
        let path = config_path_for(&root);
        let config = McpServerConfig {
            enabled: true,
            port: 45_000,
        };
        save_to_path(&path, &config).unwrap();
        assert_eq!(load_from_path(&path).unwrap(), config);
        fs::write(&path, r#"{"enabled":true,"port":45000,"future":1}"#).unwrap();
        assert_eq!(load_from_path(&path).unwrap(), McpServerConfig::default());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn invalid_ports_are_rejected_without_rewriting_good_config() {
        let root = temp_path();
        let path = config_path_for(&root);
        let config = McpServerConfig {
            enabled: true,
            port: 45_000,
        };
        save_to_path(&path, &config).unwrap();
        assert_eq!(validate_port(1023).unwrap_err(), "invalid_port");
        assert_eq!(validate_port(0).unwrap_err(), "invalid_port");
        assert_eq!(load_from_path(&path).unwrap(), config);
        let _ = fs::remove_dir_all(root);
    }
}
