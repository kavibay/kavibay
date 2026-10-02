//! What the host is willing to do on Weather's behalf.
//!
//! The Rust half of `extensions/weather/`, and deliberately a different kind of
//! declaration from `tado`: Open-Meteo needs no key, so nothing here is an auth
//! boundary (finding 11). It exists for the two things Rust can do and the
//! webview cannot — `net_guard` classification of the resolved address, and
//! keeping widget traffic out of the main window's CSP, which AGENTS.md
//! invariant 6 asks for.
//!
//! Do not read the list as protection. A widget allowed to reach
//! `api.open-meteo.com` can encode anything it read into a query parameter;
//! AGENTS.md says so, and PR review is the control.

use super::ExtensionRust;
use crate::extension_providers::CapabilityHosts;

/// The uniform entry point: which root folder this belongs to, and what the
/// host declares on its behalf.
pub const EXTENSION: ExtensionRust = ExtensionRust {
    folder: "weather",
    capabilities: &[CAPABILITY],
};

const CAPABILITY: CapabilityHosts = CapabilityHosts {
    extension_id: "kavibay.weather",
    hosts: &["geocoding-api.open-meteo.com", "api.open-meteo.com"],
};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extension_providers::listed;

    #[test]
    fn declared_hosts_match_exactly() {
        assert!(listed(CAPABILITY.hosts, "geocoding-api.open-meteo.com"));
        assert!(listed(CAPABILITY.hosts, "api.open-meteo.com"));
        assert!(
            listed(CAPABILITY.hosts, "API.Open-Meteo.COM"),
            "case-insensitive"
        );
        assert!(!listed(CAPABILITY.hosts, "evil.example.com"));
        assert!(!listed(CAPABILITY.hosts, "api.open-meteo.com.evil.example"));
    }
}
