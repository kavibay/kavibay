//! Finds TVs on the local network, so setup is a click instead of an IP address.
//!
//! One SSDP search (the UPnP multicast every smart TV and cast device answers)
//! collects who is out there; each responder is then asked what it is: a
//! Samsung TV answers its remote API's info URL on port 8001, an Android TV
//! device accepts a connection on the remote port 6466.

use std::{
    collections::BTreeMap,
    net::{IpAddr, Ipv4Addr, SocketAddr},
    time::Duration,
};

use futures_util::future::join_all;
use serde::Serialize;
use tokio::{
    net::{TcpStream, UdpSocket},
    time::{timeout, Instant},
};

const SSDP: &str = "239.255.255.250:1900";
const SEARCH: &str = "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\n\
    MAN: \"ssdp:discover\"\r\nMX: 2\r\nST: ssdp:all\r\n\r\n";
/// SSDP devices answer within MX seconds; a little more catches slow ones.
const LISTEN: Duration = Duration::from_millis(2_500);
const PROBE: Duration = Duration::from_millis(1_500);

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DeviceKind {
    Samsung,
    AndroidTv,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub kind: DeviceKind,
    pub host: String,
    pub name: String,
}

/// The address of the adapter that holds the default route.
///
/// Connecting a UDP socket sends nothing; it only asks the OS which local
/// address it would use. Multicast needs this: on a machine with VirtualBox or
/// a hotspot adapter, an unbound search goes out of the wrong one and finds
/// nothing.
fn lan_address() -> std::io::Result<Ipv4Addr> {
    let probe = std::net::UdpSocket::bind("0.0.0.0:0")?;
    // TEST-NET-1 (RFC 5737): routed like the internet, never answered.
    probe.connect("192.0.2.1:9")?;
    match probe.local_addr()?.ip() {
        IpAddr::V4(ip) => Ok(ip),
        IpAddr::V6(_) => Err(std::io::Error::other("no IPv4 network")),
    }
}

/// Every address that answered the search, with the description URL it gave.
async fn ssdp_responders() -> Result<BTreeMap<Ipv4Addr, Option<String>>, String> {
    let local = lan_address().map_err(|error| format!("No network to search: {error}"))?;
    let socket = UdpSocket::bind(SocketAddr::from((local, 0)))
        .await
        .map_err(|error| error.to_string())?;
    socket
        .send_to(SEARCH.as_bytes(), SSDP)
        .await
        .map_err(|error| format!("Could not search the network: {error}"))?;

    let mut found = BTreeMap::new();
    let deadline = Instant::now() + LISTEN;
    let mut buf = [0u8; 2048];
    while let Ok(Ok((len, from))) = timeout(
        deadline.saturating_duration_since(Instant::now()),
        socket.recv_from(&mut buf),
    )
    .await
    {
        let IpAddr::V4(ip) = from.ip() else { continue };
        let reply = String::from_utf8_lossy(&buf[..len]);
        let location = reply.lines().find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("location")
                .then(|| value.trim().to_string())
        });
        let entry = found.entry(ip).or_insert(None);
        if entry.is_none() {
            *entry = location;
        }
    }
    Ok(found)
}

/// `[TV] Samsung TV` plus the model, from the TV's own info URL.
async fn samsung_name(client: &reqwest::Client, ip: Ipv4Addr) -> Option<String> {
    let info: serde_json::Value = client
        .get(format!("http://{ip}:8001/api/v2/"))
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;
    let device = &info["device"];
    if device["OS"].as_str() != Some("Tizen") {
        return None;
    }
    let name = device["name"].as_str().unwrap_or("Samsung TV");
    let name = name.strip_prefix("[TV] ").unwrap_or(name);
    Some(match device["modelName"].as_str() {
        Some(model) => format!("{name} ({model})"),
        None => name.to_string(),
    })
}

/// The `friendlyName` from a UPnP description, which is the name the user
/// gave the device. Only fetched from the device that announced it.
async fn friendly_name(client: &reqwest::Client, ip: Ipv4Addr, location: &str) -> Option<String> {
    let url = reqwest::Url::parse(location).ok()?;
    if url.host_str() != Some(ip.to_string().as_str()) {
        return None;
    }
    let xml = client.get(url).send().await.ok()?.text().await.ok()?;
    friendly_name_in(&xml)
}

fn friendly_name_in(xml: &str) -> Option<String> {
    let start = xml.find("<friendlyName>")? + "<friendlyName>".len();
    let end = start + xml[start..].find("</friendlyName>")?;
    let name = xml[start..end].trim();
    (!name.is_empty()).then(|| name.to_string())
}

async fn classify(
    client: &reqwest::Client,
    ip: Ipv4Addr,
    location: Option<String>,
) -> Option<Device> {
    let host = ip.to_string();
    if let Some(name) = samsung_name(client, ip).await {
        return Some(Device {
            kind: DeviceKind::Samsung,
            host,
            name,
        });
    }
    timeout(PROBE, TcpStream::connect((ip, super::REMOTE_PORT)))
        .await
        .ok()?
        .ok()?;
    let name = match location {
        Some(location) => friendly_name(client, ip, &location).await,
        None => None,
    };
    Some(Device {
        kind: DeviceKind::AndroidTv,
        host,
        name: name.unwrap_or_else(|| "Android TV".to_string()),
    })
}

/// Samsung TVs and Android TV devices on the local network.
pub async fn devices() -> Result<Vec<Device>, String> {
    let client = reqwest::Client::builder()
        .timeout(PROBE)
        .build()
        .map_err(|error| error.to_string())?;
    let responders = ssdp_responders().await?;
    let checks = responders
        .into_iter()
        .filter(|(ip, _)| ip.is_private())
        .map(|(ip, location)| classify(&client, ip, location));
    Ok(join_all(checks).await.into_iter().flatten().collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn friendly_name_is_read_from_the_description() {
        let xml = "<root><device><friendlyName> waipu.tv 4K Stick </friendlyName></device></root>";
        assert_eq!(friendly_name_in(xml).as_deref(), Some("waipu.tv 4K Stick"));
        assert_eq!(friendly_name_in("<friendlyName></friendlyName>"), None);
        assert_eq!(friendly_name_in("<root/>"), None);
    }

    /// Needs a real network: `cargo test --lib discover -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn lists_devices_on_this_network() {
        let found = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(devices())
            .unwrap();
        println!("{found:#?}");
    }
}
