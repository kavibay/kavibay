//! A Samsung TV (Tizen, 2016 and later) through its LAN remote API — the
//! widget's default target for every key.
//!
//! With a streaming stick added, the TV keeps volume and power: a stick's
//! volume keys change its own output level, which tops out at whatever the TV
//! is set to, and the stick does not pass them on over HDMI-CEC either.
//!
//! The API is a WebSocket on port 8002 behind TLS. The first connection makes
//! the TV ask "Allow?"; on yes it hands out a token, which later connections
//! present instead of asking again. The token controls the TV, so it is
//! stored sealed, like the stick's client key.
//!
//! The WebSocket client is hand-written: the TV exchanges a handful of small
//! text frames, which is a few dozen lines rather than a dependency.

use std::{net::IpAddr, sync::Arc, time::Duration};

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt, ReadHalf},
    net::TcpStream,
    sync::mpsc,
    time::timeout,
};
use tokio_rustls::{client::TlsStream, rustls::ClientConfig};

const PORT: u16 = 8002;
/// How long the TV's "Allow?" prompt may wait for the user.
const ALLOW_TIMEOUT: Duration = Duration::from_secs(30);

const OP_TEXT: u8 = 1;
const OP_CLOSE: u8 = 8;
const OP_PING: u8 = 9;
const OP_PONG: u8 = 10;

/// Samsung's name for each button the widget has.
pub fn key_name(key: &str) -> Option<&'static str> {
    Some(match key {
        "power" => "KEY_POWER",
        "home" => "KEY_HOME",
        "back" => "KEY_RETURN",
        "menu" => "KEY_MENU",
        "guide" => "KEY_GUIDE",
        "info" => "KEY_INFO",
        "up" => "KEY_UP",
        "down" => "KEY_DOWN",
        "left" => "KEY_LEFT",
        "right" => "KEY_RIGHT",
        "ok" => "KEY_ENTER",
        "volumeUp" => "KEY_VOLUP",
        "volumeDown" => "KEY_VOLDOWN",
        "mute" => "KEY_MUTE",
        "channelUp" => "KEY_CHUP",
        "channelDown" => "KEY_CHDOWN",
        // ponytail: Samsung has no single play/pause key over this API;
        // KEY_PLAY resumes, pausing needs KEY_PAUSE. Split the button if missed.
        "playPause" => "KEY_PLAY",
        "0" => "KEY_0",
        "1" => "KEY_1",
        "2" => "KEY_2",
        "3" => "KEY_3",
        "4" => "KEY_4",
        "5" => "KEY_5",
        "6" => "KEY_6",
        "7" => "KEY_7",
        "8" => "KEY_8",
        "9" => "KEY_9",
        _ => return None,
    })
}

/// One key press, as a client-to-server frame.
pub fn key_frame(name: &str) -> Vec<u8> {
    let message = serde_json::json!({
        "method": "ms.remote.control",
        "params": {
            "Cmd": "Click",
            "DataOfCmd": name,
            "Option": "false",
            "TypeOfRemote": "SendRemoteKey",
        },
    });
    frame(OP_TEXT, message.to_string().as_bytes(), rand::random())
}

/// Starts an installed app. `DEEP_LINK` is the launch type the TV's own app
/// list reports for store apps such as YouTube and Netflix.
// ponytail: one launch type for all; a native app would need NATIVE_LAUNCH.
pub fn launch_frame(app_id: &str) -> Vec<u8> {
    let message = serde_json::json!({
        "method": "ms.channel.emit",
        "params": {
            "event": "ed.apps.launch",
            "to": "host",
            "data": { "appId": app_id, "action_type": "DEEP_LINK" },
        },
    });
    frame(OP_TEXT, message.to_string().as_bytes(), rand::random())
}

/// A final, masked frame — the only kind a client may send.
fn frame(opcode: u8, payload: &[u8], mask: [u8; 4]) -> Vec<u8> {
    let mut out = vec![0x80 | opcode];
    match payload.len() {
        len @ 0..=125 => out.push(0x80 | len as u8),
        len @ 126..=0xffff => {
            out.push(0x80 | 126);
            out.extend_from_slice(&(len as u16).to_be_bytes());
        }
        len => {
            out.push(0x80 | 127);
            out.extend_from_slice(&(len as u64).to_be_bytes());
        }
    }
    out.extend_from_slice(&mask);
    out.extend(
        payload
            .iter()
            .enumerate()
            .map(|(i, byte)| byte ^ mask[i % 4]),
    );
    out
}

/// A frame from the TV is never this large; refusing it bounds the allocation.
const MAX_FRAME: u64 = 256 * 1024;

/// Reads one frame and returns its opcode and payload. Fragmented messages
/// are not reassembled — the TV sends short JSON events, each in one frame.
async fn read_frame<R: AsyncRead + Unpin>(reader: &mut R) -> std::io::Result<(u8, Vec<u8>)> {
    let opcode = reader.read_u8().await? & 0x0f;
    let second = reader.read_u8().await?;
    let len = match second & 0x7f {
        126 => u64::from(reader.read_u16().await?),
        127 => reader.read_u64().await?,
        len => u64::from(len),
    };
    if len > MAX_FRAME {
        return Err(std::io::Error::other("frame too large"));
    }
    let mask = if second & 0x80 != 0 {
        let mut mask = [0; 4];
        reader.read_exact(&mut mask).await?;
        Some(mask)
    } else {
        None
    };
    let mut payload = vec![0; len as usize];
    reader.read_exact(&mut payload).await?;
    if let Some(mask) = mask {
        payload
            .iter_mut()
            .enumerate()
            .for_each(|(i, byte)| *byte ^= mask[i % 4]);
    }
    Ok((opcode, payload))
}

/// What one event from the TV means for a connection still waiting to be let in.
#[derive(Debug, PartialEq, Eq)]
enum Verdict {
    /// Allowed, with the token to present next time when the TV issued one.
    Allowed(Option<String>),
    Refused(&'static str),
    Pending,
}

fn verdict(event: &[u8]) -> Verdict {
    let Ok(event) = serde_json::from_slice::<serde_json::Value>(event) else {
        return Verdict::Pending;
    };
    match event["event"].as_str() {
        Some("ms.channel.connect") => {
            Verdict::Allowed(event["data"]["token"].as_str().map(str::to_string))
        }
        Some("ms.channel.unauthorized") => Verdict::Refused(
            "The TV did not allow Kavibay. Connect again and choose Allow on the TV.",
        ),
        Some("ms.channel.timeOut") => {
            Verdict::Refused("Nobody answered the prompt on the TV. Connect again.")
        }
        _ => Verdict::Pending,
    }
}

/// Connects, upgrades to a WebSocket and waits until the TV lets us in.
/// Returns the stream, the token the TV handed out and its certificate.
pub async fn connect(
    config: Arc<ClientConfig>,
    ip: IpAddr,
    token: Option<&str>,
) -> Result<(TlsStream<TcpStream>, Option<String>, Vec<u8>), String> {
    let mut stream = super::connect(config, ip, PORT).await?;
    let cert = stream
        .get_ref()
        .1
        .peer_certificates()
        .and_then(|certs| certs.first())
        .map(|cert| cert.to_vec())
        .ok_or_else(|| "The TV sent no certificate.".to_string())?;

    let name = B64.encode("Kavibay");
    let mut path = format!("/api/v2/channels/samsung.remote.control?name={name}");
    if let Some(token) = token {
        path.push_str(&format!("&token={token}"));
    }
    // ponytail: Sec-WebSocket-Accept is not checked; it guards against
    // non-WebSocket servers, and the pinned TLS peer already is the TV.
    let request = format!(
        "GET {path} HTTP/1.1\r\nHost: {ip}:{PORT}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\
         Sec-WebSocket-Key: {}\r\nSec-WebSocket-Version: 13\r\n\r\n",
        B64.encode(rand::random::<[u8; 16]>()),
    );
    let lost = |error: std::io::Error| format!("The TV closed the connection: {error}");
    stream.write_all(request.as_bytes()).await.map_err(lost)?;
    stream.flush().await.map_err(lost)?;

    let mut head = Vec::new();
    while !head.ends_with(b"\r\n\r\n") {
        if head.len() > 8 * 1024 {
            return Err("The TV answered something that is not a WebSocket.".into());
        }
        head.push(stream.read_u8().await.map_err(lost)?);
    }
    if !head.starts_with(b"HTTP/1.1 101") {
        return Err("The TV refused the remote connection.".into());
    }

    let waiting = async {
        loop {
            let (opcode, payload) = read_frame(&mut stream).await.map_err(lost)?;
            match opcode {
                OP_TEXT => match verdict(&payload) {
                    Verdict::Allowed(issued) => return Ok(issued),
                    Verdict::Refused(why) => return Err(why.to_string()),
                    Verdict::Pending => {}
                },
                OP_CLOSE => return Err("The TV closed the connection.".to_string()),
                _ => {}
            }
        }
    };
    let issued = timeout(ALLOW_TIMEOUT, waiting).await.map_err(|_| {
        "No answer from the TV. Check for a prompt on the TV and connect again.".to_string()
    })??;
    Ok((stream, issued, cert))
}

/// Keeps the connection alive by answering pings, until it closes.
pub async fn read_loop(
    mut reader: ReadHalf<TlsStream<TcpStream>>,
    replies: mpsc::UnboundedSender<Vec<u8>>,
) {
    while let Ok((opcode, payload)) = read_frame(&mut reader).await {
        match opcode {
            OP_PING => {
                if replies
                    .send(frame(OP_PONG, &payload, rand::random()))
                    .is_err()
                {
                    return;
                }
            }
            OP_CLOSE => break,
            _ => {}
        }
    }
    let _ = replies.send(Vec::new());
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(bytes: &[u8]) -> (u8, Vec<u8>) {
        tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap()
            .block_on(read_frame(&mut &bytes[..]))
            .unwrap()
    }

    #[test]
    fn frames_are_masked_and_read_back() {
        let framed = frame(OP_TEXT, b"Hi", [1, 2, 3, 4]);
        assert_eq!(framed, [0x81, 0x82, 1, 2, 3, 4, b'H' ^ 1, b'i' ^ 2]);
        assert_eq!(read(&framed), (OP_TEXT, b"Hi".to_vec()));

        let long = vec![b'x'; 300];
        let framed = frame(OP_TEXT, &long, [0; 4]);
        assert_eq!(&framed[..4], [0x81, 0x80 | 126, 0x01, 0x2c]);
        assert_eq!(read(&framed).1, long);
    }

    #[test]
    fn unmasked_server_frames_are_read() {
        assert_eq!(read(&[0x89, 0x01, 7]), (OP_PING, vec![7]));
    }

    #[test]
    fn verdicts_follow_the_tv_events() {
        let allowed = br#"{"event":"ms.channel.connect","data":{"token":"1234"}}"#;
        assert_eq!(verdict(allowed), Verdict::Allowed(Some("1234".into())));
        let no_token = br#"{"event":"ms.channel.connect","data":{}}"#;
        assert_eq!(verdict(no_token), Verdict::Allowed(None));
        assert!(matches!(
            verdict(br#"{"event":"ms.channel.unauthorized"}"#),
            Verdict::Refused(_)
        ));
        assert_eq!(
            verdict(br#"{"event":"ed.edenTV.update"}"#),
            Verdict::Pending
        );
        assert_eq!(verdict(b"not json"), Verdict::Pending);
    }

    #[test]
    fn every_button_has_a_samsung_key() {
        assert_eq!(key_name("volumeUp"), Some("KEY_VOLUP"));
        assert_eq!(key_name("ok"), Some("KEY_ENTER"));
        assert_eq!(key_name("7"), Some("KEY_7"));
        assert_eq!(key_name("KEY_POWER"), None);
        for key in ["power", "home", "back", "guide", "channelUp", "playPause"] {
            assert!(key_name(key).is_some(), "{key}");
        }
    }
}
