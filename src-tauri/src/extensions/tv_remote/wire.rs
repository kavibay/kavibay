//! The bytes of Android TV Remote v2: protobuf messages behind a varint length.
//!
//! Hand-encoded rather than generated: the client sends eight message shapes
//! and reads one or two fields of a few more, which is less code than a
//! `prost` build step. Field numbers come from the two `.proto` files the
//! protocol was reverse-engineered into (`polo.proto` for pairing,
//! `remotemessage.proto` for the remote), as published by `androidtvremote2`.

use tokio::io::{AsyncRead, AsyncReadExt};

/// Pairing (`polo`) messages are `OuterMessage { protocol_version = 2, status = 200, … }`.
const POLO_VERSION: u64 = 2;
pub const STATUS_OK: u64 = 200;
/// `Options.Encoding.ENCODING_TYPE_HEXADECIMAL`, six symbols — the code on screen.
const HEX_ENCODING: u64 = 3;
const CODE_LENGTH: u64 = 6;
/// `Options.RoleType.ROLE_TYPE_INPUT`: the code is shown on the TV and typed here.
const ROLE_INPUT: u64 = 1;
/// `RemoteDirection.SHORT`: one press and release.
const DIRECTION_SHORT: u64 = 3;

/// The features this client asks for: ping, key, power, volume, app link.
/// The TV announces what it supports and both sides use the intersection.
pub const FEATURES: u64 = 1 | 2 | 32 | 64 | 512;

fn varint(out: &mut Vec<u8>, mut value: u64) {
    while value >= 0x80 {
        out.push((value as u8) | 0x80);
        value >>= 7;
    }
    out.push(value as u8);
}

fn field_varint(out: &mut Vec<u8>, field: u32, value: u64) {
    varint(out, u64::from(field) << 3);
    varint(out, value);
}

fn field_bytes(out: &mut Vec<u8>, field: u32, value: &[u8]) {
    varint(out, (u64::from(field) << 3) | 2);
    varint(out, value.len() as u64);
    out.extend_from_slice(value);
}

/// One message ready for the socket: its length as a varint, then the body.
pub fn frame(body: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(body.len() + 2);
    varint(&mut out, body.len() as u64);
    out.extend_from_slice(body);
    out
}

/// A message larger than this is not one the protocol sends; refusing it keeps
/// a confused peer from making us allocate whatever it claims.
const MAX_MESSAGE: u64 = 64 * 1024;

/// Reads one framed message.
pub async fn read_frame<R: AsyncRead + Unpin>(reader: &mut R) -> std::io::Result<Vec<u8>> {
    let mut len = 0u64;
    let mut shift = 0;
    loop {
        let byte = reader.read_u8().await?;
        len |= u64::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            break;
        }
        shift += 7;
        if shift > 28 {
            return Err(std::io::Error::other("malformed message length"));
        }
    }
    if len > MAX_MESSAGE {
        return Err(std::io::Error::other("message too large"));
    }
    let mut body = vec![0; len as usize];
    reader.read_exact(&mut body).await?;
    Ok(body)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Value<'a> {
    Varint(u64),
    Bytes(&'a [u8]),
}

/// The top-level fields of a message, in order. Fixed-width fields are
/// skipped (nothing read here uses them); anything malformed ends the list.
pub fn fields(mut body: &[u8]) -> Vec<(u32, Value<'_>)> {
    fn take_varint(body: &mut &[u8]) -> Option<u64> {
        let mut value = 0u64;
        for shift in (0..64).step_by(7) {
            let (&byte, rest) = body.split_first()?;
            *body = rest;
            value |= u64::from(byte & 0x7f) << shift;
            if byte & 0x80 == 0 {
                return Some(value);
            }
        }
        None
    }
    let mut out = Vec::new();
    while !body.is_empty() {
        let Some(tag) = take_varint(&mut body) else {
            break;
        };
        let field = (tag >> 3) as u32;
        match tag & 7 {
            0 => match take_varint(&mut body) {
                Some(value) => out.push((field, Value::Varint(value))),
                None => break,
            },
            2 => {
                let Some(len) = take_varint(&mut body) else {
                    break;
                };
                let Ok(len) = usize::try_from(len) else { break };
                if len > body.len() {
                    break;
                }
                let (value, rest) = body.split_at(len);
                out.push((field, Value::Bytes(value)));
                body = rest;
            }
            1 if body.len() >= 8 => body = &body[8..],
            5 if body.len() >= 4 => body = &body[4..],
            _ => break,
        }
    }
    out
}

pub fn varint_of(body: &[u8], field: u32) -> Option<u64> {
    fields(body)
        .into_iter()
        .find_map(|(number, value)| match value {
            Value::Varint(v) if number == field => Some(v),
            _ => None,
        })
}

pub fn bytes_of(body: &[u8], field: u32) -> Option<&[u8]> {
    fields(body)
        .into_iter()
        .find_map(|(number, value)| match value {
            Value::Bytes(v) if number == field => Some(v),
            _ => None,
        })
}

// --- Pairing (port 6467) ----------------------------------------------------

fn polo(field: u32, inner: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    field_varint(&mut out, 1, POLO_VERSION);
    field_varint(&mut out, 2, STATUS_OK);
    field_bytes(&mut out, field, inner);
    out
}

fn hex_encoding() -> Vec<u8> {
    let mut out = Vec::new();
    field_varint(&mut out, 1, HEX_ENCODING);
    field_varint(&mut out, 2, CODE_LENGTH);
    out
}

/// `pairing_request { service_name: "atvremote", client_name }`. The TV shows
/// the client name while asking the user to confirm.
pub fn pairing_request(client_name: &str) -> Vec<u8> {
    let mut inner = Vec::new();
    field_bytes(&mut inner, 1, b"atvremote");
    field_bytes(&mut inner, 2, client_name.as_bytes());
    polo(10, &inner)
}

/// `options { input_encodings: [hex/6], preferred_role: INPUT }`.
pub fn pairing_options() -> Vec<u8> {
    let mut inner = Vec::new();
    field_bytes(&mut inner, 1, &hex_encoding());
    field_varint(&mut inner, 3, ROLE_INPUT);
    polo(20, &inner)
}

/// `configuration { encoding: hex/6, client_role: INPUT }` — after its ack the
/// TV puts the code on screen.
pub fn pairing_configuration() -> Vec<u8> {
    let mut inner = Vec::new();
    field_bytes(&mut inner, 1, &hex_encoding());
    field_varint(&mut inner, 2, ROLE_INPUT);
    polo(30, &inner)
}

pub fn pairing_secret(secret: &[u8]) -> Vec<u8> {
    let mut inner = Vec::new();
    field_bytes(&mut inner, 1, secret);
    polo(40, &inner)
}

/// Field numbers of the pairing replies the client waits for.
pub const PAIRING_REQUEST_ACK: u32 = 11;
pub const PAIRING_OPTIONS: u32 = 20;
pub const PAIRING_CONFIGURATION_ACK: u32 = 31;
pub const PAIRING_SECRET_ACK: u32 = 41;

// --- Remote (port 6466) -----------------------------------------------------

/// Fields of `RemoteMessage` the client reacts to.
pub const REMOTE_CONFIGURE: u32 = 1;
pub const REMOTE_SET_ACTIVE: u32 = 2;
pub const REMOTE_ERROR: u32 = 3;
pub const REMOTE_PING_REQUEST: u32 = 8;
pub const REMOTE_START: u32 = 40;

/// Answer to the TV's `remote_configure`: the agreed features plus a device
/// info block. The TV does not check its contents; these are the values the
/// reference client sends.
pub fn remote_configure(features: u64) -> Vec<u8> {
    let mut info = Vec::new();
    field_varint(&mut info, 3, 1);
    field_bytes(&mut info, 4, b"1");
    field_bytes(&mut info, 5, b"atvremote");
    field_bytes(&mut info, 6, b"1.0.0");
    let mut inner = Vec::new();
    field_varint(&mut inner, 1, features);
    field_bytes(&mut inner, 2, &info);
    let mut out = Vec::new();
    field_bytes(&mut out, REMOTE_CONFIGURE, &inner);
    out
}

pub fn remote_set_active(features: u64) -> Vec<u8> {
    let mut inner = Vec::new();
    field_varint(&mut inner, 1, features);
    let mut out = Vec::new();
    field_bytes(&mut out, REMOTE_SET_ACTIVE, &inner);
    out
}

pub fn remote_ping_response(value: u64) -> Vec<u8> {
    let mut inner = Vec::new();
    field_varint(&mut inner, 1, value);
    let mut out = Vec::new();
    field_bytes(&mut out, 9, &inner);
    out
}

pub fn remote_key(key_code: u64) -> Vec<u8> {
    let mut inner = Vec::new();
    field_varint(&mut inner, 1, key_code);
    field_varint(&mut inner, 2, DIRECTION_SHORT);
    let mut out = Vec::new();
    field_bytes(&mut out, 10, &inner);
    out
}

/// `remote_app_link_launch_request { app_link }`: the device opens the link
/// with whatever app handles it.
pub fn remote_app_link(link: &str) -> Vec<u8> {
    let mut inner = Vec::new();
    field_bytes(&mut inner, 1, link.as_bytes());
    let mut out = Vec::new();
    field_bytes(&mut out, 90, &inner);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_press_matches_protobuf_encoding() {
        // remote_key_inject { key_code: KEYCODE_POWER (26), direction: SHORT }
        assert_eq!(remote_key(26), [0x52, 0x04, 0x08, 0x1a, 0x10, 0x03]);
    }

    #[test]
    fn app_link_uses_field_90() {
        // Field 90, wire type 2: tag 0x2d2 as a varint is d2 05.
        assert_eq!(remote_app_link("x"), [0xd2, 0x05, 0x03, 0x0a, 0x01, b'x']);
    }

    #[test]
    fn pairing_request_matches_protobuf_encoding() {
        let body = pairing_request("K");
        assert_eq!(
            body,
            [
                0x08, 0x02, 0x10, 0xc8, 0x01, // version 2, status 200
                0x52, 0x0e, // field 10, 14 bytes
                0x0a, 0x09, b'a', b't', b'v', b'r', b'e', b'm', b'o', b't', b'e', //
                0x12, 0x01, b'K',
            ]
        );
    }

    #[test]
    fn fields_read_back_what_was_written() {
        let body = remote_configure(FEATURES);
        let inner = bytes_of(&body, REMOTE_CONFIGURE).unwrap();
        assert_eq!(varint_of(inner, 1), Some(FEATURES));
        assert_eq!(varint_of(&pairing_options(), 2), Some(STATUS_OK));
    }

    #[test]
    fn fields_stop_at_truncated_input() {
        // A length that runs past the end yields what came before it.
        assert_eq!(
            fields(&[0x08, 0x05, 0x12, 0x09, 0x01]),
            [(1, Value::Varint(5))]
        );
    }

    #[test]
    fn frames_round_trip_across_a_multi_byte_length() {
        let body = vec![7u8; 300];
        let framed = frame(&body);
        assert_eq!(&framed[..2], [0xac, 0x02]);
        let read = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap()
            .block_on(read_frame(&mut framed.as_slice()))
            .unwrap();
        assert_eq!(read, body);
    }
}
