//! Custom `kavibay-ext` URI scheme for sandboxed runtime package UI.
//!
//! URL form (conceptual): `kavibay-ext://<extId>/<relative-path>`
//! On Windows/Android Tauri may present requests as
//! `http://kavibay-ext.localhost/<extId>/<relative-path>`.

use std::fs;
use std::path::{Path, PathBuf};

use percent_encoding::percent_decode_str;
use tauri::http::{header, Request, Response, StatusCode, Uri};
use tauri::{AppHandle, Runtime};

use super::validate::safe_join;

/// Restrictive CSP for every file served into extension iframes (network denied by default).
///
/// There is deliberately **no `frame-ancestors`**. It reads like the right
/// directive — "only this app may frame a package" — but `'self'` can never
/// match here: the package is served from `kavibay-ext.localhost` while the host
/// page is `tauri.localhost` in a build and `localhost:1420` in dev, so the
/// browser refuses the frame and the widget renders as a blank rectangle.
/// Nothing outside the app can request this scheme in the first place, so the
/// directive bought no protection to begin with; the isolation that matters is
/// the iframe's `sandbox="allow-scripts"` (one opaque origin per package,
/// enforced by `scripts/runtimeSandboxGuard.assert.mjs`).
/// `kavibay-img:` is named as a scheme source and **is not a network grant**.
/// Nothing on a network answers it: the request goes to this process, which
/// checks the url against the provider's compiled `image_hosts` and fetches it
/// itself. `connect-src 'none'` is what it costs to keep, and this is how a
/// widget shows a cover without that changing.
///
/// Both spellings, because Tauri presents the scheme as
/// `http://kavibay-img.localhost` on Windows and Android. Naming only one is a
/// CSP that works on the developer's machine.
///
/// WebKit does not match `'self'` for package resources in an opaque sandbox.
/// Name the local package protocol explicitly for scripts, styles and images;
/// otherwise macOS renders the HTML but blocks both the SDK and widget script.
/// These sources reach the host's protocol handlers, not arbitrary web hosts.
/// The frame keeps its opaque origin and direct network access stays denied.
const EXTENSION_FRAME_CSP: &str = concat!(
    "default-src 'none'; ",
    "img-src 'self' kavibay-ext: http://kavibay-ext.localhost data: blob: kavibay-img: http://kavibay-img.localhost; ",
    "style-src 'self' kavibay-ext: http://kavibay-ext.localhost 'unsafe-inline'; ",
    "script-src 'self' kavibay-ext: http://kavibay-ext.localhost; connect-src 'none'"
);

/// Parsed `kavibay-ext` request target.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KavibayExtTarget {
    pub ext_id: String,
    pub relative_path: String,
}

/// Register the `kavibay-ext` scheme on a Tauri builder (call before `.build`).
pub fn register_kavibay_ext_protocol<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.register_uri_scheme_protocol("kavibay-ext", |ctx, request| {
        handle_kavibay_ext_request(ctx.app_handle(), &request)
    })
}

/// Serve a file from `{data_dir}/extensions/<extId>/…` for a protocol request.
fn handle_kavibay_ext_request<R: Runtime>(
    app: &AppHandle<R>,
    request: &Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    match load_kavibay_ext_file(app, request.uri()) {
        Ok((bytes, content_type)) => file_response(bytes, content_type),
        Err(_) => status_response(StatusCode::NOT_FOUND),
    }
}

/// The CSP goes on every response, not only on HTML.
///
/// `sandbox="allow-scripts"` still lets a frame navigate *itself*, and the
/// host's `frame-src` admits any url on this scheme. An SVG of the package
/// served without the header was a document that runs script with an open
/// network: navigate there, `fetch` out whatever the page had read. A CSP on
/// a script, style or image is ignored, so this costs nothing where it does
/// not matter. `nosniff` keeps a `.txt` from being promoted to HTML.
fn file_response(bytes: Vec<u8>, content_type: &'static str) -> Response<Vec<u8>> {
    let bytes = if content_type.starts_with("text/html") {
        with_frame_defaults(bytes)
    } else {
        bytes
    };
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CONTENT_SECURITY_POLICY, EXTENSION_FRAME_CSP)
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .body(bytes)
        .unwrap_or_else(|_| status_response(StatusCode::INTERNAL_SERVER_ERROR))
}

/// Resolve URI → package file bytes + content type (always `safe_join`).
fn load_kavibay_ext_file<R: Runtime>(
    app: &AppHandle<R>,
    uri: &Uri,
) -> Result<(Vec<u8>, &'static str), String> {
    let target = parse_kavibay_ext_uri(uri)?;
    // Answered before the package directory is consulted: these belong to the
    // host, not to whoever happens to have a file by that name.
    if let Some(body) = host_served_script(&target.relative_path) {
        return Ok((body.as_bytes().to_vec(), "text/javascript"));
    }
    let package_root = package_root_for(app, &target.ext_id)?;
    if !package_root.is_dir() {
        return Err("missing_package".into());
    }
    let file_path = safe_join(&package_root, &target.relative_path)?;
    if !file_path.is_file() {
        return Err("not_a_file".into());
    }
    let bytes = fs::read(&file_path).map_err(|e| e.to_string())?;
    Ok((bytes, content_type_for(&file_path)))
}

/// Host prefix that serves a draft instead of an installed package.
///
/// Collision-proof rather than merely unlikely: a package id must start with an
/// alphanumeric (`drafts::is_valid_package_id`, enforced by manifest
/// validation), so no real package can ever answer to this name.
const DRAFT_HOST_PREFIX: &str = "__draft__";

/// Reserved path that serves the runtime SDK instead of a package file.
///
/// The format used to tell authors to copy `sdk/runtime/kavibay-runtime.js`
/// into their package. That works for a person with the repo open and is
/// impossible for anything that can only emit text — a generated package has no
/// file to copy, so it either reproduces three kilobytes verbatim or invents a
/// stub that defines nothing, and `kavibay.storage` throws a ReferenceError on
/// the first click.
///
/// Serving it removes the copy: every package loads the same SDK, and it is
/// always the current one. `@` cannot start a package-relative path that
/// `safe_join` would accept, so this can never shadow a real file.
const RUNTIME_SDK_PATH: &str = "@kavibay/runtime.js";

/// The SDK itself, embedded at compile time.
const RUNTIME_SDK: &str = include_str!("../../../sdk/runtime/kavibay-runtime.js");

/// The same idea for a package built against the extension contract.
///
/// Different runtime because it is a different contract: `@kavibay/runtime.js`
/// gives a package declared endpoints and key-value storage, this one gives it
/// `WidgetContext` — typed provider queries, actions, the query cache and the
/// host's gate. A package loads one or the other, never both.
///
/// Generated by `npm run build:guest` and committed, so this `include_str!`
/// resolves on a fresh clone. `scripts/contractGuestArtifact.assert.mjs` is
/// what keeps it from going stale.
const CONTRACT_GUEST_PATH: &str = "@kavibay/contract.js";
const CONTRACT_GUEST: &str = include_str!("../../../sdk/contract-guest/kavibay-contract-guest.js");

// Host gestures are shared by both package formats and installed before package
// scripts, so a generated widget never has to implement zoom itself.
const FRAME_GESTURES: &str = include_str!("../../../core/app/runtime/frameGestures.js");
const FRAME_GESTURES_TAG: &str = "<script src=\"@kavibay/frame.js\"></script>";

/// The canvas reset, injected into every HTML document this protocol serves.
///
/// WHY HERE AND NOT ONLY IN THE GUESTS. Both guests inject the same rule, and
/// both do it when their script runs — which a generated package puts at the
/// end of `<body>`. Until then the document has already been parsed with
/// `:root { color-scheme: dark }` and a transparent root, which is exactly the
/// combination that makes the canvas opaque, and the frame can compose its
/// background before the rule ever exists. That is why the black was
/// intermittent rather than constant: it was a race, and which side won
/// depended on how fast the package parsed.
///
/// Served into `<head>` this cannot race anything — it is in the document
/// before the package's own first stylesheet.
///
/// The rule itself is explained in `sdk/runtime/kavibay-runtime.js`; the short
/// version is that `color-scheme: normal` removes the substitution rather than
/// trying to satisfy it, and the two things the dark scheme was wanted for are
/// put back where they change rendering rather than the canvas.
/// `scripts/runtimeCanvasTransparency.assert.mjs` keeps all three copies
/// honest.
const CANVAS_RESET: &str = concat!(
    "<style>",
    ":root{color-scheme:normal !important;",
    "background-color:rgba(0,0,0,0.004) !important;",
    "scrollbar-color:rgba(232,232,234,0.32) transparent;}",
    "body{background:transparent !important;}",
    "input,textarea,select,button,progress,meter{color-scheme:dark;}",
    "</style>"
);

/// Put the canvas reset and host gestures before the package's own code.
///
/// After `<head>` where there is one, after `<html>` where there is not, and
/// after the doctype otherwise — never before it, because a stray node ahead of
/// the doctype drops the page into quirks mode, which changes far more than a
/// background.
fn with_frame_defaults(html: Vec<u8>) -> Vec<u8> {
    let Ok(text) = std::str::from_utf8(&html) else {
        // Not text we can reason about; serve it untouched rather than corrupt it.
        return html;
    };
    let lower = text.to_ascii_lowercase();
    let after_open_tag = |from: usize| lower[from..].find('>').map(|end| from + end + 1);

    let at = lower
        .find("<head")
        .and_then(after_open_tag)
        .or_else(|| lower.find("<html").and_then(after_open_tag))
        .or_else(|| lower.find("<!doctype").and_then(after_open_tag))
        .unwrap_or(0);

    let mut out = String::with_capacity(text.len() + CANVAS_RESET.len() + FRAME_GESTURES_TAG.len());
    out.push_str(&text[..at]);
    out.push_str(CANVAS_RESET);
    out.push_str(FRAME_GESTURES_TAG);
    out.push_str(&text[at..]);
    out.into_bytes()
}

/// Scripts the host serves itself, under names no package file can claim.
const HOST_SERVED: [(&str, &str); 3] = [
    (RUNTIME_SDK_PATH, RUNTIME_SDK),
    (CONTRACT_GUEST_PATH, CONTRACT_GUEST),
    ("@kavibay/frame.js", FRAME_GESTURES),
];

/// The script body when a request is for one of the host-served names.
///
/// Matched at any depth, because the browser resolves the `src` against the
/// document: a `ui/index.html` asking for `@kavibay/runtime.js` requests
/// `ui/@kavibay/runtime.js`. Comparing the whole path against the bare name
/// misses every package whose HTML is not at the root — which is all of them.
///
/// The leading slash in the suffix keeps it to whole segments, so a directory
/// called `not@kavibay` cannot claim it.
fn host_served_script(relative: &str) -> Option<&'static str> {
    HOST_SERVED.iter().find_map(|(name, body)| {
        (relative == *name || relative.ends_with(&format!("/{name}"))).then_some(*body)
    })
}

/// Directory of one package, in whichever root holds it.
///
/// Delegates to the shared resolver so this cannot drift from the rest: a
/// protocol handler looking in the wrong root serves nothing, and the symptom
/// is a widget that silently stays blank.
///
/// The draft prefix is what makes live preview possible at all: a draft has no
/// install record, so the bridge denies it storage grants and every declared
/// endpoint. It renders; it cannot reach anything.
fn package_root_for<R: Runtime>(app: &AppHandle<R>, ext_id: &str) -> Result<PathBuf, String> {
    if let Some(draft_id) = ext_id.strip_prefix(DRAFT_HOST_PREFIX) {
        return super::drafts::draft_package_dir(app, draft_id)
            .ok_or_else(|| "missing_draft".to_string());
    }
    super::package_root_for(app, ext_id).ok_or_else(|| "missing_package".to_string())
}

/// Parse extId + relative path from a request URI (platform-normalized).
pub fn parse_kavibay_ext_uri(uri: &Uri) -> Result<KavibayExtTarget, String> {
    let host = uri.host().unwrap_or("");
    let path = uri.path();

    // Tauri's `convertFileSrc` builds the URL with `encodeURIComponent`, which
    // encodes the separators too — on Windows the whole package path arrives as
    // one segment (`/<extId>%2Fui%2Findex.html`). Decoding has to happen before
    // the split, or there is nothing to split on.
    //
    // Decoding first is also the safe order, not a shortcut around it: every
    // check that matters — `validate_ext_id` below and `safe_join` at the call
    // site — then runs on the bytes that actually reach the filesystem, so an
    // encoded `%2F` or `%00` is caught rather than smuggled past.
    let decoded_path = percent_decode_str(path)
        .decode_utf8()
        .map_err(|_| "path_not_utf8".to_string())?;

    let (ext_id, relative_path) =
        if host.is_empty() || host.eq_ignore_ascii_case("localhost") || is_scheme_localhost(host) {
            // `kavibay-ext://localhost/<extId>/…` or `http://kavibay-ext.localhost/<extId>/…`
            split_ext_and_path(decoded_path.trim_start_matches('/'))?
        } else {
            // `kavibay-ext://<extId>/<relative-path>`
            let rel = decoded_path.trim_start_matches('/');
            if rel.is_empty() {
                return Err("missing_relative_path".into());
            }
            (host.to_string(), rel.to_string())
        };

    validate_ext_id(&ext_id)?;
    // Relative path still goes through safe_join (traversal / absolute / empty segments).
    if relative_path.is_empty() {
        return Err("missing_relative_path".into());
    }

    Ok(KavibayExtTarget {
        ext_id,
        relative_path,
    })
}

/// True for Tauri Windows/Android host form `kavibay-ext.localhost`.
fn is_scheme_localhost(host: &str) -> bool {
    host.eq_ignore_ascii_case("kavibay-ext.localhost")
}

/// Split `<extId>/<relative-path>` from a path without leading slash.
fn split_ext_and_path(trimmed: &str) -> Result<(String, String), String> {
    if trimmed.is_empty() {
        return Err("missing_ext_id".into());
    }
    let mut parts = trimmed.splitn(2, '/');
    let ext_id = parts
        .next()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "missing_ext_id".to_string())?
        .to_string();
    let relative_path = parts.next().unwrap_or("").to_string();
    if relative_path.is_empty() {
        return Err("missing_relative_path".into());
    }
    Ok((ext_id, relative_path))
}

/// Reject ext ids that cannot be a single safe directory name.
fn validate_ext_id(ext_id: &str) -> Result<(), String> {
    if ext_id.is_empty() {
        return Err("ext_id_empty".into());
    }
    if ext_id == "." || ext_id == ".." {
        return Err("ext_id_invalid".into());
    }
    // `:` too: on Windows `root.join("C:")` is the drive's working directory,
    // not a folder under the root.
    if ext_id.contains(['/', '\\', ':']) {
        return Err("ext_id_invalid".into());
    }
    if ext_id.contains('\0') {
        return Err("ext_id_invalid".into());
    }
    Ok(())
}

/// Map file extension → Content-Type for common package UI assets.
fn content_type_for(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "json" => "application/json; charset=utf-8",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "txt" | "md" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn status_response(status: StatusCode) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(Vec::new())
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

#[cfg(test)]
mod tests {

    /// Every file a frame can navigate to carries the frame CSP — an SVG is a
    /// scripted document too, and without it `connect-src 'none'` was one
    /// `location = "x.svg"` away from not applying.
    #[test]
    fn every_served_file_carries_the_frame_csp() {
        for content_type in [
            "text/html; charset=utf-8",
            "image/svg+xml",
            "text/plain; charset=utf-8",
            "application/octet-stream",
        ] {
            let response = super::file_response(b"<svg/>".to_vec(), content_type);
            assert_eq!(
                response
                    .headers()
                    .get(tauri::http::header::CONTENT_SECURITY_POLICY)
                    .and_then(|value| value.to_str().ok()),
                Some(super::EXTENSION_FRAME_CSP),
                "{content_type} must not be served without the frame CSP",
            );
        }
    }

    #[test]
    fn package_documents_load_host_gestures_before_package_scripts() {
        let response = super::file_response(
            b"<!doctype html><html><head><script src=\"app.js\"></script></head></html>".to_vec(),
            "text/html; charset=utf-8",
        );
        let html = std::str::from_utf8(response.body()).unwrap();
        assert!(html.find("@kavibay/frame.js").unwrap() < html.find("app.js").unwrap());
        assert!(super::host_served_script("ui/@kavibay/frame.js").is_some());
        assert!(super::host_served_script("ui/not@kavibay/frame.js").is_none());
    }

    /// The reset has to be in the document before the package's own CSS, or it
    /// is racing the parser — which is what made the black intermittent.
    #[test]
    fn the_canvas_reset_lands_at_the_top_of_the_head() {
        let html = b"<!doctype html><html lang=\"de\"><head><style>:root{color-scheme:dark}</style></head><body></body></html>";
        let out = String::from_utf8(super::with_frame_defaults(html.to_vec())).unwrap();

        let reset = out
            .find("color-scheme:normal")
            .expect("the reset is served");
        let package = out
            .find("color-scheme:dark}")
            .expect("the package's own CSS survives");
        assert!(
            reset < package,
            "the reset must be parsed before the package's stylesheet"
        );
        assert!(
            out.starts_with("<!doctype html>"),
            "and never ahead of the doctype"
        );
        assert!(out.contains("<head><style>:root{color-scheme:normal"));
    }

    #[test]
    fn it_finds_the_head_whatever_the_document_looks_like() {
        let cases: [(&str, &str); 3] = [
            // Attributes on the tag.
            (
                "<html><head data-x=\"1\"><title>t</title></head>",
                "<head data-x=\"1\"><style>",
            ),
            // Upper case.
            ("<HTML><HEAD></HEAD>", "<HEAD><style>"),
            // No head at all: after the html tag.
            (
                "<!doctype html><html><body>hi</body></html>",
                "<html><style>",
            ),
        ];
        for (input, expected) in cases {
            let out =
                String::from_utf8(super::with_frame_defaults(input.as_bytes().to_vec())).unwrap();
            assert!(
                out.contains(expected),
                "{input} did not place the reset: {out}"
            );
        }
    }

    /// A fragment with neither is still served, and still gets the rule.
    #[test]
    fn a_document_with_no_tags_at_all_is_not_corrupted() {
        let out = String::from_utf8(super::with_frame_defaults(b"<p>hi</p>".to_vec())).unwrap();
        assert!(out.starts_with("<style>"));
        assert!(out.ends_with("<p>hi</p>"));

        // Bytes that are not text are served untouched rather than mangled.
        let binary = vec![0xff, 0xfe, 0x00];
        assert_eq!(super::with_frame_defaults(binary.clone()), binary);
    }
    use super::super::drafts::is_valid_package_id;
    use super::super::validate::safe_join;
    use super::{parse_kavibay_ext_uri, validate_ext_id, DRAFT_HOST_PREFIX};
    use std::path::PathBuf;
    use tauri::http::Uri;

    /// The whole preview design rests on this: because a package id must start
    /// with an alphanumeric, a draft host can never name a real package. If the
    /// id rule ever loosened, previewing a draft could shadow an installed
    /// widget's UI — so the two rules are asserted together, here.
    #[test]
    fn a_draft_host_can_never_be_a_package_id() {
        assert!(!is_valid_package_id(DRAFT_HOST_PREFIX));
        for id in ["counter", "a", "water-tracker"] {
            let host = format!("{DRAFT_HOST_PREFIX}{id}");
            assert_eq!(host, format!("__draft__{id}"));
            assert!(
                !is_valid_package_id(&host),
                "{host} could collide with a real package"
            );
            // It must still survive the protocol's own id check, or the
            // preview URL would be rejected before it reaches the resolver.
            assert!(validate_ext_id(&host).is_ok());
            assert_eq!(host.strip_prefix(DRAFT_HOST_PREFIX), Some(id));
        }
    }

    /// Locks in the reasoning above, because re-adding `frame-ancestors 'self'`
    /// looks like tightening security and actually just blanks every widget.
    #[test]
    fn the_frame_csp_does_not_forbid_its_own_host() {
        let csp = super::EXTENSION_FRAME_CSP;
        assert!(
            !csp.contains("frame-ancestors"),
            "the host page is always a different origin than the package"
        );
        // The directives that do the work are still there.
        assert!(csp.contains("default-src 'none'"));
        assert!(
            csp.contains("connect-src 'none'"),
            "network stays host-mediated"
        );
        assert!(
            csp.contains("script-src 'self'"),
            "no inline or remote scripts"
        );
    }

    /// The SDK has to be reachable and unshadowable, or a package could serve
    /// its own file under the name and quietly replace the bridge.
    #[test]
    fn the_runtime_sdk_is_served_by_the_host() {
        assert!(
            super::RUNTIME_SDK.contains("kavibay.storage"),
            "the real SDK is embedded"
        );
        assert!(super::RUNTIME_SDK.len() > 2000, "not a stub");

        // A package-relative path starting with `@` never survives safe_join,
        // so no package file can occupy the reserved name.
        let root = PathBuf::from("/packages/demo");
        assert!(safe_join(&root, super::RUNTIME_SDK_PATH).is_err());

        // It still parses as a normal request, or it would never be reached.
        let target = parse("kavibay-ext://demo/@kavibay/runtime.js").unwrap();
        assert_eq!(target.relative_path, super::RUNTIME_SDK_PATH);
    }

    /// The contract guest gets the same treatment, and for the same reason: a
    /// package serving its own file under the name would replace the channel
    /// the host talks to it over.
    #[test]
    fn the_contract_guest_is_served_by_the_host() {
        assert!(
            super::CONTRACT_GUEST.contains("window.kavibayWidget"),
            "the built guest is embedded, not a stub"
        );
        assert!(
            !super::CONTRACT_GUEST.contains("\nimport ")
                && !super::CONTRACT_GUEST.contains("\nexport "),
            "a module script cannot load inside sandbox=\"allow-scripts\" — see finding 17"
        );

        let root = PathBuf::from("/packages/demo");
        assert!(safe_join(&root, super::CONTRACT_GUEST_PATH).is_err());

        assert!(super::host_served_script("@kavibay/contract.js").is_some());
        assert!(super::host_served_script("ui/@kavibay/contract.js").is_some());
    }

    /// Two runtimes, two contracts. A package asking for one must never be
    /// handed the other: the storage SDK defines `kavibay`, the contract guest
    /// defines `kavibayWidget`, and a package loading the wrong one throws on
    /// its first call.
    #[test]
    fn the_two_runtimes_do_not_answer_for_each_other() {
        let sdk = super::host_served_script("@kavibay/runtime.js").unwrap();
        let guest = super::host_served_script("@kavibay/contract.js").unwrap();
        assert!(sdk.contains("kavibay.storage"));
        assert!(!sdk.contains("window.kavibayWidget"));
        assert!(guest.contains("window.kavibayWidget"));
        assert_ne!(sdk, guest);
    }

    /// The browser resolves `src` against the document, so a package whose HTML
    /// sits in `ui/` asks for `ui/@kavibay/runtime.js`. Matching only the bare
    /// name served a 404 to every package — `kavibay` stayed undefined and each
    /// click threw into a console nobody opens.
    #[test]
    fn the_sdk_is_found_from_any_directory() {
        assert!(super::host_served_script("@kavibay/runtime.js").is_some());
        assert!(super::host_served_script("ui/@kavibay/runtime.js").is_some());
        assert!(super::host_served_script("a/b/c/@kavibay/runtime.js").is_some());

        // Whole segments only.
        assert!(super::host_served_script("ui/not@kavibay/runtime.js").is_none());
        assert!(super::host_served_script("@kavibay/runtime.js.map").is_none());
        assert!(super::host_served_script("ui/index.html").is_none());
        assert!(super::host_served_script("").is_none());
    }

    fn parse(s: &str) -> Result<super::KavibayExtTarget, String> {
        let uri: Uri = s.parse().map_err(|e| format!("uri_parse:{e}"))?;
        parse_kavibay_ext_uri(&uri)
    }

    #[test]
    fn parse_host_is_ext_id() {
        let t = parse("kavibay-ext://sample-runtime/ui/index.html").unwrap();
        assert_eq!(t.ext_id, "sample-runtime");
        assert_eq!(t.relative_path, "ui/index.html");
    }

    #[test]
    fn parse_localhost_path_form() {
        let t = parse("kavibay-ext://localhost/sample-runtime/ui/index.html").unwrap();
        assert_eq!(t.ext_id, "sample-runtime");
        assert_eq!(t.relative_path, "ui/index.html");
    }

    #[test]
    fn parse_windows_http_localhost_form() {
        let t = parse("http://kavibay-ext.localhost/sample-runtime/ui/index.html").unwrap();
        assert_eq!(t.ext_id, "sample-runtime");
        assert_eq!(t.relative_path, "ui/index.html");
    }

    /// The shape Tauri actually produces on Windows.
    ///
    /// `convertFileSrc` builds the URL with `encodeURIComponent`, so the path
    /// separators are encoded too and the whole package path arrives as one
    /// segment. The unencoded test above passed for a year while every real
    /// request 404'd — the frame just stayed blank, which is why nobody
    /// noticed until a preview was pointed at it.
    #[test]
    fn parse_windows_percent_encoded_form() {
        let t = parse("http://kavibay-ext.localhost/sample-runtime%2Fui%2Findex.html").unwrap();
        assert_eq!(t.ext_id, "sample-runtime");
        assert_eq!(t.relative_path, "ui/index.html");

        // Draft previews travel the same road.
        let draft = parse("http://kavibay-ext.localhost/__draft__demo%2Fui%2Findex.html").unwrap();
        assert_eq!(draft.ext_id, "__draft__demo");
        assert_eq!(draft.relative_path, "ui/index.html");
    }

    /// Decoding happens before validation, so encoding a separator does not
    /// hide it: an id is checked, and a traversal is still stopped by
    /// `safe_join` on the bytes that would actually reach the filesystem.
    #[test]
    fn encoding_does_not_smuggle_anything_past_the_checks() {
        // A backslash hidden in the id position is caught by the id check.
        assert!(parse("http://kavibay-ext.localhost/demo%5Cevil%2Fui.html").is_err());
        // A NUL likewise.
        assert!(parse("http://kavibay-ext.localhost/demo%00%2Fui.html").is_err());

        // A traversal decodes into the relative path, where safe_join is the
        // defence — parsing it is not the same as serving it.
        let t = parse("http://kavibay-ext.localhost/demo%2F..%2F..%2Fsecret.txt").unwrap();
        assert_eq!(t.relative_path, "../../secret.txt");
        let root = PathBuf::from("/packages/demo");
        assert!(safe_join(&root, &t.relative_path).is_err());
    }

    #[test]
    fn parse_rejects_missing_relative_path() {
        assert!(parse("kavibay-ext://sample-runtime/").is_err());
        assert!(parse("kavibay-ext://localhost/sample-runtime").is_err());
    }

    #[test]
    fn parse_rejects_bad_ext_id() {
        assert!(validate_ext_id("..").is_err());
        assert!(validate_ext_id("a/b").is_err());
        assert!(validate_ext_id("C:").is_err());
    }

    #[test]
    fn join_denies_traversal_after_parse() {
        // Host form cannot encode `..` as ext id; path traversal is denied by safe_join.
        let t = parse("kavibay-ext://sample-runtime/ui/../../evil.txt").unwrap();
        let root = PathBuf::from("/tmp/extensions/sample-runtime");
        assert!(safe_join(&root, &t.relative_path).is_err());
    }
}
