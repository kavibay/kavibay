//! Who Kavibay is to a TV, and which TVs it has paired with.
//!
//! One client certificate for the whole app, the way a phone remote has one:
//! the TV remembers it after pairing and lets any connection that presents it
//! send keys. Its private key is the secret here, so it is stored only through
//! `security::secrets`. The certificate itself is public.
//!
//! Each paired TV is pinned by the SHA-256 of its certificate. The TV's
//! certificate is self-signed, so no CA could vouch for it; what the pin buys
//! is that after pairing, nothing else on the network can pose as that TV.

use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::Arc,
};

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use rsa::{
    pkcs8::{DecodePublicKey, EncodePrivateKey},
    traits::PublicKeyParts,
    RsaPrivateKey, RsaPublicKey,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio_rustls::rustls::{
    client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier},
    crypto::{ring, verify_tls12_signature, verify_tls13_signature, CryptoProvider},
    pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer, ServerName, UnixTime},
    ClientConfig, DigitallySignedStruct, Error as TlsError, SignatureScheme,
};
use x509_cert::der::{Decode, Encode};

use crate::security::secrets::{protect_secret, unprotect_secret};

const STORE_FILE: &str = "tv-remote.json";

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoreFile {
    /// Base64 DER of the client certificate.
    cert: String,
    /// The PKCS#8 private key, base64 and then sealed by `protect_secret`.
    key: String,
    /// TV address → hex SHA-256 of the certificate it presented while pairing.
    #[serde(default)]
    devices: BTreeMap<String, String>,
    /// Samsung TVs taking volume keys (`samsung.rs`), by address.
    #[serde(default)]
    samsung: BTreeMap<String, SamsungEntry>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SamsungEntry {
    /// Hex SHA-256 of the TV's certificate.
    pin: String,
    /// The token the TV issued, sealed by `protect_secret`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    token: Option<String>,
}

/// A Samsung TV Kavibay may send volume keys to.
pub struct SamsungTv {
    pub pin: String,
    pub token: Option<String>,
}

pub struct Store {
    path: PathBuf,
    pub cert: Vec<u8>,
    key: Vec<u8>,
    devices: BTreeMap<String, String>,
    samsung: BTreeMap<String, SamsungEntry>,
}

impl Store {
    /// Reads the store, or makes a new identity on first use. Generating a
    /// 2048-bit RSA key takes a moment, so call this off the async runtime.
    pub fn load_or_create(dir: &Path) -> Result<Self, String> {
        let path = dir.join(STORE_FILE);
        if path.exists() {
            let raw = fs::read_to_string(&path)
                .map_err(|error| format!("could not read {}: {error}", path.display()))?;
            let file: StoreFile = serde_json::from_str(&raw)
                .map_err(|error| format!("could not parse {}: {error}", path.display()))?;
            let key = B64
                .decode(unprotect_secret(&file.key).map_err(String::from)?)
                .map_err(|error| format!("corrupt TV remote key: {error}"))?;
            let cert = B64
                .decode(&file.cert)
                .map_err(|error| format!("corrupt TV remote certificate: {error}"))?;
            return Ok(Self {
                path,
                cert,
                key,
                devices: file.devices,
                samsung: file.samsung,
            });
        }
        let (cert, key) = generate()?;
        let store = Self {
            path,
            cert,
            key,
            devices: BTreeMap::new(),
            samsung: BTreeMap::new(),
        };
        store.save()?;
        Ok(store)
    }

    fn save(&self) -> Result<(), String> {
        let file = StoreFile {
            cert: B64.encode(&self.cert),
            key: protect_secret(&B64.encode(&self.key))?,
            devices: self.devices.clone(),
            samsung: self.samsung.clone(),
        };
        let json = serde_json::to_string_pretty(&file).map_err(|error| error.to_string())?;
        fs::write(&self.path, json)
            .map_err(|error| format!("could not write {}: {error}", self.path.display()))
    }

    pub fn pin(&self, host: &str) -> Option<String> {
        self.devices.get(host).cloned()
    }

    pub fn remember(&mut self, host: String, server_cert: &[u8]) -> Result<(), String> {
        self.devices.insert(host, fingerprint(server_cert));
        self.save()
    }

    pub fn samsung(&self, host: &str) -> Result<Option<SamsungTv>, String> {
        let Some(entry) = self.samsung.get(host) else {
            return Ok(None);
        };
        let token = match &entry.token {
            Some(sealed) => Some(unprotect_secret(sealed).map_err(String::from)?),
            None => None,
        };
        Ok(Some(SamsungTv {
            pin: entry.pin.clone(),
            token,
        }))
    }

    pub fn remember_samsung(
        &mut self,
        host: String,
        cert: &[u8],
        token: Option<&str>,
    ) -> Result<(), String> {
        let token = token.map(protect_secret).transpose()?;
        let pin = fingerprint(cert);
        self.samsung.insert(host, SamsungEntry { pin, token });
        self.save()
    }

    /// TLS settings for one connection: present the client certificate, and
    /// accept the TV's certificate only if it matches `pin` (any, while pairing).
    pub fn client_config(&self, pin: Option<String>) -> Result<Arc<ClientConfig>, String> {
        let provider = Arc::new(ring::default_provider());
        let config = ClientConfig::builder_with_provider(provider.clone())
            .with_safe_default_protocol_versions()
            .map_err(|error| error.to_string())?
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(TvCertificate { pin, provider }))
            .with_client_auth_cert(
                vec![CertificateDer::from(self.cert.clone())],
                PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(self.key.clone())),
            )
            .map_err(|error| error.to_string())?;
        Ok(Arc::new(config))
    }
}

/// A self-signed RSA certificate, as the TV expects: the pairing secret hashes
/// the RSA modulus and exponent, so another key type cannot pair at all.
fn generate() -> Result<(Vec<u8>, Vec<u8>), String> {
    let key = RsaPrivateKey::new(&mut rsa::rand_core::OsRng, 2048)
        .map_err(|error| format!("could not generate a key: {error}"))?;
    let key_der = key
        .to_pkcs8_der()
        .map_err(|error| error.to_string())?
        .as_bytes()
        .to_vec();
    let key_pair = rcgen::KeyPair::from_pkcs8_der_and_sign_algo(
        &PrivatePkcs8KeyDer::from(key_der.as_slice()),
        &rcgen::PKCS_RSA_SHA256,
    )
    .map_err(|error| error.to_string())?;
    let mut params =
        rcgen::CertificateParams::new(vec!["kavibay".to_string()]).map_err(|e| e.to_string())?;
    params.distinguished_name = rcgen::DistinguishedName::new();
    params
        .distinguished_name
        .push(rcgen::DnType::CommonName, "kavibay");
    params.not_after = rcgen::date_time_ymd(2046, 1, 1);
    let cert = params
        .self_signed(&key_pair)
        .map_err(|error| error.to_string())?;
    Ok((cert.der().to_vec(), key_der))
}

fn fingerprint(cert: &[u8]) -> String {
    Sha256::digest(cert)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn rsa_public_key(cert: &[u8]) -> Result<RsaPublicKey, String> {
    let cert = x509_cert::Certificate::from_der(cert)
        .map_err(|error| format!("unreadable certificate: {error}"))?;
    let spki = cert
        .tbs_certificate
        .subject_public_key_info
        .to_der()
        .map_err(|error| error.to_string())?;
    RsaPublicKey::from_public_key_der(&spki)
        .map_err(|error| format!("certificate has no RSA key: {error}"))
}

/// The secret that proves this client saw the code on the TV.
///
/// SHA-256 over both moduli and exponents (client first, as unsigned
/// big-endian bytes) and the last four hex digits of the code. The first two
/// digits are a check byte: they must equal the hash's first byte, which
/// catches a mistyped code here instead of a refusal from the TV.
pub fn pairing_secret(
    client_cert: &[u8],
    server_cert: &[u8],
    code: &str,
) -> Result<Vec<u8>, String> {
    let code = code.trim();
    if code.len() != 6 || !code.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("The code has six characters, 0–9 and A–F.".into());
    }
    let byte = |at: usize| u8::from_str_radix(&code[at..at + 2], 16).unwrap_or_default();
    let mut hash = Sha256::new();
    for key in [rsa_public_key(client_cert)?, rsa_public_key(server_cert)?] {
        hash.update(key.n().to_bytes_be());
        hash.update(key.e().to_bytes_be());
    }
    hash.update([byte(2), byte(4)]);
    let secret = hash.finalize().to_vec();
    if secret[0] != byte(0) {
        return Err("That is not the code on the TV. Check it and type it again.".into());
    }
    Ok(secret)
}

#[derive(Debug)]
struct TvCertificate {
    pin: Option<String>,
    provider: Arc<CryptoProvider>,
}

impl ServerCertVerifier for TvCertificate {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, TlsError> {
        match &self.pin {
            Some(pin) if *pin != fingerprint(end_entity) => Err(TlsError::General(
                "the TV presented a different certificate than when it was paired; pair again"
                    .into(),
            )),
            _ => Ok(ServerCertVerified::assertion()),
        }
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, TlsError> {
        verify_tls12_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, TlsError> {
        verify_tls13_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pairing_secret_checks_the_code_against_its_own_hash() {
        let (cert, _key) = generate().unwrap();
        let public = rsa_public_key(&cert).unwrap();
        assert_eq!(public.e().to_bytes_be(), [1, 0, 1]);
        assert_eq!(public.n().to_bytes_be().len(), 256);

        // Work out which check byte goes with the tail "abcd", then type it.
        let mut hash = Sha256::new();
        for _ in 0..2 {
            hash.update(public.n().to_bytes_be());
            hash.update(public.e().to_bytes_be());
        }
        hash.update([0xab, 0xcd]);
        let expected = hash.finalize().to_vec();
        let code = format!("{:02X}ABCD", expected[0]);
        assert_eq!(pairing_secret(&cert, &cert, &code).unwrap(), expected);

        let wrong = format!("{:02X}ABCD", expected[0].wrapping_add(1));
        assert!(pairing_secret(&cert, &cert, &wrong).is_err());
        assert!(pairing_secret(&cert, &cert, "12345").is_err());
        assert!(pairing_secret(&cert, &cert, "12345G").is_err());
    }

    #[test]
    fn pin_rejects_a_different_certificate() {
        let (cert, _) = generate().unwrap();
        let verifier = TvCertificate {
            pin: Some(fingerprint(b"another certificate")),
            provider: Arc::new(ring::default_provider()),
        };
        let name = ServerName::try_from("192.168.0.2").unwrap();
        let check = |v: &TvCertificate| {
            v.verify_server_cert(
                &CertificateDer::from(cert.clone()),
                &[],
                &name,
                &[],
                UnixTime::now(),
            )
        };
        assert!(check(&verifier).is_err());
        assert!(check(&TvCertificate {
            pin: Some(fingerprint(&cert)),
            ..verifier
        })
        .is_ok());
    }
}
