use std::{
    path::Path,
    sync::{atomic::Ordering, Arc, OnceLock},
    time::{Duration, Instant},
};
use tauri::{ipc::Channel, Manager};
use tokio::sync::{mpsc, oneshot};

use super::{
    artifacts,
    recording::{output_dimensions, recording_end_ms, MAX_DURATION_MS, MIN_EDGE},
    recording_commands::{RecordedClip, RecordingProgress},
    recording_session::{RecordingControl, Session},
    CaptureRegion,
};

#[cfg(target_os = "macos")]
use super::{capture_snapshot, cursor_macos as cursor, video_macos::Encoder};
#[cfg(windows)]
use super::{screen_windows as screen, video_windows::Encoder};

/// A frame as captured: on macOS the region's snapshot and the pointer, both
/// decoded on the encoder worker; on Windows the finished pixels.
#[cfg(target_os = "macos")]
type Captured = (Vec<u8>, Option<cursor::CursorSnapshot>);
#[cfg(windows)]
type Captured = image::RgbaImage;

async fn capture_frame(
    window: &tauri::WebviewWindow,
    region: CaptureRegion,
    bounds: WindowBounds,
) -> Result<Captured, String> {
    #[cfg(target_os = "macos")]
    {
        let _ = bounds;
        let snapshot = capture_snapshot(window, Duration::from_millis(500), Some(region)).await?;
        Ok((snapshot, cursor::capture(window).await?))
    }
    #[cfg(windows)]
    {
        let _ = window;
        // Even sides, which H.264 needs, so a region within 1,280 pixels
        // reaches the encoder without resampling.
        let (x, y, width, height) = region.pixels(bounds.size.0, bounds.size.1)?;
        let (x, y) = (bounds.origin.0 + x as i32, bounds.origin.1 + y as i32);
        tauri::async_runtime::spawn_blocking(move || screen::grab(x, y, width & !1, height & !1))
            .await
            .map_err(|e| e.to_string())?
    }
}

pub(super) fn availability(cache: &Path) -> Result<(), String> {
    artifacts::initialize_cache(cache)?;
    static RESULT: OnceLock<Result<(), String>> = OnceLock::new();
    RESULT
        .get_or_init(|| {
            let probe = || {
                let (_, probe) = artifacts::prepare(cache)?;
                let encoder = Encoder::new(&probe.0, MIN_EDGE, MIN_EDGE)
                    .map_err(|e| format!("The system H.264 encoder is unavailable: {e}"))?;
                encoder.finish(
                    &image::RgbaImage::from_pixel(MIN_EDGE, MIN_EDGE, image::Rgba([0, 0, 0, 255])),
                    0,
                    50,
                )
            };
            #[cfg(target_os = "macos")]
            {
                objc2::rc::autoreleasepool(|_| probe())
            }
            #[cfg(windows)]
            {
                probe()
            }
        })
        .clone()
}

#[derive(Clone, Copy, PartialEq)]
struct WindowBounds {
    origin: (i32, i32),
    size: (u32, u32),
}

fn bounds(window: &tauri::WebviewWindow) -> Result<WindowBounds, String> {
    if !window.is_visible().map_err(|e| e.to_string())?
        || window.is_minimized().map_err(|e| e.to_string())?
    {
        return Err("Recording cancelled because the window is hidden.".into());
    }
    let p = window.inner_position().map_err(|e| e.to_string())?;
    let s = window.inner_size().map_err(|e| e.to_string())?;
    Ok(WindowBounds {
        origin: (p.x, p.y),
        size: (s.width, s.height),
    })
}

struct Frame {
    captured: Captured,
    at_ms: u64,
}

enum EncoderInput {
    Frame(Frame),
    Finish(u64),
}

fn decode(captured: Captured, region: CaptureRegion) -> Result<image::RgbaImage, String> {
    #[cfg(target_os = "macos")]
    let image = {
        let (snapshot, pointer) = captured;
        let mut image = image::load_from_memory_with_format(&snapshot, image::ImageFormat::Png)
            .map_err(|e| e.to_string())?
            .into_rgba8();
        cursor::composite(pointer.as_ref(), &mut image, region)?;
        image
    };
    #[cfg(windows)]
    let (image, _) = (captured, region);
    let (w, h) = output_dimensions(image.width(), image.height())?;
    if (w, h) == image.dimensions() {
        return Ok(image);
    }
    Ok(image::imageops::resize(
        &image,
        w,
        h,
        image::imageops::FilterType::Triangle,
    ))
}

fn encode(
    first: Captured,
    mut frames: mpsc::Receiver<EncoderInput>,
    ready: oneshot::Sender<(u32, u32)>,
    control: Arc<RecordingControl>,
    region: CaptureRegion,
    path: &Path,
) -> Result<(u32, u32), String> {
    let check = || {
        if control.cancelled.load(Ordering::Acquire) {
            Err("Recording cancelled.".to_string())
        } else {
            Ok(())
        }
    };
    check()?;
    let (width, height) = decode(first, region)?.dimensions();
    let encoder = Encoder::new(path, width, height)
        .map_err(|e| format!("Could not start the H.264 encoder: {e}"))?;
    let _ = ready.send((width, height));
    let mut previous: Option<(image::RgbaImage, u64)> = None;
    let mut duration_ms = None;
    while let Some(input) = frames.blocking_recv() {
        check()?;
        let frame = match input {
            EncoderInput::Frame(frame) => frame,
            EncoderInput::Finish(duration) => {
                duration_ms = Some(duration);
                break;
            }
        };
        let next = decode(frame.captured, region)?;
        if next.dimensions() != (width, height) {
            return Err("The preview size changed during recording.".into());
        }
        if let Some((image, at_ms)) = &previous {
            encoder.frame(image, *at_ms, frame.at_ms)?;
        }
        previous = Some((next, frame.at_ms));
        if std::fs::metadata(path).map_err(|e| e.to_string())?.len() > artifacts::MAX_CLIP_BYTES {
            return Err("The video exceeds 64 MiB. Try a smaller preview.".into());
        }
    }
    check()?;
    let (previous, at_ms) = previous.ok_or("No recording frames were captured.")?;
    encoder.finish(
        &previous,
        at_ms,
        duration_ms.ok_or("Recording stopped unexpectedly.")?,
    )?;
    check()?;
    Ok((width, height))
}

pub(super) async fn record(
    window: &tauri::WebviewWindow,
    region: CaptureRegion,
    session: &Session<'_>,
    events: Channel<RecordingProgress>,
) -> Result<RecordedClip, String> {
    let cache = crate::paths::cache_dir(window.app_handle())?.join("share-recordings");
    let root = crate::paths::data_dir(window.app_handle())?.join("shared-clips");
    artifacts::initialize_cache(&cache)?;
    let (clip_id, partial) = artifacts::prepare(&cache)?;
    let initial_bounds = bounds(window)?;
    let progress = |phase, elapsed_ms| {
        events
            .send(RecordingProgress {
                recording_id: session.id.clone(),
                phase,
                elapsed_ms,
            })
            .map_err(|_| "The recording dialog closed.".to_string())
    };
    progress("preparing", 0)?;
    let first = capture_frame(window, region, initial_bounds).await?;
    session.check()?;
    let (sender, receiver) = mpsc::channel(2);
    let (ready_tx, ready_rx) = oneshot::channel();
    let control = session.control.clone();
    let output = partial.0.clone();
    let worker = tauri::async_runtime::spawn_blocking(move || {
        let work = || encode(first, receiver, ready_tx, control, region, &output);
        #[cfg(target_os = "macos")]
        {
            objc2::rc::autoreleasepool(|_| work())
        }
        #[cfg(windows)]
        {
            work()
        }
    });
    // Always join the worker before releasing its partial file or the session.
    let capture = async {
        ready_rx
            .await
            .map_err(|_| "The video encoder could not start.".to_string())?;
        session.check()?;
        // Encoder initialization is preparation. Only a fresh snapshot can
        // establish frame zero and the interaction clock.
        let captured = capture_frame(window, region, initial_bounds).await?;
        let start = Instant::now();
        sender
            .send(EncoderInput::Frame(Frame { captured, at_ms: 0 }))
            .await
            .map_err(|_| "The video encoder stopped.".to_string())?;
        let mut ticks = tokio::time::interval_at(
            tokio::time::Instant::now() + Duration::from_millis(50),
            Duration::from_millis(50),
        );
        ticks.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        progress("recording", 0)?;
        let mut last_frame_ms = 0;
        let duration_ms = loop {
            ticks.tick().await;
            session.check()?;
            let elapsed_ms = start.elapsed().as_millis() as u64;
            let stopped_at_ms = session
                .control
                .stopped_at()
                .map(|at| at.saturating_duration_since(start).as_millis() as u64);
            if let Some(duration) = recording_end_ms(elapsed_ms, stopped_at_ms, last_frame_ms) {
                break duration;
            }
            if bounds(window)? != initial_bounds {
                return Err("Recording cancelled because the window moved or resized.".into());
            }
            progress("recording", elapsed_ms)?;
            if sender.is_closed() {
                return Err("The video encoder stopped.".into());
            }
            if sender.capacity() == 0 {
                continue;
            }
            let captured = capture_frame(window, region, initial_bounds).await?;
            let at_ms = start.elapsed().as_millis() as u64;
            // A snapshot can finish after Stop. Extend the last accepted frame
            // to the stop timestamp instead of including interaction after it.
            if session.control.stopped_at().is_some() || at_ms >= MAX_DURATION_MS {
                continue;
            }
            match sender.try_send(EncoderInput::Frame(Frame { captured, at_ms })) {
                Ok(()) => last_frame_ms = at_ms,
                Err(mpsc::error::TrySendError::Full(_)) => (),
                Err(mpsc::error::TrySendError::Closed(_)) => {
                    return Err("The video encoder stopped.".into())
                }
            }
        };
        session.check()?;
        progress("encoding", duration_ms)?;
        sender
            .send(EncoderInput::Finish(duration_ms))
            .await
            .map_err(|_| "The video encoder stopped.".to_string())?;
        Ok(duration_ms)
    }
    .await;
    if capture.is_err() {
        session.control.cancelled.store(true, Ordering::Release);
    }
    drop(sender);
    let encoded = worker.await.map_err(|e| e.to_string())?;
    let duration_ms = match capture {
        Ok(duration) => duration,
        Err(error) => {
            return Err(encoded
                .err()
                .filter(|e| e != "Recording cancelled.")
                .unwrap_or(error))
        }
    };
    let (width, height) = encoded?;
    if bounds(window)? != initial_bounds {
        return Err("Recording cancelled because the window moved or resized.".into());
    }
    let bytes = session.publish(|| artifacts::publish(&partial, &root, &clip_id))?;
    Ok(RecordedClip {
        clip_id,
        duration_ms,
        width,
        height,
        bytes,
    })
}
