//! Dev-only stopwatch for the cockpit opening path.
//!
//! "Opening feels slow" has several suspects — the double-tap rule, the hop
//! from the hook thread to the main thread, `show()` on a hidden fullscreen
//! transparent window, the IPC event, the first frame, the widgets' resume
//! hooks — and guessing between them is how time gets spent on the wrong one.
//! This prints one line per opening, every stage in milliseconds since the
//! gesture was recognised:
//!
//! ```text
//! [open-timing] main 0.4 | show 38.1 | focus 38.9 | fit 52.0 | emit 52.3 | event 61.7 | frame 70.2 | resumed 88.5 | palette-show 64.0 | painted 104.9 (ms since trigger)
//! ```
//!
//! Debug builds only (`pnpm run tauri dev`). A release build records nothing,
//! sends nothing to the frontend and the report command returns at once.
//!
//! The frontend's marks are wall-clock times (`performance.timeOrigin +
//! performance.now()`), compared here with `SystemTime`. Both read the same
//! system clock, but the browser's origin is captured once at page load, so
//! treat the frontend stages as accurate to about a millisecond, not better.

use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

/// Whether this build measures at all.
const ENABLED: bool = cfg!(debug_assertions);

/// When the gesture was recognised, set from the keyboard hook's thread.
static TRIGGERED_AT: Mutex<Option<Instant>> = Mutex::new(None);
/// The opening waiting for the frontend's half of the report.
static PENDING: Mutex<Option<OpenTrace>> = Mutex::new(None);

/// The stages of one opening, measured from its trigger.
pub struct OpenTrace {
    start: Instant,
    /// `start` on the wall clock, for lining up the frontend's marks.
    start_epoch_ms: f64,
    marks: Vec<(String, f64)>,
}

impl OpenTrace {
    /// Record that `stage` finished now.
    pub fn mark(&mut self, stage: &str) {
        let ms = self.start.elapsed().as_secs_f64() * 1000.0;
        self.marks.push((stage.to_owned(), ms));
    }

    /// The trigger on the wall clock, sent to the frontend with the event.
    pub fn origin_ms(&self) -> f64 {
        self.start_epoch_ms
    }
}

fn epoch_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

/// Called by the double-tap detector the moment it fires.
#[cfg_attr(not(any(windows, target_os = "macos")), allow(dead_code))]
pub fn mark_trigger() {
    if !ENABLED {
        return;
    }
    if let Ok(mut slot) = TRIGGERED_AT.lock() {
        *slot = Some(Instant::now());
    }
}

/// Start measuring an opening. `None` in release builds.
///
/// Without a recorded trigger (tray, Shift+Ctrl+Space, `--toggle`) the clock
/// starts here instead, and the line simply has no `main` stage.
pub fn begin() -> Option<OpenTrace> {
    if !ENABLED {
        return None;
    }
    let triggered = TRIGGERED_AT.lock().ok().and_then(|mut slot| slot.take());
    let now = Instant::now();
    let start = triggered.unwrap_or(now);
    let since_trigger = now.duration_since(start).as_secs_f64() * 1000.0;
    let mut trace = OpenTrace {
        start,
        start_epoch_ms: epoch_ms() - since_trigger,
        marks: Vec::new(),
    };
    if triggered.is_some() {
        trace.mark("main");
    }
    Some(trace)
}

/// Park a trace until the frontend reports its stages.
pub fn await_frontend(trace: OpenTrace) {
    if let Ok(mut slot) = PENDING.lock() {
        // An older opening the frontend never reported is printed as it is,
        // so a missing report is visible rather than silently dropped.
        if let Some(stale) = slot.replace(trace) {
            println!("{} (no frontend report)", format_line(&stale.marks));
        }
    }
}

/// The frontend's half: wall-clock times of its stages.
#[tauri::command]
pub fn open_timing_report(marks: Vec<(String, f64)>) {
    if !ENABLED {
        return;
    }
    let Some(mut trace) = PENDING.lock().ok().and_then(|mut slot| slot.take()) else {
        return;
    };
    for (stage, at_epoch_ms) in marks {
        trace
            .marks
            .push((stage, at_epoch_ms - trace.start_epoch_ms));
    }
    println!("{}", format_line(&trace.marks));
}

fn format_line(marks: &[(String, f64)]) -> String {
    let stages: Vec<String> = marks
        .iter()
        .map(|(stage, ms)| format!("{stage} {ms:.1}"))
        .collect();
    format!("[open-timing] {} (ms since trigger)", stages.join(" | "))
}

#[cfg(test)]
mod tests {
    use super::format_line;

    #[test]
    fn the_line_lists_stages_in_order() {
        let marks = vec![("show".to_owned(), 38.06), ("event".to_owned(), 61.74)];
        assert_eq!(
            format_line(&marks),
            "[open-timing] show 38.1 | event 61.7 (ms since trigger)"
        );
    }
}
