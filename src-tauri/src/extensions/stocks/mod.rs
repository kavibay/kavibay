//! What the host is willing to do on Stocks' behalf.
//!
//! Yahoo Finance is a keyless public API, but the widget still needs the host
//! capability boundary so requests leave the webview through the same path as
//! every other contract extension. No credential is attached here.

use super::ExtensionRust;
use crate::extension_providers::CapabilityHosts;

pub const EXTENSION: ExtensionRust = ExtensionRust {
    folder: "stocks",
    capabilities: &[CAPABILITY],
};

const CAPABILITY: CapabilityHosts = CapabilityHosts {
    extension_id: "kavibay.stocks",
    hosts: &["query1.finance.yahoo.com", "query2.finance.yahoo.com"],
};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extension_providers::listed;

    #[test]
    fn declared_hosts_match_exactly() {
        for host in ["query1.finance.yahoo.com", "query2.finance.yahoo.com"] {
            assert!(listed(CAPABILITY.hosts, host));
        }
        assert!(listed(CAPABILITY.hosts, "QUERY1.FINANCE.YAHOO.COM"));
        assert!(!listed(CAPABILITY.hosts, "finance.yahoo.com"));
        assert!(!listed(
            CAPABILITY.hosts,
            "query1.finance.yahoo.com.evil.example"
        ));
    }
}
