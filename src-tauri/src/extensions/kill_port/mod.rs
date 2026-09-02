//! Kill the process listening on a TCP port (palette "Kill Port" action).
//!
//! Windows uses the IP Helper owner-PID listener tables. Linux reads
//! `/proc/net/tcp{,6}` and matches socket inodes under `/proc/<pid>/fd`.
//! macOS is stubbed until the port lands.

use super::ExtensionRust;

/// The uniform entry point: which root folder this belongs to, and what the
/// host declares on its behalf. Empty lists are the statement, not an
/// omission — this extension reaches no network host through the host layer.
pub const EXTENSION: ExtensionRust = ExtensionRust {
    folder: "kill-port",
    capabilities: &[],
};

use serde::Serialize;
use std::collections::HashSet;

/// One process that was listening on the requested port and was terminated.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct KilledProcess {
    pub pid: u32,
    pub name: String,
}

/// Result handed back to the extension after a successful kill.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct KillPortResult {
    pub port: u16,
    pub killed: Vec<KilledProcess>,
}

/// Stop every process that currently owns a TCP listen socket on `port`.
#[tauri::command]
pub fn kill_port(port: u16) -> Result<KillPortResult, String> {
    if port == 0 {
        return Err("port must be between 1 and 65535".into());
    }

    #[cfg(windows)]
    {
        kill_port_windows(port)
    }
    #[cfg(target_os = "linux")]
    {
        kill_port_linux(port)
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        Err("Kill Port is only supported on Windows".into())
    }
}

/// Convert a MIB_* `dwLocalPort` DWORD (network order in the low 16 bits) to a host port.
#[cfg(any(windows, test))]
pub fn network_port_to_host(raw: u32) -> u16 {
    u16::from_be((raw & 0xFFFF) as u16)
}

/// PIDs we must never terminate: idle/system/init and ourselves.
pub fn is_protected_pid(pid: u32, self_pid: u32) -> bool {
    if pid == 0 || pid == self_pid {
        return true;
    }
    #[cfg(windows)]
    {
        pid == 4
    }
    #[cfg(not(windows))]
    {
        pid == 1
    }
}

/// Parse one `/proc/net/tcp` or `/proc/net/tcp6` data line.
///
/// Returns `(port, inode)` only for LISTEN rows (`st == 0A`). The header line
/// and established connections yield `None`.
// Only `collect_listen_inodes` calls this, and that is Linux-only — but the
// parser is pure and worth testing on every platform, so it stays compiled.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn parse_proc_net_listen_line(line: &str) -> Option<(u16, u64)> {
    let cols: Vec<&str> = line.split_whitespace().collect();
    if cols.len() < 10 {
        return None;
    }
    if cols[3] != "0A" {
        return None;
    }
    let port_hex = cols[1].rsplit_once(':')?.1;
    let port = u16::from_str_radix(port_hex, 16).ok()?;
    if port == 0 {
        return None;
    }
    let inode: u64 = cols[9].parse().ok()?;
    if inode == 0 {
        return None;
    }
    Some((port, inode))
}

/// `socket:[12345]` fd symlink target → inode.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn socket_inode_from_fd_target(target: &str) -> Option<u64> {
    target
        .strip_prefix("socket:[")?
        .strip_suffix(']')?
        .parse()
        .ok()
}

/// Deduplicate PIDs while keeping first-seen order.
pub fn unique_pids(pids: &[u32]) -> Vec<u32> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for &pid in pids {
        if seen.insert(pid) {
            out.push(pid);
        }
    }
    out
}

/// Shared kill loop so Windows and Linux only differ in how they list and name.
#[cfg(any(windows, target_os = "linux"))]
fn terminate_pids(
    port: u16,
    pids: &[u32],
    name_of: impl Fn(u32) -> String,
) -> Result<KillPortResult, String> {
    let self_pid = std::process::id();
    let mut killed = Vec::new();
    let mut blocked = Vec::new();

    for &pid in pids {
        let name = name_of(pid);
        if is_protected_pid(pid, self_pid) {
            blocked.push((pid, name));
            continue;
        }
        terminate_pid(pid).map_err(|e| format!("cannot kill {name} (pid {pid}): {e}"))?;
        killed.push(KilledProcess { pid, name });
    }

    if killed.is_empty() {
        if let Some((pid, name)) = blocked.first() {
            return Err(format!(
                "port {port} is held by a protected process ({name}, pid {pid})"
            ));
        }
        return Err(format!("no process is listening on port {port}"));
    }
    Ok(KillPortResult { port, killed })
}

#[cfg(windows)]
fn kill_port_windows(port: u16) -> Result<KillPortResult, String> {
    let pids = unique_pids(&listener_pids_windows(port)?);
    terminate_pids(port, &pids, process_base_name_windows)
}

#[cfg(target_os = "linux")]
fn kill_port_linux(port: u16) -> Result<KillPortResult, String> {
    let pids = unique_pids(&listener_pids_linux(port)?);
    terminate_pids(port, &pids, process_base_name_linux)
}

#[cfg(windows)]
fn terminate_pid(pid: u32) -> Result<(), String> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE};

    unsafe {
        let handle = OpenProcess(PROCESS_TERMINATE, false, pid).map_err(|e| e.to_string())?;
        let result = TerminateProcess(handle, 1);
        let _ = CloseHandle(handle);
        result.map_err(|e| e.to_string())
    }
}

#[cfg(target_os = "linux")]
fn terminate_pid(pid: u32) -> Result<(), String> {
    let status = std::process::Command::new("kill")
        .args(["-KILL", &pid.to_string()])
        .status()
        .map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("kill exited {status}"))
    }
}

#[cfg(windows)]
fn listener_pids_windows(port: u16) -> Result<Vec<u32>, String> {
    use windows::Win32::Networking::WinSock::{AF_INET, AF_INET6};

    let mut pids = Vec::new();
    collect_tcp_listener_pids(AF_INET.0 as u32, port, &mut pids)?;
    collect_tcp_listener_pids(AF_INET6.0 as u32, port, &mut pids)?;
    Ok(pids)
}

#[cfg(windows)]
fn collect_tcp_listener_pids(family: u32, port: u16, pids: &mut Vec<u32>) -> Result<(), String> {
    use windows::Win32::Foundation::{ERROR_INSUFFICIENT_BUFFER, NO_ERROR, WIN32_ERROR};
    use windows::Win32::NetworkManagement::IpHelper::{
        GetExtendedTcpTable, MIB_TCP6TABLE_OWNER_PID, MIB_TCPTABLE_OWNER_PID,
        TCP_TABLE_OWNER_PID_LISTENER,
    };
    use windows::Win32::Networking::WinSock::AF_INET6;

    let mut size = 0u32;
    // Size probe — Windows answers ERROR_INSUFFICIENT_BUFFER with the byte count.
    let probe = unsafe {
        GetExtendedTcpTable(
            None,
            &mut size,
            false,
            family,
            TCP_TABLE_OWNER_PID_LISTENER,
            0,
        )
    };
    if WIN32_ERROR(probe) == NO_ERROR || size == 0 {
        return Ok(());
    }
    if WIN32_ERROR(probe) != ERROR_INSUFFICIENT_BUFFER {
        return Err(format!("GetExtendedTcpTable failed ({probe})"));
    }

    let mut buf = vec![0u8; size as usize];
    let status = unsafe {
        GetExtendedTcpTable(
            Some(buf.as_mut_ptr().cast()),
            &mut size,
            false,
            family,
            TCP_TABLE_OWNER_PID_LISTENER,
            0,
        )
    };
    if WIN32_ERROR(status) != NO_ERROR {
        return Err(format!("GetExtendedTcpTable failed ({status})"));
    }
    buf.truncate(size as usize);

    unsafe {
        if family == AF_INET6.0 as u32 {
            let table = &*(buf.as_ptr() as *const MIB_TCP6TABLE_OWNER_PID);
            let n = table.dwNumEntries as usize;
            let rows = std::slice::from_raw_parts(table.table.as_ptr(), n);
            for row in rows {
                if network_port_to_host(row.dwLocalPort) == port {
                    pids.push(row.dwOwningPid);
                }
            }
        } else {
            let table = &*(buf.as_ptr() as *const MIB_TCPTABLE_OWNER_PID);
            let n = table.dwNumEntries as usize;
            let rows = std::slice::from_raw_parts(table.table.as_ptr(), n);
            for row in rows {
                if network_port_to_host(row.dwLocalPort) == port {
                    pids.push(row.dwOwningPid);
                }
            }
        }
    }
    Ok(())
}

#[cfg(windows)]
fn process_base_name_windows(pid: u32) -> String {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };

    let fallback = format!("pid {pid}");
    unsafe {
        let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
            return fallback;
        };
        let mut buf = [0u16; 1024];
        let mut size = buf.len() as u32;
        let result = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            PWSTR(buf.as_mut_ptr()),
            &mut size,
        );
        let _ = CloseHandle(handle);
        if result.is_err() {
            return fallback;
        }
        let path = String::from_utf16_lossy(&buf[..size as usize]);
        std::path::Path::new(&path)
            .file_stem()
            .and_then(|n| n.to_str())
            .map(|s| s.to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or(fallback)
    }
}

#[cfg(target_os = "linux")]
fn listener_pids_linux(port: u16) -> Result<Vec<u32>, String> {
    let mut inodes = HashSet::new();
    collect_listen_inodes("/proc/net/tcp", port, &mut inodes)?;
    collect_listen_inodes("/proc/net/tcp6", port, &mut inodes)?;
    if inodes.is_empty() {
        return Ok(Vec::new());
    }
    Ok(pids_holding_inodes(&inodes))
}

#[cfg(target_os = "linux")]
fn collect_listen_inodes(path: &str, port: u16, inodes: &mut HashSet<u64>) -> Result<(), String> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(err) => return Err(format!("cannot read {path}: {err}")),
    };
    for line in text.lines() {
        match parse_proc_net_listen_line(line) {
            Some((listen_port, inode)) if listen_port == port => {
                inodes.insert(inode);
            }
            _ => {}
        }
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn pids_holding_inodes(inodes: &HashSet<u64>) -> Vec<u32> {
    let mut found = Vec::new();
    let Ok(proc_dir) = std::fs::read_dir("/proc") else {
        return found;
    };
    for entry in proc_dir.flatten() {
        let name = entry.file_name();
        let Some(pid) = name.to_str().and_then(|s| s.parse::<u32>().ok()) else {
            continue;
        };
        let Ok(fds) = std::fs::read_dir(entry.path().join("fd")) else {
            continue;
        };
        for fd in fds.flatten() {
            let Ok(target) = std::fs::read_link(fd.path()) else {
                continue;
            };
            match socket_inode_from_fd_target(&target.to_string_lossy()) {
                Some(inode) if inodes.contains(&inode) => {
                    found.push(pid);
                    break;
                }
                _ => {}
            }
        }
    }
    found
}

#[cfg(target_os = "linux")]
fn process_base_name_linux(pid: u32) -> String {
    let fallback = format!("pid {pid}");
    let Ok(comm) = std::fs::read_to_string(format!("/proc/{pid}/comm")) else {
        return fallback;
    };
    let name = comm.trim();
    if name.is_empty() {
        fallback
    } else {
        name.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn network_port_to_host_reads_the_low_word() {
        assert_eq!(network_port_to_host(u16::to_be(3000) as u32), 3000);
        assert_eq!(network_port_to_host(u16::to_be(80) as u32), 80);
        assert_eq!(network_port_to_host(u16::to_be(65535) as u32), 65535);
        assert_eq!(network_port_to_host(0), 0);
    }

    #[test]
    fn protected_pids_include_zero_and_self() {
        assert!(is_protected_pid(0, 99));
        assert!(is_protected_pid(99, 99));
        assert!(!is_protected_pid(1234, 99));
        #[cfg(windows)]
        assert!(is_protected_pid(4, 99));
        #[cfg(not(windows))]
        assert!(is_protected_pid(1, 99));
    }

    #[test]
    fn unique_pids_keeps_first_seen_order() {
        assert_eq!(unique_pids(&[10, 4, 10, 7]), vec![10, 4, 7]);
        assert_eq!(unique_pids(&[]), Vec::<u32>::new());
    }

    #[test]
    fn proc_net_listen_line_reads_port_and_inode() {
        let line = "   0: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 12345 1 0000000000000000 100 0 0 10 0";
        assert_eq!(parse_proc_net_listen_line(line), Some((0x1F90, 12345)));
    }

    #[test]
    fn proc_net_skips_header_and_non_listen() {
        assert_eq!(
            parse_proc_net_listen_line(
                "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode"
            ),
            None
        );
        let established = "   1: 0100007F:1F90 0100007F:0050 01 00000000:00000000 00:00000000 00000000     0        0 99 1 0000000000000000 100 0 0 10 0";
        assert_eq!(parse_proc_net_listen_line(established), None);
    }

    #[test]
    fn socket_inode_parses_proc_fd_targets() {
        assert_eq!(socket_inode_from_fd_target("socket:[12345]"), Some(12345));
        assert_eq!(socket_inode_from_fd_target("/dev/null"), None);
        assert_eq!(socket_inode_from_fd_target("socket:[abc]"), None);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn kills_a_child_tcp_listener() {
        use std::io::{BufRead, BufReader};
        use std::process::{Command, Stdio};

        let mut child = Command::new("python3")
            .args([
                "-c",
                "import socket, time\n\
s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)\n\
s.bind(('127.0.0.1', 0))\n\
print(s.getsockname()[1], flush=True)\n\
s.listen(1)\n\
time.sleep(30)\n",
            ])
            .stdout(Stdio::piped())
            .spawn()
            .expect("python3");
        let stdout = child.stdout.take().expect("stdout");
        let mut line = String::new();
        BufReader::new(stdout)
            .read_line(&mut line)
            .expect("port line");
        let port: u16 = line.trim().parse().expect("port");
        let result = kill_port(port).expect("kill_port");
        assert_eq!(result.port, port);
        assert_eq!(result.killed.len(), 1);
        assert_eq!(result.killed[0].pid, child.id());
        let status = child.wait().expect("wait");
        assert!(!status.success(), "child should have been killed");
    }
}
