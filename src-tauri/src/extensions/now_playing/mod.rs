//! Now Playing widget: Windows SMTC snapshot + transport controls.

use super::ExtensionRust;

/// The uniform entry point: which root folder this belongs to, and what the
/// host declares on its behalf. Empty lists are the statement, not an
/// omission — this extension reaches no network host through the host layer.
pub const EXTENSION: ExtensionRust = ExtensionRust {
    folder: "now-playing",
    capabilities: &[],
};

// Only the SMTC album-art encoder needs base64, and SMTC is Windows-only.
#[cfg(windows)]
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct NowPlayingInfo {
    pub has_session: bool,
    pub app_name: String,
    pub title: String,
    pub artist: String,
    pub album_art_data_url: Option<String>,
    pub is_playing: bool,
}

impl NowPlayingInfo {
    /// Creates the quiet payload used when no usable SMTC session exists.
    fn empty() -> Self {
        Self {
            has_session: false,
            app_name: String::new(),
            title: String::new(),
            artist: String::new(),
            album_art_data_url: None,
            is_playing: false,
        }
    }
}

/// Polls the current SMTC session for the widget host.
#[tauri::command(async)]
pub async fn widget_now_playing() -> Result<NowPlayingInfo, String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(|| snapshot_windows().map_err(|e| e.to_string()))
            .await
            .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        Ok(NowPlayingInfo::empty())
    }
}

/// Requests the previous track from the current SMTC session.
#[tauri::command(async)]
pub async fn now_playing_prev() -> Result<(), String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(|| {
            control_windows(Control::Prev).map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        Ok(())
    }
}

/// Toggles playback for the current SMTC session.
#[tauri::command(async)]
pub async fn now_playing_play_pause() -> Result<(), String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(|| {
            control_windows(Control::PlayPause).map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        Ok(())
    }
}

/// Requests the next track from the current SMTC session.
#[tauri::command(async)]
pub async fn now_playing_next() -> Result<(), String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(|| {
            control_windows(Control::Next).map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        Ok(())
    }
}

/// Best-effort opens or focuses the source application via its AppsFolder AUMID.
#[tauri::command(async)]
pub async fn now_playing_open_source() -> Result<(), String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(|| open_source_windows().map_err(|e| e.to_string()))
            .await
            .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        Ok(())
    }
}

#[cfg(windows)]
enum Control {
    Prev,
    PlayPause,
    Next,
}

/// Captures metadata, playback state, and optional artwork from SMTC.
#[cfg(windows)]
fn snapshot_windows() -> windows::core::Result<NowPlayingInfo> {
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSessionManager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus,
    };

    let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?.get()?;
    let session = match manager.GetCurrentSession() {
        Ok(session) => session,
        Err(_) => return Ok(NowPlayingInfo::empty()),
    };

    let app_name = session
        .SourceAppUserModelId()
        .map(|value| value.to_string())
        .unwrap_or_default();

    let properties = session.TryGetMediaPropertiesAsync()?.get()?;
    let title = properties
        .Title()
        .map(|value| value.to_string())
        .unwrap_or_default();
    let artist = properties
        .Artist()
        .map(|value| value.to_string())
        .unwrap_or_default();
    let album_art_data_url = match properties.Thumbnail() {
        Ok(thumbnail) => match thumbnail.OpenReadAsync() {
            Ok(operation) => match operation.get() {
                Ok(stream) => read_thumbnail_data_url(stream).ok(),
                Err(_) => None,
            },
            Err(_) => None,
        },
        Err(_) => None,
    };

    let is_playing = session
        .GetPlaybackInfo()
        .ok()
        .and_then(|info| info.PlaybackStatus().ok())
        .map(|status| status == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing)
        .unwrap_or(false);

    let has_session = !title.is_empty() || !artist.is_empty() || !app_name.is_empty() || is_playing;
    if !has_session {
        return Ok(NowPlayingInfo::empty());
    }

    Ok(NowPlayingInfo {
        has_session: true,
        app_name,
        title,
        artist,
        album_art_data_url,
        is_playing,
    })
}

/// Converts a thumbnail stream into a bounded base64 image data URL.
#[cfg(windows)]
fn read_thumbnail_data_url(
    stream: windows::Storage::Streams::IRandomAccessStreamWithContentType,
) -> windows::core::Result<String> {
    use windows::Storage::Streams::DataReader;

    let size = stream.Size()?;
    if size == 0 || size > 8 * 1024 * 1024 {
        return Err(windows::core::Error::from(windows::core::HRESULT(0)));
    }

    let content_type = stream
        .ContentType()
        .map(|value| value.to_string())
        .unwrap_or_else(|_| "image/png".to_string());
    let mime = if content_type.starts_with("image/") {
        content_type
    } else {
        "image/png".to_string()
    };

    let reader = DataReader::CreateDataReader(&stream)?;
    reader.LoadAsync(size as u32)?.get()?;
    let mut bytes = vec![0_u8; size as usize];
    reader.ReadBytes(&mut bytes)?;
    Ok(format!("data:{mime};base64,{}", B64.encode(bytes)))
}

/// Sends a transport request to the active SMTC session.
#[cfg(windows)]
fn control_windows(action: Control) -> windows::core::Result<()> {
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSessionManager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus,
    };

    let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?.get()?;
    let session = match manager.GetCurrentSession() {
        Ok(session) => session,
        Err(_) => return Ok(()),
    };

    match action {
        Control::Prev => {
            let _ = session.TrySkipPreviousAsync()?.get()?;
        }
        Control::Next => {
            let _ = session.TrySkipNextAsync()?.get()?;
        }
        Control::PlayPause => {
            let playing = session
                .GetPlaybackInfo()
                .ok()
                .and_then(|info| info.PlaybackStatus().ok())
                .map(|status| {
                    status == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing
                })
                .unwrap_or(false);
            if playing {
                let _ = session.TryPauseAsync()?.get()?;
            } else {
                let _ = session.TryPlayAsync()?.get()?;
            }
        }
    }
    Ok(())
}

/// Opens the current session's AUMID through the Windows AppsFolder shell namespace.
#[cfg(windows)]
fn open_source_windows() -> windows::core::Result<()> {
    use windows::core::HSTRING;
    use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?.get()?;
    let session = match manager.GetCurrentSession() {
        Ok(session) => session,
        Err(_) => return Ok(()),
    };
    let aumid = session.SourceAppUserModelId()?.to_string();
    if aumid.is_empty() {
        return Ok(());
    }

    let target = HSTRING::from(format!("shell:AppsFolder\\{aumid}"));
    unsafe {
        ShellExecuteW(
            Some(HWND::default()),
            windows::core::w!("open"),
            &target,
            None,
            None,
            SW_SHOWNORMAL,
        );
    }
    Ok(())
}
