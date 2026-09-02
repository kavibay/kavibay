//! Streaming chat against Anthropic, OpenAI, or Cloudflare Workers AI.
//!
//! Credentials live in `crate::credentials` (one type per provider); the
//! legacy `cloudflare_ai.db` is read once by `credentials::import`.

mod api;
pub mod catalog;
mod commands;
mod prefs;
mod provider;
mod sse;
mod state;

pub use commands::*;
pub(crate) use prefs::{
    disabled_quick_actions, quick_shortcut, set_disabled_quick_actions, set_quick_shortcut,
};
pub use state::LlmState;
