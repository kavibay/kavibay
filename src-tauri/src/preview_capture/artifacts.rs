use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};

// Allow a 90-second clip at the encoder's 3 Mbit/s target, including container overhead.
pub(super) const MAX_CLIP_BYTES: u64 = 64 * 1024 * 1024;

fn valid_id(id: &str) -> bool {
    id.len() == 32
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

pub(super) fn completed(root: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("Unknown video clip.".into());
    }
    let path = root.join(format!("{id}.mp4"));
    let metadata = fs::symlink_metadata(&path)
        .map_err(|_| "This video clip is no longer available.".to_string())?;
    if !metadata.file_type().is_file() || metadata.len() == 0 || metadata.len() > MAX_CLIP_BYTES {
        return Err("The video is empty, invalid or exceeds 64 MiB.".into());
    }
    Ok(path)
}

#[cfg(any(windows, target_os = "macos", test))]
pub(super) struct PartialClip(pub PathBuf);

#[cfg(any(windows, target_os = "macos", test))]
impl Drop for PartialClip {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

#[cfg(any(windows, target_os = "macos", test))]
pub(super) fn prepare(cache: &Path) -> Result<(String, PartialClip), String> {
    fs::create_dir_all(cache).map_err(|e| e.to_string())?;
    let id = format!("{:032x}", rand::random::<u128>());
    let path = cache.join(format!("{id}.partial.mp4"));
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    Ok((id, PartialClip(path)))
}

#[cfg(any(windows, target_os = "macos", test))]
pub(super) fn publish(partial: &PartialClip, root: &Path, id: &str) -> Result<u64, String> {
    let bytes = fs::metadata(&partial.0).map_err(|e| e.to_string())?.len();
    if bytes == 0 || bytes > MAX_CLIP_BYTES {
        return Err("The video is empty or exceeds 64 MiB. Try a smaller preview.".into());
    }
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let destination = root.join(format!("{id}.mp4"));
    if !valid_id(id) || destination.exists() {
        return Err("Invalid video destination.".into());
    }
    fs::rename(&partial.0, destination)
        .map_err(|e| format!("Could not save the recorded video: {e}"))?;
    Ok(bytes)
}

pub(super) fn read(root: &Path, id: &str) -> Result<Vec<u8>, String> {
    let path = completed(root, id)?;
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.take(MAX_CLIP_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.is_empty() || bytes.len() as u64 > MAX_CLIP_BYTES {
        return Err("The video is empty or exceeds 64 MiB.".into());
    }
    Ok(bytes)
}

#[cfg(any(windows, target_os = "macos", test))]
pub(super) fn cleanup_partials(cache: &Path) -> Result<(), String> {
    let entries = match fs::read_dir(cache) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.to_string()),
    };
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        let Some(id) = name
            .to_str()
            .and_then(|name| name.strip_suffix(".partial.mp4"))
        else {
            continue;
        };
        if valid_id(id) && entry.file_type().map_err(|e| e.to_string())?.is_file() {
            fs::remove_file(entry.path()).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[cfg(any(windows, target_os = "macos"))]
pub(super) fn initialize_cache(cache: &Path) -> Result<(), String> {
    static CLEANED: std::sync::OnceLock<Result<(), String>> = std::sync::OnceLock::new();
    CLEANED.get_or_init(|| cleanup_partials(cache)).clone()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn completed_files_survive_cleanup_and_dropped_partials_do_not() {
        let root =
            std::env::temp_dir().join(format!("kavibay-video-{:032x}", rand::random::<u128>()));
        let cache = root.join("cache");
        let saved = root.join("録画");
        let (id, partial) = prepare(&cache).unwrap();
        fs::write(&partial.0, b"video").unwrap();
        publish(&partial, &saved, &id).unwrap();
        drop(partial);
        assert_eq!(read(&saved, &id).unwrap(), b"video");
        let (_, cancelled) = prepare(&cache).unwrap();
        let cancelled_path = cancelled.0.clone();
        drop(cancelled);
        assert!(!cancelled_path.exists());
        let (other_id, other) = prepare(&cache).unwrap();
        fs::write(&other.0, b"another video").unwrap();
        assert_ne!(other_id, id);
        assert!(publish(&other, &saved, &id).is_err());
        let stale = cache.join(format!("{other_id}.partial.mp4"));
        drop(other);
        fs::write(&stale, b"abandoned").unwrap();
        let unrelated = cache.join("unrelated.partial.mp4");
        fs::write(&unrelated, b"keep").unwrap();
        cleanup_partials(&cache).unwrap();
        assert!(!stale.exists());
        assert!(unrelated.exists());
        assert_eq!(read(&saved, &id).unwrap(), b"video");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn only_reads_bounded_completed_clips() {
        let root =
            std::env::temp_dir().join(format!("kavibay-clips-{:032x}", rand::random::<u128>()));
        fs::create_dir_all(&root).unwrap();
        let id = "0123456789abcdef0123456789abcdef";
        for invalid in ["../secret", "", "ABCDEF", "123.partial", "/tmp/file"] {
            assert!(!valid_id(invalid));
            assert!(read(&root, invalid).is_err());
        }
        assert!(read(&root, id).is_err());
        fs::write(root.join(format!("{id}.partial.mp4")), b"partial").unwrap();
        assert!(read(&root, id).is_err());
        let path = root.join(format!("{id}.mp4"));
        fs::write(&path, b"completed").unwrap();
        assert_eq!(read(&root, id).unwrap(), b"completed");
        fs::File::create(&path)
            .unwrap()
            .set_len(MAX_CLIP_BYTES + 1)
            .unwrap();
        assert!(read(&root, id).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
