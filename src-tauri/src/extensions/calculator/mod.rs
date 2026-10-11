//! What the host is willing to do on the Calculator's behalf.
//!
//! Frankfurter serves the ECB exchange rates without a key, so this is no auth
//! boundary (finding 11) — it keeps the request out of the main window's CSP and
//! behind `net_guard`. The palette's currency conversion uses the same grant.

use super::ExtensionRust;
use crate::extension_providers::CapabilityHosts;

pub const EXTENSION: ExtensionRust = ExtensionRust {
    folder: "calculator",
    capabilities: &[CAPABILITY],
};

const CAPABILITY: CapabilityHosts = CapabilityHosts {
    extension_id: "kavibay.calculator",
    hosts: &["api.frankfurter.dev"],
};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extension_providers::listed;

    #[test]
    fn declared_hosts_match_exactly() {
        assert!(listed(CAPABILITY.hosts, "api.frankfurter.dev"));
        assert!(!listed(CAPABILITY.hosts, "frankfurter.dev"));
        assert!(!listed(
            CAPABILITY.hosts,
            "api.frankfurter.dev.evil.example"
        ));
    }
}
