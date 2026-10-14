//! TV Remote: key presses for a Samsung TV (`samsung.rs`, the default) and,
//! optionally, an Android TV or Google TV device such as the waipu.tv 4K
//! Stick, over Android TV Remote v2 — the protocol Google's own phone remote
//! uses. `discover.rs` finds both on the network.
//!
//! Android TV pairing happens once, on port 6467: the TV shows a six-digit hex code and
//! the user types it into the widget. Afterwards the TV accepts our client
//! certificate on port 6466, where one TLS connection stays open: the TV pings
//! every five seconds, and keys are sent down the same connection, so a press
//! does not pay for a TLS handshake.
//!
//! Only addresses on the local network are accepted. The commands are as
//! powerful as a remote in the room, which is the point, but they are no
//! reason to let the webview open TLS connections to the internet.

mod apps;
mod discover;
mod identity;
mod samsung;
mod wire;

use std::{net::IpAddr, sync::Arc, time::Duration};

use tauri::{AppHandle, State};
use tokio::{
    io::{AsyncWrite, AsyncWriteExt, ReadHalf},
    net::TcpStream,
    sync::{mpsc, oneshot, MappedMutexGuard, Mutex, MutexGuard},
    time::timeout,
};
use tokio_rustls::{
    client::TlsStream,
    rustls::{pki_types::ServerName, ClientConfig},
    TlsConnector,
};

use super::ExtensionRust;
use identity::Store;
use wire::Value;

/// The uniform entry point. Empty lists are the statement: this extension
/// reaches no internet host and holds no integration credential.
pub const EXTENSION: ExtensionRust = ExtensionRust {
    folder: "tv-remote",
    capabilities: &[],
};

const PAIRING_PORT: u16 = 6467;
const REMOTE_PORT: u16 = 6466;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const REPLY_TIMEOUT: Duration = Duration::from_secs(10);
/// The TV pings every five seconds; three missed pings mean the link is gone.
const IDLE_TIMEOUT: Duration = Duration::from_secs(16);
/// What the TV shows while asking for the code.
const CLIENT_NAME: &str = "Kavibay";

#[derive(Default)]
pub struct TvRemote {
    store: Mutex<Option<Store>>,
    pairing: Mutex<Option<Pairing>>,
    link: Mutex<Option<Link>>,
    /// The open connection to a Samsung TV taking volume keys.
    samsung: Mutex<Option<Link>>,
}

/// A pairing waiting for the code: the TV keeps it on screen only while this
/// connection stays open.
struct Pairing {
    host: String,
    stream: TlsStream<TcpStream>,
    server_cert: Vec<u8>,
}

/// The open remote connection. Frames sent here go out in order; an empty
/// frame closes it.
struct Link {
    host: String,
    tx: mpsc::UnboundedSender<Vec<u8>>,
}

impl Link {
    fn close(self) {
        let _ = self.tx.send(Vec::new());
    }
}

/// Writes queued frames in order until an empty frame or a write fails, then
/// closes. Dropping the receiver is what tells senders the link is gone.
fn spawn_writer<W>(mut writer: W) -> mpsc::UnboundedSender<Vec<u8>>
where
    W: AsyncWrite + Unpin + Send + 'static,
{
    let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();
    tauri::async_runtime::spawn(async move {
        while let Some(bytes) = rx.recv().await {
            if bytes.is_empty() || writer.write_all(&bytes).await.is_err() {
                break;
            }
            if writer.flush().await.is_err() {
                break;
            }
        }
        let _ = writer.shutdown().await;
    });
    tx
}

/// Only a literal address on the local network.
// ponytail: IPv4 only — no hostnames, mDNS or IPv6; add when a TV needs it.
fn parse_host(host: &str) -> Result<IpAddr, String> {
    let ip: IpAddr = host
        .trim()
        .parse()
        .map_err(|_| "Enter the TV's IP address, for example 192.168.178.32.".to_string())?;
    match ip {
        IpAddr::V4(v4) if v4.is_private() || v4.is_link_local() => Ok(ip),
        _ => Err("Only a TV on the local network can be controlled (192.168.x.x, 10.x.x.x or 172.16–31.x.x).".into()),
    }
}

/// The Android key code for each button the widget has.
fn key_code(key: &str) -> Option<u64> {
    Some(match key {
        "home" => 3,
        "back" => 4,
        "up" => 19,
        "down" => 20,
        "left" => 21,
        "right" => 22,
        "ok" => 23,
        "volumeUp" => 24,
        "volumeDown" => 25,
        "power" => 26,
        "menu" => 82,
        "playPause" => 85,
        "mute" => 164,
        "info" => 165,
        "channelUp" => 166,
        "channelDown" => 167,
        "guide" => 172,
        // KEYCODE_0 is 7, through KEYCODE_9 at 16.
        digit if digit.len() == 1 && digit.as_bytes()[0].is_ascii_digit() => {
            7 + u64::from(digit.as_bytes()[0] - b'0')
        }
        _ => return None,
    })
}

/// The identity, loaded on first use. Creating it generates an RSA key, which
/// is CPU work and runs off the async threads.
async fn store<'a>(
    app: &AppHandle,
    state: &'a TvRemote,
) -> Result<MappedMutexGuard<'a, Store>, String> {
    let mut guard = state.store.lock().await;
    if guard.is_none() {
        let dir = crate::paths::data_dir(app)?;
        let loaded = tauri::async_runtime::spawn_blocking(move || Store::load_or_create(&dir))
            .await
            .map_err(|error| error.to_string())??;
        *guard = Some(loaded);
    }
    Ok(MutexGuard::map(guard, |store| {
        store.as_mut().expect("loaded above")
    }))
}

async fn connect(
    config: Arc<ClientConfig>,
    ip: IpAddr,
    port: u16,
) -> Result<TlsStream<TcpStream>, String> {
    let unreachable =
        || "The TV did not answer. Is it switched on and on this network?".to_string();
    let tcp = timeout(CONNECT_TIMEOUT, TcpStream::connect((ip, port)))
        .await
        .map_err(|_| unreachable())?
        .map_err(|_| unreachable())?;
    timeout(
        CONNECT_TIMEOUT,
        TlsConnector::from(config).connect(ServerName::from(ip), tcp),
    )
    .await
    .map_err(|_| unreachable())?
    .map_err(|error| format!("The connection to the TV failed: {error}"))
}

/// Sends one pairing message and checks the reply carries `expect`.
async fn exchange(
    stream: &mut TlsStream<TcpStream>,
    body: &[u8],
    expect: u32,
) -> Result<(), String> {
    let lost = |error: std::io::Error| format!("The TV closed the pairing: {error}");
    stream.write_all(&wire::frame(body)).await.map_err(lost)?;
    stream.flush().await.map_err(lost)?;
    let reply = timeout(REPLY_TIMEOUT, wire::read_frame(stream))
        .await
        .map_err(|_| "The TV stopped answering. Start the pairing again.".to_string())?
        .map_err(lost)?;
    match wire::varint_of(&reply, 2) {
        Some(wire::STATUS_OK) => {}
        Some(402) => return Err("The TV did not accept that code. Start the pairing again.".into()),
        status => return Err(format!("The TV refused to pair (status {status:?}).")),
    }
    wire::bytes_of(&reply, expect)
        .map(|_| ())
        .ok_or_else(|| "The TV answered something unexpected while pairing.".into())
}

/// The reply to one message from the TV, if it needs one. `features` starts
/// as what we ask for and narrows to what the TV announces.
fn answer(
    body: &[u8],
    features: &mut u64,
    started: &mut Option<oneshot::Sender<()>>,
) -> Option<Vec<u8>> {
    let (field, Value::Bytes(inner)) = *wire::fields(body).first()? else {
        return None;
    };
    match field {
        wire::REMOTE_CONFIGURE => {
            *features &= wire::varint_of(inner, 1).unwrap_or(0);
            Some(wire::remote_configure(*features))
        }
        wire::REMOTE_SET_ACTIVE => Some(wire::remote_set_active(*features)),
        wire::REMOTE_PING_REQUEST => Some(wire::remote_ping_response(
            wire::varint_of(inner, 1).unwrap_or(0),
        )),
        wire::REMOTE_START => {
            if let Some(started) = started.take() {
                let _ = started.send(());
            }
            None
        }
        wire::REMOTE_ERROR => {
            eprintln!("[tv-remote] the TV reported an error: {inner:02x?}");
            None
        }
        _ => None,
    }
}

async fn read_loop(
    mut reader: ReadHalf<TlsStream<TcpStream>>,
    replies: mpsc::UnboundedSender<Vec<u8>>,
    started: oneshot::Sender<()>,
) {
    let mut started = Some(started);
    let mut features = wire::FEATURES;
    while let Ok(Ok(body)) = timeout(IDLE_TIMEOUT, wire::read_frame(&mut reader)).await {
        if let Some(reply) = answer(&body, &mut features, &mut started) {
            if replies.send(wire::frame(&reply)).is_err() {
                return;
            }
        }
    }
    // Lost or idle: stop the writer, so the next key press reconnects.
    let _ = replies.send(Vec::new());
}

/// Opens the remote connection and waits until the TV takes keys.
async fn open_link(app: &AppHandle, state: &TvRemote, ip: IpAddr) -> Result<Link, String> {
    let host = ip.to_string();
    let config = {
        let store = store(app, state).await?;
        let pin = store
            .pin(&host)
            .ok_or_else(|| "This TV is not paired yet.".to_string())?;
        store.client_config(Some(pin))?
    };
    let stream = connect(config, ip, REMOTE_PORT).await?;
    let (reader, writer) = tokio::io::split(stream);
    let tx = spawn_writer(writer);
    let (started_tx, started_rx) = oneshot::channel();
    tauri::async_runtime::spawn(read_loop(reader, tx.clone(), started_tx));
    let link = Link { host, tx };
    match timeout(REPLY_TIMEOUT, started_rx).await {
        Ok(Ok(())) => Ok(link),
        _ => {
            link.close();
            Err("The TV did not accept the connection. Try pairing again.".into())
        }
    }
}

/// Whether this TV has been paired.
#[tauri::command]
pub async fn tv_remote_status(
    app: AppHandle,
    state: State<'_, TvRemote>,
    host: String,
) -> Result<bool, String> {
    let ip = parse_host(&host)?;
    Ok(store(&app, &state).await?.pin(&ip.to_string()).is_some())
}

/// Asks the TV to show a pairing code. Finish with `tv_remote_pair_finish`.
#[tauri::command]
pub async fn tv_remote_pair_start(
    app: AppHandle,
    state: State<'_, TvRemote>,
    host: String,
) -> Result<(), String> {
    let ip = parse_host(&host)?;
    let config = store(&app, &state).await?.client_config(None)?;
    let mut stream = connect(config, ip, PAIRING_PORT).await?;
    let server_cert = stream
        .get_ref()
        .1
        .peer_certificates()
        .and_then(|certs| certs.first())
        .map(|cert| cert.to_vec())
        .ok_or_else(|| "The TV sent no certificate.".to_string())?;
    exchange(
        &mut stream,
        &wire::pairing_request(CLIENT_NAME),
        wire::PAIRING_REQUEST_ACK,
    )
    .await?;
    exchange(&mut stream, &wire::pairing_options(), wire::PAIRING_OPTIONS).await?;
    exchange(
        &mut stream,
        &wire::pairing_configuration(),
        wire::PAIRING_CONFIGURATION_ACK,
    )
    .await?;
    *state.pairing.lock().await = Some(Pairing {
        host: ip.to_string(),
        stream,
        server_cert,
    });
    Ok(())
}

/// Sends the code from the TV's screen and remembers the TV on success.
#[tauri::command]
pub async fn tv_remote_pair_finish(
    app: AppHandle,
    state: State<'_, TvRemote>,
    host: String,
    code: String,
) -> Result<(), String> {
    let host = parse_host(&host)?.to_string();
    let mut slot = state.pairing.lock().await;
    let pairing = slot
        .as_mut()
        .filter(|pairing| pairing.host == host)
        .ok_or_else(|| "No pairing is waiting for this TV. Start it again.".to_string())?;
    let client_cert = store(&app, &state).await?.cert.clone();
    // A mistyped code is caught here and leaves the pairing open for another try.
    let secret = identity::pairing_secret(&client_cert, &pairing.server_cert, &code)?;
    let mut pairing = slot.take().expect("checked above");
    drop(slot);
    exchange(
        &mut pairing.stream,
        &wire::pairing_secret(&secret),
        wire::PAIRING_SECRET_ACK,
    )
    .await?;
    store(&app, &state)
        .await?
        .remember(host.clone(), &pairing.server_cert)?;
    // A link opened under an older pairing would keep the old pin.
    if let Some(link) = state.link.lock().await.take_if(|link| link.host == host) {
        link.close();
    }
    Ok(())
}

/// Presses one button on the remote.
#[tauri::command]
pub async fn tv_remote_key(
    app: AppHandle,
    state: State<'_, TvRemote>,
    host: String,
    key: String,
) -> Result<(), String> {
    let ip = parse_host(&host)?;
    let code = key_code(&key).ok_or_else(|| format!("unknown key: {key}"))?;
    send_to_stick(&app, &state, ip, wire::frame(&wire::remote_key(code))).await
}

/// Starts an app on the Android TV device.
#[tauri::command]
pub async fn tv_remote_launch(
    app: AppHandle,
    state: State<'_, TvRemote>,
    host: String,
    name: String,
) -> Result<(), String> {
    let ip = parse_host(&host)?;
    let link = apps::find(&name)?.android;
    send_to_stick(&app, &state, ip, wire::frame(&wire::remote_app_link(link))).await
}

/// Sends one frame over the open stick link, reconnecting once if it is gone.
async fn send_to_stick(
    app: &AppHandle,
    state: &TvRemote,
    ip: IpAddr,
    frame: Vec<u8>,
) -> Result<(), String> {
    let mut link = state.link.lock().await;
    if let Some(open) = link.as_ref().filter(|open| open.host == ip.to_string()) {
        if open.tx.send(frame.clone()).is_ok() {
            return Ok(());
        }
    }
    if let Some(old) = link.take() {
        old.close();
    }
    let fresh = open_link(app, state, ip).await?;
    fresh
        .tx
        .send(frame)
        .map_err(|_| "The TV closed the connection.".to_string())?;
    *link = Some(fresh);
    Ok(())
}

fn start_samsung_link(stream: TlsStream<TcpStream>, host: String) -> Link {
    let (reader, writer) = tokio::io::split(stream);
    let tx = spawn_writer(writer);
    tauri::async_runtime::spawn(samsung::read_loop(reader, tx.clone()));
    Link { host, tx }
}

/// Samsung TVs and Android TV devices on the local network.
#[tauri::command]
pub async fn tv_remote_discover() -> Result<Vec<discover::Device>, String> {
    discover::devices().await
}

/// Connects to a Samsung TV. The first time, the TV asks on screen whether to
/// allow Kavibay; this waits for that answer.
#[tauri::command]
pub async fn tv_remote_samsung_pair(
    app: AppHandle,
    state: State<'_, TvRemote>,
    host: String,
) -> Result<(), String> {
    let ip = parse_host(&host)?;
    let host = ip.to_string();
    let (config, known) = {
        let store = store(&app, &state).await?;
        (store.client_config(None)?, store.samsung(&host)?)
    };
    // A token from an earlier pairing saves the user a second prompt.
    let token = known.and_then(|tv| tv.token);
    let (stream, issued, cert) = samsung::connect(config, ip, token.as_deref()).await?;
    store(&app, &state).await?.remember_samsung(
        host.clone(),
        &cert,
        issued.or(token).as_deref(),
    )?;
    let link = start_samsung_link(stream, host);
    if let Some(old) = state.samsung.lock().await.replace(link) {
        old.close();
    }
    Ok(())
}

/// Presses one button on the Samsung TV.
#[tauri::command]
pub async fn tv_remote_samsung_key(
    app: AppHandle,
    state: State<'_, TvRemote>,
    host: String,
    key: String,
) -> Result<(), String> {
    let ip = parse_host(&host)?;
    let name = samsung::key_name(&key).ok_or_else(|| format!("unknown key: {key}"))?;
    send_to_samsung(&app, &state, ip, samsung::key_frame(name)).await
}

/// Starts an app on the Samsung TV.
#[tauri::command]
pub async fn tv_remote_samsung_launch(
    app: AppHandle,
    state: State<'_, TvRemote>,
    host: String,
    name: String,
) -> Result<(), String> {
    let ip = parse_host(&host)?;
    let frame = samsung::launch_frame(apps::find(&name)?.samsung);
    send_to_samsung(&app, &state, ip, frame).await
}

/// Sends one frame over the open Samsung link, reconnecting once if it is gone.
async fn send_to_samsung(
    app: &AppHandle,
    state: &TvRemote,
    ip: IpAddr,
    frame: Vec<u8>,
) -> Result<(), String> {
    let host = ip.to_string();
    let mut link = state.samsung.lock().await;
    if let Some(open) = link.as_ref().filter(|open| open.host == host) {
        if open.tx.send(frame.clone()).is_ok() {
            return Ok(());
        }
    }
    if let Some(old) = link.take() {
        old.close();
    }
    let (config, token) = {
        let store = store(app, state).await?;
        let tv = store
            .samsung(&host)?
            .ok_or_else(|| "This TV is not connected yet.".to_string())?;
        (store.client_config(Some(tv.pin))?, tv.token)
    };
    let (stream, _, _) = samsung::connect(config, ip, token.as_deref()).await?;
    let fresh = start_samsung_link(stream, host);
    fresh
        .tx
        .send(frame)
        .map_err(|_| "The TV closed the connection.".to_string())?;
    *link = Some(fresh);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Sends app links to a paired stick and prints how it answers: the error
    /// it reports for a link no app takes, and the readable strings of what it
    /// sends after one opens (the foreground app's package among them). For
    /// finding a link `apps.rs` can use. It starts apps on the TV.
    /// `KAVIBAY_DATA_DIR=<dir> STICK_HOST=<ip> LINKS=<a,b> cargo test --lib probe_app_links -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn probe_app_links_on_a_paired_stick() {
        let dir = std::env::var("KAVIBAY_DATA_DIR").expect("KAVIBAY_DATA_DIR");
        let host = std::env::var("STICK_HOST").expect("STICK_HOST");
        let links = std::env::var("LINKS").expect("LINKS");
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(async {
                let store = Store::load_or_create(std::path::Path::new(&dir)).unwrap();
                let config = store.client_config(store.pin(&host)).unwrap();
                let ip: IpAddr = host.parse().unwrap();
                let stream = connect(config, ip, REMOTE_PORT).await.unwrap();
                let (mut reader, mut writer) = tokio::io::split(stream);
                // IME (4) makes the stick report the foreground app.
                let mut features = wire::FEATURES | 4;
                let mut started = None;
                let mut pending: Vec<&str> = links.split(',').rev().collect();
                // When the next link goes out: a second after the stick is
                // ready, then one every six seconds. The stick pings every
                // five, so silence never marks the moment.
                let mut next_at: Option<tokio::time::Instant> = None;
                loop {
                    if next_at.is_some_and(|at| tokio::time::Instant::now() >= at) {
                        match pending.pop() {
                            Some(link) => {
                                println!("trying {link}");
                                let frame = wire::frame(&wire::remote_app_link(link));
                                writer.write_all(&frame).await.unwrap();
                                next_at =
                                    Some(tokio::time::Instant::now() + Duration::from_secs(6));
                            }
                            None => break,
                        }
                    }
                    match timeout(Duration::from_secs(1), wire::read_frame(&mut reader)).await {
                        Ok(Ok(body)) => {
                            if let Some(reply) = answer(&body, &mut features, &mut started) {
                                writer.write_all(&wire::frame(&reply)).await.unwrap();
                            }
                            let field = wire::fields(&body).first().map(|(f, _)| *f);
                            if field == Some(wire::REMOTE_START) && next_at.is_none() {
                                next_at =
                                    Some(tokio::time::Instant::now() + Duration::from_secs(1));
                            }
                            if field == Some(wire::REMOTE_ERROR) {
                                println!("   -> refused");
                            }
                            if field == Some(20) {
                                let text = String::from_utf8_lossy(&body);
                                let words: Vec<&str> = text
                                    .split(|c: char| !c.is_ascii_graphic())
                                    .filter(|w| w.len() >= 4)
                                    .collect();
                                println!("   -> foreground: {words:?}");
                            }
                        }
                        Ok(Err(error)) => {
                            println!("connection ended: {error}");
                            break;
                        }
                        Err(_) => {}
                    }
                }
            });
    }

    #[test]
    fn only_local_addresses_are_accepted() {
        assert!(parse_host("192.168.178.32").is_ok());
        assert!(parse_host(" 10.0.0.5 ").is_ok());
        assert!(parse_host("8.8.8.8").is_err());
        assert!(parse_host("127.0.0.1").is_err());
        assert!(parse_host("tv.local").is_err());
    }

    #[test]
    fn digits_map_to_android_key_codes() {
        assert_eq!(key_code("0"), Some(7));
        assert_eq!(key_code("9"), Some(16));
        assert_eq!(key_code("power"), Some(26));
        assert_eq!(key_code("10"), None);
        assert_eq!(key_code("KEYCODE_POWER"), None);
    }

    #[test]
    fn handshake_answers_follow_the_tv() {
        let mut features = wire::FEATURES;
        let (tx, mut rx) = oneshot::channel();
        let mut started = Some(tx);

        // remote_configure { code1: 3 } — the TV supports ping and key only.
        let reply = answer(&[0x0a, 0x02, 0x08, 0x03], &mut features, &mut started).unwrap();
        assert_eq!(features, 3);
        assert_eq!(reply, wire::remote_configure(3));

        // remote_ping_request { val1: 9 } is echoed.
        let reply = answer(&[0x42, 0x02, 0x08, 0x09], &mut features, &mut started).unwrap();
        assert_eq!(reply, wire::remote_ping_response(9));

        // remote_start { started: true } releases the waiting key press.
        assert!(answer(&[0xc2, 0x02, 0x02, 0x08, 0x01], &mut features, &mut started).is_none());
        assert!(rx.try_recv().is_ok());
    }
}
