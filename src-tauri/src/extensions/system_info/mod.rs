//! System Info widget backend: CPU, memory, uptime, and battery snapshots.

use std::{thread, time::Duration};

use serde::Serialize;
use starship_battery::{
    units::{ratio::percent, time::second},
    Manager, State as BatteryState,
};
use sysinfo::System;

use super::ExtensionRust;

/// The uniform entry point for the System Info extension.
pub const EXTENSION: ExtensionRust = ExtensionRust {
    folder: "system-info",
    capabilities: &[],
};

#[derive(Serialize)]
pub struct BatteryInfo {
    percent: f32,
    state: String,
    time_to_empty_secs: Option<u64>,
}

#[derive(Serialize)]
pub struct SystemInfo {
    os_name: String,
    os_version: String,
    hostname: String,
    cpu_count: usize,
    cpu_brand: String,
    cpu_usage_percent: f32,
    used_memory_mb: u64,
    total_memory_mb: u64,
    uptime_secs: u64,
    battery: Option<BatteryInfo>,
}

/// Returns the first available battery's charge, state, and remaining discharge time.
fn battery_info() -> Option<BatteryInfo> {
    let manager = Manager::new().ok()?;
    let battery = manager.batteries().ok()?.next()?.ok()?;

    let state = match battery.state() {
        BatteryState::Charging => "charging",
        BatteryState::Discharging => "discharging",
        BatteryState::Full => "full",
        BatteryState::Empty => "empty",
        BatteryState::Unknown => "unknown",
    };

    Some(BatteryInfo {
        percent: battery.state_of_charge().get::<percent>().clamp(0.0, 100.0),
        state: state.to_string(),
        time_to_empty_secs: battery
            .time_to_empty()
            .map(|time| time.get::<second>().max(0.0) as u64),
    })
}

/// Delivers a live system snapshot to the contract host.
#[tauri::command]
pub fn widget_system_info() -> Result<SystemInfo, String> {
    let mut sys = System::new();
    sys.refresh_memory();
    sys.refresh_cpu_all();
    thread::sleep(Duration::from_millis(200));
    sys.refresh_cpu_all();

    Ok(SystemInfo {
        os_name: System::name().unwrap_or_else(|| "unknown".to_string()),
        os_version: System::os_version().unwrap_or_else(|| "unknown".to_string()),
        hostname: System::host_name().unwrap_or_else(|| "unknown".to_string()),
        cpu_count: sys.cpus().len(),
        cpu_brand: sys
            .cpus()
            .first()
            .map(|cpu| cpu.brand().trim())
            .filter(|brand| !brand.is_empty())
            .unwrap_or("CPU")
            .to_string(),
        cpu_usage_percent: sys.global_cpu_usage().clamp(0.0, 100.0),
        used_memory_mb: sys.used_memory() / 1024 / 1024,
        total_memory_mb: sys.total_memory() / 1024 / 1024,
        uptime_secs: System::uptime(),
        battery: battery_info(),
    })
}
