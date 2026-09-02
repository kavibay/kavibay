//! In-flight chat cancellation registry (request ids).

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

/// Shared cancel flags for active LLM streams.
#[derive(Clone, Default)]
pub struct LlmState {
    cancelled: Arc<Mutex<HashSet<String>>>,
}

impl LlmState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Mark a request as cancelled so its stream loop exits.
    pub fn cancel(&self, request_id: &str) {
        if let Ok(mut set) = self.cancelled.lock() {
            set.insert(request_id.to_string());
        }
    }

    /// Clear any stale cancel flag before starting a stream.
    pub fn clear_cancel(&self, request_id: &str) {
        if let Ok(mut set) = self.cancelled.lock() {
            set.remove(request_id);
        }
    }

    /// True when the frontend asked to stop this request.
    pub fn is_cancelled(&self, request_id: &str) -> bool {
        self.cancelled
            .lock()
            .map(|set| set.contains(request_id))
            .unwrap_or(false)
    }

    /// Remove the cancel flag after the stream has stopped.
    pub fn finish(&self, request_id: &str) {
        self.clear_cancel(request_id);
    }
}
