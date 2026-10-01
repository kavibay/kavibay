//! Declared endpoints for **first-party** extensions.
//!
//! Design: `docs/design/declarative-http-api.md` §11.1.
//!
//! Runtime packages keep their declaration on disk, where the user can read it
//! before enabling. First-party extensions ship inside the binary, so their
//! declarations are compiled in with `include_str!`: still static, still
//! host-owned, and impossible to swap at runtime.
//!
//! What this buys is not fewer lines — it is that a first-party widget which is
//! genuinely "one request" no longer needs a Rust module, and no longer needs a
//! `connect-src` entry in the main-window CSP.

use std::collections::HashMap;
use std::sync::OnceLock;

use super::api_declaration::{parse_api_declaration, ApiDeclaration, Endpoint};

/// Compiled-in declarations, keyed by extension id.
///
/// Adding an entry is the whole integration: the executor, limits and binding
/// are shared with runtime packages.
const DECLARATIONS: &[(&str, &str)] = &[];

fn parsed() -> &'static HashMap<&'static str, ApiDeclaration> {
    static PARSED: OnceLock<HashMap<&'static str, ApiDeclaration>> = OnceLock::new();
    PARSED.get_or_init(|| {
        let mut map = HashMap::new();
        for (ext_id, source) in DECLARATIONS {
            let raw: serde_json::Value = serde_json::from_str(source)
                .unwrap_or_else(|error| panic!("{ext_id}/api.json is not valid JSON: {error}"));
            let declaration = parse_api_declaration(&raw)
                .unwrap_or_else(|error| panic!("{ext_id}/api.json is invalid: {error}"));
            map.insert(*ext_id, declaration);
        }
        map
    })
}

/// One compiled-in endpoint.
pub fn endpoint(ext_id: &str, endpoint_id: &str) -> Option<Endpoint> {
    parsed()
        .get(ext_id)?
        .endpoints
        .iter()
        .find(|endpoint| endpoint.id == endpoint_id)
        .cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A malformed declaration would panic at first use, in front of a user.
    /// Parsing every one of them here turns that into a failing test instead.
    #[test]
    fn every_compiled_declaration_is_valid() {
        for (ext_id, _) in DECLARATIONS {
            let declaration = parsed()
                .get(ext_id)
                .unwrap_or_else(|| panic!("{ext_id} must parse into the registry"));
            assert!(
                !declaration.endpoints.is_empty(),
                "{ext_id} declares no endpoints"
            );
        }
    }

    #[test]
    fn unknown_ids_resolve_to_nothing() {
        assert!(endpoint("stocks", "chart").is_none());
        assert!(endpoint("nope", "forecast").is_none());
    }
}
