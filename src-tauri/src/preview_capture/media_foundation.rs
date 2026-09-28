//! Resolve optional Windows media DLLs before calling them. Static MF imports
//! would prevent Kavibay itself from starting on Windows N without Media Pack.
use std::ffi::c_void;
use windows::core::{Interface, Result, HRESULT, PCSTR, PCWSTR};
use windows::Win32::{
    Foundation::{FreeLibrary, E_POINTER, HMODULE},
    Media::MediaFoundation::{IMFMediaBuffer, IMFMediaType, IMFSample, IMFSinkWriter},
    System::LibraryLoader::{GetProcAddress, LoadLibraryExW, LOAD_LIBRARY_SEARCH_SYSTEM32},
};

type Factory = unsafe extern "system" fn(*mut *mut c_void) -> HRESULT;
type BufferFactory = unsafe extern "system" fn(u32, *mut *mut c_void) -> HRESULT;
type SinkFactory =
    unsafe extern "system" fn(PCWSTR, *mut c_void, *mut c_void, *mut *mut c_void) -> HRESULT;
type Startup = unsafe extern "system" fn(u32, u32) -> HRESULT;
type Shutdown = unsafe extern "system" fn() -> HRESULT;

struct Library(HMODULE);
impl Library {
    fn open(name: PCWSTR) -> Result<Self> {
        unsafe { LoadLibraryExW(name, None, LOAD_LIBRARY_SEARCH_SYSTEM32).map(Self) }
    }
}
impl Drop for Library {
    fn drop(&mut self) {
        unsafe {
            let _ = FreeLibrary(self.0);
        }
    }
}

pub(super) struct MediaApi {
    pub startup: Startup,
    pub shutdown: Shutdown,
    media_type: Factory,
    sample: Factory,
    buffer: BufferFactory,
    sink: SinkFactory,
    _platform: Library,
    _readwrite: Library,
}

impl MediaApi {
    pub fn load() -> Result<Self> {
        let platform = Library::open(windows::core::w!("mfplat.dll"))?;
        let readwrite = Library::open(windows::core::w!("mfreadwrite.dll"))?;
        // Each signature matches the corresponding Windows SDK entry point.
        macro_rules! resolve {
            ($library:expr, $name:literal, $signature:ty) => {
                unsafe {
                    std::mem::transmute::<unsafe extern "system" fn() -> isize, $signature>(
                        GetProcAddress($library.0, PCSTR(concat!($name, "\0").as_ptr()))
                            .ok_or_else(windows::core::Error::from_thread)?,
                    )
                }
            };
        }
        Ok(Self {
            startup: resolve!(platform, "MFStartup", Startup),
            shutdown: resolve!(platform, "MFShutdown", Shutdown),
            media_type: resolve!(platform, "MFCreateMediaType", Factory),
            sample: resolve!(platform, "MFCreateSample", Factory),
            buffer: resolve!(platform, "MFCreateMemoryBuffer", BufferFactory),
            sink: resolve!(readwrite, "MFCreateSinkWriterFromURL", SinkFactory),
            _platform: platform,
            _readwrite: readwrite,
        })
    }

    pub fn media_type(&self) -> Result<IMFMediaType> {
        self.create(|out| unsafe { (self.media_type)(out) })
    }
    pub fn sample(&self) -> Result<IMFSample> {
        self.create(|out| unsafe { (self.sample)(out) })
    }
    pub fn buffer(&self, size: u32) -> Result<IMFMediaBuffer> {
        self.create(|out| unsafe { (self.buffer)(size, out) })
    }
    pub fn sink(&self, path: PCWSTR) -> Result<IMFSinkWriter> {
        self.create(|out| unsafe {
            (self.sink)(path, std::ptr::null_mut(), std::ptr::null_mut(), out)
        })
    }
    fn create<T: Interface>(&self, call: impl FnOnce(*mut *mut c_void) -> HRESULT) -> Result<T> {
        let mut raw = std::ptr::null_mut();
        call(&mut raw).ok()?;
        if raw.is_null() {
            return Err(E_POINTER.into());
        }
        // A successful MF factory transfers one owned COM reference to us.
        Ok(unsafe { T::from_raw(raw) })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_media_library_is_an_error() {
        assert!(Library::open(windows::core::w!("kavibay-missing-media-test.dll")).is_err());
    }
}
