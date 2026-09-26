//! Binding caller arguments to a declared endpoint.
//!
//! Design: `docs/superpowers/specs/2026-08-01-declarative-http-api-design.md` §6.
//!
//! This module is where a package's arguments meet a request, so it is the
//! module that has to be paranoid. The invariant it exists to hold:
//!
//! > **No argument can change scheme, host or port, and no argument can add a
//! > path segment.** Everything a caller supplies ends up either percent-encoded
//! > inside exactly one path segment, or in a query/body value.
//!
//! Pure and synchronous on purpose: no I/O here, so every rule above is unit
//! tested without a network in sight.
//!
//! The executor (`http.rs`) is the only caller.

use std::collections::BTreeMap;

use serde_json::Value;

use super::api_declaration::{is_safe_path_segment, BodyType, Endpoint, Method, Param};

/// A request that is ready to be executed — every value already validated and
/// encoded. The executor may not add anything the caller controls.
#[derive(Debug, Clone, PartialEq)]
pub struct BoundRequest {
    pub method: Method,
    /// Primary url first, then the declared fallbacks, all bound identically.
    pub urls: Vec<String>,
    pub headers: BTreeMap<String, String>,
    pub user_agent: Option<String>,
    pub body: Option<BoundBody>,
}

/// Encoded request body.
#[derive(Debug, Clone, PartialEq)]
pub enum BoundBody {
    Json(Value),
    Form(Vec<(String, String)>),
}

/// Percent-encodes everything outside RFC 3986 `unreserved` for use inside a
/// single path segment.
///
/// Deliberately conservative rather than clever: encoding too much is a cosmetic
/// problem, encoding too little means a `?`, `#` or `/` in an argument changes
/// what the url means.
fn encode_path_segment(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        let c = *byte as char;
        if c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '_' | '~') {
            out.push(c);
        } else {
            out.push('%');
            out.push_str(&format!("{byte:02X}"));
        }
    }
    out
}

/// Renders a declared value as a string for a path or query position.
fn scalar_to_string(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Bool(flag) => Some(flag.to_string()),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

/// Validates one caller-supplied value against its declared parameter.
fn check_value(name: &str, param: &Param, value: &Value) -> Result<(), String> {
    match param {
        Param::Array {
            items, max_items, ..
        } => {
            let values = value
                .as_array()
                .ok_or_else(|| format!("invalid_argument:{name}"))?;
            if values.len() > *max_items {
                return Err(format!("argument_too_long:{name}"));
            }
            for item in values {
                check_value(name, items, item)?;
            }
            Ok(())
        }
        Param::Text {
            max_length,
            charset,
            ..
        } => {
            let text = value
                .as_str()
                .ok_or_else(|| format!("invalid_argument:{name}"))?;
            if text.chars().count() > *max_length {
                return Err(format!("argument_too_long:{name}"));
            }
            if let Some(charset) = charset {
                if !charset.accepts(text) {
                    return Err(format!("argument_charset:{name}"));
                }
            }
            Ok(())
        }
        Param::Number { .. } => {
            let number = value
                .as_f64()
                .ok_or_else(|| format!("invalid_argument:{name}"))?;
            if !number.is_finite() {
                return Err(format!("invalid_argument:{name}"));
            }
            Ok(())
        }
        Param::Boolean { .. } => value
            .as_bool()
            .map(|_| ())
            .ok_or_else(|| format!("invalid_argument:{name}")),
        Param::Enum { values, .. } => {
            let text = value
                .as_str()
                .ok_or_else(|| format!("invalid_argument:{name}"))?;
            if values.iter().any(|allowed| allowed == text) {
                Ok(())
            } else {
                Err(format!("invalid_argument:{name}"))
            }
        }
        // Consts are never supplied by the caller; `bind` rejects that earlier.
        Param::Const { .. } => Err(format!("const_not_settable:{name}")),
    }
}

/// Resolves the effective value of a declared parameter: the const, the
/// caller's value, or nothing when it is optional and absent.
fn effective_value(
    name: &str,
    param: &Param,
    args: &serde_json::Map<String, Value>,
) -> Result<Option<Value>, String> {
    if let Param::Const { value } = param {
        // A caller trying to set a const is a bug or an attempt; either way the
        // declaration wins and the call is rejected rather than silently fixed.
        if args.contains_key(name) {
            return Err(format!("const_not_settable:{name}"));
        }
        return Ok(Some(value.clone()));
    }

    match args.get(name) {
        None | Some(Value::Null) => {
            if param.required() {
                Err(format!("missing_argument:{name}"))
            } else {
                Ok(None)
            }
        }
        Some(value) => {
            check_value(name, param, value)?;
            Ok(Some(value.clone()))
        }
    }
}

/// Substitutes `{name}` placeholders with encoded segments.
///
/// Placeholders are whole path segments (enforced at declaration time), so a
/// plain replace cannot reach into the authority or split a segment.
fn bind_url(template: &str, segments: &BTreeMap<String, String>) -> String {
    let mut url = template.to_string();
    for (name, encoded) in segments {
        url = url.replace(&format!("{{{name}}}"), encoded);
    }
    url
}

/// Binds `args` to `endpoint`, or returns a stable `code:field` error.
pub fn bind(endpoint: &Endpoint, args: &Value) -> Result<BoundRequest, String> {
    let empty = serde_json::Map::new();
    let args = match args {
        Value::Null => &empty,
        Value::Object(map) => map,
        _ => return Err("invalid_arguments".to_string()),
    };

    // Fail closed on anything the declaration does not mention: a typo should
    // surface as an error, not as a silently dropped filter.
    for name in args.keys() {
        let declared = endpoint.path.contains_key(name)
            || endpoint.query.contains_key(name)
            || endpoint.body.contains_key(name);
        if !declared {
            return Err(format!("unknown_argument:{name}"));
        }
    }

    let mut path_segments = BTreeMap::new();
    for (name, param) in &endpoint.path {
        let value = effective_value(name, param, args)?
            .ok_or_else(|| format!("missing_argument:{name}"))?;
        let text = scalar_to_string(&value).ok_or_else(|| format!("invalid_argument:{name}"))?;
        // The charset (if any) already ran in `check_value`; this is the
        // separate traversal check, because a charset is only a character class
        // and `alnumDot` accepts "..".
        if !is_safe_path_segment(&text) {
            return Err(format!("invalid_path_argument:{name}"));
        }
        path_segments.insert(name.clone(), encode_path_segment(&text));
    }

    let mut query_pairs: Vec<(String, String)> = Vec::new();
    for (name, param) in &endpoint.query {
        if let Some(value) = effective_value(name, param, args)? {
            let text =
                scalar_to_string(&value).ok_or_else(|| format!("invalid_argument:{name}"))?;
            query_pairs.push((name.clone(), text));
        }
    }

    let mut body_values: Vec<(String, Value)> = Vec::new();
    for (name, param) in &endpoint.body {
        if let Some(value) = effective_value(name, param, args)? {
            body_values.push((name.clone(), value));
        }
    }

    let mut urls = Vec::with_capacity(1 + endpoint.fallback_urls.len());
    for template in std::iter::once(&endpoint.url).chain(endpoint.fallback_urls.iter()) {
        let mut parsed = url::Url::parse(&bind_url(template, &path_segments))
            .map_err(|_| "invalid_arguments".to_string())?;
        if !query_pairs.is_empty() {
            let mut serializer = parsed.query_pairs_mut();
            for (name, value) in &query_pairs {
                serializer.append_pair(name, value);
            }
        }
        urls.push(parsed.to_string());
    }

    let body = match (endpoint.method, endpoint.body_type) {
        (Method::Get, _) => None,
        (Method::Post | Method::Put, BodyType::Json) => Some(BoundBody::Json(Value::Object(
            body_values.into_iter().collect(),
        ))),
        (Method::Post | Method::Put, BodyType::Form) => Some(BoundBody::Form(
            body_values
                .into_iter()
                .map(|(name, value)| {
                    let text = scalar_to_string(&value).unwrap_or_default();
                    (name, text)
                })
                .collect(),
        )),
    };

    Ok(BoundRequest {
        method: endpoint.method,
        urls,
        headers: endpoint.headers.clone(),
        user_agent: endpoint.user_agent.clone(),
        body,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime_extensions::api_declaration::parse_api_declaration;
    use serde_json::json;

    fn endpoint_from(extra: Value) -> Endpoint {
        let mut base = json!({
            "id": "call",
            "description": "Test endpoint.",
            "method": "GET",
            "url": "https://api.example.com/v1/data",
        });
        if let (Some(base_obj), Some(extra_obj)) = (base.as_object_mut(), extra.as_object()) {
            for (key, value) in extra_obj {
                base_obj.insert(key.clone(), value.clone());
            }
        }
        parse_api_declaration(&json!({ "schemaVersion": 1, "endpoints": [base] }))
            .expect("declaration must be valid")
            .endpoints
            .remove(0)
    }

    fn host_of(url: &str) -> String {
        url::Url::parse(url)
            .unwrap()
            .host_str()
            .unwrap()
            .to_string()
    }

    #[test]
    fn binds_spotify_playback_put() {
        let endpoint = endpoint_from(json!({
            "method": "PUT",
            "url": "https://api.spotify.com/v1/me/player/play",
            "credential": "spotifyOAuth2",
            "query": { "device_id": { "type": "string" } },
            "body": { "context_uri": { "type": "string" } }
        }));
        let bound = bind(
            &endpoint,
            &json!({
                "device_id": "device1",
                "context_uri": "spotify:playlist:playlist1"
            }),
        )
        .unwrap();
        assert_eq!(bound.method, Method::Put);
        assert_eq!(
            bound.urls,
            ["https://api.spotify.com/v1/me/player/play?device_id=device1"]
        );
        assert_eq!(
            bound.body,
            Some(BoundBody::Json(
                json!({ "context_uri": "spotify:playlist:playlist1" })
            ))
        );

        let resume = bind(&endpoint, &json!({})).unwrap();
        assert_eq!(resume.urls, ["https://api.spotify.com/v1/me/player/play"]);
        assert_eq!(resume.body, Some(BoundBody::Json(json!({}))));

        let form = endpoint_from(json!({
            "method": "PUT",
            "bodyType": "form",
            "body": { "text": { "type": "string", "required": true } }
        }));
        assert_eq!(
            bind(&form, &json!({ "text": "hello" })).unwrap().body,
            Some(BoundBody::Form(vec![("text".into(), "hello".into())]))
        );
    }

    #[test]
    fn binds_and_validates_array_bodies() {
        for method in ["POST", "PUT"] {
            let endpoint = endpoint_from(json!({
                "method": method,
                "url": "https://api.spotify.com/v1/me/player/play",
                "credential": "spotifyOAuth2",
                "body": {
                    "uris": { "type": "array", "required": true, "maxItems": 2,
                        "items": { "type": "string", "maxLength": 64, "charset": "alnumSymbol" } },
                    "numbers": { "type": "array", "items": { "type": "number" } },
                    "flags": { "type": "array", "items": { "type": "boolean" } },
                    "choices": { "type": "array", "items": { "type": "enum", "values": ["a"] } }
                }
            }));
            let args = json!({ "uris": ["spotify:track:t1", "spotify:track:t2"], "numbers": [1, 2.5], "flags": [true, false], "choices": ["a"] });
            let bound = bind(&endpoint, &args).unwrap();
            assert_eq!(bound.method.as_str(), method);
            assert_eq!(bound.body, Some(BoundBody::Json(args)));
            assert_eq!(
                bind(&endpoint, &json!({ "uris": [] })).unwrap().body,
                Some(BoundBody::Json(json!({ "uris": [] })))
            );
            for args in [json!({}), json!({ "uris": null })] {
                assert_eq!(bind(&endpoint, &args).unwrap_err(), "missing_argument:uris");
            }
            for value in [
                json!("[\"spotify:track:t1\"]"),
                json!(["valid", 1]),
                json!([null]),
                json!([["nested"]]),
                json!([{}]),
            ] {
                assert_eq!(
                    bind(&endpoint, &json!({ "uris": value })).unwrap_err(),
                    "invalid_argument:uris"
                );
            }
            for value in [json!(["a", "b", "c"]), json!(["x".repeat(65)])] {
                assert_eq!(
                    bind(&endpoint, &json!({ "uris": value })).unwrap_err(),
                    "argument_too_long:uris"
                );
            }
            assert_eq!(
                bind(&endpoint, &json!({ "uris": ["bad space"] })).unwrap_err(),
                "argument_charset:uris"
            );
            for (name, value) in [
                ("numbers", json!(["1"])),
                ("flags", json!([1])),
                ("choices", json!(["b"])),
            ] {
                let mut args = json!({ "uris": ["spotify:track:t1"] });
                args[name] = value;
                assert_eq!(
                    bind(&endpoint, &args).unwrap_err(),
                    format!("invalid_argument:{name}")
                );
            }
        }
    }

    #[test]
    fn binds_query_values_and_consts() {
        let endpoint = endpoint_from(json!({
            "query": {
                "latitude": { "type": "number", "required": true },
                "current": { "type": "const", "value": "temperature_2m" },
                "optional": { "type": "string" }
            }
        }));
        let bound = bind(&endpoint, &json!({ "latitude": 52.52 })).unwrap();

        assert_eq!(bound.urls.len(), 1);
        assert!(
            bound.urls[0].contains("latitude=52.52"),
            "{}",
            bound.urls[0]
        );
        assert!(
            bound.urls[0].contains("current=temperature_2m"),
            "const is always sent"
        );
        assert!(
            !bound.urls[0].contains("optional"),
            "absent optional is omitted"
        );
    }

    #[test]
    fn binds_path_segments_in_url_order() {
        let endpoint = endpoint_from(json!({
            "url": "https://api.github.com/repos/{owner}/{repo}/actions/runs",
            "path": {
                "owner": { "type": "string", "required": true },
                "repo": { "type": "string", "required": true }
            }
        }));
        let bound = bind(
            &endpoint,
            &json!({ "owner": "aswetlow", "repo": "kavibay" }),
        )
        .unwrap();
        assert_eq!(
            bound.urls[0],
            "https://api.github.com/repos/aswetlow/kavibay/actions/runs"
        );
    }

    /// The headline invariant: nothing a caller sends may change where the
    /// request goes.
    #[test]
    fn arguments_cannot_change_the_target() {
        let endpoint = endpoint_from(json!({
            "url": "https://api.example.com/v1/{item}",
            "path": { "item": { "type": "string", "required": true } }
        }));

        // Traversal is rejected outright (charset would not catch it).
        for hostile in ["..", ".", "../../etc", "a/b", "%2e%2e"] {
            assert!(
                bind(&endpoint, &json!({ "item": hostile })).is_err(),
                "{hostile} must be rejected"
            );
        }

        // Anything else that survives is encoded into exactly one segment, so
        // it can neither open a query, a fragment, nor an authority.
        for sneaky in ["a?x=1", "a#frag", "a b", "évé"] {
            let bound = bind(&endpoint, &json!({ "item": sneaky })).unwrap();
            let url = &bound.urls[0];
            assert_eq!(
                host_of(url),
                "api.example.com",
                "host stays put for {sneaky}"
            );
            let parsed = url::Url::parse(url).unwrap();
            assert!(parsed.query().is_none(), "no query injected by {sneaky}");
            assert!(
                parsed.fragment().is_none(),
                "no fragment injected by {sneaky}"
            );
            // Exactly `/v1/<one encoded segment>` — the argument stayed inside
            // the slot the declaration gave it.
            assert_eq!(
                parsed.path(),
                format!("/v1/{}", encode_path_segment(sneaky)),
                "argument stayed in its segment for {sneaky}"
            );
            assert_eq!(
                parsed.path_segments().unwrap().count(),
                2,
                "no extra segment for {sneaky}"
            );
        }
    }

    #[test]
    fn query_values_cannot_inject_extra_parameters() {
        let endpoint = endpoint_from(json!({
            "query": { "q": { "type": "string", "required": true } }
        }));
        let bound = bind(&endpoint, &json!({ "q": "a&admin=1#x" })).unwrap();
        let parsed = url::Url::parse(&bound.urls[0]).unwrap();
        let pairs: Vec<_> = parsed.query_pairs().collect();
        assert_eq!(pairs.len(), 1, "one parameter, not two: {}", bound.urls[0]);
        assert_eq!(pairs[0].1, "a&admin=1#x");
        assert!(parsed.fragment().is_none());
    }

    #[test]
    fn undeclared_arguments_are_rejected() {
        let endpoint = endpoint_from(json!({
            "query": { "q": { "type": "string" } }
        }));
        assert_eq!(
            bind(&endpoint, &json!({ "nope": "x" })).unwrap_err(),
            "unknown_argument:nope"
        );
    }

    #[test]
    fn consts_cannot_be_overridden_by_the_caller() {
        let endpoint = endpoint_from(json!({
            "query": { "mode": { "type": "const", "value": "safe" } }
        }));
        assert_eq!(
            bind(&endpoint, &json!({ "mode": "unsafe" })).unwrap_err(),
            "const_not_settable:mode"
        );
        let bound = bind(&endpoint, &json!({})).unwrap();
        assert!(bound.urls[0].contains("mode=safe"));
    }

    #[test]
    fn required_arguments_are_enforced_and_typed() {
        let endpoint = endpoint_from(json!({
            "query": {
                "count": { "type": "number", "required": true },
                "flag": { "type": "boolean" },
                "mode": { "type": "enum", "values": ["fast", "slow"] },
                "code": { "type": "string", "maxLength": 4, "charset": "alnum" }
            }
        }));

        assert_eq!(
            bind(&endpoint, &json!({})).unwrap_err(),
            "missing_argument:count"
        );
        assert_eq!(
            bind(&endpoint, &json!({ "count": "12" })).unwrap_err(),
            "invalid_argument:count"
        );
        assert_eq!(
            bind(&endpoint, &json!({ "count": 1, "flag": "yes" })).unwrap_err(),
            "invalid_argument:flag"
        );
        assert_eq!(
            bind(&endpoint, &json!({ "count": 1, "mode": "medium" })).unwrap_err(),
            "invalid_argument:mode"
        );
        assert_eq!(
            bind(&endpoint, &json!({ "count": 1, "code": "toolong" })).unwrap_err(),
            "argument_too_long:code"
        );
        assert_eq!(
            bind(&endpoint, &json!({ "count": 1, "code": "a-b" })).unwrap_err(),
            "argument_charset:code"
        );
        assert!(bind(&endpoint, &json!({ "count": 1, "code": "ab12" })).is_ok());
    }

    /// An explicit null is "not supplied", not "supplied as null".
    #[test]
    fn null_counts_as_absent() {
        let endpoint = endpoint_from(json!({
            "query": { "q": { "type": "string", "required": true } }
        }));
        assert_eq!(
            bind(&endpoint, &json!({ "q": Value::Null })).unwrap_err(),
            "missing_argument:q"
        );
    }

    #[test]
    fn post_bodies_are_encoded_per_declaration() {
        let json_endpoint = endpoint_from(json!({
            "method": "POST",
            "body": { "text": { "type": "string", "required": true } }
        }));
        assert_eq!(
            bind(&json_endpoint, &json!({ "text": "hi" })).unwrap().body,
            Some(BoundBody::Json(json!({ "text": "hi" })))
        );

        let form_endpoint = endpoint_from(json!({
            "method": "POST",
            "bodyType": "form",
            "body": { "text": { "type": "string", "required": true } }
        }));
        assert_eq!(
            bind(&form_endpoint, &json!({ "text": "hi" })).unwrap().body,
            Some(BoundBody::Form(vec![("text".into(), "hi".into())]))
        );
    }

    #[test]
    fn fallback_urls_are_bound_the_same_way() {
        let endpoint = endpoint_from(json!({
            "url": "https://query1.finance.yahoo.com/v8/chart/{symbol}",
            "fallbackUrls": ["https://query2.finance.yahoo.com/v8/chart/{symbol}"],
            "path": { "symbol": { "type": "string", "required": true, "charset": "alnumDot" } },
            "query": { "range": { "type": "const", "value": "1d" } }
        }));
        let bound = bind(&endpoint, &json!({ "symbol": "BRK.B" })).unwrap();

        assert_eq!(bound.urls.len(), 2);
        assert!(bound.urls[0].starts_with("https://query1.finance.yahoo.com/v8/chart/BRK.B?"));
        assert!(bound.urls[1].starts_with("https://query2.finance.yahoo.com/v8/chart/BRK.B?"));
        assert!(bound.urls.iter().all(|url| url.contains("range=1d")));
    }

    #[test]
    fn declared_headers_and_user_agent_travel_with_the_request() {
        let endpoint = endpoint_from(json!({
            "headers": { "Accept": "application/json" },
            "userAgent": "Mozilla/5.0 (compatible)"
        }));
        let bound = bind(&endpoint, &Value::Null).unwrap();
        assert_eq!(bound.headers["Accept"], "application/json");
        assert_eq!(
            bound.user_agent.as_deref(),
            Some("Mozilla/5.0 (compatible)")
        );
    }

    #[test]
    fn non_object_arguments_are_rejected() {
        let endpoint = endpoint_from(json!({}));
        assert_eq!(
            bind(&endpoint, &json!("nope")).unwrap_err(),
            "invalid_arguments"
        );
        assert!(bind(&endpoint, &Value::Null).is_ok());
    }
}
