use std::{
    path::Path,
    sync::{atomic::Ordering, Arc, OnceLock},
    time::{Duration, Instant},
};
use tauri::{ipc::Channel, Manager};
use tokio::sync::{mpsc, oneshot};

use super::{
    artifacts, capture_snapshot,
    recording::{output_dimensions, recording_end_ms, MAX_DURATION_MS},
    recording_commands::{RecordedClip, RecordingProgress},
    recording_session::{RecordingControl, Session},
    CaptureRegion,
};

#[cfg(target_os = "macos")]
use super::{cursor_macos as cursor, video_macos::Encoder};
#[cfg(windows)]
use super::{cursor_windows as cursor, video_windows::Encoder};

async fn capture_cursor(
    window: &tauri::WebviewWindow,
) -> Result<Option<cursor::CursorSnapshot>, String> {
    #[cfg(target_os = "macos")]
    {
        cursor::capture(window).await
    }
    #[cfg(windows)]
    {
        let _ = window;
        cursor::capture()
    }
}

pub(super) fn availability(cache: &Path) -> Result<(), String> {
    artifacts::initialize_cache(cache)?;
    static RESULT: OnceLock<Result<(), String>> = OnceLock::new();
    RESULT
        .get_or_init(|| {
            let probe = || {
                let (_, probe) = artifacts::prepare(cache)?;
                let encoder = Encoder::new(&probe.0, 32, 32)
                    .map_err(|e| format!("The system H.264 encoder is unavailable: {e}"))?;
                encoder.finish(
                    &image::RgbaImage::from_pixel(32, 32, image::Rgba([0, 0, 0, 255])),
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
    png: Vec<u8>,
    at_ms: u64,
    cursor: Option<cursor::CursorSnapshot>,
}

enum EncoderInput {
    Frame(Frame),
    Finish(u64),
}

fn decode(
    frame: &Frame,
    region: CaptureRegion,
    _bounds: WindowBounds,
) -> Result<image::RgbaImage, String> {
    let source = image::load_from_memory_with_format(&frame.png, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    #[cfg(windows)]
    let image = {
        let dimensions = (source.width(), source.height());
        let (x, y, w, h) = region.pixels(dimensions.0, dimensions.1)?;
        let mut image = source.crop_imm(x, y, w, h).into_rgba8();
        cursor::composite(
            frame.cursor.as_ref(),
            &mut image,
            dimensions,
            _bounds.origin,
            _bounds.size,
            region,
        )?;
        image
    };
    #[cfg(target_os = "macos")]
    let image = {
        let mut image = source.into_rgba8();
        cursor::composite(frame.cursor.as_ref(), &mut image, region)?;
        image
    };
    let (w, h) = output_dimensions(image.width(), image.height())?;
    Ok(image::imageops::resize(
        &image,
        w,
        h,
        image::imageops::FilterType::Triangle,
    ))
}

fn encode(
    first: Frame,
    mut frames: mpsc::Receiver<EncoderInput>,
    ready: oneshot::Sender<(u32, u32)>,
    control: Arc<RecordingControl>,
    region: CaptureRegion,
    bounds: WindowBounds,
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
    let probe = decode(&first, region, bounds)?;
    let (width, height) = probe.dimensions();
    drop(probe);
    drop(first);
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
        let next = decode(&frame, region, bounds)?;
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
    let first = Frame {
        png: capture_snapshot(window, Duration::from_millis(500), Some(region)).await?,
        at_ms: 0,
        cursor: None,
    };
    session.check()?;
    let (sender, receiver) = mpsc::channel(2);
    let (ready_tx, ready_rx) = oneshot::channel();
    let control = session.control.clone();
    let output = partial.0.clone();
    let worker = tauri::async_runtime::spawn_blocking(move || {
        let work = || {
            encode(
                first,
                receiver,
                ready_tx,
                control,
                region,
                initial_bounds,
                &output,
            )
        };
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
        let png = capture_snapshot(window, Duration::from_millis(500), Some(region)).await?;
        let cursor = capture_cursor(window).await?;
        let start = Instant::now();
        sender
            .send(EncoderInput::Frame(Frame {
                png,
                at_ms: 0,
                cursor,
            }))
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
            let png = capture_snapshot(window, Duration::from_millis(500), Some(region)).await?;
            let cursor = capture_cursor(window).await?;
            let at_ms = start.elapsed().as_millis() as u64;
            // A snapshot can finish after Stop. Extend the last accepted frame
            // to the stop timestamp instead of including interaction after it.
            if session.control.stopped_at().is_some() || at_ms >= MAX_DURATION_MS {
                continue;
            }
            match sender.try_send(EncoderInput::Frame(Frame { png, at_ms, cursor })) {
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
