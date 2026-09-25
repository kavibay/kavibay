//! Provider-neutral credential layer.
//!
//! One declarative type registry (`registry`), one encrypted store (`db`), one
//! persistent consumer selections (`bindings`), one resolver
//! used by every integration's API module (`resolve`), and one generic command
//! surface (`commands`). Integrations no longer own credential storage, auth
//! flows, or settings UI — only their own API requests.
//!
//! Invariant (AGENTS.md 5): plaintext values live in Rust only. The frontend
//! sees type schemas and non-secret status, never a secret.

pub mod bindings;
pub mod db;
pub mod instance_url;
pub mod oauth;
pub mod registry;
pub mod resolve;
pub mod types;

mod commands;

pub use commands::*;
pub use oauth::OAuthState;
pub use resolve::{ResolveError, ResolvedCredential};

use std::time::{SystemTime, UNIX_EPOCH};

/// Shared clock for credential timestamps (Unix seconds).
pub(crate) fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}
