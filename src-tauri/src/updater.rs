//! Self-update for the installed build.
//!
//! Checks the latest GitHub release in the background, downloads it quietly and
//! then turns the tray's version row into "Restart to update". Nothing installs
//! until the user asks — from that row or from Settings → About: a launcher
//! that restarts itself mid-sentence loses whatever was typed into it.

use std::{sync::Mutex, time::Duration};

use serde::Serialize;
use tauri::{menu::MenuItem, AppHandle, Emitter, Manager, Wry};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Out of the way of start-up, which has enough to do in its first seconds.
const FIRST_CHECK_DELAY: Duration = Duration::from_secs(30);
/// A launcher runs for weeks without a restart, so one check per start is not enough.
const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

/// What Settings → About shows. Sent with every change as `updater:status`.
#[derive(Clone, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum Status {
    /// The standalone `.exe` or a dev build: there is nothing to update in place.
    Unsupported,
    Idle,
    Checking,
    Downloading { version: String },
    UpToDate,
    Ready { version: String },
    Failed { message: String },
}

pub struct Updater {
    status: Mutex<Status>,
    pending: Mutex<Option<(Update, Vec<u8>)>>,
    /// The tray's version row, which becomes the restart button.
    row: MenuItem<Wry>,
}

/// Whether this is the NSIS install, told apart from the standalone `.exe` and
/// dev builds by the uninstaller NSIS writes beside the binary. Updating the
/// standalone build would run the installer over it and leave a second,
/// installed copy behind.
fn is_installed() -> bool {
    cfg!(windows)
        && !cfg!(debug_assertions)
        && std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(|dir| dir.join("uninstall.exe").is_file()))
            .unwrap_or(false)
}

/// Manage the updater state and start the background check.
pub fn spawn(app: AppHandle, row: MenuItem<Wry>) {
    let installed = is_installed();
    app.manage(Updater {
        status: Mutex::new(if installed { Status::Idle } else { Status::Unsupported }),
        pending: Mutex::new(None),
        row,
    });
    if !installed {
        return;
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK_DELAY).await;
        loop {
            check(&app, false).await;
            if matches!(status(&app), Status::Ready { .. }) {
                return;
            }
            tokio::time::sleep(CHECK_INTERVAL).await;
        }
    });
}

fn status(app: &AppHandle) -> Status {
    app.try_state::<Updater>()
        .and_then(|updater| updater.status.lock().ok().map(|status| status.clone()))
        .unwrap_or(Status::Unsupported)
}

fn set_status(app: &AppHandle, next: Status) {
    if let Some(updater) = app.try_state::<Updater>() {
        if let Ok(mut status) = updater.status.lock() {
            *status = next.clone();
        }
    }
    let _ = app.emit("updater:status", next);
}

/// Check and, if there is a newer release, download it. `manual` is a check
/// the user asked for: it reports a failure, where the background check stays
/// quiet and simply tries again next round.
async fn check(app: &AppHandle, manual: bool) {
    // One check at a time, and none once a download is waiting.
    {
        let Some(updater) = app.try_state::<Updater>() else {
            return;
        };
        let Ok(mut status) = updater.status.lock() else {
            return;
        };
        match *status {
            Status::Unsupported
            | Status::Checking
            | Status::Downloading { .. }
            | Status::Ready { .. } => return,
            _ => *status = Status::Checking,
        }
    }
    let _ = app.emit("updater:status", Status::Checking);

    match fetch(app).await {
        Ok(Some((update, bytes))) => offer(app, update, bytes),
        Ok(None) => set_status(app, Status::UpToDate),
        Err(error) => {
            // Offline, rate-limited or a release without updater files.
            eprintln!("[updater] check failed: {error}");
            set_status(
                app,
                if manual {
                    Status::Failed {
                        message: error.to_string(),
                    }
                } else {
                    Status::Idle
                },
            );
        }
    }
}

async fn fetch(app: &AppHandle) -> tauri_plugin_updater::Result<Option<(Update, Vec<u8>)>> {
    let shutdown_app = app.clone();
    let updater = app
        .updater_builder()
        // Installing ends the process with `exit(0)`, which skips `RunEvent::Exit`.
        .on_before_exit(move || crate::shutdown(&shutdown_app))
        .build()?;
    let Some(update) = updater.check().await? else {
        return Ok(None);
    };
    set_status(
        app,
        Status::Downloading {
            version: update.version.clone(),
        },
    );
    let bytes = update.download(|_, _| {}, || {}).await?;
    Ok(Some((update, bytes)))
}

fn offer(app: &AppHandle, update: Update, bytes: Vec<u8>) {
    let version = update.version.clone();
    if let Some(updater) = app.try_state::<Updater>() {
        if let Ok(mut pending) = updater.pending.lock() {
            *pending = Some((update, bytes));
        }
        let _ = updater.row.set_text(format!("Restart to update to {version}"));
        let _ = updater.row.set_enabled(true);
    }
    set_status(app, Status::Ready { version: version.clone() });
    let _ = crate::notifications::widget_notification_show(
        format!("Kavibay {version} is ready"),
        "Open the Kavibay tray menu and choose Restart to update.".to_string(),
    );
}

/// Run the downloaded installer. On success the process exits and the installer
/// starts the new version.
pub fn install(app: &AppHandle) -> Result<(), String> {
    let pending = app
        .try_state::<Updater>()
        .and_then(|updater| updater.pending.lock().ok().and_then(|mut pending| pending.take()));
    let Some((update, bytes)) = pending else {
        return Err("No update has been downloaded yet".to_string());
    };
    update.install(bytes).map_err(|error| {
        eprintln!("[updater] install failed: {error}");
        // The download went with the attempt; a new check fetches it again.
        set_status(app, Status::Failed { message: error.to_string() });
        error.to_string()
    })
}

#[tauri::command]
pub fn updater_status(app: AppHandle) -> Status {
    status(&app)
}

/// Start a check the user asked for; progress arrives as `updater:status`.
#[tauri::command]
pub fn updater_check(app: AppHandle) {
    tauri::async_runtime::spawn(async move { check(&app, true).await });
}

#[tauri::command]
pub fn updater_install(app: AppHandle) -> Result<(), String> {
    install(&app)
}
