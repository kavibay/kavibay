//! Shared OS-backed secret protection for credentials at rest.
//!
//! One implementation for every integration (GitHub PAT, Google credentials,
//! Tado tokens, Cloudflare token) and for `web-storage.json`. Plaintext is never
//! returned to the frontend.
//!
//! Per-OS backend boundary: only `protect_bytes` / `unprotect_bytes` are
//! platform-specific, and both are pure transforms. A blob carries everything
//! needed to open it, so callers store it wherever they like and never clean up.
//!
//! - **Windows:** DPAPI (`CryptProtectData`), bound to the current user profile,
//!   so a copied `*.db` cannot be read elsewhere.
//! - **macOS:** AES-256-GCM under one random key held in the login keychain.
//!   The Keychain stores items, it does not encrypt blobs; one item per secret
//!   would turn every `protect` into a new item nobody deletes, once per
//!   web-storage save. One key sealing everything keeps the DPAPI shape, and the
//!   key never leaves this user's keychain.
//! - **Everywhere else** fails closed instead of silently storing plaintext.

use base64::{engine::general_purpose::STANDARD as B64, Engine};

/// Encrypts a UTF-8 secret for storage. Output is base64 of the protected blob.
pub fn protect_secret(plaintext: &str) -> Result<String, String> {
    let protected = protect_bytes(plaintext.as_bytes())?;
    Ok(B64.encode(protected))
}

/// Decrypts a value previously produced by [`protect_secret`].
pub fn unprotect_secret(encoded: &str) -> Result<String, String> {
    let protected = B64
        .decode(encoded.trim())
        .map_err(|error| format!("corrupt protected secret: {error}"))?;
    let bytes = unprotect_bytes(&protected)?;
    String::from_utf8(bytes).map_err(|error| format!("protected secret is not UTF-8: {error}"))
}

#[cfg(windows)]
fn protect_bytes(plaintext: &[u8]) -> Result<Vec<u8>, String> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::LocalFree;
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    if plaintext.is_empty() {
        return Err("cannot protect an empty secret".into());
    }

    let input = CRYPT_INTEGER_BLOB {
        cbData: plaintext.len() as u32,
        pbData: plaintext.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };

    // UI-forbidden keeps save/connect flows non-interactive if DPAPI would prompt.
    unsafe {
        CryptProtectData(
            &input,
            PCWSTR::null(),
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|error| format!("DPAPI protect failed: {error}"))?;
    }

    let result = unsafe {
        if output.pbData.is_null() || output.cbData == 0 {
            return Err("DPAPI protect returned an empty blob".into());
        }
        let slice = std::slice::from_raw_parts(output.pbData, output.cbData as usize);
        let copied = slice.to_vec();
        let _ = LocalFree(Some(windows::Win32::Foundation::HLOCAL(
            output.pbData as *mut std::ffi::c_void,
        )));
        copied
    };
    Ok(result)
}

#[cfg(windows)]
fn unprotect_bytes(protected: &[u8]) -> Result<Vec<u8>, String> {
    use windows::Win32::Foundation::LocalFree;
    use windows::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    if protected.is_empty() {
        return Err("cannot unprotect an empty blob".into());
    }

    let input = CRYPT_INTEGER_BLOB {
        cbData: protected.len() as u32,
        pbData: protected.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };

    unsafe {
        CryptUnprotectData(
            &input,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|error| format!("DPAPI unprotect failed: {error}"))?;
    }

    let result = unsafe {
        if output.pbData.is_null() || output.cbData == 0 {
            return Err("DPAPI unprotect returned an empty blob".into());
        }
        let slice = std::slice::from_raw_parts(output.pbData, output.cbData as usize);
        let copied = slice.to_vec();
        let _ = LocalFree(Some(windows::Win32::Foundation::HLOCAL(
            output.pbData as *mut std::ffi::c_void,
        )));
        copied
    };
    Ok(result)
}

#[cfg(target_os = "macos")]
fn protect_bytes(plaintext: &[u8]) -> Result<Vec<u8>, String> {
    seal(&master_key()?, plaintext)
}

#[cfg(target_os = "macos")]
fn unprotect_bytes(protected: &[u8]) -> Result<Vec<u8>, String> {
    open(&master_key()?, protected)
}

// No secret store on other platforms yet. Storing plaintext here would silently
// downgrade every integration at once.

#[cfg(not(any(windows, target_os = "macos")))]
fn protect_bytes(_plaintext: &[u8]) -> Result<Vec<u8>, String> {
    Err("secure secret storage is not available on this platform".into())
}

#[cfg(not(any(windows, target_os = "macos")))]
fn unprotect_bytes(_protected: &[u8]) -> Result<Vec<u8>, String> {
    Err("secure secret storage is not available on this platform".into())
}

/// AES-256-GCM key length, and the size of the keychain item that holds it.
#[cfg(any(target_os = "macos", test))]
const KEY_LEN: usize = 32;

#[cfg(any(target_os = "macos", test))]
type MasterKey = [u8; KEY_LEN];

/// First byte of every sealed blob, also bound in as associated data. A blob in
/// another format, such as a DPAPI blob copied over from Windows, fails to open
/// instead of being misread.
#[cfg(any(target_os = "macos", test))]
const SEALED_V1: u8 = 1;

/// The master key, fetched from the Keychain once per process.
///
/// `web_storage` seals on every debounce tick. A Keychain read per call would be
/// a round trip per save and, on a build the item does not trust yet (every
/// unsigned rebuild), an access prompt per save. A refusal is kept for the same
/// reason, until [`retry_access`] forgets it or the next start asks again.
#[cfg(target_os = "macos")]
fn master_key() -> Result<MasterKey, String> {
    MASTER_KEY.get_or_fetch(fetch_master_key)
}

#[cfg(target_os = "macos")]
static MASTER_KEY: KeyCache = KeyCache::new();

/// Forgets a refused Keychain read, so the next secret operation asks again.
/// A key that was read stays.
pub fn retry_access() {
    #[cfg(target_os = "macos")]
    MASTER_KEY.forget_failure();
}

/// The outcome of the one Keychain fetch. Concurrent first callers wait on
/// that fetch, so they raise one prompt between them.
#[cfg(any(target_os = "macos", test))]
struct KeyCache(std::sync::Mutex<Option<Result<MasterKey, String>>>);

#[cfg(any(target_os = "macos", test))]
impl KeyCache {
    const fn new() -> Self {
        Self(std::sync::Mutex::new(None))
    }

    fn get_or_fetch(
        &self,
        fetch: impl FnOnce() -> Result<MasterKey, String>,
    ) -> Result<MasterKey, String> {
        self.lock().get_or_insert_with(fetch).clone()
    }

    fn forget_failure(&self) {
        let mut outcome = self.lock();
        if matches!(*outcome, Some(Err(_))) {
            *outcome = None;
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Option<Result<MasterKey, String>>> {
        // A fetch that panics stores nothing, so a poisoned slot is still consistent.
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

#[cfg(target_os = "macos")]
fn fetch_master_key() -> Result<MasterKey, String> {
    // Tests seal under a throwaway key: the real item trusts the app build that
    // created it, so a test binary reading it would raise a Keychain prompt.
    #[cfg(test)]
    {
        random_key()
    }
    #[cfg(not(test))]
    {
        load_or_create_key(&MASTER_ITEM)
    }
}

/// The item holding the master key. The access prompt names it: "kavibay wants
/// to use your confidential information stored in "Kavibay Safe Storage"".
#[cfg(all(target_os = "macos", not(test)))]
const MASTER_ITEM: KeychainItem = KeychainItem {
    service: "Kavibay Safe Storage",
    account: "Kavibay",
};

/// A generic-password item in the login keychain.
#[cfg(target_os = "macos")]
struct KeychainItem<'a> {
    service: &'a str,
    account: &'a str,
}

/// `errSecUserCanceled`, `errSecItemNotFound` and `errSecDuplicateItem` from
/// `SecBase.h`. Denying the access prompt is a user cancel.
#[cfg(target_os = "macos")]
const ERR_SEC_USER_CANCELED: i32 = -128;
#[cfg(target_os = "macos")]
const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;
#[cfg(target_os = "macos")]
const ERR_SEC_DUPLICATE_ITEM: i32 = -25299;

/// The key stored in `item`, generated and stored first when there is none.
#[cfg(target_os = "macos")]
fn load_or_create_key(item: &KeychainItem) -> Result<MasterKey, String> {
    match read_key(item)? {
        Some(key) => Ok(key),
        None => add_key_or_adopt(item, &random_key()?),
    }
}

#[cfg(target_os = "macos")]
fn read_key(item: &KeychainItem) -> Result<Option<MasterKey>, String> {
    use security_framework::passwords::{generic_password, PasswordOptions};

    match generic_password(PasswordOptions::new_generic_password(
        item.service,
        item.account,
    )) {
        Ok(bytes) => MasterKey::try_from(bytes.as_slice())
            .map(Some)
            .map_err(|_| {
                format!(
                    "keychain item \"{}\" is not a {KEY_LEN}-byte key",
                    item.service
                )
            }),
        Err(error) if error.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(None),
        Err(error) if error.code() == ERR_SEC_USER_CANCELED => Err(format!(
            "access to \"{}\" in your login keychain was denied",
            item.service
        )),
        Err(error) => Err(format!("keychain read failed: {error}")),
    }
}

/// Store `key` unless the item already exists, and return the key the item holds.
///
/// Create-only, never overwrite: two instances can start at once (a
/// `KAVIBAY_DATA_DIR` run skips single instancing). The one that loses the race
/// adopts the winner's key, because the winner may already have sealed with it.
#[cfg(target_os = "macos")]
fn add_key_or_adopt(item: &KeychainItem, key: &MasterKey) -> Result<MasterKey, String> {
    use core_foundation::data::CFData;
    use security_framework::item::{ItemAddOptions, ItemAddValue, ItemClass};

    let mut options = ItemAddOptions::new(ItemAddValue::Data {
        class: ItemClass::generic_password(),
        data: CFData::from_buffer(key),
    });
    options
        .set_service(item.service)
        .set_account_name(item.account);
    match options.add() {
        Ok(()) => Ok(*key),
        Err(error) if error.code() == ERR_SEC_DUPLICATE_ITEM => {
            read_key(item)?.ok_or_else(|| "keychain key vanished while being created".into())
        }
        Err(error) => Err(format!("keychain write failed: {error}")),
    }
}

#[cfg(any(target_os = "macos", test))]
fn random_key() -> Result<MasterKey, String> {
    use ring::rand::{SecureRandom, SystemRandom};

    let mut key = [0u8; KEY_LEN];
    SystemRandom::new()
        .fill(&mut key)
        .map_err(|_| "no system randomness for a secret key".to_string())?;
    Ok(key)
}

/// `SEALED_V1 || nonce || ciphertext || tag`.
///
/// A random 96-bit nonce per blob. GCM's collision bound is about 2^32 blobs
/// per key, which is centuries of web-storage saves.
#[cfg(any(target_os = "macos", test))]
fn seal(key: &MasterKey, plaintext: &[u8]) -> Result<Vec<u8>, String> {
    use ring::aead::{Aad, Nonce, NONCE_LEN};
    use ring::rand::{SecureRandom, SystemRandom};

    let mut nonce = [0u8; NONCE_LEN];
    SystemRandom::new()
        .fill(&mut nonce)
        .map_err(|_| "no system randomness for a nonce".to_string())?;

    let mut sealed = plaintext.to_vec();
    cipher(key)
        .seal_in_place_append_tag(
            Nonce::assume_unique_for_key(nonce),
            Aad::from([SEALED_V1]),
            &mut sealed,
        )
        .map_err(|_| "sealing the secret failed".to_string())?;

    let mut blob = Vec::with_capacity(1 + NONCE_LEN + sealed.len());
    blob.push(SEALED_V1);
    blob.extend_from_slice(&nonce);
    blob.extend_from_slice(&sealed);
    Ok(blob)
}

/// Opens a blob from [`seal`]; any other key, format or a single flipped bit fails.
#[cfg(any(target_os = "macos", test))]
fn open(key: &MasterKey, blob: &[u8]) -> Result<Vec<u8>, String> {
    use ring::aead::{Aad, Nonce, AES_256_GCM, NONCE_LEN};

    let Some((&SEALED_V1, rest)) = blob.split_first() else {
        return Err("protected secret is in an unknown format".into());
    };
    let Some((nonce, sealed)) = rest
        .split_first_chunk::<NONCE_LEN>()
        .filter(|(_, sealed)| sealed.len() >= AES_256_GCM.tag_len())
    else {
        return Err("protected secret is truncated".into());
    };

    let mut buffer = sealed.to_vec();
    let plaintext = cipher(key)
        .open_in_place(
            Nonce::assume_unique_for_key(*nonce),
            Aad::from([SEALED_V1]),
            &mut buffer,
        )
        .map_err(|_| "protected secret does not decrypt with this user's key".to_string())?;
    Ok(plaintext.to_vec())
}

#[cfg(any(target_os = "macos", test))]
fn cipher(key: &MasterKey) -> ring::aead::LessSafeKey {
    use ring::aead::{LessSafeKey, UnboundKey, AES_256_GCM};

    LessSafeKey::new(UnboundKey::new(&AES_256_GCM, key).expect("KEY_LEN is the AES-256 key size"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(any(windows, target_os = "macos"))]
    #[test]
    fn protect_unprotect_roundtrip() {
        let secret = "some-oauth-refresh-token";
        let protected = protect_secret(secret).expect("protect");
        assert_ne!(protected, secret);
        assert!(!protected.contains(secret));
        let restored = unprotect_secret(&protected).expect("unprotect");
        assert_eq!(restored, secret);
    }

    #[test]
    fn a_refused_key_is_asked_for_again_only_after_a_retry() {
        let cache = KeyCache::new();
        let key = random_key().unwrap();
        let denied = || Err("denied".to_string());

        assert_eq!(cache.get_or_fetch(denied), denied());
        assert_eq!(
            cache.get_or_fetch(|| panic!("a refusal must not prompt again")),
            denied()
        );

        cache.forget_failure();
        assert_eq!(cache.get_or_fetch(|| Ok(key)), Ok(key));

        cache.forget_failure();
        assert_eq!(
            cache.get_or_fetch(|| panic!("a key that was read must be kept")),
            Ok(key)
        );
    }

    #[test]
    fn a_sealed_blob_opens_only_with_its_own_key() {
        let key = random_key().unwrap();
        let blob = seal(&key, b"ghp_secret").unwrap();

        assert_eq!(open(&key, &blob).unwrap(), b"ghp_secret");
        assert_ne!(
            seal(&key, b"ghp_secret").unwrap(),
            blob,
            "fresh nonce per seal"
        );
        assert_eq!(
            open(&random_key().unwrap(), &blob).unwrap_err(),
            "protected secret does not decrypt with this user's key"
        );
    }

    #[test]
    fn a_damaged_or_foreign_blob_fails_closed() {
        let key = random_key().unwrap();
        let blob = seal(&key, b"ghp_secret").unwrap();

        let mut flipped = blob.clone();
        *flipped.last_mut().unwrap() ^= 1;
        assert_eq!(
            open(&key, &flipped).unwrap_err(),
            "protected secret does not decrypt with this user's key"
        );

        let mut other_format = blob.clone();
        other_format[0] = 2;
        assert_eq!(
            open(&key, &other_format).unwrap_err(),
            "protected secret is in an unknown format"
        );
        assert_eq!(
            open(&key, &blob[..20]).unwrap_err(),
            "protected secret is truncated"
        );
        assert_eq!(
            open(&key, &[]).unwrap_err(),
            "protected secret is in an unknown format"
        );
    }

    /// A keychain item that exists for one test and is deleted after it.
    #[cfg(target_os = "macos")]
    struct ThrowawayItem {
        account: String,
    }

    #[cfg(target_os = "macos")]
    impl ThrowawayItem {
        const SERVICE: &'static str = "Kavibay Safe Storage (test)";

        fn new() -> Self {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            Self {
                account: format!("test-{}-{nanos}", std::process::id()),
            }
        }

        fn item(&self) -> KeychainItem<'_> {
            KeychainItem {
                service: Self::SERVICE,
                account: &self.account,
            }
        }
    }

    #[cfg(target_os = "macos")]
    impl Drop for ThrowawayItem {
        fn drop(&mut self) {
            let _ = security_framework::passwords::delete_generic_password(
                Self::SERVICE,
                &self.account,
            );
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn the_keychain_key_is_created_once_and_read_back() {
        let throwaway = ThrowawayItem::new();
        let item = throwaway.item();
        assert_eq!(read_key(&item).unwrap(), None, "starts without a key");

        let created = load_or_create_key(&item).expect("create");
        assert_eq!(
            read_key(&item).unwrap(),
            Some(created),
            "stored in the keychain"
        );
        assert_eq!(
            load_or_create_key(&item).unwrap(),
            created,
            "reused, not replaced"
        );
        assert_eq!(
            add_key_or_adopt(&item, &random_key().unwrap()).unwrap(),
            created,
            "a racing second key adopts the stored one"
        );

        let blob = seal(&created, b"some-oauth-refresh-token").unwrap();
        let reloaded = read_key(&item).unwrap().unwrap();
        assert_eq!(open(&reloaded, &blob).unwrap(), b"some-oauth-refresh-token");
    }
}
