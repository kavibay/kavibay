//! System Info widget backend: CPU, memory, uptime, and battery snapshots,
//! plus disks, network counters, and the busiest processes on request.

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use starship_battery::{
    units::{ratio::percent, time::second},
    Manager, State as BatteryState,
};
use sysinfo::{
    DiskRefreshKind, Disks, Networks, Pid, ProcessRefreshKind, ProcessesToUpdate, System,
};

use super::ExtensionRust;

/// The uniform entry point for the System Info extension.
pub const EXTENSION: ExtensionRust = ExtensionRust {
    folder: "system-info",
    capabilities: &[],
};

/// How many process groups the widget lists.
const TOP_PROCESSES: usize = 5;

/// How long the kept process list outlives the last view that asked for it.
const PROCESS_LIST_IDLE: Duration = Duration::from_secs(30);

/// The process list, kept between calls while a large view shows it.
///
/// sysinfo sets a process's CPU baseline on its second refresh, not its first,
/// so a list made fresh per call reports every process's lifetime average —
/// measured: Chrome at 0.2 % on a machine at 11 %. Kept, each refresh measures
/// the interval since the previous one, like Task Manager. The list holds a
/// handle to every process, so a call that does not need it drops it once it
/// has been idle for `PROCESS_LIST_IDLE`.
struct ProcessList {
    sys: System,
    refreshes: u32,
    used: Instant,
}

static PROCESSES: Mutex<Option<ProcessList>> = Mutex::new(None);

fn process_list() -> MutexGuard<'static, Option<ProcessList>> {
    PROCESSES.lock().unwrap_or_else(PoisonError::into_inner)
}

/// The costlier sections, which the widget asks for only while its large view
/// shows them: the compact view polls every 5 s, and listing every process
/// that often for a list nobody sees is the cost this avoids.
#[derive(Deserialize, Default, Clone, Copy)]
#[serde(default)]
pub struct Include {
    disks: bool,
    processes: bool,
    network: bool,
}

#[derive(Serialize)]
pub struct BatteryInfo {
    percent: f32,
    state: String,
    time_to_empty_secs: Option<u64>,
}

#[derive(Serialize)]
pub struct DiskInfo {
    mount: String,
    total_bytes: u64,
    available_bytes: u64,
}

/// Lifetime byte counters of one adapter. The widget turns two of these into a
/// rate, per adapter, so one that connects between two samples is skipped
/// instead of counting its whole lifetime as a spike.
#[derive(Serialize)]
pub struct InterfaceTotals {
    name: String,
    received_bytes: u64,
    transmitted_bytes: u64,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct ProcessInfo {
    name: String,
    count: u32,
    cpu_percent: f32,
    memory_bytes: u64,
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
    disks: Option<Vec<DiskInfo>>,
    network: Option<Vec<InterfaceTotals>>,
    processes: Option<Vec<ProcessInfo>>,
}

/// Returns the first available battery's charge, state, and remaining discharge time.
fn battery_info() -> Option<BatteryInfo> {
    let manager = Manager::new().ok()?;
    let battery = manager.batteries().ok()?.next()?.ok()?;

    let state = match battery.state() {
        BatteryState::Charging => "charging",
        BatteryState::Discharging => "discharging",
        // Paused: on mains but held below full (a charge limit). Shown like full.
        BatteryState::Full | BatteryState::Paused => "full",
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

/// Mounted volumes with a size. An empty card reader or DVD drive reports
/// zero and is left out.
fn disk_info() -> Vec<DiskInfo> {
    let disks = Disks::new_with_refreshed_list_specifics(DiskRefreshKind::nothing().with_storage());
    let mut list: Vec<DiskInfo> = disks
        .list()
        .iter()
        .filter(|disk| disk.total_space() > 0)
        .map(|disk| DiskInfo {
            mount: disk
                .mount_point()
                .to_string_lossy()
                .trim_end_matches('\\')
                .to_string(),
            total_bytes: disk.total_space(),
            available_bytes: disk.available_space(),
        })
        .collect();
    list.sort_by(|a, b| a.mount.cmp(&b.mount));
    list
}

/// Byte counters of the connected hardware adapters (sysinfo drops virtual ones).
fn network_totals() -> Vec<InterfaceTotals> {
    Networks::new_with_refreshed_list()
        .list()
        .iter()
        .map(|(name, data)| InterfaceTotals {
            name: name.clone(),
            received_bytes: data.total_received(),
            transmitted_bytes: data.total_transmitted(),
        })
        .collect()
}

/// Groups processes by executable the way Task Manager groups an app's
/// helpers — twenty `chrome` at 1 % each are one answer, not twenty — and
/// returns the busiest groups. `cpu` arrives as sysinfo reports it, 100 per
/// fully used core, and leaves as a share of the whole machine like Task
/// Manager shows it.
fn top_processes(
    processes: impl IntoIterator<Item = (String, f32, u64)>,
    cpu_count: usize,
    limit: usize,
) -> Vec<ProcessInfo> {
    let mut groups: HashMap<String, (u32, f32, u64)> = HashMap::new();
    for (name, cpu, memory) in processes {
        let name = name.strip_suffix(".exe").unwrap_or(&name).to_string();
        let group = groups.entry(name).or_default();
        group.0 += 1;
        group.1 += cpu;
        group.2 += memory;
    }

    let cores = cpu_count.max(1) as f32;
    let mut top: Vec<ProcessInfo> = groups
        .into_iter()
        .map(|(name, (count, cpu, memory))| ProcessInfo {
            name,
            count,
            // Rounded before sorting so idle noise (0.03 % vs 0.01 %) ties and
            // memory decides the order, which is what stays stable on screen.
            cpu_percent: ((cpu / cores).clamp(0.0, 100.0) * 10.0).round() / 10.0,
            memory_bytes: memory,
        })
        .collect();
    top.sort_by(|a, b| {
        b.cpu_percent
            .total_cmp(&a.cpu_percent)
            .then(b.memory_bytes.cmp(&a.memory_bytes))
    });
    top.truncate(limit);
    top
}

/// Refreshes the kept list and returns its busiest groups; `None` until it has
/// two refreshes behind it, while its numbers are still lifetime averages.
fn sample_processes(cpu_count: usize) -> Option<Vec<ProcessInfo>> {
    let mut guard = process_list();
    let list = guard.get_or_insert_with(|| ProcessList {
        sys: System::new(),
        refreshes: 0,
        used: Instant::now(),
    });
    list.sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_cpu().with_memory(),
    );
    list.refreshes = list.refreshes.saturating_add(1);
    list.used = Instant::now();
    if list.refreshes < 3 {
        return None;
    }
    Some(top_processes(
        list.sys
            .processes()
            .iter()
            // Pid 0 is the idle process: never a process anyone is looking for.
            .filter(|(pid, _)| **pid != Pid::from_u32(0))
            .map(|(_, process)| {
                (
                    process.name().to_string_lossy().into_owned(),
                    process.cpu_usage(),
                    process.memory(),
                )
            }),
        cpu_count,
        TOP_PROCESSES,
    ))
}

/// Delivers a live system snapshot to the contract host.
///
/// Async because of the sample window: CPU usage is the difference between two
/// reads, and a synchronous command runs on the UI thread — the 200 ms between
/// them froze the whole app on every refresh the widget asked for. Listing
/// processes stays outside that window: it costs CPU of its own, which would
/// otherwise show up in the number it sits next to.
#[tauri::command]
pub async fn widget_system_info(include: Option<Include>) -> Result<SystemInfo, String> {
    let include = include.unwrap_or_default();
    if include.processes {
        // A new list's first refresh, so the one after the window is its second.
        if process_list().is_none() {
            sample_processes(0);
        }
    } else {
        let mut list = process_list();
        if list
            .as_ref()
            .is_some_and(|list| list.used.elapsed() > PROCESS_LIST_IDLE)
        {
            *list = None;
        }
    }

    let mut sys = System::new();
    sys.refresh_memory();
    sys.refresh_cpu_all();
    tokio::time::sleep(Duration::from_millis(200)).await;
    sys.refresh_cpu_all();

    let processes = if include.processes {
        Some(sample_processes(sys.cpus().len()).unwrap_or_default())
    } else {
        None
    };

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
        disks: include.disks.then(disk_info),
        network: include.network.then(network_totals),
        processes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn proc(name: &str, cpu: f32, memory: u64) -> (String, f32, u64) {
        (name.to_string(), cpu, memory)
    }

    #[test]
    fn groups_by_name_and_normalises_cpu_to_the_machine() {
        let top = top_processes(
            [
                proc("chrome.exe", 40.0, 300),
                proc("chrome.exe", 40.0, 200),
                proc("code.exe", 20.0, 100),
            ],
            4,
            5,
        );
        assert_eq!(
            top,
            vec![
                ProcessInfo {
                    name: "chrome".into(),
                    count: 2,
                    cpu_percent: 20.0,
                    memory_bytes: 500,
                },
                ProcessInfo {
                    name: "code".into(),
                    count: 1,
                    cpu_percent: 5.0,
                    memory_bytes: 100,
                },
            ]
        );
    }

    #[test]
    fn idle_noise_ties_and_memory_decides() {
        let top = top_processes(
            [
                proc("small", 0.04, 10),
                proc("big", 0.02, 900),
                proc("busy", 8.0, 1),
            ],
            1,
            2,
        );
        let names: Vec<&str> = top.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, ["busy", "big"]);
    }
}
