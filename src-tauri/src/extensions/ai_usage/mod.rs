//! AI Usage widget backend: Codex and Claude Code rate-limit snapshots.

use std::{
    env, fs,
    io::{Read, Seek, SeekFrom},
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
const CLAUDE_SCRIPT_FILE: &str = "kavibay-usage-statusline.ps1";
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

fn claude_command(config_dir: &Path) -> Result<String, String> {
    let path = config_dir.join(CLAUDE_SCRIPT_FILE);
    let path = path
        .to_str()
        .ok_or_else(|| "Claude config path is not valid Unicode".to_string())?;
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

fn legacy_claude_command(config_dir: &Path) -> Result<String, String> {
    let path = config_dir.join(CLAUDE_SCRIPT_FILE);
    let path = path
        .to_str()
        .ok_or_else(|| "Claude config path is not valid Unicode".to_string())?;
    if path.contains('"') {
        return Err("Claude config path contains an unsupported quote".to_string());
    }
    Ok(format!(
        "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"{path}\""
    ))
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

fn configured_status_line(settings: &Value) -> Option<&str> {
    settings
        .get("statusLine")
        .and_then(Value::as_object)
        .and_then(|value| value.get("command"))
        .and_then(Value::as_str)
}

#[cfg(windows)]
fn claude_unconfigured() -> UsageSource {
    UsageSource::state(
        "notConfigured",
        "Enable capture to add the Kavibay Claude Code status line.",
    )
}

#[cfg(not(windows))]
fn claude_unconfigured() -> UsageSource {
    UsageSource::state(
        "unsupported",
        "Claude capture setup is currently available on Windows only.",
    )
}

fn claude_snapshot() -> UsageSource {
    let Some(config_dir) = claude_dir() else {
        return UsageSource::state("notFound", "Could not locate the Claude config directory.");
    };
    let command = match claude_command(&config_dir) {
        Ok(command) => command,
        Err(error) => return UsageSource::state("error", error),
    };
    let legacy_command = match legacy_claude_command(&config_dir) {
        Ok(command) => command,
        Err(error) => return UsageSource::state("error", error),
    };
    let settings = match read_claude_settings(&config_dir) {
        Ok(settings) => settings,
        Err(error) => return UsageSource::state("error", error),
    };

    match configured_status_line(&settings) {
        None if settings.get("statusLine").is_some() => UsageSource::state(
            "conflict",
            "Claude has a status line Kavibay cannot safely update.",
        ),
        None => claude_unconfigured(),
        Some(existing) if existing == legacy_command => UsageSource::state(
            "notConfigured",
            "Claude capture needs a one-time path repair. Enable it again to repair the status line.",
        ),
        Some(existing) if existing != command => UsageSource::state(
            "conflict",
            "Claude already has a different status line. Kavibay left it unchanged.",
        ),
        Some(_) => {
            let cache = config_dir.join(CLAUDE_CACHE_FILE);
            let state = home_dir()
                .map(|home| home.join(".claude.json"))
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
    let local = claude_snapshot();
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
fn enable_claude_capture() -> Result<(), String> {
    let config_dir =
        claude_dir().ok_or_else(|| "Could not locate the Claude config directory".to_string())?;
    let command = claude_command(&config_dir)?;
    let legacy_command = legacy_claude_command(&config_dir)?;
    let mut settings = read_claude_settings(&config_dir)?;

    if let Some(existing) = settings.get("statusLine") {
        let existing_command = configured_status_line(&settings);
        if existing_command != Some(command.as_str())
            && existing_command != Some(legacy_command.as_str())
        {
            return Err(if existing.is_null() {
                "Claude statusLine is null; remove it before enabling Kavibay capture".to_string()
            } else {
                "Claude already has a different status line; Kavibay did not overwrite it"
                    .to_string()
            });
        }
    }

    fs::create_dir_all(&config_dir)
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
    let mut content = serde_json::to_string_pretty(&settings)
        .map_err(|error| format!("Could not serialize Claude settings: {error}"))?;
    content.push('\n');
    fs::write(config_dir.join("settings.json"), content)
        .map_err(|error| format!("Could not update Claude settings: {error}"))?;
    Ok(())
}

#[cfg(not(windows))]
fn enable_claude_capture() -> Result<(), String> {
    Err("Claude capture setup is currently available on Windows only".to_string())
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
    enable_claude_capture()?;
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

    #[test]
    fn claude_command_uses_git_bash_safe_forward_slashes() {
        let config_dir = Path::new(r"C:\Users\Alex\.claude");
        let command = claude_command(config_dir).expect("valid Windows path");
        assert!(command.starts_with("powershell "));
        assert!(command.contains("C:/Users/Alex/.claude/kavibay-usage-statusline.ps1"));
        assert!(!command.contains('\\'));
    }
}
