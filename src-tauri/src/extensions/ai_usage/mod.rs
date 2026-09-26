//! AI Usage widget backend: Codex and Claude Code rate-limit snapshots.

use std::{
    env, fs,
    io::{self, Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    time::{Duration, UNIX_EPOCH},
};

use chrono::{DateTime, Utc};
use reqwest::redirect::Policy;
use serde::Serialize;
use serde_json::{Map, Value};

use super::ExtensionRust;

/// The uniform entry point for the AI Usage extension.
pub const EXTENSION: ExtensionRust = ExtensionRust {
    folder: "ai-usage",
    capabilities: &[],
};

const CODEX_TAIL_BYTES: u64 = 512 * 1024;
const CLAUDE_CACHE_FILE: &str = "kavibay-usage.json";
#[cfg(windows)]
const CLAUDE_SCRIPT_FILE: &str = "kavibay-usage-statusline.ps1";
#[cfg(unix)]
const CLAUDE_SCRIPT_FILE: &str = "kavibay-usage-statusline.sh";
/// The whole `statusLine` object the Unix wrapper replaced, kept so it can be
/// restored and so enabling again regenerates the same wrapper.
#[cfg(unix)]
const CLAUDE_ORIGINAL_STATUS_LINE_FILE: &str = "kavibay-statusline-original.json";
const CLAUDE_CREDENTIALS_FILE: &str = ".credentials.json";
const CLAUDE_OAUTH_CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const CLAUDE_OAUTH_TOKEN_URL: &str = "https://platform.claude.com/v1/oauth/token";
// Claude Code's own plan-usage source. Tokens stay in the Rust backend and
// refreshed credentials are written only back to Claude's own credentials file.
const CLAUDE_USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_TOKEN_REFRESH_SKEW_MS: i64 = 60_000;
const CLAUDE_DEFAULT_SCOPES: &[&str] = &[
    "user:profile",
    "user:inference",
    "user:sessions:claude_code",
    "user:mcp_servers",
    "user:file_upload",
];

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    id: String,
    label: String,
    used_percent: f64,
    resets_at: Option<i64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSource {
    status: &'static str,
    plan: Option<String>,
    windows: Vec<UsageWindow>,
    updated_at: Option<i64>,
    detail: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct AiUsageSnapshot {
    codex: UsageSource,
    claude: UsageSource,
}

impl UsageSource {
    fn state(status: &'static str, detail: impl Into<String>) -> Self {
        Self {
            status,
            plan: None,
            windows: Vec::new(),
            updated_at: None,
            detail: Some(detail.into()),
        }
    }

    fn available(plan: Option<String>, windows: Vec<UsageWindow>, updated_at: Option<i64>) -> Self {
        Self {
            status: "available",
            plan,
            windows,
            updated_at,
            detail: None,
        }
    }
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
}

fn codex_dir() -> Option<PathBuf> {
    env::var_os("CODEX_HOME")
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .or_else(|| home_dir().map(|home| home.join(".codex")))
}

fn claude_dir() -> Option<PathBuf> {
    env::var_os("CLAUDE_CONFIG_DIR")
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .or_else(|| home_dir().map(|home| home.join(".claude")))
}

fn epoch(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_u64().and_then(|value| i64::try_from(value).ok()))
        .or_else(|| value.as_f64().map(|value| value as i64))
        .or_else(|| value.as_str()?.parse::<i64>().ok())
        .or_else(|| {
            DateTime::parse_from_rfc3339(value.as_str()?)
                .ok()
                .map(|value| value.timestamp())
        })
}

fn epoch_seconds_from_millis(value: &Value) -> Option<i64> {
    let value = epoch(value)?;
    Some(if value > 10_000_000_000 {
        value / 1_000
    } else {
        value
    })
}

fn timestamp_millis(value: &Value) -> Option<i64> {
    let value = epoch(value)?;
    Some(if value < 10_000_000_000 {
        value.saturating_mul(1_000)
    } else {
        value
    })
}

fn duration_millis(value: &Value) -> Option<i64> {
    let seconds = epoch(value)?;
    (seconds > 0).then(|| seconds.saturating_mul(1_000))
}

fn percentage(value: &Value) -> Option<f64> {
    value.as_f64().map(|value| value.clamp(0.0, 100.0))
}

fn window_label(minutes: Option<u64>, fallback: &str) -> String {
    match minutes {
        Some(300) => "5 hours".to_string(),
        Some(10_080) => "7 days".to_string(),
        Some(value) if value % 1_440 == 0 => format!("{} days", value / 1_440),
        Some(value) if value % 60 == 0 => format!("{} hours", value / 60),
        Some(value) => format!("{value} minutes"),
        None => fallback.to_string(),
    }
}

fn codex_window(rate_limits: &Value, id: &str) -> Option<UsageWindow> {
    let value = rate_limits.get(id)?;
    let used_percent = percentage(value.get("used_percent")?)?;
    let minutes = value.get("window_minutes").and_then(Value::as_u64);
    Some(UsageWindow {
        id: id.to_string(),
        label: window_label(minutes, id),
        used_percent,
        resets_at: value.get("resets_at").and_then(epoch_seconds_from_millis),
    })
}

fn parse_codex_line(line: &str) -> Option<UsageSource> {
    let value: Value = serde_json::from_str(line).ok()?;
    let payload = value.get("payload")?;
    let rate_limits = payload.get("rate_limits")?;
    let windows = ["primary", "secondary"]
        .into_iter()
        .filter_map(|id| codex_window(rate_limits, id))
        .collect::<Vec<_>>();
    if windows.is_empty() {
        return None;
    }

    Some(UsageSource::available(
        rate_limits
            .get("plan_type")
            .and_then(Value::as_str)
            .map(str::to_string),
        windows,
        value.get("timestamp").and_then(epoch),
    ))
}

fn collect_jsonl_files(dir: &Path, files: &mut Vec<(u64, PathBuf)>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            collect_jsonl_files(&entry.path(), files);
        } else if file_type.is_file()
            && entry.path().extension().and_then(|value| value.to_str()) == Some("jsonl")
        {
            let modified = entry
                .metadata()
                .and_then(|metadata| metadata.modified())
                .ok()
                .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
                .map(|value| value.as_secs())
                .unwrap_or_default();
            files.push((modified, entry.path()));
        }
    }
}

fn read_tail(path: &Path) -> Option<String> {
    let mut file = fs::File::open(path).ok()?;
    let length = file.metadata().ok()?.len();
    file.seek(SeekFrom::Start(length.saturating_sub(CODEX_TAIL_BYTES)))
        .ok()?;
    let mut content = Vec::new();
    file.read_to_end(&mut content).ok()?;
    Some(String::from_utf8_lossy(&content).into_owned())
}

fn codex_snapshot() -> UsageSource {
    let Some(root) = codex_dir() else {
        return UsageSource::state("notFound", "Could not locate the Codex data directory.");
    };

    let mut files = Vec::new();
    collect_jsonl_files(&root.join("sessions"), &mut files);
    collect_jsonl_files(&root.join("archived_sessions"), &mut files);
    files.sort_unstable_by_key(|entry| std::cmp::Reverse(entry.0));

    for (_, path) in files.into_iter().take(24) {
        let Some(content) = read_tail(&path) else {
            continue;
        };
        if let Some(source) = content.lines().rev().find_map(parse_codex_line) {
            return source;
        }
    }

    UsageSource::state(
        "notFound",
        "No Codex rate-limit event found. Start or resume a Codex session first.",
    )
}

fn claude_window(rate_limits: &Value, id: &str, label: &str) -> Option<UsageWindow> {
    let value = rate_limits.get(id)?;
    Some(UsageWindow {
        id: id.to_string(),
        label: label.to_string(),
        used_percent: percentage(value.get("used_percentage")?)?,
        resets_at: value.get("resets_at").and_then(epoch_seconds_from_millis),
    })
}

fn claude_usage_window(rate_limits: &Value, id: &str, label: &str) -> Option<UsageWindow> {
    let value = rate_limits.get(id)?;
    Some(UsageWindow {
        id: id.to_string(),
        label: label.to_string(),
        used_percent: percentage(value.get("utilization")?)?,
        resets_at: value.get("resets_at").and_then(epoch_seconds_from_millis),
    })
}

fn parse_claude_usage(content: &str) -> Option<UsageSource> {
    let value: Value = serde_json::from_str(content.trim_start_matches('\u{feff}')).ok()?;
    let windows = [
        claude_usage_window(&value, "five_hour", "5 hours"),
        claude_usage_window(&value, "seven_day", "7 days"),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>();
    if windows.is_empty() {
        return None;
    }
    Some(UsageSource::available(
        None,
        windows,
        Some(Utc::now().timestamp()),
    ))
}

fn claude_cached_usage_window(utilization: &Value, id: &str, label: &str) -> Option<UsageWindow> {
    let value = utilization.get(id)?;
    Some(UsageWindow {
        id: id.to_string(),
        label: label.to_string(),
        used_percent: percentage(value.get("utilization")?)?,
        resets_at: value.get("resets_at").and_then(epoch_seconds_from_millis),
    })
}

fn parse_claude_usage_state(content: &str) -> Option<UsageSource> {
    let value: Value = serde_json::from_str(content.trim_start_matches('\u{feff}')).ok()?;
    let cached = value.get("cachedUsageUtilization")?;
    let utilization = cached.get("utilization")?;
    let windows = [
        claude_cached_usage_window(utilization, "five_hour", "5 hours"),
        claude_cached_usage_window(utilization, "seven_day", "7 days"),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>();
    if windows.is_empty() {
        return None;
    }
    Some(UsageSource::available(
        None,
        windows,
        cached
            .get("fetchedAtMs")
            .and_then(epoch_seconds_from_millis),
    ))
}

struct ClaudeCredentials {
    path: PathBuf,
    document: Value,
    access_token: String,
    refresh_token: Option<String>,
    expires_at: Option<i64>,
    scopes: Vec<String>,
}

fn parse_claude_credentials(path: PathBuf, content: &str) -> Option<ClaudeCredentials> {
    let document: Value = serde_json::from_str(content.trim_start_matches('\u{feff}')).ok()?;
    let oauth = document.get("claudeAiOauth")?.as_object()?;
    let access_token = oauth.get("accessToken")?.as_str()?.to_string();
    if access_token.is_empty() {
        return None;
    }
    let refresh_token = oauth
        .get("refreshToken")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let scopes = oauth
        .get("scopes")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .filter(|values| !values.is_empty())
        .unwrap_or_else(|| {
            CLAUDE_DEFAULT_SCOPES
                .iter()
                .map(|value| (*value).to_string())
                .collect()
        });
    let expires_at = oauth.get("expiresAt").and_then(timestamp_millis);
    Some(ClaudeCredentials {
        path,
        document,
        access_token,
        refresh_token,
        expires_at,
        scopes,
    })
}

fn claude_credentials() -> Option<ClaudeCredentials> {
    let path = claude_dir()?.join(CLAUDE_CREDENTIALS_FILE);
    let content = fs::read_to_string(&path).ok()?;
    parse_claude_credentials(path, &content)
}

fn claude_oauth_client_id() -> String {
    env::var("CLAUDE_CODE_OAUTH_CLIENT_ID")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| CLAUDE_OAUTH_CLIENT_ID.to_string())
}

fn claude_token_needs_refresh(expires_at: Option<i64>) -> bool {
    expires_at.is_some_and(|expires_at| {
        expires_at <= Utc::now().timestamp_millis() + CLAUDE_TOKEN_REFRESH_SKEW_MS
    })
}

struct RefreshedClaudeToken {
    access_token: String,
    refresh_token: Option<String>,
    expires_at: i64,
    refresh_token_expires_at: Option<i64>,
}

fn parse_refreshed_claude_token(
    value: &Value,
    previous_refresh_token: &str,
    now_millis: i64,
) -> Option<RefreshedClaudeToken> {
    let access_token = value.get("access_token")?.as_str()?.to_string();
    if access_token.is_empty() {
        return None;
    }
    let expires_in = duration_millis(value.get("expires_in")?)?;
    let refresh_token = value
        .get("refresh_token")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| Some(previous_refresh_token.to_string()));
    let refresh_token_expires_at = value
        .get("refresh_token_expires_in")
        .and_then(duration_millis)
        .map(|duration| now_millis.saturating_add(duration));
    Some(RefreshedClaudeToken {
        access_token,
        refresh_token,
        expires_at: now_millis.saturating_add(expires_in),
        refresh_token_expires_at,
    })
}

fn update_claude_credentials_document(
    document: &mut Value,
    refreshed: &RefreshedClaudeToken,
) -> bool {
    let Some(oauth) = document
        .get_mut("claudeAiOauth")
        .and_then(Value::as_object_mut)
    else {
        return false;
    };
    oauth.insert(
        "accessToken".to_string(),
        Value::String(refreshed.access_token.clone()),
    );
    oauth.insert("expiresAt".to_string(), Value::from(refreshed.expires_at));
    if let Some(refresh_token) = &refreshed.refresh_token {
        oauth.insert(
            "refreshToken".to_string(),
            Value::String(refresh_token.clone()),
        );
    }
    if let Some(expires_at) = refreshed.refresh_token_expires_at {
        oauth.insert("refreshTokenExpiresAt".to_string(), Value::from(expires_at));
    }
    true
}

fn persist_claude_credentials(credentials: &ClaudeCredentials, refreshed: &RefreshedClaudeToken) {
    let mut document = credentials.document.clone();
    if !update_claude_credentials_document(&mut document, refreshed) {
        return;
    }
    let Ok(mut content) = serde_json::to_string_pretty(&document) else {
        return;
    };
    content.push('\n');
    // Claude owns this file. Preserve its schema and write only after a
    // successful refresh, without ever returning the refreshed secret.
    let _ = fs::write(&credentials.path, content);
}

async fn refresh_claude_access_token(
    client: &reqwest::Client,
    credentials: &ClaudeCredentials,
) -> Option<String> {
    let refresh_token = credentials.refresh_token.as_deref()?;
    let body = serde_json::json!({
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": claude_oauth_client_id(),
        "scope": credentials.scopes.join(" "),
    });
    let response = client
        .post(CLAUDE_OAUTH_TOKEN_URL)
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let value: Value = response.json().await.ok()?;
    let refreshed =
        parse_refreshed_claude_token(&value, refresh_token, Utc::now().timestamp_millis())?;
    persist_claude_credentials(credentials, &refreshed);
    Some(refreshed.access_token)
}

async fn request_claude_usage(
    client: &reqwest::Client,
    access_token: &str,
) -> Option<reqwest::Response> {
    client
        .get(CLAUDE_USAGE_URL)
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .header("anthropic-beta", "oauth-2025-04-20")
        .header("User-Agent", "kavibay-ai-usage")
        .bearer_auth(access_token)
        .send()
        .await
        .ok()
}

async fn fetch_claude_usage() -> Option<UsageSource> {
    let credentials = claude_credentials()?;
    let client = reqwest::Client::builder()
        .redirect(Policy::none())
        .timeout(Duration::from_secs(10))
        .build()
        .ok()?;
    let mut access_token = credentials.access_token.clone();
    let mut refreshed = false;
    if claude_token_needs_refresh(credentials.expires_at) {
        if let Some(token) = refresh_claude_access_token(&client, &credentials).await {
            access_token = token;
            refreshed = true;
        }
    }
    let mut response = request_claude_usage(&client, &access_token).await?;
    if response.status().as_u16() == 401 && !refreshed {
        access_token = refresh_claude_access_token(&client, &credentials).await?;
        response = request_claude_usage(&client, &access_token).await?;
    }
    if !response.status().is_success() {
        return None;
    }
    parse_claude_usage(&response.text().await.ok()?)
}

fn parse_claude_cache(content: &str) -> Option<UsageSource> {
    let content = content.trim_start_matches('\u{feff}');
    let value: Value = serde_json::from_str(content).ok()?;
    let rate_limits = value.get("rate_limits")?;
    let windows = [
        claude_window(rate_limits, "five_hour", "5 hours"),
        claude_window(rate_limits, "seven_day", "7 days"),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>();
    if windows.is_empty() {
        return None;
    }
    Some(UsageSource::available(
        None,
        windows,
        value.get("captured_at").and_then(epoch),
    ))
}

fn claude_script_path(config_dir: &Path) -> Result<String, String> {
    config_dir
        .join(CLAUDE_SCRIPT_FILE)
        .to_str()
        .map(str::to_string)
        .ok_or_else(|| "Claude config path is not valid Unicode".to_string())
}

#[cfg(windows)]
fn claude_command(config_dir: &Path) -> Result<String, String> {
    let path = claude_script_path(config_dir)?;
    if path.contains('"') {
        return Err("Claude config path contains an unsupported quote".to_string());
    }
    // Claude routes Windows status-line commands through Git Bash when it is
    // installed; backslashes are escape characters there. Forward slashes are
    // accepted by both Git Bash and PowerShell.
    let path = path.replace('\\', "/");
    Ok(format!(
        "powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"{path}\""
    ))
}

#[cfg(windows)]
fn legacy_claude_command(config_dir: &Path) -> Result<String, String> {
    let path = claude_script_path(config_dir)?;
    if path.contains('"') {
        return Err("Claude config path contains an unsupported quote".to_string());
    }
    Ok(format!(
        "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"{path}\""
    ))
}

#[cfg(unix)]
fn claude_command(config_dir: &Path) -> Result<String, String> {
    let path = claude_script_path(config_dir)?;
    if path.contains('\'') {
        return Err("Claude config path contains an unsupported quote".to_string());
    }
    Ok(format!("sh '{path}'"))
}

fn read_claude_settings(config_dir: &Path) -> Result<Value, String> {
    let path = config_dir.join("settings.json");
    if !path.exists() {
        return Ok(Value::Object(Map::new()));
    }
    let content = fs::read_to_string(&path)
        .map_err(|error| format!("Could not read Claude settings: {error}"))?;
    let value: Value = serde_json::from_str(content.trim_start_matches('\u{feff}'))
        .map_err(|error| format!("Claude settings.json is invalid: {error}"))?;
    if !value.is_object() {
        return Err("Claude settings.json must contain a JSON object".to_string());
    }
    Ok(value)
}

/// What Claude's `statusLine` setting holds, from Kavibay's point of view.
enum StatusLine {
    Missing,
    /// Present, but Kavibay cannot safely take it over: not an object with a
    /// string `command`, or on Unix a Kavibay wrapper under another path,
    /// which wrapping again would make run itself.
    Unmanageable,
    Kavibay,
    /// Kavibay's command from before generated paths used forward slashes.
    #[cfg(windows)]
    LegacyKavibay,
    /// Someone else's status line: refused on Windows, wrapped on Unix.
    Foreign,
}

fn status_line_command(status_line: &Value) -> Option<&str> {
    status_line.as_object()?.get("command")?.as_str()
}

fn read_status_line(config_dir: &Path) -> Result<(Value, StatusLine), String> {
    let command = claude_command(config_dir)?;
    #[cfg(windows)]
    let legacy_command = legacy_claude_command(config_dir)?;
    let settings = read_claude_settings(config_dir)?;
    let status_line = match settings.get("statusLine") {
        None => StatusLine::Missing,
        Some(value) => match status_line_command(value) {
            None => StatusLine::Unmanageable,
            Some(existing) if existing == command => StatusLine::Kavibay,
            #[cfg(windows)]
            Some(existing) if existing == legacy_command => StatusLine::LegacyKavibay,
            #[cfg(unix)]
            Some(existing) if existing.contains(CLAUDE_SCRIPT_FILE) => StatusLine::Unmanageable,
            Some(_) => StatusLine::Foreign,
        },
    };
    Ok((settings, status_line))
}

/// `state_file` is Claude's own `~/.claude.json`, which holds its last usage fetch.
fn claude_snapshot(config_dir: &Path, state_file: Option<&Path>) -> UsageSource {
    let status_line = match read_status_line(config_dir) {
        Ok((_, status_line)) => status_line,
        Err(error) => return UsageSource::state("error", error),
    };

    match status_line {
        #[cfg(windows)]
        StatusLine::Missing => UsageSource::state(
            "notConfigured",
            "Enable capture to add the Kavibay Claude Code status line.",
        ),
        #[cfg(unix)]
        StatusLine::Missing => UsageSource::state(
            "notConfigured",
            "Enable capture to read usage through Claude Code's status line.",
        ),
        StatusLine::Unmanageable => UsageSource::state(
            "conflict",
            "Claude has a status line Kavibay cannot safely update.",
        ),
        #[cfg(windows)]
        StatusLine::LegacyKavibay => UsageSource::state(
            "notConfigured",
            "Claude capture needs a one-time path repair. Enable it again to repair the status line.",
        ),
        #[cfg(windows)]
        StatusLine::Foreign => UsageSource::state(
            "conflict",
            "Claude already has a different status line. Kavibay left it unchanged.",
        ),
        #[cfg(unix)]
        StatusLine::Foreign => UsageSource::state(
            "notConfigured",
            "Enable capture to read usage through your Claude Code status line. Kavibay keeps it and its output.",
        ),
        StatusLine::Kavibay => {
            let cache = config_dir.join(CLAUDE_CACHE_FILE);
            let state = state_file
                .and_then(|path| fs::read_to_string(path).ok())
                .and_then(|value| parse_claude_usage_state(&value));
            let status_line = fs::read_to_string(cache)
                .ok()
                .and_then(|value| parse_claude_cache(&value));
            match [state, status_line]
                .into_iter()
                .flatten()
                .max_by_key(|source| source.updated_at.unwrap_or_default())
            {
                Some(source) => source,
                None => UsageSource::state(
                    "waiting",
                    "Capture is enabled. Accept Claude workspace trust and send one prompt; usage is available for Pro/Max.",
                ),
            }
        }
    }
}

async fn claude_snapshot_live() -> UsageSource {
    let Some(config_dir) = claude_dir() else {
        return UsageSource::state("notFound", "Could not locate the Claude config directory.");
    };
    let state_file = home_dir().map(|home| home.join(".claude.json"));
    let local = claude_snapshot(&config_dir, state_file.as_deref());
    if !matches!(local.status, "available" | "waiting") {
        return local;
    }
    fetch_claude_usage().await.unwrap_or(local)
}

#[cfg(windows)]
const CLAUDE_STATUS_LINE_SCRIPT: &str = r#"$raw = [Console]::In.ReadToEnd()
try {
    $data = $raw | ConvertFrom-Json
    $cachePath = Join-Path $PSScriptRoot 'kavibay-usage.json'
    $tempPath = "$cachePath.tmp"
    $payload = [ordered]@{
        captured_at = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
        rate_limits = $data.rate_limits
    }
    $payload | ConvertTo-Json -Depth 8 -Compress | Set-Content -LiteralPath $tempPath -Encoding utf8
    Move-Item -LiteralPath $tempPath -Destination $cachePath -Force

    $parts = @('Claude')
    if ($null -ne $data.rate_limits.five_hour.used_percentage) {
        $parts += ('5h {0}% used' -f [Math]::Round($data.rate_limits.five_hour.used_percentage))
    }
    if ($null -ne $data.rate_limits.seven_day.used_percentage) {
        $parts += ('7d {0}% used' -f [Math]::Round($data.rate_limits.seven_day.used_percentage))
    }
    Write-Output ($parts -join ' | ')
} catch {
    Write-Output 'Claude'
}
"#;

#[cfg(windows)]
fn enable_claude_capture(config_dir: &Path) -> Result<(), String> {
    let command = claude_command(config_dir)?;
    let (mut settings, status_line) = read_status_line(config_dir)?;

    if matches!(status_line, StatusLine::Unmanageable | StatusLine::Foreign) {
        return Err(if settings["statusLine"].is_null() {
            "Claude statusLine is null; remove it before enabling Kavibay capture".to_string()
        } else {
            "Claude already has a different status line; Kavibay did not overwrite it".to_string()
        });
    }

    fs::create_dir_all(config_dir)
        .map_err(|error| format!("Could not create Claude config directory: {error}"))?;
    fs::write(
        config_dir.join(CLAUDE_SCRIPT_FILE),
        CLAUDE_STATUS_LINE_SCRIPT,
    )
    .map_err(|error| format!("Could not install Claude status-line script: {error}"))?;

    settings.as_object_mut().expect("validated object").insert(
        "statusLine".to_string(),
        serde_json::json!({ "type": "command", "command": command, "refreshInterval": 60 }),
    );
    write_claude_settings(config_dir, &settings)
}

/// The usage-recording part of the Unix wrapper; `claude_status_line_script`
/// appends the line that runs the original status line. Only the `rate_limits`
/// object reaches the cache, so paths and session ids never touch disk.
#[cfg(unix)]
const CLAUDE_STATUS_LINE_SCRIPT: &str = r#"#!/bin/sh
# Generated by Kavibay. Records Claude Code's usage limits for the AI Usage
# widget, then runs the status line configured before, with the same input.
# That statusLine setting is saved in kavibay-statusline-original.json.
input=$(cat; printf x)
input=${input%x}
dir=$(dirname "$0")
tmp="$dir/kavibay-usage.json.$$.tmp"
{
  printf '%s' "$input" | LC_ALL=C awk -v now="$(date +%s)" '
    { json = json $0 "\n" }
    END {
      if (now !~ /^[0-9]+$/) exit 1
      key = "\"rate_limits\""
      while ((at = index(json, key)) > 0) {
        json = substr(json, at + length(key))
        sub(/^[ \t\r\n]*/, "", json)
        if (substr(json, 1, 1) != ":") continue
        json = substr(json, 2)
        sub(/^[ \t\r\n]*/, "", json)
        if (substr(json, 1, 1) != "{") exit 1
        for (i = 1; i <= length(json); i++) {
          c = substr(json, i, 1)
          if (quoted) {
            if (escaped) escaped = 0
            else if (c == "\\") escaped = 1
            else if (c == "\"") quoted = 0
          } else if (c == "\"") quoted = 1
          else if (c == "{") depth++
          else if (c == "}" && --depth == 0) {
            printf "{\"captured_at\":%s,\"rate_limits\":%s}\n", now, substr(json, 1, i)
            exit 0
          }
        }
        exit 1
      }
      exit 1
    }' > "$tmp" && mv -f "$tmp" "$dir/kavibay-usage.json" || rm -f "$tmp"
} 2>/dev/null
"#;

/// Claude Code runs a status-line command with `/bin/sh -c`, so the wrapper
/// does the same with the original command as one single-quoted literal.
#[cfg(unix)]
fn claude_status_line_script(original_command: Option<&str>) -> String {
    let mut script = CLAUDE_STATUS_LINE_SCRIPT.to_string();
    if let Some(command) = original_command {
        let quoted = command.replace('\'', r"'\''");
        script.push_str(&format!("printf '%s' \"$input\" | /bin/sh -c '{quoted}'\n"));
    }
    script
}

#[cfg(unix)]
fn read_original_status_line(config_dir: &Path) -> Result<Option<Value>, String> {
    let content = match fs::read_to_string(config_dir.join(CLAUDE_ORIGINAL_STATUS_LINE_FILE)) {
        Ok(content) => content,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(format!(
                "Could not read the saved Claude status line: {error}"
            ))
        }
    };
    match serde_json::from_str::<Value>(&content) {
        Ok(value) if status_line_command(&value).is_some() => Ok(Some(value)),
        _ => Err(format!(
            "{CLAUDE_ORIGINAL_STATUS_LINE_FILE} is not a Claude status line"
        )),
    }
}

#[cfg(unix)]
fn save_original_status_line(config_dir: &Path, original: Option<&Value>) -> Result<(), String> {
    let path = config_dir.join(CLAUDE_ORIGINAL_STATUS_LINE_FILE);
    let result = match original {
        Some(original) => write_json(&path, original),
        None => fs::remove_file(&path).or_else(|error| match error.kind() {
            io::ErrorKind::NotFound => Ok(()),
            _ => Err(error),
        }),
    };
    result.map_err(|error| format!("Could not save the original Claude status line: {error}"))
}

/// Wraps an existing status line instead of replacing it: the wrapper records
/// usage and then runs the original command, so its output stays the same.
#[cfg(unix)]
fn enable_claude_capture(config_dir: &Path) -> Result<(), String> {
    let command = claude_command(config_dir)?;
    let (mut settings, status_line) = read_status_line(config_dir)?;
    let original = match status_line {
        StatusLine::Missing => None,
        StatusLine::Unmanageable => {
            return Err("Claude has a status line Kavibay cannot safely update".to_string())
        }
        StatusLine::Kavibay => read_original_status_line(config_dir)?,
        StatusLine::Foreign => Some(settings["statusLine"].clone()),
    };

    fs::create_dir_all(config_dir)
        .map_err(|error| format!("Could not create Claude config directory: {error}"))?;
    save_original_status_line(config_dir, original.as_ref())?;
    fs::write(
        config_dir.join(CLAUDE_SCRIPT_FILE),
        claude_status_line_script(original.as_ref().and_then(status_line_command)),
    )
    .map_err(|error| format!("Could not install Claude status-line script: {error}"))?;

    // Keeps `type`, `padding` and any other field of the line being wrapped.
    let mut status_line = settings
        .get("statusLine")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({ "type": "command" }));
    status_line["command"] = Value::String(command);
    settings["statusLine"] = status_line;
    write_claude_settings(config_dir, &settings)
}

fn write_json(path: &Path, value: &Value) -> io::Result<()> {
    let mut content = serde_json::to_string_pretty(value)?;
    content.push('\n');
    fs::write(path, content)
}

fn write_claude_settings(config_dir: &Path, settings: &Value) -> Result<(), String> {
    write_json(&config_dir.join("settings.json"), settings)
        .map_err(|error| format!("Could not update Claude settings: {error}"))
}

/// Returns normalized, secret-free rate-limit snapshots for both providers.
#[tauri::command]
pub async fn widget_ai_usage() -> AiUsageSnapshot {
    AiUsageSnapshot {
        codex: codex_snapshot(),
        claude: claude_snapshot_live().await,
    }
}

/// Installs the opt-in Claude Code status-line capture and returns its new state.
#[tauri::command]
pub async fn widget_ai_usage_enable_claude() -> Result<AiUsageSnapshot, String> {
    let config_dir =
        claude_dir().ok_or_else(|| "Could not locate the Claude config directory".to_string())?;
    enable_claude_capture(&config_dir)?;
    Ok(widget_ai_usage().await)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_codex_rate_limit_event() {
        let source = parse_codex_line(
            r#"{"timestamp":"2026-08-21T12:30:00Z","payload":{"rate_limits":{"primary":{"used_percent":72.0,"window_minutes":300,"resets_at":1770000000},"secondary":{"used_percent":15.5,"window_minutes":10080,"resets_at":1780000000},"plan_type":"plus"}}}"#,
        )
        .expect("valid rate limits");

        assert_eq!(source.status, "available");
        assert_eq!(source.plan.as_deref(), Some("plus"));
        assert_eq!(source.windows.len(), 2);
        assert_eq!(source.windows[0].label, "5 hours");
        assert_eq!(source.windows[1].label, "7 days");
    }

    #[test]
    fn ignores_codex_lines_without_usage_windows() {
        assert!(parse_codex_line(r#"{"payload":{"type":"message"}}"#).is_none());
    }

    #[test]
    fn parses_claude_cache_and_iso_reset_time() {
        let source = parse_claude_cache(
            r#"{"captured_at":1770000000,"rate_limits":{"five_hour":{"used_percentage":20,"resets_at":"2026-08-21T14:00:00Z"},"seven_day":{"used_percentage":35.5,"resets_at":1780000000}}}"#,
        )
        .expect("valid cache");

        assert_eq!(source.windows.len(), 2);
        assert_eq!(source.windows[0].used_percent, 20.0);
        assert!(source.windows[0].resets_at.is_some());
        assert_eq!(source.updated_at, Some(1_770_000_000));
    }

    #[test]
    fn parses_live_claude_usage() {
        let source = parse_claude_usage(
            r#"{"five_hour":{"utilization":51,"resets_at":"2026-08-22T16:50:00Z"},"seven_day":{"utilization":93,"resets_at":"2026-08-23T09:00:00Z"}}"#,
        )
        .expect("valid live usage");

        assert_eq!(source.windows[0].used_percent, 51.0);
        assert_eq!(source.windows[1].used_percent, 93.0);
        assert!(source.windows[0].resets_at.is_some());
    }

    #[test]
    fn parses_cached_claude_usage_state() {
        let source = parse_claude_usage_state(
            r#"{"cachedUsageUtilization":{"fetchedAtMs":1787344401082,"utilization":{"five_hour":{"utilization":41,"resets_at":"2026-08-21T21:40:00Z"},"seven_day":{"utilization":77,"resets_at":"2026-08-23T09:00:00Z"}}}}"#,
        )
        .expect("valid cached usage state");

        assert_eq!(source.windows[0].used_percent, 41.0);
        assert_eq!(source.windows[1].used_percent, 77.0);
        assert_eq!(source.updated_at, Some(1_787_344_401));
    }

    #[test]
    fn refresh_payload_updates_expiry_and_rotated_refresh_token() {
        let credentials = parse_claude_credentials(
            PathBuf::from(".credentials.json"),
            r#"{"claudeAiOauth":{"accessToken":"old-access","refreshToken":"old-refresh","expiresAt":1787373186776,"scopes":["user:profile"]}}"#,
        )
        .expect("valid Claude credentials");
        let refreshed = parse_refreshed_claude_token(
            &serde_json::json!({
                "access_token": "new-access",
                "refresh_token": "new-refresh",
                "expires_in": 3600,
                "refresh_token_expires_in": 604800
            }),
            credentials.refresh_token.as_deref().expect("refresh token"),
            1_787_400_000_000,
        )
        .expect("valid refresh response");

        assert_eq!(refreshed.access_token, "new-access");
        assert_eq!(refreshed.refresh_token.as_deref(), Some("new-refresh"));
        assert_eq!(refreshed.expires_at, 1_787_403_600_000);
        assert_eq!(refreshed.refresh_token_expires_at, Some(1_788_004_800_000));

        let mut document = credentials.document.clone();
        assert!(update_claude_credentials_document(
            &mut document,
            &refreshed
        ));
        assert_eq!(document["claudeAiOauth"]["accessToken"], "new-access");
        assert_eq!(document["claudeAiOauth"]["refreshToken"], "new-refresh");
        assert_eq!(document["claudeAiOauth"]["expiresAt"], 1_787_403_600_000i64);
    }

    #[test]
    fn rejects_claude_cache_without_rate_limits() {
        assert!(parse_claude_cache(r#"{"rate_limits":null}"#).is_none());
    }

    #[test]
    fn labels_nonstandard_windows_readably() {
        assert_eq!(window_label(Some(120), "primary"), "2 hours");
        assert_eq!(window_label(Some(2_880), "secondary"), "2 days");
        assert_eq!(window_label(Some(45), "primary"), "45 minutes");
    }

    #[cfg(windows)]
    #[test]
    fn claude_command_uses_git_bash_safe_forward_slashes() {
        let config_dir = Path::new(r"C:\Users\Alex\.claude");
        let command = claude_command(config_dir).expect("valid Windows path");
        assert!(command.starts_with("powershell "));
        assert!(command.contains("C:/Users/Alex/.claude/kavibay-usage-statusline.ps1"));
        assert!(!command.contains('\\'));
    }

    #[cfg(unix)]
    mod unix_capture {
        use super::*;
        use serde_json::json;
        use std::{
            io::Write,
            process::{Command, Stdio},
            sync::atomic::{AtomicUsize, Ordering},
            time::SystemTime,
        };

        /// Shaped like Claude Code's status-line input, including the trailing
        /// newline it writes. Braces and escaped quotes sit inside strings,
        /// also within `rate_limits`, and a string value "rate_limits" comes
        /// before the real key.
        const CLAUDE_INPUT: &str = concat!(
            r#"{"session_id":"abc","cwd":"/work/a}b \"quoted\" {dir","#,
            r#""output_style":{"name":"rate_limits"},"#,
            r#""model":{"id":"claude-opus-4","display_name":"Opus"},"#,
            r#""workspace":{"current_dir":"/work/a}b","project_dir":"/work"},"#,
            r#""rate_limits" : {"five_hour":{"used_percentage":25,"resets_at":1790000000},"#,
            r#""seven_day":{"used_percentage":4,"resets_at":1790500000},"#,
            r#""spend_limit":{"label":"cap }} \"{\\\" "}},"#,
            r#""version":"2.1.271"}"#,
            "\n"
        );

        fn temp_config_dir() -> PathBuf {
            static NEXT: AtomicUsize = AtomicUsize::new(0);
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let dir = env::temp_dir().join(format!(
                "kavibay_claude_{}_{nanos}_{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&dir).unwrap();
            dir
        }

        fn wrapper_command(dir: &Path) -> String {
            format!("sh '{}/kavibay-usage-statusline.sh'", dir.display())
        }

        fn enable_over(status_line: Option<Value>) -> PathBuf {
            let dir = temp_config_dir();
            let mut settings = json!({ "model": "opus" });
            if let Some(status_line) = status_line {
                settings["statusLine"] = status_line;
            }
            write_json(&dir.join("settings.json"), &settings).unwrap();
            enable_claude_capture(&dir).unwrap();
            dir
        }

        /// Runs the configured status line the way Claude Code does, with
        /// `HOME` pointing at the temp dir so `~` is predictable.
        fn run_status_line(dir: &Path, input: &str) -> String {
            let settings = read_claude_settings(dir).unwrap();
            let mut child = Command::new("/bin/sh")
                .arg("-c")
                .arg(settings["statusLine"]["command"].as_str().unwrap())
                .env("HOME", dir)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .unwrap();
            child
                .stdin
                .take()
                .unwrap()
                .write_all(input.as_bytes())
                .unwrap();
            let output = child.wait_with_output().unwrap();
            assert!(
                output.status.success(),
                "status line failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            assert_eq!(String::from_utf8_lossy(&output.stderr), "");
            String::from_utf8(output.stdout).unwrap()
        }

        fn cached_windows(dir: &Path) -> Vec<(f64, Option<i64>)> {
            let cache = fs::read_to_string(dir.join(CLAUDE_CACHE_FILE)).unwrap();
            parse_claude_cache(&cache)
                .unwrap()
                .windows
                .iter()
                .map(|window| (window.used_percent, window.resets_at))
                .collect()
        }

        fn file_names(dir: &Path) -> Vec<String> {
            let mut names = fs::read_dir(dir)
                .unwrap()
                .map(|entry| entry.unwrap().file_name().into_string().unwrap())
                .collect::<Vec<_>>();
            names.sort();
            names
        }

        #[test]
        fn wrapper_passes_input_through_and_caches_only_rate_limits() {
            let dir = enable_over(Some(
                json!({ "type": "command", "command": "printf 'seen:'; cat" }),
            ));

            assert_eq!(
                run_status_line(&dir, CLAUDE_INPUT),
                format!("seen:{CLAUDE_INPUT}")
            );

            let cache: Value =
                serde_json::from_str(&fs::read_to_string(dir.join(CLAUDE_CACHE_FILE)).unwrap())
                    .unwrap();
            let mut keys = cache.as_object().unwrap().keys().collect::<Vec<_>>();
            keys.sort();
            assert_eq!(keys, ["captured_at", "rate_limits"]);
            assert_eq!(
                cache["rate_limits"],
                json!({
                    "five_hour": { "used_percentage": 25, "resets_at": 1790000000 },
                    "seven_day": { "used_percentage": 4, "resets_at": 1790500000 },
                    "spend_limit": { "label": "cap }} \"{\\\" " }
                })
            );
            assert_eq!(
                cached_windows(&dir),
                [(25.0, Some(1_790_000_000)), (4.0, Some(1_790_500_000))]
            );
            fs::remove_dir_all(dir).unwrap();
        }

        #[test]
        fn wrapper_runs_an_original_with_single_quotes_and_tilde() {
            let dir = enable_over(Some(json!({
                "type": "command",
                "command": "printf '%s %s' \"it's\" ~/statusline"
            })));

            assert_eq!(
                run_status_line(&dir, CLAUDE_INPUT),
                format!("it's {}/statusline", dir.display())
            );
            fs::remove_dir_all(dir).unwrap();
        }

        #[test]
        fn input_without_rate_limits_keeps_the_previous_cache() {
            let dir = enable_over(Some(json!({ "type": "command", "command": "cat" })));
            let previous = r#"{"captured_at":1790000000,"rate_limits":{"five_hour":{"used_percentage":60,"resets_at":1790000000}}}"#;
            fs::write(dir.join(CLAUDE_CACHE_FILE), previous).unwrap();
            let input = "{\"model\":{\"id\":\"claude-opus-4\"},\"workspace\":{\"current_dir\":\"/work\"}}\n";

            assert_eq!(run_status_line(&dir, input), input);
            assert_eq!(
                fs::read_to_string(dir.join(CLAUDE_CACHE_FILE)).unwrap(),
                previous
            );
            assert_eq!(
                file_names(&dir),
                [
                    "kavibay-statusline-original.json",
                    "kavibay-usage-statusline.sh",
                    "kavibay-usage.json",
                    "settings.json"
                ]
            );
            fs::remove_dir_all(dir).unwrap();
        }

        #[test]
        fn enabling_wraps_a_foreign_status_line_and_is_idempotent() {
            let original = json!({
                "type": "command",
                "command": "bash ~/.claude/statusline-command.sh",
                "padding": 0
            });
            let dir = enable_over(Some(original.clone()));

            assert_eq!(
                read_claude_settings(&dir).unwrap(),
                json!({
                    "model": "opus",
                    "statusLine": { "type": "command", "command": wrapper_command(&dir), "padding": 0 }
                })
            );
            let sidecar = fs::read_to_string(dir.join("kavibay-statusline-original.json")).unwrap();
            assert_eq!(serde_json::from_str::<Value>(&sidecar).unwrap(), original);

            let files = [
                "settings.json",
                "kavibay-statusline-original.json",
                "kavibay-usage-statusline.sh",
            ];
            let first = files.map(|name| fs::read(dir.join(name)).unwrap());
            enable_claude_capture(&dir).unwrap();
            assert_eq!(files.map(|name| fs::read(dir.join(name)).unwrap()), first);

            fs::create_dir(dir.join(".claude")).unwrap();
            fs::write(
                dir.join(".claude/statusline-command.sh"),
                "printf 'user line'\n",
            )
            .unwrap();
            assert_eq!(run_status_line(&dir, CLAUDE_INPUT), "user line");
            fs::remove_dir_all(dir).unwrap();
        }

        #[test]
        fn enabling_without_a_status_line_adds_a_silent_wrapper() {
            let dir = temp_config_dir();
            fs::write(
                dir.join("kavibay-statusline-original.json"),
                r#"{"type":"command","command":"echo removed since"}"#,
            )
            .unwrap();
            enable_claude_capture(&dir).unwrap();

            assert_eq!(
                read_claude_settings(&dir).unwrap(),
                json!({ "statusLine": { "type": "command", "command": wrapper_command(&dir) } })
            );
            assert_eq!(
                file_names(&dir),
                ["kavibay-usage-statusline.sh", "settings.json"]
            );
            assert_eq!(run_status_line(&dir, CLAUDE_INPUT), "");
            assert_eq!(
                cached_windows(&dir),
                [(25.0, Some(1_790_000_000)), (4.0, Some(1_790_500_000))]
            );
            fs::remove_dir_all(dir).unwrap();
        }

        #[test]
        fn snapshot_moves_from_setup_to_waiting_to_available() {
            let dir = temp_config_dir();
            let state = |dir: &Path| {
                let source = claude_snapshot(dir, None);
                (source.status, source.detail.unwrap_or_default())
            };

            assert_eq!(
                state(&dir),
                (
                    "notConfigured",
                    "Enable capture to read usage through Claude Code's status line.".to_string()
                )
            );

            write_json(
                &dir.join("settings.json"),
                &json!({ "statusLine": { "type": "command", "command": "echo mine" } }),
            )
            .unwrap();
            assert_eq!(
                state(&dir),
                (
                    "notConfigured",
                    "Enable capture to read usage through your Claude Code status line. Kavibay keeps it and its output.".to_string()
                )
            );

            enable_claude_capture(&dir).unwrap();
            assert_eq!(state(&dir).0, "waiting");

            assert_eq!(run_status_line(&dir, CLAUDE_INPUT), "mine\n");
            let source = claude_snapshot(&dir, None);
            assert_eq!(source.status, "available");
            assert_eq!(
                source
                    .windows
                    .iter()
                    .map(|window| (window.label.as_str(), window.used_percent))
                    .collect::<Vec<_>>(),
                [("5 hours", 25.0), ("7 days", 4.0)]
            );
            fs::remove_dir_all(dir).unwrap();
        }

        #[test]
        fn status_lines_kavibay_cannot_wrap_are_left_alone() {
            for status_line in [
                Value::Null,
                json!("echo mine"),
                json!({ "type": "command" }),
                json!({ "type": "command", "command": "sh '/elsewhere/kavibay-usage-statusline.sh'" }),
            ] {
                let dir = temp_config_dir();
                write_json(
                    &dir.join("settings.json"),
                    &json!({ "statusLine": status_line }),
                )
                .unwrap();
                let before = fs::read(dir.join("settings.json")).unwrap();

                let source = claude_snapshot(&dir, None);
                assert_eq!(
                    (source.status, source.detail.as_deref()),
                    (
                        "conflict",
                        Some("Claude has a status line Kavibay cannot safely update.")
                    ),
                    "{status_line}"
                );
                assert_eq!(
                    enable_claude_capture(&dir),
                    Err("Claude has a status line Kavibay cannot safely update".to_string())
                );
                assert_eq!(fs::read(dir.join("settings.json")).unwrap(), before);
                assert_eq!(file_names(&dir), ["settings.json"]);
                fs::remove_dir_all(dir).unwrap();
            }
        }

        #[test]
        fn claude_command_single_quotes_the_script_path() {
            assert_eq!(
                claude_command(Path::new("/Users/alex/.claude")),
                Ok("sh '/Users/alex/.claude/kavibay-usage-statusline.sh'".to_string())
            );
            assert_eq!(
                claude_command(Path::new("/Users/alex/it's/.claude")),
                Err("Claude config path contains an unsupported quote".to_string())
            );
        }
    }
}
