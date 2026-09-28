//! AVFoundation objects stay on their creating encoder worker. The small native
//! bridge uses the existing Objective-C bindings and macOS frameworks only.
use std::{
    ffi::c_void,
    path::Path,
    ptr,
    time::{Duration, Instant},
};

use block2::RcBlock;
use objc2::{
    encode::Encoding,
    msg_send,
    rc::Retained,
    runtime::{AnyClass, AnyObject},
    Encode,
};
use objc2_foundation::{NSDictionary, NSError, NSNumber, NSString, NSURL};

use super::recording::sample_duration;

#[repr(C)]
#[derive(Clone, Copy)]
struct CMTime {
    value: i64,
    timescale: i32,
    flags: u32,
    epoch: i64,
}

// CMTime is the anonymous C struct declared by CoreMedia/CMTime.h.
unsafe impl Encode for CMTime {
    const ENCODING: Encoding = Encoding::Struct(
        "?",
        &[
            Encoding::LongLong,
            Encoding::Int,
            Encoding::UInt,
            Encoding::LongLong,
        ],
    );
}

fn time(ms: u64) -> CMTime {
    CMTime {
        value: ms as i64,
        timescale: 1000,
        flags: 1,
        epoch: 0,
    }
}

#[link(name = "AVFoundation", kind = "framework")]
unsafe extern "C" {
    static AVFileTypeMPEG4: &'static NSString;
    static AVMediaTypeVideo: &'static NSString;
    static AVVideoCodecKey: &'static NSString;
    static AVVideoCodecTypeH264: &'static NSString;
    static AVVideoWidthKey: &'static NSString;
    static AVVideoHeightKey: &'static NSString;
    static AVVideoCompressionPropertiesKey: &'static NSString;
    static AVVideoAverageBitRateKey: &'static NSString;
}

#[link(name = "CoreVideo", kind = "framework")]
unsafe extern "C" {
    fn CVPixelBufferCreate(
        allocator: *const c_void,
        width: usize,
        height: usize,
        format: u32,
        attributes: *const c_void,
        output: *mut *mut c_void,
    ) -> i32;
    fn CVPixelBufferRelease(buffer: *mut c_void);
    fn CVPixelBufferLockBaseAddress(buffer: *mut c_void, flags: u64) -> i32;
    fn CVPixelBufferUnlockBaseAddress(buffer: *mut c_void, flags: u64) -> i32;
    fn CVPixelBufferGetBaseAddress(buffer: *mut c_void) -> *mut c_void;
    fn CVPixelBufferGetBytesPerRow(buffer: *mut c_void) -> usize;
}

struct PixelBuffer(*mut c_void);
impl Drop for PixelBuffer {
    fn drop(&mut self) {
        unsafe { CVPixelBufferRelease(self.0) };
    }
}

impl PixelBuffer {
    fn from_image(image: &image::RgbaImage) -> Result<Self, String> {
        unsafe {
            let mut buffer = ptr::null_mut();
            let status = CVPixelBufferCreate(
                ptr::null(),
                image.width() as usize,
                image.height() as usize,
                u32::from_be_bytes(*b"BGRA"),
                ptr::null(),
                &mut buffer,
            );
            if status != 0 || buffer.is_null() {
                return Err(format!("Could not allocate video pixels ({status})."));
            }
            let buffer = Self(buffer);
            let status = CVPixelBufferLockBaseAddress(buffer.0, 0);
            if status != 0 {
                return Err(format!("Could not access video pixels ({status})."));
            }
            let base = CVPixelBufferGetBaseAddress(buffer.0).cast::<u8>();
            let stride = CVPixelBufferGetBytesPerRow(buffer.0);
            let row_bytes = image.width() as usize * 4;
            if base.is_null() || stride < row_bytes {
                CVPixelBufferUnlockBaseAddress(buffer.0, 0);
                return Err("The video pixel buffer is invalid.".into());
            }
            for (y, row) in image.rows().enumerate() {
                let target = std::slice::from_raw_parts_mut(base.add(y * stride), row_bytes);
                for (target, source) in target.as_chunks_mut::<4>().0.iter_mut().zip(row) {
                    target.copy_from_slice(&[source[2], source[1], source[0], 255]);
                }
            }
            CVPixelBufferUnlockBaseAddress(buffer.0, 0);
            Ok(buffer)
        }
    }
}

fn class(name: &'static std::ffi::CStr) -> Result<&'static AnyClass, String> {
    AnyClass::get(name).ok_or_else(|| format!("macOS video API {name:?} is unavailable."))
}

pub(super) struct Encoder {
    writer: Retained<AnyObject>,
    input: Retained<AnyObject>,
    adaptor: Retained<AnyObject>,
    dimensions: (u32, u32),
}

impl Encoder {
    pub(super) fn new(path: &Path, width: u32, height: u32) -> Result<Self, String> {
        // AVAssetWriter needs a nonexistent output URL. Remove only our empty
        // reservation; an existing recording must never be overwritten.
        let metadata = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
        if !metadata.is_file() || metadata.len() != 0 {
            return Err("The recording destination is already occupied.".into());
        }
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
        let path = path
            .to_str()
            .ok_or("The recording path is not valid UTF-8.")?;
        let url = NSURL::fileURLWithPath(&NSString::from_str(path));
        unsafe {
            let mut error: Option<Retained<NSError>> = None;
            let writer: Option<Retained<AnyObject>> = msg_send![class(c"AVAssetWriter")?,
                assetWriterWithURL: &*url, fileType: AVFileTypeMPEG4, error: Some(&mut error)];
            let writer = writer.ok_or_else(|| {
                error
                    .map(|e| e.localizedDescription().to_string())
                    .unwrap_or_else(|| "Could not create the MP4 writer.".into())
            })?;
            let bitrate = NSNumber::new_u32(3_000_000);
            let compression = NSDictionary::<NSString, AnyObject>::from_slices(
                &[AVVideoAverageBitRateKey],
                &[&bitrate],
            );
            let width_value = NSNumber::new_u32(width);
            let height_value = NSNumber::new_u32(height);
            let settings = NSDictionary::<NSString, AnyObject>::from_slices(
                &[
                    AVVideoCodecKey,
                    AVVideoWidthKey,
                    AVVideoHeightKey,
                    AVVideoCompressionPropertiesKey,
                ],
                &[
                    AVVideoCodecTypeH264,
                    &width_value,
                    &height_value,
                    &compression,
                ],
            );
            let input: Retained<AnyObject> = msg_send![class(c"AVAssetWriterInput")?,
                assetWriterInputWithMediaType: AVMediaTypeVideo, outputSettings: &*settings];
            let _: () = msg_send![&*input, setExpectsMediaDataInRealTime: true];
            let can_add: bool = msg_send![&*writer, canAddInput: &*input];
            if !can_add {
                return Err("macOS cannot encode this video format.".into());
            }
            let _: () = msg_send![&*writer, addInput: &*input];
            // This adaptor also supports macOS versions before the newer Swift receiver API.
            let adaptor: Retained<AnyObject> = msg_send![class(c"AVAssetWriterInputPixelBufferAdaptor")?,
                assetWriterInputPixelBufferAdaptorWithAssetWriterInput: &*input,
                sourcePixelBufferAttributes: None::<&NSDictionary>];
            let encoder = Self {
                writer,
                input,
                adaptor,
                dimensions: (width, height),
            };
            let started: bool = msg_send![&*encoder.writer, startWriting];
            if !started {
                return Err(encoder.error("Could not start the video encoder"));
            }
            let _: () = msg_send![&*encoder.writer, startSessionAtSourceTime: time(0)];
            Ok(encoder)
        }
    }

    fn error(&self, message: &str) -> String {
        let error: Option<Retained<NSError>> = unsafe { msg_send![&*self.writer, error] };
        error
            .map(|e| format!("{message}: {}", e.localizedDescription()))
            .unwrap_or_else(|| message.to_string())
    }

    fn append(&self, buffer: &PixelBuffer, at_ms: u64) -> Result<(), String> {
        let deadline = Instant::now() + Duration::from_secs(2);
        unsafe {
            loop {
                let ready: bool = msg_send![&*self.input, isReadyForMoreMediaData];
                if ready {
                    break;
                }
                let status: isize = msg_send![&*self.writer, status];
                if status != 1 || Instant::now() >= deadline {
                    return Err(self.error("The video encoder stopped accepting frames"));
                }
                std::thread::sleep(Duration::from_millis(5));
            }
            let appended: bool = msg_send![&*self.adaptor,
                appendPixelBuffer: buffer.0, withPresentationTime: time(at_ms)];
            if !appended {
                return Err(self.error("Could not encode the video frame"));
            }
        }
        Ok(())
    }

    pub(super) fn frame(
        &self,
        image: &image::RgbaImage,
        at_ms: u64,
        next_ms: u64,
    ) -> Result<(), String> {
        sample_duration(at_ms, next_ms)?;
        if image.dimensions() != self.dimensions {
            return Err("The preview size changed during recording.".into());
        }
        let buffer = PixelBuffer::from_image(image)?;
        self.append(&buffer, at_ms)?;
        Ok(())
    }

    pub(super) fn finish(
        self,
        image: &image::RgbaImage,
        at_ms: u64,
        duration_ms: u64,
    ) -> Result<(), String> {
        self.frame(image, at_ms, duration_ms)?;
        // The adaptor has no sample-duration argument. Keep the last image visible
        // until the user's stop time, even when capture has dropped frames.
        if at_ms < duration_ms - 1 {
            self.append(&PixelBuffer::from_image(image)?, duration_ms - 1)?;
        }
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        let completion = RcBlock::new(move || {
            let _ = sender.send(());
        });
        unsafe {
            let _: () = msg_send![&*self.writer, endSessionAtSourceTime: time(duration_ms)];
            let _: () = msg_send![&*self.input, markAsFinished];
            let _: () = msg_send![&*self.writer, finishWritingWithCompletionHandler: &*completion];
        }
        receiver
            .recv_timeout(Duration::from_secs(15))
            .map_err(|_| "Finishing the video timed out.".to_string())?;
        let status: isize = unsafe { msg_send![&*self.writer, status] };
        if status != 2 {
            return Err(self.error("Could not finish the video"));
        }
        Ok(())
    }
}

impl Drop for Encoder {
    fn drop(&mut self) {
        unsafe {
            let status: isize = msg_send![&*self.writer, status];
            if status == 1 {
                let _: () = msg_send![&*self.writer, cancelWriting];
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_mp4_roundtrip() {
        let root = std::env::temp_dir().join(format!(
            "kavibay-avfoundation-{:032x}",
            rand::random::<u128>()
        ));
        let (_, partial) = super::super::artifacts::prepare(&root).unwrap();
        let encoder = Encoder::new(&partial.0, 320, 180).unwrap();
        let mut frame = image::RgbaImage::from_pixel(320, 180, image::Rgba([255, 0, 0, 255]));
        for y in 90..180 {
            for x in 0..320 {
                frame.put_pixel(x, y, image::Rgba([0, 0, 255, 255]));
            }
        }
        encoder.frame(&frame, 0, 2300).unwrap();
        let green = image::RgbaImage::from_pixel(320, 180, image::Rgba([0, 255, 0, 255]));
        encoder.finish(&green, 2300, 7350).unwrap();
        assert!(Encoder::new(&partial.0, 320, 180).is_err());
        let script =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../scripts/shareRecordingMacSmoke.swift");
        let result = std::process::Command::new("/usr/bin/swift")
            .arg(script)
            .arg(&partial.0)
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&result.stdout),
            String::from_utf8_lossy(&result.stderr)
        );
        drop(partial);
        std::fs::remove_dir(root).unwrap();
    }
}
