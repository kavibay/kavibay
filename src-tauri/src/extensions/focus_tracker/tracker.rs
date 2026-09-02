//! Win32 foreground + idle poller that opens/closes focus sessions in SQLite.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use super::db::{self, FocusDb};

// The poller itself is Win32-only, so its tuning constants and pure decision
// helpers below are compiled for Windows and for tests — the rules are worth
// pinning on every platform, the Win32 loop that consumes them is not.

/// Idle pause after this many milliseconds without keyboard/mouse input.
#[cfg(any(windows, test))]
pub const IDLE_THRESHOLD_MS: u64 = 5 * 60 * 1000;
/// Poll interval for foreground + idle sampling.
#[cfg(windows)]
pub const POLL_INTERVAL: Duration = Duration::from_millis(500);
/// Title (and same-app key) must stay stable this long before a session split.
#[cfg(any(windows, test))]
pub const TITLE_DEBOUNCE: Duration = Duration::from_millis(400);

/// Managed tracker status + current open session bookkeeping.
pub struct FocusTrackerState {
    /// True when the Win32 poller is running (false on non-Windows / startup failure).
    pub available: AtomicBool,
    /// True while idle ≥ 5 minutes (no input).
    pub idle: AtomicBool,
    /// Set by `shutdown_tracker`; poll loop exits when true.
    stop: AtomicBool,
    /// Join handle for the poll thread (Windows only when running).
    thread: Mutex<Option<JoinHandle<()>>>,
    inner: Mutex<TrackerInner>,
}

struct TrackerInner {
    current_session_id: Option<i64>,
    committed_key: Option<FocusKey>,
    pending: Option<(FocusKey, Instant)>,
}

/// Focus identity used for session boundaries.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FocusKey {
    pub app_name: String,
    pub window_title: String,
}

/// Outcome of debounce evaluation for one observed sample.
#[cfg(any(windows, test))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DebounceAction {
    /// Keep the current committed session.
    Hold,
    /// Commit a new focus key (close previous + open new).
    Commit(FocusKey),
    /// Clear focus (close open session; no new row).
    Clear,
}

impl FocusTrackerState {
    /// Creates idle tracker state (available/idle false until `start_tracker`).
    pub fn new() -> Self {
        Self {
            available: AtomicBool::new(false),
            idle: AtomicBool::new(false),
            stop: AtomicBool::new(false),
            thread: Mutex::new(None),
            inner: Mutex::new(TrackerInner {
                current_session_id: None,
                committed_key: None,
                pending: None,
            }),
        }
    }
}

impl Default for FocusTrackerState {
    fn default() -> Self {
        Self::new()
    }
}

/// Idle when last-input age is at least the threshold.
#[cfg(any(windows, test))]
pub fn is_idle(idle_ms: u64, threshold_ms: u64) -> bool {
    idle_ms >= threshold_ms
}

/// Tick-count idle age with wraparound-safe subtraction (`GetTickCount` style).
#[cfg(any(windows, test))]
pub fn idle_duration_ms(tick_now: u32, last_input_tick: u32) -> u64 {
    tick_now.wrapping_sub(last_input_tick) as u64
}

/// Pure debounce: app switches commit immediately; same-app title changes need stability.
#[cfg(any(windows, test))]
pub fn evaluate_debounce(
    committed: Option<&FocusKey>,
    pending: &mut Option<(FocusKey, Instant)>,
    observed: Option<FocusKey>,
    now: Instant,
    debounce: Duration,
) -> DebounceAction {
    let Some(observed) = observed else {
        *pending = None;
        return DebounceAction::Clear;
    };

    if committed.is_some_and(|c| c == &observed) {
        *pending = None;
        return DebounceAction::Hold;
    }

    // New focus or different app → commit immediately (no title flicker).
    let app_changed = match committed {
        None => true,
        Some(c) => c.app_name != observed.app_name,
    };
    if app_changed {
        *pending = None;
        return DebounceAction::Commit(observed);
    }

    // Same app, different title → require stable pending window.
    match pending {
        Some((key, since)) if key == &observed => {
            if now.duration_since(*since) >= debounce {
                *pending = None;
                DebounceAction::Commit(observed)
            } else {
                DebounceAction::Hold
            }
        }
        _ => {
            *pending = Some((observed, now));
            DebounceAction::Hold
        }
    }
}

/// True when the foreground target should not open a session row.
#[cfg(any(windows, test))]
pub fn is_unresolved_focus(app_name: &str, class_name: &str) -> bool {
    if app_name.is_empty() {
        return true;
    }
    matches!(class_name, "Progman" | "WorkerW")
}

/// Recovers crash-open sessions, then starts the Win32 poll thread (no-op elsewhere).
pub fn start_tracker(db: Arc<FocusDb>, state: Arc<FocusTrackerState>) {
    #[cfg(not(windows))]
    {
        let _ = db;
        state.stop.store(false, Ordering::SeqCst);
        state.available.store(false, Ordering::SeqCst);
        state.idle.store(false, Ordering::SeqCst);
    }

    #[cfg(windows)]
    {
        // Allow a fresh start after a prior shutdown.
        state.stop.store(false, Ordering::SeqCst);

        if let Err(error) = db.with_conn(|conn| db::close_any_open(conn, now_ms()).map(|_| ())) {
            eprintln!("[focus_tracker] close_any_open on startup failed: {error}");
            state.available.store(false, Ordering::SeqCst);
            return;
        }
        state.available.store(true, Ordering::SeqCst);
        state.idle.store(false, Ordering::SeqCst);

        let state_thread = Arc::clone(&state);
        let db_thread = Arc::clone(&db);
        let handle = std::thread::Builder::new()
            .name("focus-tracker".into())
            .spawn(move || poll_loop(db_thread, state_thread))
            .expect("failed to spawn focus-tracker thread");
        if let Ok(mut slot) = state.thread.lock() {
            *slot = Some(handle);
        }
    }
}

/// Stops the poll thread (join), then best-effort closes any open session.
pub fn shutdown_tracker(db: &FocusDb, state: &FocusTrackerState) {
    // Signal first so the loop cannot open another session after we join.
    state.stop.store(true, Ordering::SeqCst);
    state.available.store(false, Ordering::SeqCst);

    if let Ok(mut slot) = state.thread.lock() {
        if let Some(handle) = slot.take() {
            if handle.join().is_err() {
                eprintln!("[focus_tracker] poll thread join panicked");
            }
        }
    }

    if let Ok(mut inner) = state.inner.lock() {
        inner.current_session_id = None;
        inner.committed_key = None;
        inner.pending = None;
    }
    if let Err(error) = db.with_conn(|conn| db::close_any_open(conn, now_ms()).map(|_| ())) {
        eprintln!("[focus_tracker] shutdown close_any_open failed: {error}");
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(windows)]
fn poll_loop(db: Arc<FocusDb>, state: Arc<FocusTrackerState>) {
    let mut fg_cache: Option<ForegroundCache> = None;

    loop {
        if state.stop.load(Ordering::SeqCst) {
            break;
        }
        std::thread::sleep(POLL_INTERVAL);
        if state.stop.load(Ordering::SeqCst) {
            break;
        }

        let sample_now = Instant::now();
        let ts = now_ms();

        let idle_ms = match read_idle_ms() {
            Some(ms) => ms,
            None => continue,
        };

        if is_idle(idle_ms, IDLE_THRESHOLD_MS) {
            state.idle.store(true, Ordering::SeqCst);
            close_current(&db, &state, ts);
            fg_cache = None;
            continue;
        }

        state.idle.store(false, Ordering::SeqCst);

        let observed = read_foreground_focus(&mut fg_cache);
        apply_focus_sample(&db, &state, observed, sample_now, ts);
    }
}

#[cfg(windows)]
fn apply_focus_sample(
    db: &FocusDb,
    state: &FocusTrackerState,
    observed: Option<FocusKey>,
    sample_now: Instant,
    ts: i64,
) {
    // Read rules from the shared DB so a new exclusion takes effect without
    // restarting the Win32 poller. On a lookup failure, keep tracking instead.
    let observed = observed.and_then(|key| {
        match db.with_conn(|conn| db::is_ignored(conn, &key.app_name, &key.window_title)) {
            Ok(true) => None,
            Ok(false) => Some(key),
            Err(error) => {
                eprintln!("[focus_tracker] ignore rule lookup failed: {error}");
                Some(key)
            }
        }
    });

    let Ok(mut inner) = state.inner.lock() else {
        return;
    };

    let committed = inner.committed_key.clone();
    let action = evaluate_debounce(
        committed.as_ref(),
        &mut inner.pending,
        observed,
        sample_now,
        TITLE_DEBOUNCE,
    );

    match action {
        DebounceAction::Hold => {}
        DebounceAction::Clear => {
            if let Some(id) = inner.current_session_id.take() {
                if let Err(error) = db.with_conn(|conn| db::close_session(conn, id, ts)) {
                    eprintln!("[focus_tracker] close_session failed: {error}");
                }
            }
            inner.committed_key = None;
        }
        DebounceAction::Commit(key) => {
            if let Some(id) = inner.current_session_id.take() {
                if let Err(error) = db.with_conn(|conn| db::close_session(conn, id, ts)) {
                    eprintln!("[focus_tracker] close_session failed: {error}");
                }
            }
            match db.with_conn(|conn| {
                db::insert_open_session(conn, &key.app_name, &key.window_title, ts)
            }) {
                Ok(id) => {
                    inner.current_session_id = Some(id);
                    inner.committed_key = Some(key);
                }
                Err(error) => {
                    eprintln!("[focus_tracker] insert_open_session failed: {error}");
                    inner.committed_key = None;
                }
            }
        }
    }
}

#[cfg(windows)]
fn close_current(db: &FocusDb, state: &FocusTrackerState, ts: i64) {
    let Ok(mut inner) = state.inner.lock() else {
        return;
    };
    if let Some(id) = inner.current_session_id.take() {
        if let Err(error) = db.with_conn(|conn| db::close_session(conn, id, ts)) {
            eprintln!("[focus_tracker] close_session on idle failed: {error}");
        }
    }
    inner.committed_key = None;
    inner.pending = None;
}

/// Cached foreground identity so unchanged HWND skips OpenProcess.
#[cfg(windows)]
struct ForegroundCache {
    hwnd: isize,
    app_name: String,
}

#[cfg(windows)]
fn read_idle_ms() -> Option<u64> {
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};

    unsafe {
        let mut info = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        // BOOL::ok → Result; convert to Option for this helper.
        GetLastInputInfo(&mut info).ok().ok()?;
        Some(idle_duration_ms(GetTickCount(), info.dwTime))
    }
}

#[cfg(windows)]
fn read_foreground_focus(cache: &mut Option<ForegroundCache>) -> Option<FocusKey> {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetForegroundWindow, GetWindowThreadProcessId,
    };

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            *cache = None;
            return None;
        }
        let hwnd_key = hwnd.0 as isize;

        // Same HWND: reuse process name; only re-read the title (tab changes).
        if let Some(cached) = cache.as_ref() {
            if cached.hwnd == hwnd_key {
                let window_title = read_window_title(hwnd);
                return Some(FocusKey {
                    app_name: cached.app_name.clone(),
                    window_title,
                });
            }
        }

        let mut class_buf = [0u16; 256];
        let class_len = GetClassNameW(hwnd, &mut class_buf);
        let class_name = if class_len > 0 {
            String::from_utf16_lossy(&class_buf[..class_len as usize])
        } else {
            String::new()
        };

        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            *cache = None;
            return None;
        }

        let app_name = process_base_name(pid)?;
        if is_unresolved_focus(&app_name, &class_name) {
            *cache = None;
            return None;
        }

        let window_title = read_window_title(hwnd);
        *cache = Some(ForegroundCache {
            hwnd: hwnd_key,
            app_name: app_name.clone(),
        });

        Some(FocusKey {
            app_name,
            window_title,
        })
    }
}

/// Reads the UTF-16 window title for `hwnd` (empty string when none).
#[cfg(windows)]
fn read_window_title(hwnd: windows::Win32::Foundation::HWND) -> String {
    use windows::Win32::UI::WindowsAndMessaging::{GetWindowTextLengthW, GetWindowTextW};

    unsafe {
        let title_len = GetWindowTextLengthW(hwnd);
        if title_len <= 0 {
            return String::new();
        }
        let mut title_buf = vec![0u16; (title_len as usize) + 1];
        let copied = GetWindowTextW(hwnd, &mut title_buf);
        if copied > 0 {
            String::from_utf16_lossy(&title_buf[..copied as usize])
        } else {
            String::new()
        }
    }
}

#[cfg(windows)]
fn process_base_name(pid: u32) -> Option<String> {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };

    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut size = buf.len() as u32;
        let result = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            PWSTR(buf.as_mut_ptr()),
            &mut size,
        );
        let _ = CloseHandle(handle);
        result.ok()?;
        let path = String::from_utf16_lossy(&buf[..size as usize]);
        let file_name = std::path::Path::new(&path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(&path);
        let stem = file_name
            .strip_suffix(".exe")
            .or_else(|| file_name.strip_suffix(".EXE"))
            .unwrap_or(file_name);
        if stem.is_empty() {
            None
        } else {
            Some(stem.to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idle_threshold_boundary() {
        assert!(!is_idle(IDLE_THRESHOLD_MS - 1, IDLE_THRESHOLD_MS));
        assert!(is_idle(IDLE_THRESHOLD_MS, IDLE_THRESHOLD_MS));
        assert!(is_idle(IDLE_THRESHOLD_MS + 1, IDLE_THRESHOLD_MS));
    }

    #[test]
    fn idle_duration_wraps() {
        assert_eq!(idle_duration_ms(10, 5), 5);
        assert_eq!(idle_duration_ms(5, u32::MAX - 4), 10);
    }

    #[test]
    fn unresolved_desktop_classes() {
        assert!(is_unresolved_focus("", "Notepad"));
        assert!(is_unresolved_focus("explorer", "Progman"));
        assert!(is_unresolved_focus("explorer", "WorkerW"));
        assert!(!is_unresolved_focus("Code", "Chrome_WidgetWin_1"));
    }

    #[test]
    fn debounce_app_switch_is_immediate() {
        let mut pending = None;
        let now = Instant::now();
        let committed = FocusKey {
            app_name: "chrome".into(),
            window_title: "A".into(),
        };
        let observed = FocusKey {
            app_name: "code".into(),
            window_title: "main.rs".into(),
        };
        let action = evaluate_debounce(
            Some(&committed),
            &mut pending,
            Some(observed.clone()),
            now,
            TITLE_DEBOUNCE,
        );
        assert_eq!(action, DebounceAction::Commit(observed));
        assert!(pending.is_none());
    }

    #[test]
    fn debounce_title_change_waits_then_commits() {
        let mut pending = None;
        let t0 = Instant::now();
        let committed = FocusKey {
            app_name: "chrome".into(),
            window_title: "Tab A".into(),
        };
        let observed = FocusKey {
            app_name: "chrome".into(),
            window_title: "Tab B".into(),
        };

        let first = evaluate_debounce(
            Some(&committed),
            &mut pending,
            Some(observed.clone()),
            t0,
            TITLE_DEBOUNCE,
        );
        assert_eq!(first, DebounceAction::Hold);
        assert!(pending.is_some());

        let early = evaluate_debounce(
            Some(&committed),
            &mut pending,
            Some(observed.clone()),
            t0 + Duration::from_millis(200),
            TITLE_DEBOUNCE,
        );
        assert_eq!(early, DebounceAction::Hold);

        let ready = evaluate_debounce(
            Some(&committed),
            &mut pending,
            Some(observed.clone()),
            t0 + Duration::from_millis(400),
            TITLE_DEBOUNCE,
        );
        assert_eq!(ready, DebounceAction::Commit(observed));
        assert!(pending.is_none());
    }

    #[test]
    fn debounce_title_flicker_resets_pending() {
        let mut pending = None;
        let t0 = Instant::now();
        let committed = FocusKey {
            app_name: "chrome".into(),
            window_title: "A".into(),
        };
        let b = FocusKey {
            app_name: "chrome".into(),
            window_title: "B".into(),
        };
        let c = FocusKey {
            app_name: "chrome".into(),
            window_title: "C".into(),
        };

        let _ = evaluate_debounce(
            Some(&committed),
            &mut pending,
            Some(b.clone()),
            t0,
            TITLE_DEBOUNCE,
        );
        let mid = evaluate_debounce(
            Some(&committed),
            &mut pending,
            Some(c.clone()),
            t0 + Duration::from_millis(300),
            TITLE_DEBOUNCE,
        );
        assert_eq!(mid, DebounceAction::Hold);
        assert_eq!(pending.as_ref().map(|(k, _)| k), Some(&c));

        let not_yet = evaluate_debounce(
            Some(&committed),
            &mut pending,
            Some(c.clone()),
            t0 + Duration::from_millis(500),
            TITLE_DEBOUNCE,
        );
        // Only 200ms since C became pending (at t0+300), so still Hold.
        assert_eq!(not_yet, DebounceAction::Hold);

        let done = evaluate_debounce(
            Some(&committed),
            &mut pending,
            Some(c.clone()),
            t0 + Duration::from_millis(700),
            TITLE_DEBOUNCE,
        );
        assert_eq!(done, DebounceAction::Commit(c));
    }

    #[test]
    fn debounce_clear_on_unresolved() {
        let mut pending = Some((
            FocusKey {
                app_name: "chrome".into(),
                window_title: "X".into(),
            },
            Instant::now(),
        ));
        let committed = FocusKey {
            app_name: "chrome".into(),
            window_title: "A".into(),
        };
        let action = evaluate_debounce(
            Some(&committed),
            &mut pending,
            None,
            Instant::now(),
            TITLE_DEBOUNCE,
        );
        assert_eq!(action, DebounceAction::Clear);
        assert!(pending.is_none());
    }

    #[test]
    fn debounce_first_focus_commits() {
        let mut pending = None;
        let key = FocusKey {
            app_name: "code".into(),
            window_title: "app.rs".into(),
        };
        let action = evaluate_debounce(
            None,
            &mut pending,
            Some(key.clone()),
            Instant::now(),
            TITLE_DEBOUNCE,
        );
        assert_eq!(action, DebounceAction::Commit(key));
    }
}
