//! Reviewed host capability for native operating-system notifications.

#[cfg(windows)]
const WINDOWS_NOTIFICATION_APP_ID: &str = "com.aswetlow.kavibay";

const MAX_TITLE_CHARS: usize = 80;
const MAX_BODY_CHARS: usize = 512;

fn validate_text(value: &str, field: &str, max_chars: usize) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("Notification {field} must not be empty"));
    }
    if trimmed.chars().count() > max_chars {
        return Err(format!(
            "Notification {field} must not exceed {max_chars} characters"
        ));
    }
    if trimmed
        .chars()
        .any(|character| character.is_control() && character != '\n' && character != '\r')
    {
        return Err(format!(
            "Notification {field} contains unsupported control characters"
        ));
    }
    Ok(trimmed.to_string())
}

/// Register the unpackaged desktop AUMID used by Windows Notification Center.
///
/// A Tauri NSIS app is a classic Win32 process, so Windows needs this per-user
/// AppUserModelId registration before `ToastNotificationManager` accepts a toast.
#[cfg(windows)]
fn ensure_windows_notification_app() -> Result<(), String> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu
        .create_subkey(format!(
            r"Software\Classes\AppUserModelId\{WINDOWS_NOTIFICATION_APP_ID}"
        ))
        .map_err(|error| format!("Could not register Windows notification app: {error}"))?;
    key.set_value("DisplayName", &"Kavibay")
        .map_err(|error| format!("Could not set notification app name: {error}"))?;
    key.set_value("IconBackgroundColor", &"0")
        .map_err(|error| format!("Could not set notification app icon color: {error}"))?;
    if let Ok(path) = std::env::current_exe() {
        let icon_uri = path.to_string_lossy().to_string();
        key.set_value("IconUri", &icon_uri)
            .map_err(|error| format!("Could not set notification app icon: {error}"))?;
    }
    ensure_windows_notification_shortcut()?;
    Ok(())
}

/// Give the unpackaged Win32 app the AUMID-bearing Start-menu shortcut that
/// Windows uses as the notification endpoint for classic desktop processes.
#[cfg(windows)]
fn ensure_windows_notification_shortcut() -> Result<(), String> {
    use std::{env, fs, os::windows::ffi::OsStrExt, path::PathBuf};
    use windows::core::{Interface, PCWSTR};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{IObjectWithAppUserModelID, IShellLinkW, ShellLink};

    fn wide(value: &std::ffi::OsStr) -> Vec<u16> {
        value.encode_wide().chain(std::iter::once(0)).collect()
    }

    let app_data = env::var_os("APPDATA").ok_or_else(|| {
        "APPDATA is unavailable; cannot register Windows notifications".to_string()
    })?;
    let shortcut_dir = PathBuf::from(app_data)
        .join("Microsoft")
        .join("Windows")
        .join("Start Menu")
        .join("Programs");
    fs::create_dir_all(&shortcut_dir)
        .map_err(|error| format!("Could not create the Start-menu folder: {error}"))?;

    let executable = env::current_exe()
        .map_err(|error| format!("Could not resolve Kavibay executable: {error}"))?;
    let shortcut = shortcut_dir.join("Kavibay.lnk");
    let executable_wide = wide(executable.as_os_str());
    let shortcut_wide = wide(shortcut.as_os_str());
    let app_id_wide = wide(std::ffi::OsStr::new(WINDOWS_NOTIFICATION_APP_ID));
    let description_wide = wide(std::ffi::OsStr::new("Kavibay"));

    let initialized = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok() };
    let result = (|| {
        // SAFETY: COM is initialized for this thread above, and all interfaces
        // are released by Rust when this closure returns.
        let link: IShellLinkW = unsafe { CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER) }
            .map_err(|error| format!("Could not create the notification shortcut: {error}"))?;
        unsafe { link.SetPath(PCWSTR(executable_wide.as_ptr())) }
            .map_err(|error| format!("Could not set the notification shortcut target: {error}"))?;
        unsafe { link.SetDescription(PCWSTR(description_wide.as_ptr())) }.map_err(|error| {
            format!("Could not set the notification shortcut description: {error}")
        })?;

        let app_id: IObjectWithAppUserModelID = link
            .cast()
            .map_err(|error| format!("Could not access the shortcut AppUserModelID: {error}"))?;
        unsafe { app_id.SetAppID(PCWSTR(app_id_wide.as_ptr())) }
            .map_err(|error| format!("Could not set the shortcut AppUserModelID: {error}"))?;

        let persist: IPersistFile = link
            .cast()
            .map_err(|error| format!("Could not persist the notification shortcut: {error}"))?;
        unsafe { persist.Save(PCWSTR(shortcut_wide.as_ptr()), true) }
            .map_err(|error| format!("Could not save the notification shortcut: {error}"))?;
        Ok(())
    })();
    if initialized {
        unsafe { CoUninitialize() };
    }
    result
}

/// Show one notification supplied through the reviewed first-party SDK capability.
#[tauri::command]
pub fn widget_notification_show(title: String, body: String) -> Result<(), String> {
    let title = validate_text(&title, "title", MAX_TITLE_CHARS)?;
    let body = validate_text(&body, "body", MAX_BODY_CHARS)?;

    #[cfg(windows)]
    {
        use tauri_winrt_notification::{Duration, Sound, Toast};

        ensure_windows_notification_app()?;
        Toast::new(WINDOWS_NOTIFICATION_APP_ID)
            .title(&title)
            .text1(&body)
            .duration(Duration::Long)
            .sound(Some(Sound::Default))
            .show()
            .map_err(|error| format!("Could not show Windows notification: {error}"))?;
        Ok(())
    }

    #[cfg(not(windows))]
    {
        let _ = (title, body);
        Err("Native widget notifications are currently available on Windows only".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trims_valid_notification_text() {
        assert_eq!(
            validate_text("  AI Usage  ", "title", 80).unwrap(),
            "AI Usage"
        );
    }

    #[test]
    fn rejects_empty_and_oversized_notification_text() {
        assert!(validate_text("   ", "body", 10).is_err());
        assert!(validate_text("eleven chars", "body", 10).is_err());
    }

    #[test]
    fn permits_newlines_but_rejects_other_control_characters() {
        assert!(validate_text("line one\nline two", "body", 80).is_ok());
        assert!(validate_text("body\u{0007}", "body", 80).is_err());
    }
}
