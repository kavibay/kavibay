fn main() {
    // The icon set is embedded at compile time (window/tray icon via
    // `generate_context!`, exe resource via winres). `tauri_build` only watches
    // tauri.conf.json, so without this a changed icon leaves a stale build.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
