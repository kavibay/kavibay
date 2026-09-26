//! Apple Music on macOS, read and controlled through AppleScript.
//!
//! macOS has no public API for the system's now-playing session, and the
//! private one (MediaRemote) stopped answering third-party apps in macOS 15.4.
//! Music is scriptable instead. That needs the user's consent under Privacy &
//! Security › Automation, which macOS asks for the first time an app sends
//! Music an Apple Event. Kavibay asks only when the user clicks Connect in the
//! widget or runs a media command. A poll never raises the dialog and never
//! starts Music: it checks consent and whether Music runs before any event.

use std::cell::RefCell;
use std::collections::HashMap;

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use objc2::rc::Retained;
use objc2::{msg_send, AllocAnyThread};
use objc2_foundation::{NSAppleEventDescriptor, NSAppleScript, NSDictionary, NSString};
use tauri::AppHandle;

use super::{NowPlayingInfo, COVERS};

pub const PLAYER: &str = "Music";
const MUSIC_BUNDLE_ID: &str = "com.apple.Music";
const DENIED: &str = "Kavibay may not control Music. Allow it under System Settings › Privacy & Security › Automation.";

/// Whether Kavibay may send Music Apple Events right now.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Access {
    NotRunning,
    Granted,
    NeedsConsent,
    Denied,
}

/// Asks TCC, never Music. With `ask`, macOS shows the consent dialog if the
/// user has not answered yet, and this blocks until they do.
pub fn access(ask: bool) -> Access {
    use ffi::*;

    let mut target = AEDesc {
        descriptor_type: TYPE_NULL,
        data_handle: std::ptr::null_mut(),
    };
    let id = MUSIC_BUNDLE_ID.as_bytes();
    // SAFETY: `target` is a valid out-parameter, and AECreateDesc copies `id`.
    let made = unsafe {
        AECreateDesc(
            TYPE_APPLICATION_BUNDLE_ID,
            id.as_ptr().cast(),
            id.len() as isize,
            &mut target,
        )
    };
    if made != 0 {
        return Access::NotRunning;
    }
    // Get Data is the event the snapshot sends. Consent is granted per target
    // app, not per event, so it covers the transport commands too.
    // SAFETY: `target` holds the descriptor made above, disposed right after.
    let status = unsafe {
        let status = AEDeterminePermissionToAutomateTarget(
            &target,
            K_AE_CORE_SUITE,
            K_AE_GET_DATA,
            u8::from(ask),
        );
        AEDisposeDesc(&mut target);
        status
    };
    match status {
        NO_ERR => Access::Granted,
        PROC_NOT_FOUND => Access::NotRunning,
        ERR_AE_EVENT_WOULD_REQUIRE_USER_CONSENT => Access::NeedsConsent,
        _ => Access::Denied,
    }
}

/// The widget's poll. Sends Music events only once consent is given.
pub async fn snapshot(app: &AppHandle) -> Result<NowPlayingInfo, String> {
    let state = match tauri::async_runtime::spawn_blocking(|| access(false))
        .await
        .map_err(|e| e.to_string())?
    {
        Access::Granted => return on_main(app, read_music).await?,
        Access::NotRunning => "ready",
        Access::NeedsConsent => "needsConsent",
        Access::Denied => "denied",
    };
    Ok(NowPlayingInfo {
        access: state,
        ..NowPlayingInfo::empty_for(Some(PLAYER))
    })
}

/// Shows the consent dialog if the user has not answered yet.
pub async fn connect() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| access(true))
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub enum Control {
    Previous,
    PlayPause,
    Next,
}

/// A media command. It is the user's own action, so it may ask for consent.
pub async fn control(app: &AppHandle, action: Control) -> Result<(), String> {
    let granted = tauri::async_runtime::spawn_blocking(|| match access(false) {
        Access::NeedsConsent => access(true),
        other => other,
    })
    .await
    .map_err(|e| e.to_string())?;
    match granted {
        Access::NotRunning => Ok(()),
        Access::NeedsConsent | Access::Denied => Err(DENIED.to_string()),
        Access::Granted => {
            let script = match action {
                Control::Previous => PREVIOUS,
                Control::PlayPause => PLAY_PAUSE,
                Control::Next => NEXT,
            };
            on_main(app, move || run(script).map(drop)).await?
        }
    }
}

/// Opens Music through Launch Services, which needs no Automation consent.
pub fn open_music() -> Result<(), String> {
    std::process::Command::new("open")
        .args(["-b", MUSIC_BUNDLE_ID])
        .status()
        .map_err(|e| e.to_string())
        .and_then(|status| {
            status
                .success()
                .then_some(())
                .ok_or_else(|| format!("open exited with {status}"))
        })
}

const SNAPSHOT: &str = r#"if application "Music" is not running then return {}
tell application "Music"
	set isPlaying to player state is playing
	if player state is stopped then return {isPlaying}
	try
		set t to current track
	on error
		return {isPlaying}
	end try
	return {isPlaying, name of t, artist of t, album of t, persistent ID of t}
end tell"#;

const ARTWORK: &str = r#"if application "Music" is not running then return
tell application "Music"
	try
		return raw data of artwork 1 of current track
	end try
end tell"#;

const PREVIOUS: &str =
    r#"if application "Music" is running then tell application "Music" to previous track"#;
const PLAY_PAUSE: &str =
    r#"if application "Music" is running then tell application "Music" to playpause"#;
const NEXT: &str =
    r#"if application "Music" is running then tell application "Music" to next track"#;

/// Runs on the main thread: NSAppleScript is documented as main-thread only.
fn read_music() -> Result<NowPlayingInfo, String> {
    let result = run(SNAPSHOT)?;
    let item = |index: isize| result.descriptorAtIndex(index);
    let text = |index: isize| {
        item(index)
            .and_then(|value| value.stringValue())
            .map(|value| value.to_string())
            .unwrap_or_default()
    };
    // Music is not running, is stopped, or has no current track.
    if result.numberOfItems() < 5 {
        return Ok(NowPlayingInfo::empty_for(Some(PLAYER)));
    }
    let is_playing = item(1).is_some_and(|value| value.booleanValue() != 0);
    let track = text(5);
    Ok(NowPlayingInfo {
        has_session: true,
        app_name: PLAYER.to_string(),
        title: text(2),
        artist: text(3),
        album_art_data_url: COVERS.get_or_read(&track, read_artwork),
        is_playing,
        ..NowPlayingInfo::empty_for(Some(PLAYER))
    })
}

fn read_artwork() -> Option<String> {
    let data = run(ARTWORK).ok()?.data();
    let bytes = data.to_vec();
    let mime = if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "image/jpeg"
    } else if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        "image/png"
    } else {
        return None;
    };
    (bytes.len() <= 8 * 1024 * 1024).then(|| format!("data:{mime};base64,{}", B64.encode(bytes)))
}

thread_local! {
    /// Compiled once per script: compiling reads Music's dictionary (12 ms
    /// measured), and the snapshot runs every second while the widget shows.
    static COMPILED: RefCell<HashMap<&'static str, Retained<NSAppleScript>>> =
        RefCell::new(HashMap::new());
}

fn run(source: &'static str) -> Result<Retained<NSAppleEventDescriptor>, String> {
    let script = COMPILED.with_borrow_mut(|compiled| {
        compiled
            .entry(source)
            .or_insert_with(|| {
                NSAppleScript::initWithSource(NSAppleScript::alloc(), &NSString::from_str(source))
                    .expect("NSAppleScript accepts any source string")
            })
            .clone()
    });
    let mut error: Option<Retained<NSDictionary<NSString, objc2::runtime::AnyObject>>> = None;
    // Declared nonnull in the header, but nil on failure: read it as optional.
    // SAFETY: the error out-parameter has the type the method documents.
    let result: Option<Retained<NSAppleEventDescriptor>> =
        unsafe { msg_send![&*script, executeAndReturnError: Some(&mut error)] };
    result.ok_or_else(|| {
        error
            .and_then(|info| info.objectForKey(&NSString::from_str("NSAppleScriptErrorMessage")))
            .map(|message| format!("{message:?}"))
            .unwrap_or_else(|| "Music did not answer".to_string())
    })
}

/// Runs `f` on the main thread and waits for it without blocking the runtime.
async fn on_main<T: Send + 'static>(
    app: &AppHandle,
    f: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(f());
    })
    .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || rx.recv())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

mod ffi {
    use std::ffi::c_void;

    /// AEDataModel.h packs to 2 bytes: 12 bytes, handle at offset 4 (measured).
    #[repr(C, packed(2))]
    pub struct AEDesc {
        pub descriptor_type: u32,
        pub data_handle: *mut c_void,
    }

    pub const TYPE_NULL: u32 = u32::from_be_bytes(*b"null");
    pub const TYPE_APPLICATION_BUNDLE_ID: u32 = u32::from_be_bytes(*b"bund");
    pub const K_AE_CORE_SUITE: u32 = u32::from_be_bytes(*b"core");
    pub const K_AE_GET_DATA: u32 = u32::from_be_bytes(*b"getd");
    pub const NO_ERR: i32 = 0;
    pub const PROC_NOT_FOUND: i32 = -600;
    pub const ERR_AE_EVENT_WOULD_REQUIRE_USER_CONSENT: i32 = -1744;

    #[link(name = "CoreServices", kind = "framework")]
    extern "C" {
        pub fn AECreateDesc(
            type_code: u32,
            data: *const c_void,
            size: isize,
            result: *mut AEDesc,
        ) -> i16;
        pub fn AEDisposeDesc(desc: *mut AEDesc) -> i16;
        pub fn AEDeterminePermissionToAutomateTarget(
            target: *const AEDesc,
            event_class: u32,
            event_id: u32,
            ask_user_if_needed: u8,
        ) -> i32;
    }
}
