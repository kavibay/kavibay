//! Now Playing widget: Windows SMTC or macOS Music snapshot + transport controls.

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

#[cfg(target_os = "macos")]
mod macos;

#[derive(Serialize, Clone)]
pub struct NowPlayingInfo {
    pub has_session: bool,
    /// "ready", or on macOS "needsConsent" / "denied" while Kavibay may not
    /// script Music. Only a ready source can have a session.
    pub access: &'static str,
    /// The one player this platform can read, for the empty state. None on
    /// Windows, where any app that publishes a media session shows up.
    pub player: Option<&'static str>,
    pub app_name: String,
    pub title: String,
    pub artist: String,
    pub album_art_data_url: Option<String>,
    pub is_playing: bool,
}

/// The last track's cover, so the per-second poll reads it once per track.
///
/// The cover only changes with the track, but reading it meant opening the
/// thumbnail stream and base64-encoding up to 8 MB on every poll. A missing
/// cover is read again after `retry_missing_after`: players often publish it a
/// moment after the title, while a track without artwork never gets one.
#[cfg_attr(not(any(windows, target_os = "macos")), allow(dead_code))]
struct CoverCache(std::sync::Mutex<Option<CoverRead>>);

struct CoverRead {
    track: String,
    cover: Option<String>,
    at: std::time::Instant,
}

#[cfg_attr(not(any(windows, target_os = "macos")), allow(dead_code))]
impl CoverCache {
    const fn new() -> Self {
        Self(std::sync::Mutex::new(None))
    }

    fn get_or_read(
        &self,
        track: &str,
        retry_missing_after: std::time::Duration,
        read: impl FnOnce() -> Option<String>,
    ) -> Option<String> {
        if let Some(last) = &*self.0.lock().unwrap() {
            if last.track == track
                && (last.cover.is_some() || last.at.elapsed() < retry_missing_after)
            {
                return last.cover.clone();
            }
        }
        let cover = read();
        *self.0.lock().unwrap() = Some(CoverRead {
            track: track.to_string(),
            cover: cover.clone(),
            at: std::time::Instant::now(),
        });
        cover
    }
}

#[cfg(any(windows, target_os = "macos"))]
static COVERS: CoverCache = CoverCache::new();

impl NowPlayingInfo {
    /// Creates the quiet payload used when no usable SMTC session exists.
    #[cfg_attr(target_os = "macos", allow(dead_code))]
    fn empty() -> Self {
        Self::empty_for(None)
    }

    /// Nothing playing, ready to read `player` once something plays.
    fn empty_for(player: Option<&'static str>) -> Self {
        Self {
            has_session: false,
            access: "ready",
            player,
            app_name: String::new(),
            title: String::new(),
            artist: String::new(),
            album_art_data_url: None,
            is_playing: false,
        }
    }
}

/// Polls the current media session for the widget host.
#[tauri::command(async)]
pub async fn widget_now_playing(app: tauri::AppHandle) -> Result<NowPlayingInfo, String> {
    #[cfg(windows)]
    {
        let _ = app;
        tauri::async_runtime::spawn_blocking(|| snapshot_windows().map_err(|e| e.to_string()))
            .await
            .map_err(|e| e.to_string())?
    }
    #[cfg(target_os = "macos")]
    {
        macos::snapshot(&app).await
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = app;
        Ok(NowPlayingInfo::empty())
    }
}

/// Asks macOS for consent to script Music. Nothing to ask for elsewhere.
#[tauri::command(async)]
pub async fn now_playing_connect() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos::connect().await
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(())
    }
}

/// Requests the previous track from the current SMTC session.
#[tauri::command(async)]
pub async fn now_playing_prev(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        let _ = app;
        tauri::async_runtime::spawn_blocking(|| {
            control_windows(Control::Prev).map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(target_os = "macos")]
    {
        macos::control(&app, macos::Control::Previous).await
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = app;
        Ok(())
    }
}

/// Toggles playback for the current SMTC session.
#[tauri::command(async)]
pub async fn now_playing_play_pause(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        let _ = app;
        tauri::async_runtime::spawn_blocking(|| {
            control_windows(Control::PlayPause).map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(target_os = "macos")]
    {
        macos::control(&app, macos::Control::PlayPause).await
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = app;
        Ok(())
    }
}

/// Requests the next track from the current SMTC session.
#[tauri::command(async)]
pub async fn now_playing_next(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        let _ = app;
        tauri::async_runtime::spawn_blocking(|| {
            control_windows(Control::Next).map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(target_os = "macos")]
    {
        macos::control(&app, macos::Control::Next).await
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = app;
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
    #[cfg(target_os = "macos")]
    {
        macos::open_music()
    }
    #[cfg(not(any(windows, target_os = "macos")))]
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

    let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?.join()?;
    let session = match manager.GetCurrentSession() {
        Ok(session) => session,
        Err(_) => return Ok(NowPlayingInfo::empty()),
    };

    let app_name = session
        .SourceAppUserModelId()
        .map(|value| value.to_string())
        .unwrap_or_default();

    let properties = session.TryGetMediaPropertiesAsync()?.join()?;
    let title = properties
        .Title()
        .map(|value| value.to_string())
        .unwrap_or_default();
    let artist = properties
        .Artist()
        .map(|value| value.to_string())
        .unwrap_or_default();
    let album = properties
        .AlbumTitle()
        .map(|value| value.to_string())
        .unwrap_or_default();
    let track = [app_name.as_str(), &title, &artist, &album].join("\0");
    let album_art_data_url = COVERS.get_or_read(&track, std::time::Duration::ZERO, || {
        match properties.Thumbnail() {
            Ok(thumbnail) => match thumbnail.OpenReadAsync() {
                Ok(operation) => match operation.join() {
                    Ok(stream) => read_thumbnail_data_url(stream).ok(),
                    Err(_) => None,
                },
                Err(_) => None,
            },
            Err(_) => None,
        }
    });

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
        ..NowPlayingInfo::empty()
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
    reader.LoadAsync(size as u32)?.join()?;
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

    let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?.join()?;
    let session = match manager.GetCurrentSession() {
        Ok(session) => session,
        Err(_) => return Ok(()),
    };

    match action {
        Control::Prev => {
            let _ = session.TrySkipPreviousAsync()?.join()?;
        }
        Control::Next => {
            let _ = session.TrySkipNextAsync()?.join()?;
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
                let _ = session.TryPauseAsync()?.join()?;
            } else {
                let _ = session.TryPlayAsync()?.join()?;
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

    let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?.join()?;
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

#[cfg(test)]
mod tests {
    use super::CoverCache;
    use std::cell::Cell;
    use std::time::Duration;

    #[test]
    fn a_cover_is_read_once_per_track() {
        let covers = CoverCache::new();
        let reads = Cell::new(0);
        let read = |cover: Option<&str>| {
            reads.set(reads.get() + 1);
            cover.map(str::to_string)
        };
        let every_poll = Duration::ZERO;

        // The player has not published the cover yet: ask again next poll.
        assert_eq!(covers.get_or_read("a", every_poll, || read(None)), None);
        assert_eq!(
            covers.get_or_read("a", every_poll, || read(Some("art-a"))),
            Some("art-a".into())
        );
        assert_eq!(
            covers.get_or_read("a", every_poll, || read(Some("other"))),
            Some("art-a".into())
        );
        assert_eq!(
            reads.get(),
            2,
            "the second poll of a known cover reads nothing"
        );

        assert_eq!(
            covers.get_or_read("b", every_poll, || read(Some("art-b"))),
            Some("art-b".into())
        );
        assert_eq!(reads.get(), 3, "a new track reads its own cover");
    }

    #[test]
    fn a_missing_cover_waits_before_the_next_read() {
        let covers = CoverCache::new();
        let reads = Cell::new(0);
        let read = || {
            reads.set(reads.get() + 1);
            None
        };
        let later = Duration::from_secs(60);

        assert_eq!(covers.get_or_read("a", later, read), None);
        assert_eq!(covers.get_or_read("a", later, read), None);
        assert_eq!(
            reads.get(),
            1,
            "a track without artwork is not read every poll"
        );
        assert_eq!(covers.get_or_read("b", later, read), None);
        assert_eq!(reads.get(), 2, "a new track reads its own cover");
    }
}
