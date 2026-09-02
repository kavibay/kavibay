//! Which resolved addresses a package may reach.
//!
//! Design: `docs/superpowers/specs/2026-08-01-declarative-http-api-design.md` §6.3.
//!
//! A declared host is a name, never a literal address (the declaration validator
//! enforces that). But a name can resolve anywhere, including back into this
//! machine or into the LAN — which is how a "weather widget" reaches a router
//! admin page or a cloud metadata endpoint. So every resolved address is
//! classified before a connection is opened, and the vetted address is what the
//! request is pinned to.
//!
//! Pure and dependency-free so the classification is unit tested exhaustively.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

/// How strictly resolved addresses are classified before a connection opens.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AddressPolicy {
    /// Runtime packages and exact-host providers: private, loopback and
    /// link-local are all refused.
    PublicOnly,
    /// The person typed this address when connecting their own instance.
    /// Private, loopback and unique-local are then permitted; link-local
    /// (including `169.254.169.254`) stays refused.
    UserSupplied,
}

/// True when an address must never be dialled on a package's behalf.
pub fn is_forbidden_address(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(v4) => is_forbidden_v4(v4),
        IpAddr::V6(v6) => {
            // An IPv4-mapped address (`::ffff:127.0.0.1`) is an IPv4 address
            // wearing a hat; classify it as one.
            if let Some(mapped) = v6.to_ipv4_mapped() {
                return is_forbidden_v4(mapped);
            }
            is_forbidden_v6(v6)
        }
    }
}

fn is_forbidden_v4(address: Ipv4Addr) -> bool {
    let [a, b, ..] = address.octets();
    address.is_loopback()
        || address.is_private()
        || address.is_link_local()
        || address.is_broadcast()
        || address.is_documentation()
        || address.is_unspecified()
        || address.is_multicast()
        // Carrier-grade NAT (100.64.0.0/10) — provider-internal space.
        || (a == 100 && (64..128).contains(&b))
        // Reserved / benchmarking ranges that have no business here.
        || a == 0
        || a >= 240
        || (a == 198 && (18..20).contains(&b))
}

fn is_forbidden_v6(address: Ipv6Addr) -> bool {
    let segments = address.segments();
    address.is_loopback()
        || address.is_unspecified()
        || address.is_multicast()
        // Unique local (fc00::/7) — the IPv6 equivalent of a private range.
        || (segments[0] & 0xfe00) == 0xfc00
        // Link-local unicast (fe80::/10), which includes the address a
        // link-local metadata service would sit on.
        || (segments[0] & 0xffc0) == 0xfe80
}

/// RFC1918 / loopback / unique-local — a home server, not the cloud metadata
/// hop. Link-local is deliberately not in this set.
pub fn is_user_network(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(v4) => v4.is_private() || v4.is_loopback(),
        IpAddr::V6(v6) => {
            if let Some(mapped) = v6.to_ipv4_mapped() {
                return mapped.is_private() || mapped.is_loopback();
            }
            let segments = v6.segments();
            v6.is_loopback() || (segments[0] & 0xfe00) == 0xfc00
        }
    }
}

/// True when this address must not be dialled under `policy`.
pub fn address_blocked(address: IpAddr, policy: AddressPolicy) -> bool {
    match policy {
        AddressPolicy::PublicOnly => is_forbidden_address(address),
        AddressPolicy::UserSupplied => {
            if is_user_network(address) {
                false
            } else {
                is_forbidden_address(address)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    fn forbidden(text: &str) -> bool {
        is_forbidden_address(IpAddr::from_str(text).expect("test address must parse"))
    }

    #[test]
    fn loopback_and_private_ranges_are_refused() {
        for address in [
            "127.0.0.1",
            "127.1.2.3",
            "10.0.0.1",
            "172.16.0.1",
            "172.31.255.255",
            "192.168.1.1",
            "0.0.0.0",
            "255.255.255.255",
        ] {
            assert!(forbidden(address), "{address} must be refused");
        }
    }

    /// The cloud metadata address lives in the link-local range and is the
    /// classic target of a server-side request forgery.
    #[test]
    fn link_local_including_metadata_is_refused() {
        assert!(forbidden("169.254.169.254"));
        assert!(forbidden("169.254.0.1"));
        assert!(forbidden("fe80::1"));
    }

    #[test]
    fn carrier_grade_nat_and_reserved_ranges_are_refused() {
        assert!(forbidden("100.64.0.1"));
        assert!(forbidden("100.127.255.255"));
        assert!(forbidden("198.18.0.1"), "benchmarking range");
        assert!(forbidden("240.0.0.1"), "reserved");
        assert!(forbidden("224.0.0.1"), "multicast");
    }

    #[test]
    fn ipv6_loopback_and_unique_local_are_refused() {
        assert!(forbidden("::1"));
        assert!(forbidden("::"));
        assert!(forbidden("fc00::1"));
        assert!(forbidden("fd12:3456::1"));
        assert!(forbidden("ff02::1"), "multicast");
    }

    /// A v4 address in a v6 coat is still that v4 address.
    #[test]
    fn ipv4_mapped_addresses_are_classified_as_ipv4() {
        assert!(forbidden("::ffff:127.0.0.1"));
        assert!(forbidden("::ffff:10.0.0.1"));
        assert!(!forbidden("::ffff:93.184.216.34"));
    }

    #[test]
    fn ordinary_public_addresses_are_allowed() {
        for address in [
            "93.184.216.34",
            "1.1.1.1",
            "8.8.8.8",
            "100.128.0.1",
            "2606:4700:4700::1111",
        ] {
            assert!(!forbidden(address), "{address} must be allowed");
        }
    }

    /// 100.63.x and 100.128.x sit just outside CGNAT — the boundary is easy to
    /// get wrong in either direction.
    #[test]
    fn carrier_grade_nat_boundaries_are_exact() {
        assert!(!forbidden("100.63.255.255"));
        assert!(forbidden("100.64.0.0"));
        assert!(forbidden("100.127.255.255"));
        assert!(!forbidden("100.128.0.0"));
    }

    fn blocked(text: &str, policy: AddressPolicy) -> bool {
        address_blocked(
            IpAddr::from_str(text).expect("test address must parse"),
            policy,
        )
    }

    /// A FromCredential provider may reach the machine it is running on and
    /// the LAN; the metadata hop stays refused.
    #[test]
    fn user_supplied_allows_private_and_loopback_but_not_link_local() {
        for address in [
            "127.0.0.1",
            "10.0.0.1",
            "192.168.1.1",
            "172.16.0.1",
            "::1",
            "fd12:3456::1",
        ] {
            assert!(
                !blocked(address, AddressPolicy::UserSupplied),
                "{address} is the person's own instance"
            );
            assert!(
                blocked(address, AddressPolicy::PublicOnly),
                "{address} stays refused for exact-host providers"
            );
        }
        assert!(blocked("169.254.169.254", AddressPolicy::UserSupplied));
        assert!(blocked("fe80::1", AddressPolicy::UserSupplied));
        assert!(!blocked("1.1.1.1", AddressPolicy::UserSupplied));
    }
}
