use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

#[derive(Default)]
pub(super) struct Sessions(Mutex<Option<(String, Arc<AtomicBool>)>>);

pub(super) struct Session<'a> {
    owner: &'a Sessions,
    pub id: String,
    pub cancelled: Arc<AtomicBool>,
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
        let cancelled = Arc::new(AtomicBool::new(false));
        *active = Some((id.clone(), cancelled.clone()));
        Ok(Session {
            owner: self,
            id,
            cancelled,
        })
    }
    pub fn cancel(&self, id: &str) {
        if let Some((current, flag)) = &*self.0.lock().unwrap_or_else(|e| e.into_inner()) {
            if current == id {
                flag.store(true, Ordering::Release);
            }
        }
    }
}

impl Session<'_> {
    pub fn check(&self) -> Result<(), String> {
        if self.cancelled.load(Ordering::Acquire) {
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
