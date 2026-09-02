//! Focus Tracker: SQLite sessions/habits + Win32 focus/idle poller + Tauri commands.

use super::ExtensionRust;

/// The uniform entry point: which root folder this belongs to, and what the
/// host declares on its behalf. Empty lists are the statement, not an
/// omission — this extension reaches no network host through the host layer.
pub const EXTENSION: ExtensionRust = ExtensionRust {
    folder: "focus-tracker",
    capabilities: &[],
};

pub mod commands;
pub mod db;
pub mod tracker;
pub mod types;

pub use commands::*;
pub use db::FocusDb;
pub use tracker::{shutdown_tracker, start_tracker, FocusTrackerState};
