//! Streaming chat against Anthropic, Cloudflare Workers AI, or a Chat
//! Completions service (OpenAI, DeepSeek, OpenRouter).
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
mod turn;

pub use commands::*;
pub(crate) use prefs::{
    disabled_quick_actions, quick_shortcut, set_disabled_quick_actions, set_quick_shortcut,
};
/// The wizard's non-streamed requests read the same service profiles.
pub(crate) use provider::{chatgpt_error_sentence, CacheHits, ChatCompletions};
pub use state::LlmState;
