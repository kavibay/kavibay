//! In-process MCP Streamable HTTP server and its managed lifecycle.
//!
//! The server is deliberately bound to IPv4 loopback. Host/origin/body and
//! concurrency checks live in this outer router, before rmcp dispatches a
//! request to any future tool implementation.

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Mutex,
};

use axum::{
    body::Body,
    extract::State,
    http::{header, Request, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    Router,
};
use rmcp::transport::streamable_http_server::{
    session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
};
use serde::Serialize;
use tauri::{AppHandle, State as TauriState};

use super::{settings, tools::McpAuthoringServer};

pub const MAX_REQUEST_BODY_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_CONCURRENT_REQUESTS: usize = 16;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum McpServerLifecycle {
    Stopped,
    Starting,
    Running,
    Stopping,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerStatus {
    pub desired_enabled: bool,
    pub state: McpServerLifecycle,
    pub url: Option<String>,
    pub last_error: Option<String>,
    /// Clients must send `Authorization: Bearer <token>`. Never the token itself.
    pub token_required: bool,
}

struct Inner {
    #[cfg(not(test))]
    app: Option<AppHandle>,
    config: settings::McpServerConfig,
    status: McpServerStatus,
    generation: u64,
    task: Option<tauri::async_runtime::JoinHandle<()>>,
}

/// One managed listener. The generation makes a late task completion harmless
/// after a stop/restart sequence has already installed a newer listener.
#[derive(Clone)]
pub struct McpServerState {
    inner: Arc<Mutex<Inner>>,
}

impl McpServerState {
    #[cfg(test)]
    pub fn new(config: settings::McpServerConfig) -> Self {
        let desired_enabled = config.enabled;
        Self {
            inner: Arc::new(Mutex::new(Inner {
                #[cfg(not(test))]
                app: None,
                config,
                status: McpServerStatus {
                    desired_enabled,
                    state: McpServerLifecycle::Stopped,
                    url: None,
                    last_error: None,
                    token_required: config.token_sha256.is_some(),
                },
                generation: 0,
                task: None,
            })),
        }
    }

    #[cfg(not(test))]
    pub fn new_with_app(app: AppHandle, config: settings::McpServerConfig) -> Self {
        let desired_enabled = config.enabled;
        Self {
            inner: Arc::new(Mutex::new(Inner {
                app: Some(app),
                config,
                status: McpServerStatus {
                    desired_enabled,
                    state: McpServerLifecycle::Stopped,
                    url: None,
                    last_error: None,
                    token_required: config.token_sha256.is_some(),
                },
                generation: 0,
                task: None,
            })),
        }
    }

    pub fn config(&self) -> settings::McpServerConfig {
        self.inner
            .lock()
            .map(|inner| inner.config)
            .unwrap_or_else(|_| settings::McpServerConfig::disabled())
    }

    pub fn status(&self) -> McpServerStatus {
        self.inner
            .lock()
            .map(|inner| inner.status.clone())
            .unwrap_or_else(|_| McpServerStatus {
                desired_enabled: false,
                state: McpServerLifecycle::Error,
                url: None,
                last_error: Some("state_poisoned".into()),
                token_required: false,
            })
    }

    pub fn update_config(&self, config: settings::McpServerConfig) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.config = config;
            inner.status.desired_enabled = config.enabled;
            inner.status.token_required = config.token_sha256.is_some();
        }
    }

    pub async fn start(&self) -> McpServerStatus {
        let config = self.config();
        if !config.enabled {
            return self.status();
        }
        self.start_at(SocketAddr::new(
            IpAddr::V4(Ipv4Addr::LOCALHOST),
            config.port,
        ))
        .await
    }

    async fn start_at(&self, address: SocketAddr) -> McpServerStatus {
        #[cfg(not(test))]
        let (generation, app, token_sha256) = {
            let Ok(mut inner) = self.inner.lock() else {
                return self.status();
            };
            if matches!(
                inner.status.state,
                McpServerLifecycle::Running
                    | McpServerLifecycle::Starting
                    | McpServerLifecycle::Stopping
            ) {
                return inner.status.clone();
            }
            inner.generation = inner.generation.wrapping_add(1);
            inner.status.state = McpServerLifecycle::Starting;
            inner.status.url = None;
            inner.status.last_error = None;
            (
                inner.generation,
                inner.app.clone(),
                inner.config.token_sha256,
            )
        };
        #[cfg(test)]
        let (generation, token_sha256) = {
            let Ok(mut inner) = self.inner.lock() else {
                return self.status();
            };
            if matches!(
                inner.status.state,
                McpServerLifecycle::Running
                    | McpServerLifecycle::Starting
                    | McpServerLifecycle::Stopping
            ) {
                return inner.status.clone();
            }
            inner.generation = inner.generation.wrapping_add(1);
            inner.status.state = McpServerLifecycle::Starting;
            inner.status.url = None;
            inner.status.last_error = None;
            (inner.generation, inner.config.token_sha256)
        };

        let listener = match tokio::net::TcpListener::bind(address).await {
            Ok(listener) => listener,
            Err(error) => {
                if let Ok(mut inner) = self.inner.lock() {
                    if inner.generation == generation {
                        inner.status.state = McpServerLifecycle::Error;
                        inner.status.last_error = Some(format!("bind:{error}"));
                        inner.status.url = None;
                    }
                }
                return self.status();
            }
        };

        let actual = match listener.local_addr() {
            Ok(actual) => actual,
            Err(error) => {
                if let Ok(mut inner) = self.inner.lock() {
                    if inner.generation == generation {
                        inner.status.state = McpServerLifecycle::Error;
                        inner.status.last_error = Some(format!("local_addr:{error}"));
                    }
                }
                return self.status();
            }
        };
        let expected_host = format!("127.0.0.1:{}", actual.port());
        let url = format!("http://{expected_host}/mcp");
        #[cfg(not(test))]
        let router = build_router(expected_host, MAX_REQUEST_BODY_BYTES, token_sha256, app);
        #[cfg(test)]
        let router = build_router(expected_host, MAX_REQUEST_BODY_BYTES, token_sha256);
        let state = self.clone();
        let task = tauri::async_runtime::spawn(async move {
            let result = axum::serve(listener, router).await;
            state.task_finished(generation, result.err().map(|error| error.to_string()));
        });

        let Ok(mut inner) = self.inner.lock() else {
            task.abort();
            return self.status();
        };
        if inner.generation != generation {
            task.abort();
            return inner.status.clone();
        }
        inner.task = Some(task);
        inner.status.state = McpServerLifecycle::Running;
        inner.status.url = Some(url);
        inner.status.last_error = None;
        inner.status.clone()
    }

    pub async fn stop(&self) -> McpServerStatus {
        let task = {
            let Ok(mut inner) = self.inner.lock() else {
                return self.status();
            };
            if inner.status.state == McpServerLifecycle::Stopped && inner.task.is_none() {
                return inner.status.clone();
            }
            inner.generation = inner.generation.wrapping_add(1);
            inner.status.state = McpServerLifecycle::Stopping;
            inner.status.url = None;
            inner.task.take()
        };

        if let Some(task) = task {
            task.abort();
            let _ = task.await;
        }

        if let Ok(mut inner) = self.inner.lock() {
            inner.status.state = McpServerLifecycle::Stopped;
            inner.status.url = None;
            inner.status.last_error = None;
        }
        self.status()
    }

    pub async fn restart(&self) -> McpServerStatus {
        let _ = self.stop().await;
        self.start().await
    }

    /// RunEvent::Exit is synchronous. Request task cancellation here; the
    /// runtime drops the listener as the process exits without blocking the
    /// Tauri shutdown callback on an async await.
    pub fn shutdown_for_exit(&self) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.generation = inner.generation.wrapping_add(1);
            if let Some(task) = inner.task.take() {
                task.abort();
            }
            inner.status.state = McpServerLifecycle::Stopped;
            inner.status.url = None;
            inner.status.last_error = None;
        }
    }

    fn task_finished(&self, generation: u64, error: Option<String>) {
        if let Ok(mut inner) = self.inner.lock() {
            if inner.generation != generation {
                return;
            }
            inner.task = None;
            inner.status.state = McpServerLifecycle::Error;
            inner.status.url = None;
            inner.status.last_error =
                Some(error.unwrap_or_else(|| "server_stopped_unexpectedly".to_string()));
        }
    }

    #[cfg(test)]
    fn generation(&self) -> u64 {
        self.inner.lock().unwrap().generation
    }

    #[cfg(test)]
    async fn start_ephemeral(&self) -> McpServerStatus {
        self.start_at(SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0))
            .await
    }
}

#[derive(Clone)]
struct GuardState {
    expected_host: String,
    in_flight: Arc<AtomicUsize>,
    max_concurrent: usize,
    max_body_bytes: usize,
    /// Digest of the bearer token every request must carry, when one is set.
    token_sha256: Option<[u8; 32]>,
}

struct InFlightGuard(Arc<AtomicUsize>);

impl Drop for InFlightGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

async fn guard_request(
    State(guards): State<GuardState>,
    request: Request<Body>,
    next: Next,
) -> Response {
    let host_ok = request
        .headers()
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|host| host == guards.expected_host);
    if !host_ok {
        return (StatusCode::BAD_REQUEST, "invalid_host").into_response();
    }
    if request.headers().contains_key(header::ORIGIN) {
        return (StatusCode::FORBIDDEN, "origin_not_allowed").into_response();
    }
    // After host and origin, so a browser page never learns whether a token is
    // set; before anything reaches rmcp, so no tool runs unauthenticated.
    if let Some(expected) = guards.token_sha256.as_ref() {
        let presented = request
            .headers()
            .get(header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.strip_prefix("Bearer "));
        if !presented.is_some_and(|token| settings::token_matches(token, expected)) {
            return (
                StatusCode::UNAUTHORIZED,
                [(header::WWW_AUTHENTICATE, "Bearer")],
                "invalid_token",
            )
                .into_response();
        }
    }
    if let Some(length) = request.headers().get(header::CONTENT_LENGTH) {
        let Ok(length) = length
            .to_str()
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .ok_or(())
        else {
            return (StatusCode::BAD_REQUEST, "invalid_content_length").into_response();
        };
        if length > guards.max_body_bytes as u64 {
            return (StatusCode::PAYLOAD_TOO_LARGE, "request_too_large").into_response();
        }
    }

    let previous = guards.in_flight.fetch_add(1, Ordering::AcqRel);
    if previous >= guards.max_concurrent {
        guards.in_flight.fetch_sub(1, Ordering::AcqRel);
        return (StatusCode::TOO_MANY_REQUESTS, "too_many_requests").into_response();
    }
    let _permit = InFlightGuard(guards.in_flight);
    next.run(request).await
}

#[cfg(not(test))]
fn build_router(
    expected_host: String,
    max_body_bytes: usize,
    token_sha256: Option<[u8; 32]>,
    app: Option<AppHandle>,
) -> Router {
    let config = StreamableHttpServerConfig::default()
        .with_allowed_hosts([expected_host.clone()])
        .with_json_response(true)
        .with_max_request_body_bytes(max_body_bytes);
    let service = StreamableHttpService::new(
        move || Ok(McpAuthoringServer::new_optional(app.clone())),
        Arc::new(LocalSessionManager::default()),
        config,
    );
    let guards = GuardState {
        expected_host,
        in_flight: Arc::new(AtomicUsize::new(0)),
        max_concurrent: MAX_CONCURRENT_REQUESTS,
        max_body_bytes,
        token_sha256,
    };
    Router::new()
        .route_service("/mcp", service)
        .layer(middleware::from_fn_with_state(guards, guard_request))
}

#[cfg(test)]
fn build_router(
    expected_host: String,
    max_body_bytes: usize,
    token_sha256: Option<[u8; 32]>,
) -> Router {
    let config = StreamableHttpServerConfig::default()
        .with_allowed_hosts([expected_host.clone()])
        .with_json_response(true)
        .with_max_request_body_bytes(max_body_bytes);
    let service = StreamableHttpService::new(
        || Ok(McpAuthoringServer::placeholder()),
        Arc::new(LocalSessionManager::default()),
        config,
    );
    let guards = GuardState {
        expected_host,
        in_flight: Arc::new(AtomicUsize::new(0)),
        max_concurrent: MAX_CONCURRENT_REQUESTS,
        max_body_bytes,
        token_sha256,
    };
    Router::new()
        .route_service("/mcp", service)
        .layer(middleware::from_fn_with_state(guards, guard_request))
}

#[tauri::command]
pub fn mcp_server_status(state: TauriState<'_, McpServerState>) -> McpServerStatus {
    state.status()
}

#[tauri::command]
pub async fn mcp_server_set_enabled(
    app: AppHandle,
    state: TauriState<'_, McpServerState>,
    enabled: bool,
) -> Result<McpServerStatus, String> {
    let mut config = state.config();
    config.enabled = enabled;
    settings::save(&app, &config)?;
    state.update_config(config);
    if enabled {
        Ok(state.start().await)
    } else {
        Ok(state.stop().await)
    }
}

#[tauri::command]
pub async fn mcp_server_set_port(
    app: AppHandle,
    state: TauriState<'_, McpServerState>,
    port: u16,
) -> Result<McpServerStatus, String> {
    settings::validate_port(port)?;
    let mut config = state.config();
    if config.port == port {
        return Ok(state.status());
    }
    config.port = port;
    settings::save(&app, &config)?;
    let enabled = config.enabled;
    state.update_config(config);
    if enabled {
        Ok(state.restart().await)
    } else {
        Ok(state.status())
    }
}

/// Result of turning the token on, off or over.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpTokenChange {
    pub status: McpServerStatus,
    /// The new token, present only in the response that created it. It is not
    /// stored anywhere and cannot be asked for again.
    pub token: Option<String>,
}

/// Require a bearer token (a fresh one on every call) or stop requiring one.
///
/// The running listener is restarted so the change applies to the next
/// request, not the next launch. Clients configured with an old token are
/// refused from then on — which is the point of generating a new one.
#[tauri::command]
pub async fn mcp_server_set_token(
    app: AppHandle,
    state: TauriState<'_, McpServerState>,
    required: bool,
) -> Result<McpTokenChange, String> {
    let mut config = state.config();
    let token = if required {
        let (token, digest) = settings::generate_token();
        config.token_sha256 = Some(digest);
        Some(token)
    } else {
        config.token_sha256 = None;
        None
    };
    settings::save(&app, &config)?;
    let enabled = config.enabled;
    state.update_config(config);
    let status = if enabled {
        state.restart().await
    } else {
        state.status()
    };
    Ok(McpTokenChange { status, token })
}

#[tauri::command]
pub async fn mcp_server_retry(
    state: TauriState<'_, McpServerState>,
) -> Result<McpServerStatus, String> {
    if !state.config().enabled {
        return Ok(state.status());
    }
    Ok(state.start().await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    fn test_state() -> McpServerState {
        McpServerState::new(settings::McpServerConfig {
            enabled: true,
            port: 43_127,
            token_sha256: None,
        })
    }

    fn runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
    }

    async fn request(addr: SocketAddr, host: &str, origin: Option<&str>, body: &str) -> String {
        let mut stream = tokio::net::TcpStream::connect(addr).await.unwrap();
        let origin = origin
            .map(|value| format!("Origin: {value}\r\n"))
            .unwrap_or_default();
        let request = format!(
            "POST /mcp HTTP/1.1\r\nHost: {host}\r\nAccept: application/json, text/event-stream\r\nContent-Type: application/json\r\n{origin}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        stream.write_all(request.as_bytes()).await.unwrap();
        let mut bytes = Vec::new();
        stream.read_to_end(&mut bytes).await.unwrap();
        String::from_utf8_lossy(&bytes).into_owned()
    }

    #[test]
    fn start_stop_start_is_idempotent_and_generation_safe() {
        runtime().block_on(async {
            let state = test_state();
            let first = state.start_ephemeral().await;
            assert_eq!(first.state, McpServerLifecycle::Running);
            let same = state.start_ephemeral().await;
            assert_eq!(same.url, first.url);
            let old_generation = state.generation();
            let stopped = state.stop().await;
            assert_eq!(stopped.state, McpServerLifecycle::Stopped);
            let second = state.start_ephemeral().await;
            assert_eq!(second.state, McpServerLifecycle::Running);
            state.task_finished(old_generation, Some("stale".into()));
            assert_eq!(state.status().state, McpServerLifecycle::Running);
            state.stop().await;
        });
    }

    #[test]
    fn occupied_port_is_reported_without_crashing() {
        runtime().block_on(async {
            let occupied = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
            let port = occupied.local_addr().unwrap().port();
            let state = McpServerState::new(settings::McpServerConfig {
                enabled: true,
                port,
                token_sha256: None,
            });
            let status = state.start().await;
            assert_eq!(status.state, McpServerLifecycle::Error);
            assert!(status.last_error.unwrap().starts_with("bind:"));
            drop(occupied);
        });
    }

    #[test]
    fn listener_is_loopback_reachable_and_rejects_host_origin_and_large_body() {
        runtime().block_on(async {
            let state = test_state();
            let status = state.start_ephemeral().await;
            let url = status.url.clone().unwrap();
            let addr: SocketAddr = url
                .trim_start_matches("http://")
                .trim_end_matches("/mcp")
                .parse()
                .unwrap();
            assert_eq!(addr.ip(), IpAddr::V4(Ipv4Addr::LOCALHOST));
            let valid_host = format!("127.0.0.1:{}", addr.port());
            let body = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"m2-test","version":"0.1"}}}"#;
            let valid = request(addr, &valid_host, None, body).await;
            assert!(valid.starts_with("HTTP/1.1 200"), "{valid}");
            let bad_host = request(addr, "evil.test", None, body).await;
            assert!(bad_host.starts_with("HTTP/1.1 400"), "{bad_host}");
            let origin = request(addr, &valid_host, Some("https://evil.test"), body).await;
            assert!(origin.starts_with("HTTP/1.1 403"), "{origin}");
            let oversized_header = format!(
                "POST /mcp HTTP/1.1\r\nHost: {valid_host}\r\nAccept: application/json, text/event-stream\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                MAX_REQUEST_BODY_BYTES + 1
            );
            let mut stream = tokio::net::TcpStream::connect(addr).await.unwrap();
            stream.write_all(oversized_header.as_bytes()).await.unwrap();
            let mut bytes = Vec::new();
            stream.read_to_end(&mut bytes).await.unwrap();
            let oversized = String::from_utf8_lossy(&bytes);
            assert!(oversized.starts_with("HTTP/1.1 413"), "{oversized}");
            state.stop().await;
        });
    }

    #[test]
    fn a_set_token_is_required_and_only_the_right_one_passes() {
        runtime().block_on(async {
            let (token, digest) = settings::generate_token();
            let state = McpServerState::new(settings::McpServerConfig {
                enabled: true,
                port: 43_127,
                token_sha256: Some(digest),
            });
            assert!(state.status().token_required);
            let status = state.start_ephemeral().await;
            let addr: SocketAddr = status
                .url
                .unwrap()
                .trim_start_matches("http://")
                .trim_end_matches("/mcp")
                .parse()
                .unwrap();
            let host = format!("127.0.0.1:{}", addr.port());
            let body = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"token-test","version":"0.1"}}}"#;
            let send = |authorization: Option<String>| {
                let host = host.clone();
                async move {
                    let mut stream = tokio::net::TcpStream::connect(addr).await.unwrap();
                    let authorization = authorization
                        .map(|value| format!("Authorization: {value}\r\n"))
                        .unwrap_or_default();
                    let request = format!(
                        "POST /mcp HTTP/1.1\r\nHost: {host}\r\nAccept: application/json, text/event-stream\r\nContent-Type: application/json\r\n{authorization}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    stream.write_all(request.as_bytes()).await.unwrap();
                    let mut bytes = Vec::new();
                    stream.read_to_end(&mut bytes).await.unwrap();
                    String::from_utf8_lossy(&bytes).into_owned()
                }
            };

            let missing = send(None).await;
            assert!(missing.starts_with("HTTP/1.1 401"), "{missing}");
            assert!(missing.to_ascii_lowercase().contains("www-authenticate: bearer"), "{missing}");
            let wrong = send(Some("Bearer kvb_wrong".into())).await;
            assert!(wrong.starts_with("HTTP/1.1 401"), "{wrong}");
            let not_bearer = send(Some(format!("Basic {token}"))).await;
            assert!(not_bearer.starts_with("HTTP/1.1 401"), "{not_bearer}");
            let right = send(Some(format!("Bearer {token}"))).await;
            assert!(right.starts_with("HTTP/1.1 200"), "{right}");
            state.stop().await;
        });
    }

    #[test]
    fn shutdown_releases_the_port() {
        runtime().block_on(async {
            let state = test_state();
            let status = state.start_ephemeral().await;
            let url = status.url.unwrap();
            let addr: SocketAddr = url
                .trim_start_matches("http://")
                .trim_end_matches("/mcp")
                .parse()
                .unwrap();
            state.stop().await;
            let rebound = std::net::TcpListener::bind(addr).unwrap();
            drop(rebound);
        });
    }
}
