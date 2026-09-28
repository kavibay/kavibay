//! Media Foundation objects stay on their creating worker thread.
use std::{os::windows::ffi::OsStrExt, path::Path};
use windows::core::{Result, PCWSTR};
use windows::Win32::Media::MediaFoundation::*;
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};

use super::media_foundation::MediaApi;
use super::recording::{nv12, sample_duration};

struct MediaFoundation {
    api: MediaApi,
}

impl MediaFoundation {
    fn start() -> Result<Self> {
        let api = MediaApi::load()?;
        unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED).ok()?;
            if let Err(error) = (api.startup)(MF_VERSION, MFSTARTUP_FULL).ok() {
                CoUninitialize();
                return Err(error);
            }
        }
        Ok(Self { api })
    }
}

impl Drop for MediaFoundation {
    fn drop(&mut self) {
        unsafe {
            let _ = (self.api.shutdown)();
            CoUninitialize();
        }
    }
}

pub(super) struct Encoder {
    // Declaration order releases the sink before shutting down Media Foundation.
    writer: IMFSinkWriter,
    stream: u32,
    runtime: MediaFoundation,
}

fn media_type(
    api: &MediaApi,
    width: u32,
    height: u32,
    subtype: &windows::core::GUID,
) -> Result<IMFMediaType> {
    unsafe {
        let ty = api.media_type()?;
        ty.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
        ty.SetGUID(&MF_MT_SUBTYPE, subtype)?;
        ty.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)?;
        ty.SetUINT64(
            &MF_MT_FRAME_SIZE,
            (u64::from(width) << 32) | u64::from(height),
        )?;
        ty.SetUINT64(&MF_MT_FRAME_RATE, (20u64 << 32) | 1)?;
        ty.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, (1u64 << 32) | 1)?;
        ty.SetUINT32(&MF_MT_YUV_MATRIX, MFVideoTransferMatrix_BT601.0 as u32)?;
        ty.SetUINT32(&MF_MT_VIDEO_NOMINAL_RANGE, MFNominalRange_16_235.0 as u32)?;
        Ok(ty)
    }
}

impl Encoder {
    pub(super) fn new(path: &Path, width: u32, height: u32) -> Result<Self> {
        let runtime = MediaFoundation::start()?;
        let name: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        unsafe {
            let writer = runtime.api.sink(PCWSTR(name.as_ptr()))?;
            let output = media_type(&runtime.api, width, height, &MFVideoFormat_H264)?;
            output.SetUINT32(&MF_MT_AVG_BITRATE, 3_000_000)?;
            let stream = writer.AddStream(&output)?;
            let input = media_type(&runtime.api, width, height, &MFVideoFormat_NV12)?;
            writer.SetInputMediaType(stream, &input, None)?;
            writer.BeginWriting()?;
            Ok(Self {
                writer,
                stream,
                runtime,
            })
        }
    }

    pub(super) fn frame(
        &self,
        image: &image::RgbaImage,
        at_ms: u64,
        next_ms: u64,
    ) -> std::result::Result<(), String> {
        let duration = sample_duration(at_ms, next_ms)?;
        let pixels = nv12(image);
        let write = || unsafe {
            let buffer = self.runtime.api.buffer(pixels.len() as u32)?;
            let mut data = std::ptr::null_mut();
            buffer.Lock(&mut data, None, None)?;
            std::ptr::copy_nonoverlapping(pixels.as_ptr(), data, pixels.len());
            buffer.Unlock()?;
            buffer.SetCurrentLength(pixels.len() as u32)?;
            let sample = self.runtime.api.sample()?;
            sample.AddBuffer(&buffer)?;
            sample.SetSampleTime((at_ms * 10_000) as i64)?;
            sample.SetSampleDuration(duration)?;
            self.writer.WriteSample(self.stream, &sample)
        };
        write().map_err(|e| format!("Could not encode the video: {e}"))
    }

    pub(super) fn finish(
        self,
        image: &image::RgbaImage,
        at_ms: u64,
        duration_ms: u64,
    ) -> std::result::Result<(), String> {
        self.frame(image, at_ms, duration_ms)?;
        unsafe { self.writer.Finalize() }.map_err(|e| format!("Could not finish the video: {e}"))
    }
}
