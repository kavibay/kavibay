//! Custom `kavibay-img` URI scheme: pictures a widget may show but not fetch.
//!
//! URL form (conceptual): `kavibay-img://p/<provider>/<absolute https url>`,
//! both segments percent-encoded. On Windows/Android Tauri presents requests as
//! `http://kavibay-img.localhost/p/<provider>/<url>`.
//!
//! WHY A SCHEME AND NOT A WIDER `img-src`. A package frame is served with
//! `default-src 'none'; connect-src 'none'` because the code inside it is
//! generated and unreviewed. An `<img src="https://…">` would be a GET to a
//! host of the widget's choosing, with a path of its choosing — that is a
//! working exfiltration channel, and it is the one the CSP exists to close.
//!
//! Answering a scheme instead keeps the frame with no network at all: the
//! browser hands the request to this process, which checks it against the
//! provider's compiled `image_hosts` and fetches it through the same vetted,
//! pinned, redirect-refusing path every other provider request takes. The
//! widget never learns the CDN's address and the CDN never learns the user's.
//!
//! NO CREDENTIAL IS ATTACHED HERE, EVER. `extension_provider_image` is a third
//! entry point beside the provider and capability ones for exactly that reason.

use percent_encoding::percent_decode_str;
use tauri::http::{header, Request, Response, StatusCode, Uri};
use tauri::Runtime;

use crate::extension_providers::extension_provider_image;

/// What a picture may weigh. A cover is tens of kilobytes; this is the point at
/// which "that is not a picture" is the better explanation.
const MAX_IMAGE_BYTES: usize = 8 * 1024 * 1024;

/// Parsed `kavibay-img` request target.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KavibayImgTarget {
    pub provider_id: String,
    pub url: String,
}

/// `…/p/<provider>/<url>` → the two decoded halves.
///
/// The url segment is decoded once and once only. A second pass would let
/// `%252e%252e` arrive as `..` after the check that looked at `%2e%2e`, which
/// is the shape of every path-traversal bug ever written; there is no path
/// walking here, but the same discipline is why there is not.
pub fn parse_kavibay_img_uri(uri: &Uri) -> Result<KavibayImgTarget, String> {
    let path = uri.path().trim_start_matches('/');
    let mut parts = path.splitn(3, '/');
    if parts.next() != Some("p") {
        return Err("bad_target".into());
    }
    let provider_id = parts.next().ok_or("bad_target")?;
    let url = parts.next().ok_or("bad_target")?;
    if provider_id.is_empty() || url.is_empty() {
        return Err("bad_target".into());
    }
    Ok(KavibayImgTarget {
        provider_id: percent_decode_str(provider_id)
            .decode_utf8()
            .map_err(|_| "bad_target".to_string())?
            .to_string(),
        url: percent_decode_str(url)
            .decode_utf8()
            .map_err(|_| "bad_target".to_string())?
            .to_string(),
    })
}

/// Whether a content type may be served into an `<img>`.
///
/// Without this the broker is an open proxy wearing a picture's name: anything
/// on an allowlisted host would come back verbatim, and `img-src` would be the
/// only thing left deciding what the frame does with it. SVG is refused along
/// with everything else that is not a raster image — it carries script, and it
/// would run in the frame's context rather than the CDN's.
fn servable_image_type(raw: &str) -> Option<&'static str> {
    let value = raw
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    match value.as_str() {
        "image/jpeg" => Some("image/jpeg"),
        "image/png" => Some("image/png"),
        "image/webp" => Some("image/webp"),
        "image/gif" => Some("image/gif"),
        "image/avif" => Some("image/avif"),
        _ => None,
    }
}

fn status_response(status: StatusCode) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .body(Vec::new())
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

/// Register the `kavibay-img` scheme on a Tauri builder (call before `.build`).
///
/// Asynchronous, unlike `kavibay-ext`: that one reads a file off disk, this one
/// waits on a network round trip, and doing that synchronously would block the
/// webview's request thread for every cover on the desk.
pub fn register_kavibay_img_protocol<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.register_asynchronous_uri_scheme_protocol(
        "kavibay-img",
        move |_ctx, request, responder| {
            tauri::async_runtime::spawn(async move {
                responder.respond(serve(&request).await);
            });
        },
    )
}

async fn serve(request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let Ok(target) = parse_kavibay_img_uri(request.uri()) else {
        return status_response(StatusCode::BAD_REQUEST);
    };
    // One status for every refusal. Which host was not on a list is the
    // developer's business and reaches them through the provider definition;
    // telling a refusal apart from a miss here would let a widget probe the
    // allowlist one url at a time.
    let Ok(raw) = extension_provider_image(&target.provider_id, &target.url).await else {
        return status_response(StatusCode::NOT_FOUND);
    };
    if raw.status >= 400 {
        return status_response(StatusCode::NOT_FOUND);
    }
    let Some(content_type) = raw.content_type.as_deref().and_then(servable_image_type) else {
        return status_response(StatusCode::NOT_FOUND);
    };
    if raw.body.len() > MAX_IMAGE_BYTES {
        return status_response(StatusCode::NOT_FOUND);
    }
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        // The picture is immutable at this url — a Spotify cover url changes
        // when the cover does. Without this every redraw of the desk is a fresh
        // round trip for fifty covers.
        .header(header::CACHE_CONTROL, "public, max-age=86400")
        .body(raw.body)
        .unwrap_or_else(|_| status_response(StatusCode::INTERNAL_SERVER_ERROR))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn uri(value: &str) -> Uri {
        value.parse().unwrap()
    }

    #[test]
    fn a_target_is_two_decoded_segments() {
        let target = parse_kavibay_img_uri(&uri(
            "kavibay-img://p/p/kavibay.spotify%2Fspotify/https%3A%2F%2Fi.scdn.co%2Fimage%2Fabc",
        ))
        .unwrap();
        assert_eq!(target.provider_id, "kavibay.spotify/spotify");
        assert_eq!(target.url, "https://i.scdn.co/image/abc");
    }

    #[test]
    fn a_target_without_both_halves_is_refused() {
        assert!(parse_kavibay_img_uri(&uri("kavibay-img://p/p/only-a-provider")).is_err());
        assert!(parse_kavibay_img_uri(&uri("kavibay-img://p/nope/a/b")).is_err());
    }

    #[test]
    fn only_raster_image_types_are_servable() {
        assert_eq!(servable_image_type("image/jpeg"), Some("image/jpeg"));
        assert_eq!(
            servable_image_type("image/PNG; charset=binary"),
            Some("image/png")
        );
        // Script in a picture's clothing, running in the frame's context.
        assert_eq!(servable_image_type("image/svg+xml"), None);
        assert_eq!(servable_image_type("text/html"), None);
    }
}
