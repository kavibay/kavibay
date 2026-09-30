pub(super) const MAX_DURATION_MS: u64 = 90_000;
/// The smallest edge a recording encodes. Windows' H.264 encoder rejects 32
/// pixels in either dimension (0xC00D36B4) and took 34 on the machine it was
/// measured on; 64 leaves room for other encoders. The availability probe
/// encodes exactly this size, so passing it covers every recording.
pub(super) const MIN_EDGE: u32 = 64;

pub(super) fn recording_end_ms(
    elapsed_ms: u64,
    stopped_at_ms: Option<u64>,
    last_frame_ms: u64,
) -> Option<u64> {
    let end =
        stopped_at_ms.or_else(|| (elapsed_ms >= MAX_DURATION_MS).then_some(MAX_DURATION_MS))?;
    // Frames and stop requests can share a millisecond; the last sample still needs a duration.
    Some(end.clamp(last_frame_ms + 1, MAX_DURATION_MS))
}

pub(super) fn output_dimensions(width: u32, height: u32) -> Result<(u32, u32), String> {
    let scale = (1280.0 / f64::from(width.max(height))).min(1.0);
    let dimensions = (
        (f64::from(width) * scale) as u32 & !1,
        (f64::from(height) * scale) as u32 & !1,
    );
    if dimensions.0 < MIN_EDGE || dimensions.1 < MIN_EDGE {
        return Err("The preview is too small to record.".into());
    }
    Ok(dimensions)
}

pub(super) fn sample_duration(at_ms: u64, next_ms: u64) -> Result<i64, String> {
    if next_ms <= at_ms || next_ms > MAX_DURATION_MS {
        return Err("Invalid recording timeline.".into());
    }
    Ok(((next_ms - at_ms) * 10_000) as i64)
}

#[cfg(any(windows, test))]
pub(super) fn nv12(image: &image::RgbaImage) -> Vec<u8> {
    // NV12 is top-down BT.601 limited-range Y, followed by subsampled UV pairs.
    // Supplying the encoder's native format avoids an implicit RGB converter.
    let (w, h) = image.dimensions();
    let mut bytes = vec![0; (w * h * 3 / 2) as usize];
    for y in (0..h).step_by(2) {
        for x in (0..w).step_by(2) {
            let mut rgb = [0i32; 3];
            for dy in 0..2 {
                for dx in 0..2 {
                    let p = image.get_pixel(x + dx, y + dy);
                    let [r, g, b] = [i32::from(p[0]), i32::from(p[1]), i32::from(p[2])];
                    bytes[((y + dy) * w + x + dx) as usize] =
                        (((66 * r + 129 * g + 25 * b + 128) >> 8) + 16) as u8;
                    rgb[0] += r;
                    rgb[1] += g;
                    rgb[2] += b;
                }
            }
            let [r, g, b] = rgb.map(|v| (v + 2) / 4);
            let uv = (w * h + y / 2 * w + x) as usize;
            bytes[uv] = (((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128) as u8;
            bytes[uv + 1] = (((112 * r - 94 * g - 18 * b + 128) >> 8) + 128) as u8;
        }
    }
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn limits_dimensions_without_upscaling() {
        assert_eq!(output_dimensions(1920, 1080).unwrap(), (1280, 720));
        assert_eq!(output_dimensions(600, 801).unwrap(), (600, 800));
        assert_eq!(output_dimensions(800, 1600).unwrap(), (640, 1280));
        assert!(output_dimensions(1, 600).is_err());
    }

    #[test]
    fn dropped_frames_preserve_the_requested_timeline() {
        let times = [0, 50, 150, 410, 4990, 7350, MAX_DURATION_MS];
        let duration: i64 = times
            .windows(2)
            .map(|t| sample_duration(t[0], t[1]).unwrap())
            .sum();
        assert_eq!(duration, 900_000_000);
        assert!(sample_duration(50, 50).is_err());
        assert!(sample_duration(50, 49).is_err());
        assert!(sample_duration(4900, 5100).is_ok());
        assert!(sample_duration(MAX_DURATION_MS, MAX_DURATION_MS + 1).is_err());
    }

    #[test]
    fn stops_at_the_user_timestamp_or_ninety_seconds() {
        assert_eq!(recording_end_ms(5000, None, 4950), None);
        assert_eq!(recording_end_ms(89_999, None, 89_950), None);
        assert_eq!(recording_end_ms(90_100, None, 89_950), Some(90_000));
        assert_eq!(recording_end_ms(7400, Some(7350), 7300), Some(7350));
        assert_eq!(recording_end_ms(7400, Some(7350), 7350), Some(7351));
        assert_eq!(recording_end_ms(1, Some(0), 0), Some(1));
        assert_eq!(recording_end_ms(90_100, Some(90_050), 89_950), Some(90_000));
    }

    #[test]
    fn nv12_has_top_down_luma_and_interleaved_chroma() {
        let mut image = image::RgbaImage::from_pixel(2, 2, image::Rgba([255, 255, 255, 255]));
        image.put_pixel(0, 0, image::Rgba([0, 0, 0, 255]));
        assert_eq!(nv12(&image), vec![16, 235, 235, 235, 128, 128]);
        let red = image::RgbaImage::from_pixel(2, 2, image::Rgba([255, 0, 0, 255]));
        assert_eq!(nv12(&red), vec![82, 82, 82, 82, 90, 240]);
    }
}
