use super::{artifacts, recording_session::Sessions, CaptureRegion};
use serde::Serialize;
use std::{path::PathBuf, sync::LazyLock, time::Duration};
use tauri::{
    ipc::{Channel, Response},
    Manager,
};
use tauri_plugin_dialog::DialogExt;

static SESSIONS: LazyLock<Sessions> = LazyLock::new(Sessions::default);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Availability {
    supported: bool,
    available: bool,
    reason: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingProgress {
    pub recording_id: String,
    pub phase: &'static str,
    pub elapsed_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordedClip {
    pub clip_id: String,
    pub duration_ms: u64,
    pub width: u32,
    pub height: u32,
    pub bytes: u64,
}

fn require_main(label: &str) -> Result<(), String> {
    if label != "main" {
        return Err("Video sharing is only available in the main window.".into());
    }
    Ok(())
}

fn clip_root(window: &tauri::WebviewWindow) -> Result<PathBuf, String> {
    require_main(window.label())?;
    Ok(crate::paths::data_dir(window.app_handle())?.join("shared-clips"))
}

#[tauri::command]
pub async fn preview_recording_availability(
    window: tauri::WebviewWindow,
) -> Result<Availability, String> {
    require_main(window.label())?;
    #[cfg(any(windows, target_os = "macos"))]
    {
        let cache = crate::paths::cache_dir(window.app_handle())?.join("share-recordings");
        let result = tauri::async_runtime::spawn_blocking(move || {
            super::recording_pipeline::availability(&cache)
        })
        .await
        .map_err(|e| e.to_string())?;
        Ok(Availability {
            supported: true,
            available: result.is_ok(),
            reason: result.err(),
        })
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        Ok(Availability {
            supported: false,
            available: false,
            reason: Some("Video recording is available on Windows and macOS.".into()),
        })
    }
}

#[tauri::command]
pub async fn record_preview_clip(
    window: tauri::WebviewWindow,
    recording_id: String,
    region: CaptureRegion,
    on_event: Channel<RecordingProgress>,
) -> Result<RecordedClip, String> {
    require_main(window.label())?;
    region.validate()?;
    let session = SESSIONS.start(recording_id)?;
    session.check()?;
    #[cfg(any(windows, target_os = "macos"))]
    {
        super::recording_pipeline::record(&window, region, &session, on_event).await
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = on_event;
        Err("Video recording is available on Windows and macOS.".into())
    }
}

#[tauri::command]
pub fn stop_preview_clip(window: tauri::WebviewWindow, recording_id: String) -> Result<(), String> {
    require_main(window.label())?;
    SESSIONS.stop(&recording_id);
    Ok(())
}

#[tauri::command]
pub fn cancel_preview_clip(
    window: tauri::WebviewWindow,
    recording_id: String,
) -> Result<(), String> {
    require_main(window.label())?;
    SESSIONS.cancel(&recording_id);
    Ok(())
}

#[tauri::command]
pub async fn read_preview_clip(
    window: tauri::WebviewWindow,
    clip_id: String,
) -> Result<Response, String> {
    let root = clip_root(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        artifacts::read(&root, &clip_id).map(Response::new)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn copy_preview_clip(
    window: tauri::WebviewWindow,
    clip_id: String,
) -> Result<(), String> {
    let root = clip_root(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let path = artifacts::completed(&root, &clip_id)?;
        let _clipboard_io = crate::extensions::clipboard_widget::system::lock_clipboard_io();
        let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
        for attempt in 0..3 {
            match clipboard.set().file_list(&[path.as_path()]) {
                Ok(()) => return Ok(()),
                Err(e) if attempt == 2 => return Err(format!("Could not copy the video: {e}")),
                Err(_) => std::thread::sleep(Duration::from_millis(50)),
            }
        }
        unreachable!()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn save_preview_clip(
    window: tauri::WebviewWindow,
    clip_id: String,
    title: String,
) -> Result<bool, String> {
    let root = clip_root(&window)?;
    let stem = super::widget_file_stem(&title).unwrap_or_else(|| "kavibay-recording".into());
    tauri::async_runtime::spawn_blocking(move || {
        let source = artifacts::completed(&root, &clip_id)?;
        let target = window
            .dialog()
            .file()
            .set_parent(&window)
            .set_file_name(format!("{stem}.mp4"))
            .add_filter("MP4 video", &["mp4"])
            .blocking_save_file();
        let Some(target) = target else {
            return Ok(false);
        };
        let target = target.into_path().map_err(|e| e.to_string())?;
        if target == source {
            return Ok(true);
        }
        std::fs::copy(source, target).map_err(|e| format!("Could not save the video: {e}"))?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn all_video_commands_are_main_window_only() {
        assert!(require_main("main").is_ok());
        for label in ["quickaction", "widget", "", "Main"] {
            assert!(require_main(label).is_err());
        }
    }
}
