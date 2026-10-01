//! Validation of a runtime package's `api.json` (declarative HTTP endpoints).
//!
//! Design: `docs/design/declarative-http-api.md`.
//! This is step D0 — the format and its validators. **Nothing here performs a
//! request**; the host-side call path lands in D1.
//!
//! Fail closed, always: an unknown key, an unparsable url or a credential type
//! that no longer exists makes the whole package `error` rather than degrading
//! to "most of it works". A declaration that is only partly understood cannot be
//! rendered honestly in the consent dialog, and the consent dialog is the point.
//!
//! Mirrored in `core/app/runtime/apiDeclarationValidate.ts` (AGENTS.md
//! invariant 4) — change both or neither.

use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::Value;

use crate::credentials::registry;

/// Only version the format has had.
const SCHEMA_VERSION: u64 = 1;

const MAX_ENDPOINTS: usize = 32;
const MAX_ID_LEN: usize = 64;
const MAX_DESCRIPTION_LEN: usize = 160;
const MAX_FALLBACK_URLS: usize = 4;
const MAX_USER_AGENT_LEN: usize = 128;
const MAX_HEADERS: usize = 8;
const MAX_HEADER_VALUE_LEN: usize = 256;
const MAX_PARAMS_PER_LOCATION: usize = 16;
const DEFAULT_STRING_MAX_LEN: usize = 256;
const HARD_STRING_MAX_LEN: usize = 2048;
const MAX_ENUM_VALUES: usize = 32;
const MAX_ARRAY_ITEMS: usize = 100;
/// Caps for cache/rate windows — a day is already an eternity for a widget.
const MAX_WINDOW_SECS: u64 = 86_400;

/// HTTP methods the format allows in v1.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Method {
    Get,
    Post,
    Put,
}

impl Method {
    fn parse(raw: &str) -> Option<Self> {
        match raw {
            "GET" => Some(Method::Get),
            "POST" => Some(Method::Post),
            "PUT" => Some(Method::Put),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Method::Get => "GET",
            Method::Post => "POST",
            Method::Put => "PUT",
        }
    }
}

/// How a `POST` or `PUT` body is encoded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BodyType {
    Json,
    Form,
}

/// Allowed character classes for string parameters.
///
/// Deliberately not a regex: a regex would need two behaviourally identical
/// implementations (Rust + TypeScript) and would bring catastrophic-backtracking
/// risk into a validator that runs on untrusted input.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Charset {
    Alnum,
    AlnumDash,
    AlnumDot,
    AlnumSymbol,
}

impl Charset {
    fn parse(raw: &str) -> Option<Self> {
        match raw {
            "alnum" => Some(Charset::Alnum),
            "alnumDash" => Some(Charset::AlnumDash),
            "alnumDot" => Some(Charset::AlnumDot),
            "alnumSymbol" => Some(Charset::AlnumSymbol),
            _ => None,
        }
    }

    /// True when every character of `value` is inside this class.
    ///
    /// Argument binding (`binding.rs`) is the caller.
    pub fn accepts(self, value: &str) -> bool {
        value.chars().all(|c| match self {
            Charset::Alnum => c.is_ascii_alphanumeric(),
            Charset::AlnumDash => c.is_ascii_alphanumeric() || c == '-' || c == '_',
            Charset::AlnumDot => c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_',
            Charset::AlnumSymbol => {
                c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '^' | '=' | ':')
            }
        })
    }
}

/// True when `value` may be used as a single URL path segment.
///
/// A charset is a character *class* and nothing more: `AlnumDot` happily accepts
/// `".."`, which is precisely the traversal the design forbids. Path binding
/// (`binding.rs`) therefore runs this check **in addition to** the declared
/// charset — it lives here, tested, so the call path cannot forget it.
pub fn is_safe_path_segment(value: &str) -> bool {
    if value.is_empty() || value.len() > HARD_STRING_MAX_LEN {
        return false;
    }
    if value == "." || value == ".." || value.starts_with('.') {
        return false;
    }
    // `%` would let a pre-encoded `%2f` smuggle in a separator; `/` and `\`
    // are separators outright; control characters can split headers/requests.
    !value
        .chars()
        .any(|c| c == '/' || c == '\\' || c == '%' || c.is_control())
}

/// One declared input value.
#[derive(Debug, Clone, PartialEq)]
pub enum Param {
    Array {
        required: bool,
        items: Box<Param>,
        max_items: usize,
    },
    Text {
        required: bool,
        max_length: usize,
        charset: Option<Charset>,
    },
    Number {
        required: bool,
    },
    Boolean {
        required: bool,
    },
    Enum {
        required: bool,
        values: Vec<String>,
    },
    /// Fixed value the caller can neither set nor override.
    Const {
        value: Value,
    },
}

impl Param {
    /// Whether the caller must supply this value (checked while binding).
    pub fn required(&self) -> bool {
        match self {
            Param::Array { required, .. }
            | Param::Text { required, .. }
            | Param::Number { required }
            | Param::Boolean { required }
            | Param::Enum { required, .. } => *required,
            // A const is always present and never supplied by the caller.
            Param::Const { .. } => false,
        }
    }
}

/// One declared endpoint.
#[derive(Debug, Clone, PartialEq)]
pub struct Endpoint {
    pub id: String,
    /// User-visible consent text. Author-supplied, therefore untrusted: render
    /// as text, never as markup.
    pub description: String,
    pub method: Method,
    pub url: String,
    /// Alternates tried only on network error / 5xx (D1), each validated like `url`.
    pub fallback_urls: Vec<String>,
    /// Fixed User-Agent; some providers reject default clients (Yahoo → 429).
    pub user_agent: Option<String>,
    pub path: BTreeMap<String, Param>,
    pub query: BTreeMap<String, Param>,
    pub body: BTreeMap<String, Param>,
    pub body_type: BodyType,
    pub headers: BTreeMap<String, String>,
    /// Credential *type* id from `crate::credentials::registry`.
    pub credential: Option<String>,
    pub cache_ttl_secs: Option<u64>,
    pub min_interval_secs: Option<u64>,
}

impl Endpoint {
    /// Host shown in the consent dialog (never a path or query).
    pub fn host(&self) -> String {
        url::Url::parse(&self.url)
            .ok()
            .and_then(|parsed| parsed.host_str().map(str::to_string))
            .unwrap_or_default()
    }
}

/// A package's validated declaration.
#[derive(Debug, Clone, PartialEq)]
pub struct ApiDeclaration {
    pub endpoints: Vec<Endpoint>,
}

/// Frontend-facing endpoint row: exactly what the consent dialog needs, and
/// nothing that could be mistaken for a capability.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointSummary {
    pub id: String,
    pub description: String,
    pub method: &'static str,
    /// Primary host plus any fallback hosts — all of them are shown.
    pub hosts: Vec<String>,
    pub credential: Option<String>,
}

impl ApiDeclaration {
    pub fn summaries(&self) -> Vec<EndpointSummary> {
        self.endpoints
            .iter()
            .map(|endpoint| {
                let mut hosts = vec![endpoint.host()];
                for fallback in &endpoint.fallback_urls {
                    if let Some(host) = url::Url::parse(fallback)
                        .ok()
                        .and_then(|parsed| parsed.host_str().map(str::to_string))
                    {
                        if !hosts.contains(&host) {
                            hosts.push(host);
                        }
                    }
                }
                EndpointSummary {
                    id: endpoint.id.clone(),
                    description: endpoint.description.clone(),
                    method: endpoint.method.as_str(),
                    hosts,
                    credential: endpoint.credential.clone(),
                }
            })
            .collect()
    }
}

/// Rejects any key the format does not define, so a declaration can never mean
/// more than what the consent dialog showed.
fn reject_unknown_keys(
    obj: &serde_json::Map<String, Value>,
    allowed: &[&str],
    scope: &str,
) -> Result<(), String> {
    for key in obj.keys() {
        if !allowed.contains(&key.as_str()) {
            return Err(format!("unknown_key:{scope}.{key}"));
        }
    }
    Ok(())
}

fn as_object<'a>(
    value: &'a Value,
    code: &str,
) -> Result<&'a serde_json::Map<String, Value>, String> {
    value.as_object().ok_or_else(|| code.to_string())
}

/// `[a-zA-Z][a-zA-Z0-9_]{0,63}`
fn valid_endpoint_id(id: &str) -> bool {
    if id.is_empty() || id.len() > MAX_ID_LEN {
        return false;
    }
    let mut chars = id.chars();
    let first = chars.next().unwrap_or('\0');
    if !first.is_ascii_alphabetic() {
        return false;
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Static, absolute, https url whose only variable parts are whole path
/// segments — the guarantee the security model rests on (design §6.1).
///
/// A placeholder may occupy a segment (`/repos/{owner}/{repo}`) or sit inside
/// one beside literal text (`/feed/@{uid}/`, `/v1/user-{id}.json`). Never in the
/// host, and never twice in one segment.
///
/// PARTIAL SEGMENTS USED TO BE REFUSED, with the reason that they "would let one
/// argument carry a `/` worth of meaning". That reason did not survive being
/// checked: what stops an argument carrying a separator is `is_safe_path_segment`
/// refusing `/`, `\`, `%` and `..`, plus `encode_path_segment` percent-encoding
/// everything outside `A-Za-z0-9-._~`. Both run per value and neither cares
/// where in the segment the value sits. The whole-segment rule was protecting
/// nothing the encoding was not already protecting.
///
/// What it did cost is real: WAQI addresses a station as `/feed/@6189/`, and
/// no charset admits `@`, so a widget could search for stations and never read
/// one. Chained lookups — search, then fetch by id — are the ordinary shape of
/// a REST API, and this rule made them unexpressible whenever the id carried a
/// sigil.
///
/// The literal text around a placeholder comes from the declaration the person
/// reviewed, not from the caller, so it cannot be widened either.
///
/// Returns the placeholder names in the order they appear.
fn validate_url(raw: &str) -> Result<Vec<String>, String> {
    let parsed = url::Url::parse(raw).map_err(|_| "invalid_url".to_string())?;
    // The host is parsed before any placeholder check, so a brace there can
    // never be mistaken for a path placeholder.
    if parsed
        .host_str()
        .is_some_and(|host| host.contains('{') || host.contains('}'))
    {
        return Err("url_placeholder_in_host".into());
    }
    if parsed.scheme() != "https" {
        return Err("url_not_https".into());
    }
    if parsed.query().is_some() {
        return Err("url_has_query".into());
    }
    if parsed.fragment().is_some() {
        return Err("url_has_fragment".into());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("url_has_userinfo".into());
    }
    match parsed.host() {
        Some(url::Host::Domain(domain)) if !domain.is_empty() => {}
        // An IP literal skips DNS and is the classic way to reach a local
        // service; hosts must be names so the resolution check can run.
        Some(_) => return Err("url_is_ip_literal".into()),
        None => return Err("invalid_url".into()),
    }

    // Placeholders are read from the raw string, not from `parsed.path()`:
    // url parsing percent-encodes braces (`{owner}` → `%7Bowner%7D`), which
    // would hide every placeholder from this check.
    let raw_path = raw_path_of(raw);

    let mut placeholders = Vec::new();
    for segment in raw_path.split('/') {
        if segment.is_empty() {
            continue;
        }
        if !segment.contains('{') && !segment.contains('}') {
            continue;
        }
        // Exactly one placeholder per segment. `{a}{b}` is still refused: two
        // adjacent values with no separator between them are ambiguous to read
        // and buy nothing a second segment does not.
        let open = segment.matches('{').count();
        let close = segment.matches('}').count();
        if open != 1 || close != 1 {
            return Err("url_partial_placeholder".into());
        }
        let start = segment.find('{').expect("counted one");
        let end = segment.find('}').expect("counted one");
        if end < start {
            return Err("url_partial_placeholder".into());
        }
        let name = &segment[start + 1..end];
        if !valid_param_name(name) {
            return Err("invalid_placeholder_name".into());
        }
        if placeholders.contains(&name.to_string()) {
            return Err("duplicate_placeholder".into());
        }
        placeholders.push(name.to_string());
    }
    Ok(placeholders)
}

/// Parameter and placeholder names share one rule.
fn valid_param_name(name: &str) -> bool {
    valid_endpoint_id(name)
}

/// Path portion of a raw url string, untouched by url normalization.
///
/// Query and fragment are rejected before this runs, so everything after the
/// authority is path.
fn raw_path_of(raw: &str) -> &str {
    let after_scheme = raw.split_once("://").map(|(_, rest)| rest).unwrap_or(raw);
    match after_scheme.find('/') {
        Some(index) => &after_scheme[index..],
        None => "",
    }
}

/// Headers a declaration may set. `Authorization` is absent on purpose: auth
/// comes from the credential layer, never from the package's file.
fn header_allowed(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower == "accept" || lower == "content-type" || lower.starts_with("x-")
}

fn parse_param(raw: &Value, scope: &str) -> Result<Param, String> {
    let obj = as_object(raw, "invalid_param_type")?;
    reject_unknown_keys(
        obj,
        &[
            "type",
            "required",
            "value",
            "values",
            "maxLength",
            "charset",
            "description",
            "items",
            "maxItems",
        ],
        scope,
    )?;

    let kind = obj
        .get("type")
        .and_then(Value::as_str)
        .ok_or("invalid_param_type")?;
    let required = match obj.get("required") {
        None => false,
        Some(Value::Bool(value)) => *value,
        Some(_) => return Err("invalid_param_type".into()),
    };

    match kind {
        "array" => {
            if scope != "body" {
                return Err("array_not_in_body".into());
            }
            let items = obj.get("items").ok_or("invalid_array_items")?;
            // Check before recursion: nested arrays and objects are not supported.
            if !matches!(
                items.get("type").and_then(Value::as_str),
                Some("string" | "number" | "boolean" | "enum")
            ) {
                return Err("invalid_array_items".into());
            }
            let max_items = match obj.get("maxItems") {
                None => MAX_ARRAY_ITEMS,
                Some(value) => {
                    let n = value.as_u64().ok_or("invalid_array_max_items")?;
                    if n == 0 || n > MAX_ARRAY_ITEMS as u64 {
                        return Err("invalid_array_max_items".into());
                    }
                    n as usize
                }
            };
            Ok(Param::Array {
                required,
                items: Box::new(parse_param(items, "items")?),
                max_items,
            })
        }
        "string" => {
            let max_length = match obj.get("maxLength") {
                None => DEFAULT_STRING_MAX_LEN,
                Some(value) => {
                    let n = value.as_u64().ok_or("invalid_param_type")? as usize;
                    if n == 0 || n > HARD_STRING_MAX_LEN {
                        return Err("invalid_param_max_length".into());
                    }
                    n
                }
            };
            let charset = match obj.get("charset") {
                None => None,
                Some(Value::String(name)) => Some(Charset::parse(name).ok_or("invalid_charset")?),
                Some(_) => return Err("invalid_charset".into()),
            };
            Ok(Param::Text {
                required,
                max_length,
                charset,
            })
        }
        "number" => Ok(Param::Number { required }),
        "boolean" => Ok(Param::Boolean { required }),
        "enum" => {
            let values = obj
                .get("values")
                .and_then(Value::as_array)
                .ok_or("invalid_enum_values")?;
            if values.is_empty() || values.len() > MAX_ENUM_VALUES {
                return Err("invalid_enum_values".into());
            }
            let mut parsed = Vec::with_capacity(values.len());
            for value in values {
                parsed.push(value.as_str().ok_or("invalid_enum_values")?.to_string());
            }
            Ok(Param::Enum {
                required,
                values: parsed,
            })
        }
        "const" => {
            let value = obj.get("value").ok_or("invalid_const")?;
            if value.is_object() || value.is_array() || value.is_null() {
                return Err("invalid_const".into());
            }
            Ok(Param::Const {
                value: value.clone(),
            })
        }
        _ => Err("invalid_param_type".into()),
    }
}

fn parse_params(raw: Option<&Value>, scope: &str) -> Result<BTreeMap<String, Param>, String> {
    let Some(raw) = raw else {
        return Ok(BTreeMap::new());
    };
    let obj = as_object(raw, "invalid_params")?;
    if obj.len() > MAX_PARAMS_PER_LOCATION {
        return Err("too_many_params".into());
    }
    let mut out = BTreeMap::new();
    for (name, value) in obj {
        if name.is_empty() || name.len() > MAX_ID_LEN {
            return Err("invalid_param_name".into());
        }
        out.insert(name.clone(), parse_param(value, scope)?);
    }
    Ok(out)
}

fn parse_window(
    obj: &serde_json::Map<String, Value>,
    key: &str,
    field: &str,
    scope: &str,
) -> Result<Option<u64>, String> {
    let Some(raw) = obj.get(key) else {
        return Ok(None);
    };
    let inner = as_object(raw, "invalid_window")?;
    reject_unknown_keys(inner, &[field], scope)?;
    let seconds = inner
        .get(field)
        .and_then(Value::as_u64)
        .ok_or("invalid_window")?;
    if seconds == 0 || seconds > MAX_WINDOW_SECS {
        return Err("invalid_window".into());
    }
    Ok(Some(seconds))
}

fn parse_endpoint(raw: &Value) -> Result<Endpoint, String> {
    let obj = as_object(raw, "invalid_endpoint")?;
    reject_unknown_keys(
        obj,
        &[
            "id",
            "description",
            "method",
            "url",
            "fallbackUrls",
            "userAgent",
            "path",
            "query",
            "body",
            "bodyType",
            "headers",
            "credential",
            "cache",
            "rate",
        ],
        "endpoint",
    )?;

    let id = obj
        .get("id")
        .and_then(Value::as_str)
        .ok_or("invalid_endpoint_id")?;
    if !valid_endpoint_id(id) {
        return Err("invalid_endpoint_id".into());
    }

    let description = obj
        .get("description")
        .and_then(Value::as_str)
        .ok_or("missing_description")?;
    if description.trim().is_empty() {
        return Err("missing_description".into());
    }
    if description.chars().count() > MAX_DESCRIPTION_LEN {
        return Err("description_too_long".into());
    }

    let method = obj
        .get("method")
        .and_then(Value::as_str)
        .and_then(Method::parse)
        .ok_or("invalid_method")?;

    let url = obj
        .get("url")
        .and_then(Value::as_str)
        .ok_or("invalid_url")?;
    let placeholders = validate_url(url)?;

    let mut fallback_urls = Vec::new();
    if let Some(raw_fallbacks) = obj.get("fallbackUrls") {
        let list = raw_fallbacks.as_array().ok_or("invalid_fallback_urls")?;
        if list.len() > MAX_FALLBACK_URLS {
            return Err("too_many_fallback_urls".into());
        }
        for entry in list {
            let candidate = entry.as_str().ok_or("invalid_fallback_urls")?;
            let fallback_placeholders = validate_url(candidate)?;
            // A fallback with a different shape would bind different arguments
            // than the primary — same inputs, same target shape, or nothing.
            if fallback_placeholders != placeholders {
                return Err("fallback_placeholder_mismatch".into());
            }
            fallback_urls.push(candidate.to_string());
        }
    }

    let user_agent = match obj.get("userAgent") {
        None => None,
        Some(Value::String(value)) => {
            if value.trim().is_empty()
                || value.len() > MAX_USER_AGENT_LEN
                || !value.chars().all(|c| c.is_ascii_graphic() || c == ' ')
            {
                return Err("invalid_user_agent".into());
            }
            Some(value.clone())
        }
        Some(_) => return Err("invalid_user_agent".into()),
    };

    let path = parse_params(obj.get("path"), "path")?;
    // Declaration and url must agree exactly: an undeclared placeholder could
    // never be filled, and a declared-but-unused path param would silently do
    // nothing while looking like an input in the consent dialog.
    for name in &placeholders {
        if !path.contains_key(name) {
            return Err(format!("undeclared_placeholder:{name}"));
        }
    }
    for name in path.keys() {
        if !placeholders.contains(name) {
            return Err(format!("unused_path_param:{name}"));
        }
        // A const path segment is pointless (it would just be part of the url)
        // and would make the consent text claim an input that does not exist.
        if matches!(path[name], Param::Const { .. }) {
            return Err(format!("const_path_param:{name}"));
        }
    }

    let query = parse_params(obj.get("query"), "query")?;
    let body = parse_params(obj.get("body"), "body")?;
    if method == Method::Get && !body.is_empty() {
        return Err("body_on_get".into());
    }

    let body_type = match obj.get("bodyType") {
        None => BodyType::Json,
        Some(Value::String(value)) if value == "json" => BodyType::Json,
        Some(Value::String(value)) if value == "form" => BodyType::Form,
        Some(_) => return Err("invalid_body_type".into()),
    };
    if body_type == BodyType::Form
        && body
            .values()
            .any(|param| matches!(param, Param::Array { .. }))
    {
        return Err("array_on_form".into());
    }

    let mut headers = BTreeMap::new();
    if let Some(raw_headers) = obj.get("headers") {
        let map = as_object(raw_headers, "invalid_headers")?;
        if map.len() > MAX_HEADERS {
            return Err("too_many_headers".into());
        }
        for (name, value) in map {
            if !header_allowed(name) {
                return Err(format!("header_not_allowed:{name}"));
            }
            let value = value.as_str().ok_or("invalid_headers")?;
            if value.len() > MAX_HEADER_VALUE_LEN
                || !value.chars().all(|c| c.is_ascii_graphic() || c == ' ')
            {
                return Err("invalid_headers".into());
            }
            headers.insert(name.clone(), value.to_string());
        }
    }

    let credential = match obj.get("credential") {
        None | Some(Value::Null) => None,
        Some(Value::String(type_id)) => {
            // A stale type id would mean the consent dialog names a credential
            // that no longer exists — reject instead of guessing.
            if registry::find(type_id).is_none() {
                return Err(format!("unknown_credential_type:{type_id}"));
            }
            Some(type_id.clone())
        }
        Some(_) => return Err("invalid_credential".into()),
    };

    let cache_ttl_secs = parse_window(obj, "cache", "ttlSeconds", "cache")?;
    let min_interval_secs = parse_window(obj, "rate", "minIntervalSeconds", "rate")?;

    Ok(Endpoint {
        id: id.to_string(),
        description: description.trim().to_string(),
        method,
        url: url.to_string(),
        fallback_urls,
        user_agent,
        path,
        query,
        body,
        body_type,
        headers,
        credential,
        cache_ttl_secs,
        min_interval_secs,
    })
}

/// Validates a raw `api.json` document. `Err` is a stable code, mirrored in the
/// frontend validator and surfaced in the package list.
pub fn parse_api_declaration(raw: &Value) -> Result<ApiDeclaration, String> {
    let obj = as_object(raw, "declaration_not_object")?;
    reject_unknown_keys(obj, &["schemaVersion", "endpoints"], "root")?;

    match obj.get("schemaVersion").and_then(Value::as_u64) {
        Some(version) if version == SCHEMA_VERSION => {}
        _ => return Err("schema_version_unsupported".into()),
    }

    let list = obj
        .get("endpoints")
        .and_then(Value::as_array)
        .ok_or("invalid_endpoints")?;
    if list.is_empty() {
        return Err("no_endpoints".into());
    }
    if list.len() > MAX_ENDPOINTS {
        return Err("too_many_endpoints".into());
    }

    let mut endpoints = Vec::with_capacity(list.len());
    let mut seen = Vec::with_capacity(list.len());
    for raw_endpoint in list {
        let endpoint = parse_endpoint(raw_endpoint)?;
        if seen.contains(&endpoint.id) {
            return Err("duplicate_endpoint_id".into());
        }
        seen.push(endpoint.id.clone());
        endpoints.push(endpoint);
    }

    Ok(ApiDeclaration { endpoints })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn endpoint(extra: Value) -> Value {
        let mut base = json!({
            "id": "forecast",
            "description": "Reads the current temperature from Open-Meteo.",
            "method": "GET",
            "url": "https://api.open-meteo.com/v1/forecast",
        });
        if let (Some(base_obj), Some(extra_obj)) = (base.as_object_mut(), extra.as_object()) {
            for (key, value) in extra_obj {
                base_obj.insert(key.clone(), value.clone());
            }
        }
        base
    }

    fn declaration(endpoints: Value) -> Value {
        json!({ "schemaVersion": 1, "endpoints": endpoints })
    }

    fn parse_one(extra: Value) -> Result<Endpoint, String> {
        parse_api_declaration(&declaration(json!([endpoint(extra)])))
            .map(|decl| decl.endpoints.into_iter().next().unwrap())
    }

    #[test]
    fn accepts_the_documented_weather_example() {
        let decl = parse_api_declaration(&declaration(json!([endpoint(json!({
            "query": {
                "latitude": { "type": "number", "required": true },
                "longitude": { "type": "number", "required": true },
                "current": { "type": "const", "value": "temperature_2m" }
            },
            "cache": { "ttlSeconds": 600 },
            "rate": { "minIntervalSeconds": 60 }
        }))])))
        .unwrap();

        let endpoint = &decl.endpoints[0];
        assert_eq!(endpoint.method, Method::Get);
        assert_eq!(endpoint.cache_ttl_secs, Some(600));
        assert_eq!(endpoint.min_interval_secs, Some(60));
        assert!(matches!(
            endpoint.query.get("current"),
            Some(Param::Const { .. })
        ));

        let summary = &decl.summaries()[0];
        assert_eq!(summary.hosts, vec!["api.open-meteo.com".to_string()]);
        assert_eq!(summary.credential, None);
    }

    #[test]
    fn rejects_a_wrong_schema_version() {
        assert_eq!(
            parse_api_declaration(&json!({ "schemaVersion": 2, "endpoints": [] })).unwrap_err(),
            "schema_version_unsupported"
        );
        assert_eq!(
            parse_api_declaration(&json!({ "endpoints": [] })).unwrap_err(),
            "schema_version_unsupported"
        );
    }

    /// A format that silently ignores what it does not understand cannot be
    /// audited — the consent dialog would under-report what the package does.
    #[test]
    fn rejects_unknown_keys_at_every_level() {
        let root = parse_api_declaration(&json!({
            "schemaVersion": 1,
            "endpoints": [endpoint(json!({}))],
            "extra": true
        }))
        .unwrap_err();
        assert!(root.starts_with("unknown_key:root."), "{root}");

        let ep = parse_one(json!({ "retries": 3 })).unwrap_err();
        assert!(ep.starts_with("unknown_key:endpoint."), "{ep}");

        let param = parse_one(json!({ "query": { "a": { "type": "string", "pattern": "^x$" } } }))
            .unwrap_err();
        assert!(param.starts_with("unknown_key:query."), "{param}");
    }

    #[test]
    fn endpoint_ids_are_constrained_and_unique() {
        assert_eq!(
            parse_one(json!({ "id": "9lives" })).unwrap_err(),
            "invalid_endpoint_id"
        );
        assert_eq!(
            parse_one(json!({ "id": "has-dash" })).unwrap_err(),
            "invalid_endpoint_id"
        );
        assert_eq!(
            parse_one(json!({ "id": "" })).unwrap_err(),
            "invalid_endpoint_id"
        );

        let duplicated = declaration(json!([endpoint(json!({})), endpoint(json!({}))]));
        assert_eq!(
            parse_api_declaration(&duplicated).unwrap_err(),
            "duplicate_endpoint_id"
        );
    }

    /// The description is consent text, so it must exist and stay short enough
    /// to read.
    #[test]
    fn description_is_required_and_capped() {
        assert_eq!(
            parse_one(json!({ "description": "   " })).unwrap_err(),
            "missing_description"
        );
        assert_eq!(
            parse_one(json!({ "description": "x".repeat(161) })).unwrap_err(),
            "description_too_long"
        );
    }

    /// Design §6.1: nothing a caller controls may influence the target.
    #[test]
    fn urls_must_be_static_https_hosts() {
        for (url, code) in [
            ("http://api.example.com/v1", "url_not_https"),
            ("https://api.example.com/v1?key=1", "url_has_query"),
            ("https://api.example.com/v1#frag", "url_has_fragment"),
            ("https://user:pw@api.example.com/v1", "url_has_userinfo"),
            ("https://127.0.0.1/v1", "url_is_ip_literal"),
            ("https://[::1]/v1", "url_is_ip_literal"),
            ("not a url", "invalid_url"),
        ] {
            assert_eq!(
                parse_one(json!({ "url": url })).unwrap_err(),
                code,
                "url {url}"
            );
        }
    }

    /// Placeholders are the only variable part of a url, and only as whole
    /// segments — the declaration and the url must agree exactly.
    #[test]
    fn path_placeholders_bind_to_declared_params() {
        let ok = parse_one(json!({
            "url": "https://api.github.com/repos/{owner}/{repo}/actions/runs",
            "path": {
                "owner": { "type": "string", "required": true, "charset": "alnumDash" },
                "repo": { "type": "string", "required": true, "charset": "alnumDash" }
            }
        }))
        .unwrap();
        assert_eq!(ok.path.len(), 2);

        // A placeholder nobody declared could never be filled.
        assert_eq!(
            parse_one(json!({ "url": "https://api.example.com/v1/{id}" })).unwrap_err(),
            "undeclared_placeholder:id"
        );
        // A declared param the url never uses looks like an input but is none.
        assert_eq!(
            parse_one(json!({ "path": { "id": { "type": "string" } } })).unwrap_err(),
            "unused_path_param:id"
        );
        // A placeholder inside a segment is allowed, and still has to be
        // declared like any other. WAQI's `/feed/@6189/` is the case that made
        // this necessary: no charset admits `@`, so the sigil has to be literal
        // text in the url and the id has to sit beside it.
        assert_eq!(
            parse_one(json!({ "url": "https://api.example.com/v1/user-{id}" })).unwrap_err(),
            "undeclared_placeholder:id"
        );
        assert!(
            parse_one(json!({
                "url": "https://api.waqi.info/feed/@{uid}/",
                "path": { "uid": { "type": "string" } }
            }))
            .is_ok(),
            "a sigil before the value is literal text and cannot be widened",
        );
        // Two values in one segment stay refused: ambiguous to read, and a
        // second segment expresses it.
        assert_eq!(
            parse_one(json!({ "url": "https://api.example.com/v1/{a}{b}" })).unwrap_err(),
            "url_partial_placeholder"
        );
        assert_eq!(
            parse_one(json!({ "url": "https://{host}.example.com/v1" })).unwrap_err(),
            "url_placeholder_in_host"
        );
        assert_eq!(
            parse_one(json!({
                "url": "https://api.example.com/{id}/{id}",
                "path": { "id": { "type": "string" } }
            }))
            .unwrap_err(),
            "duplicate_placeholder"
        );
        // A const segment is just part of the url, and would claim a phantom input.
        assert_eq!(
            parse_one(json!({
                "url": "https://api.example.com/{kind}",
                "path": { "kind": { "type": "const", "value": "runs" } }
            }))
            .unwrap_err(),
            "const_path_param:kind"
        );
    }

    #[test]
    fn fallback_urls_are_validated_like_the_primary() {
        let ok = parse_one(json!({
            "fallbackUrls": ["https://query2.finance.yahoo.com/v8/finance/chart"]
        }))
        .unwrap();
        assert_eq!(ok.fallback_urls.len(), 1);

        assert_eq!(
            parse_one(json!({ "fallbackUrls": ["http://query2.example.com"] })).unwrap_err(),
            "url_not_https"
        );
        assert_eq!(
            parse_one(json!({ "fallbackUrls": ["https://10.0.0.1/x"] })).unwrap_err(),
            "url_is_ip_literal"
        );

        // A fallback with a different shape would bind different arguments.
        assert_eq!(
            parse_one(json!({
                "url": "https://a.example.com/{id}",
                "path": { "id": { "type": "string" } },
                "fallbackUrls": ["https://b.example.com/fixed"]
            }))
            .unwrap_err(),
            "fallback_placeholder_mismatch"
        );
    }

    /// Auth comes from the credential layer; a package may not smuggle it in
    /// through a header.
    #[test]
    fn authorization_and_other_headers_are_rejected() {
        let err = parse_one(json!({ "headers": { "Authorization": "Bearer x" } })).unwrap_err();
        assert!(err.starts_with("header_not_allowed:"), "{err}");
        assert!(parse_one(json!({ "headers": { "Cookie": "a=b" } }))
            .unwrap_err()
            .starts_with("header_not_allowed:"));

        let ok = parse_one(json!({
            "headers": { "Accept": "application/json", "X-GitHub-Api-Version": "2022-11-28" }
        }))
        .unwrap();
        assert_eq!(ok.headers.len(), 2);
    }

    #[test]
    fn credential_must_name_a_registered_type() {
        let ok = parse_one(json!({ "credential": registry::GITHUB_PAT })).unwrap();
        assert_eq!(ok.credential.as_deref(), Some(registry::GITHUB_PAT));

        let err = parse_one(json!({ "credential": "nopeToken" })).unwrap_err();
        assert!(err.starts_with("unknown_credential_type:"), "{err}");
    }

    #[test]
    fn bodies_belong_to_post_and_put() {
        assert_eq!(
            parse_one(json!({ "body": { "text": { "type": "string" } } })).unwrap_err(),
            "body_on_get"
        );
        for method in ["POST", "PUT"] {
            let ok = parse_one(json!({
                "method": method,
                "body": { "text": { "type": "string", "required": true } },
                "bodyType": "form"
            }))
            .unwrap();
            assert_eq!(ok.method.as_str(), method);
            assert_eq!(ok.body_type, BodyType::Form);
            assert!(ok.body["text"].required());
        }
        for method in ["PATCH", "DELETE", "put"] {
            assert_eq!(
                parse_one(json!({ "method": method })).unwrap_err(),
                "invalid_method"
            );
        }
    }

    #[test]
    fn arrays_belong_only_to_json_bodies() {
        let array = json!({ "type": "array", "items": { "type": "string", "maxLength": 64 }, "required": true });
        for method in ["POST", "PUT"] {
            let endpoint =
                parse_one(json!({ "method": method, "body": { "uris": array } })).unwrap();
            assert!(matches!(
                endpoint.body["uris"],
                Param::Array {
                    max_items: 100,
                    required: true,
                    ..
                }
            ));
        }
        for items in [
            json!({ "type": "number" }),
            json!({ "type": "boolean" }),
            json!({ "type": "enum", "values": ["a"] }),
        ] {
            let mut param = array.clone();
            param["items"] = items;
            param["maxItems"] = json!(1);
            assert!(parse_one(json!({ "method": "PUT", "body": { "values": param } })).is_ok());
        }
        for limit in [
            json!(0),
            json!(-1),
            json!(101),
            json!(1.5),
            json!("2"),
            Value::Null,
        ] {
            let mut param = array.clone();
            param["maxItems"] = limit;
            assert_eq!(
                parse_one(json!({ "method": "PUT", "body": { "uris": param } })).unwrap_err(),
                "invalid_array_max_items"
            );
        }
        for items in [
            Value::Null,
            json!({}),
            json!({ "type": "object" }),
            json!({ "type": "array", "items": { "type": "string" } }),
            json!({ "type": "const", "value": "a" }),
        ] {
            let mut param = array.clone();
            param["items"] = items;
            assert_eq!(
                parse_one(json!({ "method": "PUT", "body": { "uris": param } })).unwrap_err(),
                "invalid_array_items"
            );
        }
        assert_eq!(parse_one(json!({ "method": "PUT", "body": { "uris": { "type": "array", "items": { "type": "string", "surprise": true } } } })).unwrap_err(), "unknown_key:items.surprise");
        assert_eq!(
            parse_one(json!({ "method": "PUT", "body": { "uris": array }, "bodyType": "form" }))
                .unwrap_err(),
            "array_on_form"
        );
        assert_eq!(
            parse_one(json!({ "body": { "uris": array } })).unwrap_err(),
            "body_on_get"
        );
        assert_eq!(
            parse_one(json!({ "query": { "uris": array } })).unwrap_err(),
            "array_not_in_body"
        );
        assert_eq!(
            parse_one(json!({ "url": "https://api.example.com/{id}", "path": { "id": array } }))
                .unwrap_err(),
            "array_not_in_body"
        );
    }

    #[test]
    fn parameter_types_are_checked() {
        assert_eq!(
            parse_one(json!({ "query": { "a": { "type": "object" } } })).unwrap_err(),
            "invalid_param_type"
        );
        assert_eq!(
            parse_one(json!({ "query": { "a": { "type": "enum", "values": [] } } })).unwrap_err(),
            "invalid_enum_values"
        );
        assert_eq!(
            parse_one(json!({ "query": { "a": { "type": "const" } } })).unwrap_err(),
            "invalid_const"
        );
        assert_eq!(
            parse_one(json!({ "query": { "a": { "type": "string", "maxLength": 9999 } } }))
                .unwrap_err(),
            "invalid_param_max_length"
        );
        assert_eq!(
            parse_one(json!({ "query": { "a": { "type": "string", "charset": "regex" } } }))
                .unwrap_err(),
            "invalid_charset"
        );
    }

    /// The charset classes replace a regex; these are the checks a stock symbol
    /// will be run through in D1.
    #[test]
    fn charsets_accept_only_their_class() {
        assert!(Charset::Alnum.accepts("AAPL"));
        assert!(!Charset::Alnum.accepts("BRK.B"));
        assert!(Charset::AlnumDot.accepts("BRK.B"));
        assert!(Charset::AlnumSymbol.accepts("^GDAXI"));
        assert!(!Charset::AlnumDash.accepts("a/b"));
        assert!(!Charset::AlnumSymbol.accepts("a b"));
    }

    /// A charset is not a traversal defence: `AlnumDot` accepts `".."` by
    /// definition. Path binding needs the segment check on top, which is why
    /// both exist.
    #[test]
    fn path_segments_need_more_than_a_charset() {
        assert!(
            Charset::AlnumDot.accepts(".."),
            "charset is only a character class"
        );
        assert!(!is_safe_path_segment(".."));
        assert!(!is_safe_path_segment("."));
        assert!(!is_safe_path_segment(".hidden"));
        assert!(!is_safe_path_segment("a/b"));
        assert!(!is_safe_path_segment("a\\b"));
        assert!(!is_safe_path_segment("%2f"));
        assert!(!is_safe_path_segment("a\nb"));
        assert!(!is_safe_path_segment(""));

        assert!(is_safe_path_segment("AAPL"));
        assert!(is_safe_path_segment("BRK.B"));
        assert!(is_safe_path_segment("2026-08-01"));
    }

    #[test]
    fn windows_are_bounded() {
        assert_eq!(
            parse_one(json!({ "cache": { "ttlSeconds": 0 } })).unwrap_err(),
            "invalid_window"
        );
        assert_eq!(
            parse_one(json!({ "rate": { "minIntervalSeconds": 86_401 } })).unwrap_err(),
            "invalid_window"
        );
        assert!(parse_one(json!({ "cache": { "ttlSeconds": 86_400 } })).is_ok());
    }

    #[test]
    fn user_agent_is_a_bounded_printable_string() {
        assert!(parse_one(json!({ "userAgent": "Mozilla/5.0 (compatible)" })).is_ok());
        assert_eq!(
            parse_one(json!({ "userAgent": "" })).unwrap_err(),
            "invalid_user_agent"
        );
        assert_eq!(
            parse_one(json!({ "userAgent": "bad\nheader" })).unwrap_err(),
            "invalid_user_agent"
        );
    }

    #[test]
    fn endpoint_count_is_bounded() {
        let many: Vec<Value> = (0..33)
            .map(|i| endpoint(json!({ "id": format!("e{i}") })))
            .collect();
        assert_eq!(
            parse_api_declaration(&declaration(json!(many))).unwrap_err(),
            "too_many_endpoints"
        );
        assert_eq!(
            parse_api_declaration(&declaration(json!([]))).unwrap_err(),
            "no_endpoints"
        );
    }

    #[test]
    fn summaries_list_every_host_including_fallbacks() {
        let decl = parse_api_declaration(&declaration(json!([endpoint(json!({
            "url": "https://query1.finance.yahoo.com/v8/finance/chart",
            "fallbackUrls": ["https://query2.finance.yahoo.com/v8/finance/chart"],
            "credential": registry::GITHUB_PAT
        }))])))
        .unwrap();
        let summary = &decl.summaries()[0];
        assert_eq!(
            summary.hosts,
            vec![
                "query1.finance.yahoo.com".to_string(),
                "query2.finance.yahoo.com".to_string()
            ]
        );
        assert_eq!(summary.credential.as_deref(), Some(registry::GITHUB_PAT));
        assert_eq!(summary.method, "GET");
    }
}
