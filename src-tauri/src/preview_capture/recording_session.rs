use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::Instant;

#[derive(Default)]
pub(super) struct RecordingControl {
    pub cancelled: AtomicBool,
    stopped_at: Mutex<Option<Instant>>,
}

impl RecordingControl {
    #[cfg(any(windows, target_os = "macos", test))]
    pub fn stopped_at(&self) -> Option<Instant> {
        *self.stopped_at.lock().unwrap_or_else(|e| e.into_inner())
    }
}

#[derive(Default)]
pub(super) struct Sessions(Mutex<Option<(String, Arc<RecordingControl>)>>);

pub(super) struct Session<'a> {
    owner: &'a Sessions,
    pub id: String,
    pub control: Arc<RecordingControl>,
}

impl Sessions {
    pub fn start(&self, id: String) -> Result<Session<'_>, String> {
        if id.is_empty()
            || id.len() > 80
            || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
        {
            return Err("Invalid recording ID.".into());
        }
        let mut active = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if active.is_some() {
            return Err("Another recording is still finishing.".into());
        }
        let control = Arc::new(RecordingControl::default());
        *active = Some((id.clone(), control.clone()));
        Ok(Session {
            owner: self,
            id,
            control,
        })
    }
    pub fn cancel(&self, id: &str) {
        if let Some((current, control)) = &*self.0.lock().unwrap_or_else(|e| e.into_inner()) {
            if current == id {
                control.cancelled.store(true, Ordering::Release);
            }
        }
    }

    pub fn stop(&self, id: &str) {
        if let Some((current, control)) = &*self.0.lock().unwrap_or_else(|e| e.into_inner()) {
            if current == id {
                control
                    .stopped_at
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .get_or_insert_with(Instant::now);
            }
        }
    }
}

impl Session<'_> {
    pub fn check(&self) -> Result<(), String> {
        if self.control.cancelled.load(Ordering::Acquire) {
            Err("Recording cancelled.".into())
        } else {
            Ok(())
        }
    }
    #[cfg(any(windows, target_os = "macos"))]
    pub fn publish<T>(&self, f: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
        let _lock = self.owner.0.lock().unwrap_or_else(|e| e.into_inner());
        self.check()?;
        f()
    }
}
impl Drop for Session<'_> {
    fn drop(&mut self) {
        let mut active = self.owner.0.lock().unwrap_or_else(|e| e.into_inner());
        if active.as_ref().is_some_and(|(id, _)| id == &self.id) {
            *active = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stopping_keeps_the_clip_and_does_not_affect_other_sessions() {
        let sessions = Sessions::default();
        let first = sessions.start("first".into()).unwrap();
        sessions.stop("unknown");
        assert!(first.control.stopped_at().is_none());
        sessions.stop("first");
        let stopped_at = first.control.stopped_at();
        assert!(stopped_at.is_some());
        sessions.stop("first");
        assert_eq!(first.control.stopped_at(), stopped_at);
        assert!(first.check().is_ok());
        assert!(sessions.start("second".into()).is_err());
        sessions.cancel("first");
        assert!(first.check().is_err());
        drop(first);
        let second = sessions.start("second".into()).unwrap();
        sessions.stop("first");
        assert!(second.control.stopped_at().is_none());
    }
    #[test]
    fn cancellation_cannot_release_a_running_job_or_cancel_its_successor() {
        let sessions = Sessions::default();
        let first = sessions.start("first".into()).unwrap();
        assert!(sessions.start("second".into()).is_err());
        sessions.cancel("unknown");
        assert!(first.check().is_ok());
        sessions.cancel("first");
        sessions.cancel("first");
        assert!(first.check().is_err());
        assert!(sessions.start("second".into()).is_err());
        drop(first);
        let second = sessions.start("second".into()).unwrap();
        sessions.cancel("first");
        assert!(second.check().is_ok());
    }
}
