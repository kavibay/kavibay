//! Enumerate installed apps for the palette launcher.
//!
//! Windows: Start apps + Start Menu shortcuts + uninstall registry.
//! macOS: `.app` bundles under `/Applications` and `~/Applications`.

use serde::Serialize;

// Everything below the scan itself — cache, merging, plist parsing — exists only
// on the platforms that can enumerate apps at all.
#[cfg(windows)]
use serde::Deserialize;
#[cfg(windows)]
use std::collections::HashMap;
#[cfg(any(windows, target_os = "macos"))]
use std::path::{Path, PathBuf};
#[cfg(any(windows, target_os = "macos"))]
use std::sync::Mutex;
#[cfg(any(windows, target_os = "macos"))]
use std::time::{Duration, Instant};

/// One launchable installed app for the picker UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledApp {
    pub name: String,
    pub path: String,
    /// True when this app is on the Windows Start “Pinned” grid.
    #[serde(default)]
    pub pinned: bool,
}

#[cfg(any(windows, target_os = "macos"))]
struct Cache {
    at: Instant,
    apps: Vec<InstalledApp>,
}

#[cfg(any(windows, target_os = "macos"))]
static CACHE: Mutex<Option<Cache>> = Mutex::new(None);
/// Longer TTL — full app scan is expensive on both platforms; palette only needs a warm copy.
#[cfg(any(windows, target_os = "macos"))]
const CACHE_TTL: Duration = Duration::from_secs(5 * 60);

/// List installed apps, merged and sorted. Cached ~5 min.
/// Runs the heavy scan off the async runtime so the open path's IPC stays responsive.
#[tauri::command]
pub async fn list_installed_apps() -> Result<Vec<InstalledApp>, String> {
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        Err("Installed apps listing is only supported on Windows and macOS".into())
    }
    #[cfg(any(windows, target_os = "macos"))]
    {
        {
            let guard = CACHE.lock().map_err(|e| e.to_string())?;
            if let Some(c) = guard.as_ref() {
                if c.at.elapsed() < CACHE_TTL {
                    return Ok(c.apps.clone());
                }
            }
        }
        #[cfg(windows)]
        let apps = tokio::task::spawn_blocking(scan_installed_apps_windows)
            .await
            .map_err(|e| e.to_string())??;
        #[cfg(target_os = "macos")]
        let apps = tokio::task::spawn_blocking(scan_installed_apps_macos)
            .await
            .map_err(|e| e.to_string())??;
        let mut guard = CACHE.lock().map_err(|e| e.to_string())?;
        *guard = Some(Cache {
            at: Instant::now(),
            apps: apps.clone(),
        });
        Ok(apps)
    }
}

/// Scan `/Applications` and `~/Applications` for launchable `.app` bundles.
#[cfg(target_os = "macos")]
fn scan_installed_apps_macos() -> Result<Vec<InstalledApp>, String> {
    let mut out = Vec::new();
    for dir in [PathBuf::from("/Applications"), home_applications_dir()] {
        collect_macos_apps_in_dir(&dir, &mut out);
    }
    out.sort_by_key(|a| a.name.to_lowercase());
    Ok(dedupe_by_path(out))
}

/// User-level Applications folder (`~/Applications`).
#[cfg(target_os = "macos")]
fn home_applications_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/"))
        .join("Applications")
}

/// Read one directory level for `.app` bundles (no recursion — matches Finder layout).
#[cfg(target_os = "macos")]
fn collect_macos_apps_in_dir(dir: &Path, out: &mut Vec<InstalledApp>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let is_app = path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("app"));
        if !is_app {
            continue;
        }
        let name = macos_app_display_name(&path);
        if name.trim().is_empty() {
            continue;
        }
        out.push(InstalledApp {
            name,
            path: path.to_string_lossy().to_string(),
            pinned: false,
        });
    }
}

/// Resolve display name: `CFBundleDisplayName` → `CFBundleName` → bundle folder name.
#[cfg(target_os = "macos")]
fn macos_app_display_name(app_bundle: &Path) -> String {
    let fallback = app_bundle
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("App")
        .to_string();

    let plist_path = app_bundle.join("Contents/Info.plist");
    let Ok(file) = std::fs::File::open(&plist_path) else {
        return fallback;
    };
    let Ok(value) = plist::Value::from_reader(file) else {
        return fallback;
    };
    let Some(dict) = value.as_dictionary() else {
        return fallback;
    };

    for key in ["CFBundleDisplayName", "CFBundleName"] {
        if let Some(plist::Value::String(name)) = dict.get(key) {
            let trimmed = name.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }
    fallback
}

/// Collapse duplicate bundle paths (case-insensitive — HFS+/APFS default).
#[cfg(target_os = "macos")]
fn dedupe_by_path(apps: Vec<InstalledApp>) -> Vec<InstalledApp> {
    use std::collections::HashSet;

    let mut seen = HashSet::new();
    let mut out = Vec::with_capacity(apps.len());
    for app in apps {
        if seen.insert(app.path.to_lowercase()) {
            out.push(app);
        }
    }
    out
}

#[cfg(windows)]
fn scan_installed_apps_windows() -> Result<Vec<InstalledApp>, String> {
    // identity_key -> (app, priority). Higher wins.
    // Get-StartApps (3) > Start Menu .lnk (2) > registry (1)
    let mut by_identity: HashMap<String, (InstalledApp, u8)> = HashMap::new();
    let mut by_name: HashMap<String, String> = HashMap::new();

    for app in collect_get_start_apps() {
        upsert(&mut by_identity, &mut by_name, app, 3);
    }
    for app in collect_start_menu_apps() {
        upsert(&mut by_identity, &mut by_name, app, 2);
    }
    for app in collect_registry_apps() {
        upsert(&mut by_identity, &mut by_name, app, 1);
    }

    let apps: Vec<InstalledApp> = by_identity.into_values().map(|(a, _)| a).collect();
    // Start “Pinned” grid first (Export-StartLayout order), then the rest A–Z.
    Ok(dedupe_by_identity(order_with_start_pins(apps)))
}

/// A Start-menu pin from `Export-StartLayout` (desktop link or packaged AppID).
#[cfg(windows)]
enum StartPin {
    Link(String),
    AppId(String),
}

/// Read the current user’s Start Pinned apps (same source as the Start menu grid).
#[cfg(windows)]
fn collect_start_pins() -> Vec<StartPin> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let tmp = std::env::temp_dir().join(format!("kavibay-start-pins-{}.json", std::process::id()));
    let tmp_str = tmp.to_string_lossy().replace('\'', "''");
    let script = format!(
        "Export-StartLayout -Path '{tmp_str}'; Get-Content -Raw -LiteralPath '{tmp_str}'; Remove-Item -LiteralPath '{tmp_str}' -Force -ErrorAction SilentlyContinue"
    );
    let output = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &script,
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output();

    let Ok(output) = output else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    let raw = String::from_utf8_lossy(&output.stdout);
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    #[derive(Deserialize)]
    struct Layout {
        #[serde(rename = "pinnedList", default)]
        pinned_list: Vec<PinRow>,
    }
    #[derive(Deserialize)]
    struct PinRow {
        #[serde(rename = "desktopAppLink")]
        desktop_app_link: Option<String>,
        #[serde(rename = "desktopAppId")]
        desktop_app_id: Option<String>,
        #[serde(rename = "packagedAppId")]
        packaged_app_id: Option<String>,
    }

    let Ok(layout) = serde_json::from_str::<Layout>(trimmed) else {
        return Vec::new();
    };

    layout
        .pinned_list
        .into_iter()
        .filter_map(|row| {
            if let Some(link) = row.desktop_app_link {
                let expanded = expand_env_vars(link.trim());
                if expanded.is_empty() {
                    None
                } else {
                    Some(StartPin::Link(expanded))
                }
            } else {
                row.packaged_app_id
                    .or(row.desktop_app_id)
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .map(StartPin::AppId)
            }
        })
        .collect()
}

/// Put Start Pinned apps first (pin order), then remaining apps alphabetically.
#[cfg(windows)]
fn order_with_start_pins(apps: Vec<InstalledApp>) -> Vec<InstalledApp> {
    use std::collections::HashSet;

    let pins = collect_start_pins();
    if pins.is_empty() {
        let mut apps = apps;
        apps.sort_by(|a, b| {
            a.name
                .to_ascii_lowercase()
                .cmp(&b.name.to_ascii_lowercase())
                .then_with(|| {
                    a.path
                        .to_ascii_lowercase()
                        .cmp(&b.path.to_ascii_lowercase())
                })
        });
        return apps;
    }

    // Keyed by launch identity (.lnk → target exe) so pins collapse with catalog rows.
    let mut by_identity: HashMap<String, InstalledApp> = HashMap::new();
    // AppID (lowercase) → identity for shell:AppsFolder entries.
    let mut by_app_id: HashMap<String, String> = HashMap::new();
    for app in apps {
        let key = identity_key(&app.path);
        if let Some(id) = shell_apps_folder_id(&app.path) {
            by_app_id.insert(id.to_ascii_lowercase(), key.clone());
        }
        by_identity.insert(key, app);
    }

    let mut out: Vec<InstalledApp> = Vec::new();
    let mut used: HashSet<String> = HashSet::new();

    for pin in pins {
        let resolved = match pin {
            StartPin::Link(link) => {
                let key = identity_key(&link);
                if let Some(mut app) = by_identity.get(&key).cloned() {
                    app.pinned = true;
                    Some((key, app))
                } else if Path::new(&link).exists() {
                    let name = Path::new(&link)
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or("App")
                        .to_string();
                    Some((
                        key.clone(),
                        InstalledApp {
                            name,
                            path: link,
                            pinned: true,
                        },
                    ))
                } else {
                    None
                }
            }
            StartPin::AppId(id) => {
                let id_key = id.to_ascii_lowercase();
                let path = format!("shell:AppsFolder\\{id}");
                let path_identity = identity_key(&path);
                if let Some(existing_key) = by_app_id.get(&id_key) {
                    if let Some(mut app) = by_identity.get(existing_key).cloned() {
                        app.pinned = true;
                        Some((existing_key.clone(), app))
                    } else {
                        None
                    }
                } else if let Some(mut app) = by_identity.get(&path_identity).cloned() {
                    app.pinned = true;
                    Some((path_identity, app))
                } else {
                    // Prefer a friendly name from Get-StartApps catalog when present.
                    let name = by_identity
                        .values()
                        .find(|a| {
                            shell_apps_folder_id(&a.path)
                                .map(|x| x.eq_ignore_ascii_case(&id))
                                .unwrap_or(false)
                        })
                        .map(|a| a.name.clone())
                        .unwrap_or_else(|| id.clone());
                    Some((
                        path_identity,
                        InstalledApp {
                            name,
                            path,
                            pinned: true,
                        },
                    ))
                }
            }
        };

        if let Some((key, app)) = resolved {
            if used.insert(key) {
                out.push(app);
            }
        }
    }

    let mut rest: Vec<InstalledApp> = by_identity
        .into_iter()
        .filter(|(k, _)| !used.contains(k))
        .map(|(_, mut a)| {
            a.pinned = false;
            a
        })
        .collect();
    rest.sort_by(|a, b| {
        a.name
            .to_ascii_lowercase()
            .cmp(&b.name.to_ascii_lowercase())
            .then_with(|| {
                a.path
                    .to_ascii_lowercase()
                    .cmp(&b.path.to_ascii_lowercase())
            })
    });
    out.extend(rest);
    out
}

/// Extract AppID from `shell:AppsFolder\…` paths.
#[cfg(windows)]
fn shell_apps_folder_id(path: &str) -> Option<&str> {
    let lower = path.to_ascii_lowercase();
    const PREFIXES: &[&str] = &["shell:appsfolder\\", "shell:appsfolder/"];
    for prefix in PREFIXES {
        if lower.starts_with(prefix) {
            return Some(path[prefix.len()..].trim());
        }
    }
    None
}

/// Canonical identity for dedupe: path-like AppIDs → exe path.
/// `.lnk` files keep their own key; name-based upsert merges shortcut + exe twins.
#[cfg(windows)]
fn identity_key(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    if let Some(id) = shell_apps_folder_id(trimmed) {
        let id = id.trim();
        let looks_like_path = id.contains('\\')
            || id.contains('/')
            || id.to_ascii_lowercase().ends_with(".exe")
            || id.to_ascii_lowercase().ends_with(".lnk");
        if looks_like_path {
            return identity_key(id);
        }
        return format!("shell-appid:{}", id.to_ascii_lowercase());
    }

    normalize_key(trimmed)
}

#[cfg(windows)]
fn path_is_lnk(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("lnk"))
}

/// Prefer pinned, then shorter display name, then direct exe over `.lnk`.
#[cfg(windows)]
fn prefer_app(a: &InstalledApp, b: &InstalledApp) -> InstalledApp {
    let mut keep = a.clone();
    let mut other = b.clone();
    // Normalize comparison order: evaluate which is better, then merge flags.
    let a_better = {
        if a.pinned != b.pinned {
            a.pinned
        } else if a.name.trim().len() != b.name.trim().len() {
            a.name.trim().len() < b.name.trim().len()
        } else {
            let a_lnk = path_is_lnk(&a.path);
            let b_lnk = path_is_lnk(&b.path);
            if a_lnk != b_lnk {
                !a_lnk
            } else {
                a.name.to_ascii_lowercase() <= b.name.to_ascii_lowercase()
            }
        }
    };
    if !a_better {
        std::mem::swap(&mut keep, &mut other);
    }
    keep.pinned = a.pinned || b.pinned;
    // Keep the shorter/cleaner name even when the other entry supplied pin/path.
    if other.name.trim().len() < keep.name.trim().len() {
        keep.name = other.name;
    }
    if path_is_lnk(&keep.path) && !path_is_lnk(&other.path) {
        keep.path = other.path;
    }
    keep
}

/// Final collapse so pin + catalog + registry rows for one exe become a single entry.
#[cfg(windows)]
fn dedupe_by_identity(apps: Vec<InstalledApp>) -> Vec<InstalledApp> {
    let mut map: HashMap<String, InstalledApp> = HashMap::new();
    let mut order: Vec<String> = Vec::new();
    for app in apps {
        let key = identity_key(&app.path);
        if key.is_empty() {
            continue;
        }
        match map.remove(&key) {
            None => {
                order.push(key.clone());
                map.insert(key, app);
            }
            Some(existing) => {
                map.insert(key, prefer_app(&existing, &app));
            }
        }
    }
    order.into_iter().filter_map(|k| map.remove(&k)).collect()
}

#[cfg(windows)]
fn upsert(
    by_identity: &mut HashMap<String, (InstalledApp, u8)>,
    by_name: &mut HashMap<String, String>,
    app: InstalledApp,
    prio: u8,
) {
    if app.name.trim().is_empty() || app.path.trim().is_empty() {
        return;
    }
    if is_noise_name(&app.name) {
        return;
    }
    let id_key = identity_key(&app.path);
    if id_key.is_empty() {
        return;
    }
    // Collapse "HeidiSQL" + "HeidiSQL 12.11.0.7065" even before path resolve.
    let name_key = name_dedupe_key(&app.name);

    if let Some((existing, existing_prio)) = by_identity.get(&id_key).cloned() {
        if prio < existing_prio {
            return;
        }
        let merged = prefer_app(&existing, &app);
        by_name.insert(name_key, id_key.clone());
        by_identity.insert(id_key, (merged, prio.max(existing_prio)));
        return;
    }

    if let Some(other_id) = by_name.get(&name_key).cloned() {
        if other_id != id_key {
            if let Some((other_app, other_prio)) = by_identity.get(&other_id).cloned() {
                if prio >= other_prio {
                    by_identity.remove(&other_id);
                    let merged = prefer_app(&other_app, &app);
                    by_name.insert(name_key, id_key.clone());
                    by_identity.insert(id_key, (merged, prio));
                } else {
                    let merged = prefer_app(&other_app, &app);
                    by_identity.insert(other_id, (merged, other_prio));
                }
                return;
            }
        }
    }

    by_name.insert(name_key, id_key.clone());
    by_identity.insert(id_key, (app, prio));
}

#[cfg(windows)]
fn normalize_key(path: &str) -> String {
    path.trim().to_ascii_lowercase().replace('/', "\\")
}

/// Name key that ignores a trailing version so registry + Start names collapse.
#[cfg(windows)]
fn name_dedupe_key(name: &str) -> String {
    let n = name.trim().to_ascii_lowercase();
    if let Some((base, ver)) = n.rsplit_once(' ') {
        if looks_like_version(ver) {
            return base.trim_end().to_string();
        }
    }
    n
}

#[cfg(windows)]
fn looks_like_version(s: &str) -> bool {
    // Require a dotted version ("12.11.0") so years like "2022" stay distinct.
    s.contains('.')
        && s.chars().any(|c| c.is_ascii_digit())
        && s.chars().all(|c| c.is_ascii_digit() || c == '.')
}

#[cfg(windows)]
fn is_noise_name(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    const NOISE: &[&str] = &[
        "uninstall",
        "uninst",
        "readme",
        "help",
        "documentation",
        "website",
        "release notes",
        "eula",
        "license",
    ];
    NOISE.iter().any(|k| n.contains(k))
}

/// Same catalog as the Start menu “All apps” list (`Get-StartApps`).
#[cfg(windows)]
fn collect_get_start_apps() -> Vec<InstalledApp> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let output = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            "Get-StartApps | Select-Object Name, AppID | ConvertTo-Json -Compress",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output();

    let Ok(output) = output else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    let raw = String::from_utf8_lossy(&output.stdout);
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    #[derive(Deserialize)]
    struct Row {
        #[serde(alias = "Name")]
        name: String,
        #[serde(alias = "AppID")]
        app_id: String,
    }

    let rows: Vec<Row> = if trimmed.starts_with('[') {
        serde_json::from_str(trimmed).unwrap_or_default()
    } else {
        serde_json::from_str::<Row>(trimmed)
            .map(|r| vec![r])
            .unwrap_or_default()
    };

    rows.into_iter()
        .filter_map(|r| {
            let name = r.name.trim().to_string();
            let app_id = r.app_id.trim().to_string();
            if name.is_empty() || app_id.is_empty() {
                return None;
            }
            Some(InstalledApp {
                name,
                path: start_app_launch_path(&app_id),
                pinned: false,
            })
        })
        .collect()
}

/// Map a Start-apps AppID to a launchable path / shell: URI.
#[cfg(windows)]
fn start_app_launch_path(app_id: &str) -> String {
    let id = app_id.trim();
    let looks_like_path = id.contains('\\')
        || id.contains('/')
        || id.to_ascii_lowercase().ends_with(".exe")
        || id.to_ascii_lowercase().ends_with(".lnk");

    if looks_like_path {
        if Path::new(id).exists() {
            return id.to_string();
        }
        // Relative AppIDs sometimes omit the drive root — try common bases.
        for base in [
            std::env::var_os("ProgramFiles"),
            std::env::var_os("ProgramFiles(x86)"),
            std::env::var_os("LocalAppData"),
        ]
        .into_iter()
        .flatten()
        {
            let candidate = PathBuf::from(base).join(id.trim_start_matches('\\'));
            if candidate.exists() {
                return candidate.to_string_lossy().to_string();
            }
        }
    }

    format!("shell:AppsFolder\\{id}")
}

#[cfg(windows)]
fn collect_start_menu_apps() -> Vec<InstalledApp> {
    let mut out = Vec::new();
    let mut roots = Vec::new();
    if let Ok(pd) = std::env::var("ProgramData") {
        roots.push(
            PathBuf::from(pd)
                .join("Microsoft")
                .join("Windows")
                .join("Start Menu")
                .join("Programs"),
        );
    }
    if let Ok(ad) = std::env::var("AppData") {
        roots.push(
            PathBuf::from(ad)
                .join("Microsoft")
                .join("Windows")
                .join("Start Menu")
                .join("Programs"),
        );
    }
    if let Ok(local) = std::env::var("LocalAppData") {
        roots.push(
            PathBuf::from(local)
                .join("Microsoft")
                .join("Windows")
                .join("Start Menu")
                .join("Programs"),
        );
    }
    for root in roots {
        walk_lnk_dir(&root, &mut out);
    }
    out
}

#[cfg(windows)]
fn walk_lnk_dir(dir: &Path, out: &mut Vec<InstalledApp>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk_lnk_dir(&path, out);
            continue;
        }
        let is_lnk = path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("lnk"));
        if !is_lnk {
            continue;
        }
        let Some(name) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let name = name.trim();
        if name.is_empty() {
            continue;
        }
        // Keep the .lnk itself — ShellExecute + SHGetFileInfo handle shortcuts well.
        out.push(InstalledApp {
            name: name.to_string(),
            path: path.to_string_lossy().to_string(),
            pinned: false,
        });
    }
}

#[cfg(windows)]
fn collect_registry_apps() -> Vec<InstalledApp> {
    use winreg::enums::*;
    use winreg::RegKey;

    let mut out = Vec::new();
    let roots: [(RegKey, &str); 3] = [
        (
            RegKey::predef(HKEY_LOCAL_MACHINE),
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        ),
        (
            RegKey::predef(HKEY_LOCAL_MACHINE),
            r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
        ),
        (
            RegKey::predef(HKEY_CURRENT_USER),
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        ),
    ];
    for (root, sub) in roots {
        let Ok(key) = root.open_subkey(sub) else {
            continue;
        };
        for name in key.enum_keys().filter_map(|k| k.ok()) {
            let Ok(subkey) = key.open_subkey(&name) else {
                continue;
            };
            if let Ok(1u32) = subkey.get_value::<u32, _>("SystemComponent") {
                continue;
            }
            let Ok(display_name) = subkey.get_value::<String, _>("DisplayName") else {
                continue;
            };
            let display_name = display_name.trim().to_string();
            if display_name.is_empty() {
                continue;
            }
            let Some(path) = resolve_registry_path(&subkey) else {
                continue;
            };
            out.push(InstalledApp {
                name: display_name,
                path,
                pinned: false,
            });
        }
    }
    out
}

#[cfg(windows)]
fn resolve_registry_path(subkey: &winreg::RegKey) -> Option<String> {
    if let Ok(icon) = subkey.get_value::<String, _>("DisplayIcon") {
        if let Some(p) = clean_display_icon(&icon) {
            let expanded = expand_env_vars(&p);
            if Path::new(&expanded).is_file() {
                return Some(expanded);
            }
        }
    }
    if let Ok(loc) = subkey.get_value::<String, _>("InstallLocation") {
        let loc = expand_env_vars(loc.trim().trim_matches('"'));
        if !loc.is_empty() {
            let dir = Path::new(&loc);
            if dir.is_dir() {
                if let Ok(rd) = std::fs::read_dir(dir) {
                    let exes: Vec<_> = rd
                        .flatten()
                        .map(|e| e.path())
                        .filter(|p| {
                            p.is_file()
                                && p.extension()
                                    .and_then(|e| e.to_str())
                                    .is_some_and(|e| e.eq_ignore_ascii_case("exe"))
                        })
                        .collect();
                    if exes.len() == 1 {
                        return Some(exes[0].to_string_lossy().to_string());
                    }
                }
            }
        }
    }
    None
}

/// Strip quotes and `,0` icon-index suffix from DisplayIcon.
#[cfg(windows)]
fn clean_display_icon(raw: &str) -> Option<String> {
    let mut s = raw.trim().trim_matches('"').to_string();
    if let Some((path, idx)) = s.rsplit_once(',') {
        if idx.chars().all(|c| c == '-' || c.is_ascii_digit()) {
            s = path.trim().trim_matches('"').to_string();
        }
    }
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

/// Expand `%VAR%` segments using the process environment.
#[cfg(windows)]
fn expand_env_vars(input: &str) -> String {
    use windows::core::PCWSTR;
    use windows::Win32::System::Environment::ExpandEnvironmentStringsW;

    let wide: Vec<u16> = input.encode_utf16().chain(Some(0)).collect();
    unsafe {
        let needed = ExpandEnvironmentStringsW(PCWSTR(wide.as_ptr()), None);
        if needed == 0 {
            return input.to_string();
        }
        let mut buf = vec![0u16; needed as usize];
        let written = ExpandEnvironmentStringsW(PCWSTR(wide.as_ptr()), Some(&mut buf));
        if written == 0 {
            return input.to_string();
        }
        let len = (written as usize).saturating_sub(1);
        String::from_utf16_lossy(&buf[..len])
    }
}
