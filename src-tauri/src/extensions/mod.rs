//! The Rust half of the first-party extensions.
//!
//! ONE DIRECTORY PER EXTENSION, ALL THE SAME SHAPE — the layout `extensions/`
//! in the repo root already has. Every subdirectory here holds a `mod.rs` that
//! opens with an `EXTENSION` constant naming the root folder it belongs to and
//! declaring whatever the host must state on its behalf, followed by that
//! extension's own modules. `ALL` below lists them, and the tests at the bottom
//! fail if a directory is missing from it or names a folder that does not exist.
//!
//! An extension is free to have no Rust at all — most do, and since providers
//! are generated into `generated.rs` from `extensions/*/provider.ts`, tado°,
//! GitHub and Google Calendar are among them: their whole Rust half was the
//! allowlist, and the allowlist is now derived. What an extension may not have
//! is Rust that lives somewhere else, or two extensions in one file.
//!
//! WHAT BELONGS HERE. A module whose commands exist for exactly one widget
//! under `extensions/<id>/`. These used to sit flat beside the host's own
//! modules, which made `src-tauri/src/` read as though a clipboard history and
//! the credential vault were the same kind of thing.
//!
//! WHAT DOES NOT. Anything the host itself needs, or that more than one
//! extension shares: `commands`, `credentials`, `security`, `web_storage`,
//! `quick_action`, `file_search`, `runtime_extensions`, `extension_providers`.
//! Two live on the line and stay out deliberately — `llm` is shared by Single
//! Purpose LLM and the Widget Wizard, and `wizard` is the AI builder's control
//! plane, which AGENTS.md keeps host-side.
//!
//! THIS IS ORGANISATION, NOT A BOUNDARY. Everything here is compiled into the
//! same binary with the same privileges; moving a module in or out grants and
//! removes nothing. The boundaries that do enforce something are the provider
//! allowlist in `extension_providers` and the credential path in `credentials`,
//! and neither is here for that reason.

// Written by `scripts/providerSchemaDoc.ts` and compared byte for byte by its
// assert; rustfmt rewrapping a long line would fail that check.
#[rustfmt::skip]
mod generated;

pub mod ai_usage;
pub mod app_launcher;
pub mod clipboard_widget;
pub mod color_picker;
pub mod focus_tracker;
pub mod image_widget;
pub mod kill_port;
pub mod now_playing;
pub mod stocks;
pub mod system_info;
pub mod weather;

use crate::extension_providers::{CapabilityHosts, ProviderDef};

/// What one extension's Rust half declares about itself.
///
/// The same struct for all of them, so the entry point of every directory here
/// reads the same and a reviewer can find one fact in one place. Most fields
/// are empty for most extensions — an empty `providers` is the statement "this
/// one sends no credential anywhere", which is worth being able to read.
pub struct ExtensionRust {
    /// The folder under `extensions/` in the repo root that this belongs to.
    ///
    /// Stated, not derived: Rust module names are snake_case and the folders
    /// are kebab-case, and three of them do not correspond at all
    /// (`app_launcher` is `launcher-buttons`).
    ///
    /// Read only by the tests below, which is the point rather than an
    /// oversight — the value is a claim about the repo ("this Rust belongs to
    /// that extension") and its consumer is the check that the claim holds. The
    /// running app has no use for it and should not grow one.
    #[allow(dead_code)]
    pub folder: &'static str,
    /// Hosts an `http` capability may reach, and nothing else.
    ///
    /// Providers are no longer declared here: they are generated into
    /// `generated.rs` from `extensions/*/provider.ts`, which is the one place
    /// a provider is now described (FINDINGS §28).
    /// Never an auth boundary — finding 11.
    pub capabilities: &'static [CapabilityHosts],
}

/// Every extension with a Rust half.
///
/// Rust has no module auto-discovery, so one list has to exist; this is it, and
/// it holds only references. The values, and the tests that pin them, live in
/// the extension's own directory — adding a host to Weather touches
/// `weather/mod.rs` and nothing else. `extension_providers` owns the machinery
/// and names no extension at all.
pub const ALL: &[&ExtensionRust] = &[
    &ai_usage::EXTENSION,
    &app_launcher::EXTENSION,
    &clipboard_widget::EXTENSION,
    &color_picker::EXTENSION,
    &focus_tracker::EXTENSION,
    &image_widget::EXTENSION,
    &kill_port::EXTENSION,
    &now_playing::EXTENSION,
    &stocks::EXTENSION,
    &system_info::EXTENSION,
    &weather::EXTENSION,
];

/// Every declared provider, across all extensions.
pub fn providers() -> impl Iterator<Item = &'static ProviderDef> {
    generated::PROVIDERS.iter()
}

/// Every declared capability, across all extensions.
pub fn capabilities() -> impl Iterator<Item = &'static CapabilityHosts> {
    ALL.iter()
        .flat_map(|extension| extension.capabilities.iter())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn repo_root() -> &'static Path {
        // CARGO_MANIFEST_DIR is `src-tauri`; the extension folders are its sibling.
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("src-tauri has a parent")
    }

    /// A directory added here and forgotten in `ALL` compiles, ships, and
    /// declares nothing — the exact failure this list exists to prevent.
    #[test]
    fn every_directory_is_listed() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/extensions");
        let mut found = 0;
        for entry in std::fs::read_dir(&dir).expect("extensions dir") {
            let entry = entry.expect("dir entry");
            if entry.file_type().expect("file type").is_dir() {
                found += 1;
                assert!(
                    entry.path().join("mod.rs").exists(),
                    "{:?} has no mod.rs — every extension directory has the same entry point",
                    entry.file_name()
                );
            }
        }
        assert_eq!(
            found,
            ALL.len(),
            "{found} extension directories but {} entries in ALL",
            ALL.len()
        );
    }

    /// The Rust half must belong to an extension that exists.
    #[test]
    fn every_declared_folder_exists() {
        for extension in ALL {
            assert!(
                repo_root()
                    .join("extensions")
                    .join(extension.folder)
                    .is_dir(),
                "extensions/{} does not exist",
                extension.folder
            );
        }
    }

    #[test]
    fn folders_are_claimed_once() {
        for (index, extension) in ALL.iter().enumerate() {
            assert!(
                !ALL[..index].iter().any(|e| e.folder == extension.folder),
                "two Rust modules claim extensions/{}",
                extension.folder
            );
        }
    }
}
