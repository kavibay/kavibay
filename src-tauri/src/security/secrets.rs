//! Shared OS-backed secret protection for credentials at rest.
//!
//! One implementation for every integration (GitHub PAT, Google credentials,
//! Tado tokens, Cloudflare token). On Windows, secrets are wrapped with DPAPI
//! (`CryptProtectData`) bound to the current user profile, so a copied `*.db`
//! cannot be read elsewhere. Plaintext is never returned to the frontend.
//!
//! Per-OS backend boundary: only `protect_bytes` / `unprotect_bytes` are
//! platform-specific. The macOS port adds a Keychain-based backend behind the
//! same two functions (see plan 2026-07-23, P0.1); until then non-Windows
//! builds fail closed instead of silently storing plaintext.

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

// Fail closed off-Windows until the macOS Keychain backend lands with the port.
// Storing plaintext here would silently downgrade every integration at once.

#[cfg(not(windows))]
fn protect_bytes(_plaintext: &[u8]) -> Result<Vec<u8>, String> {
    Err("secure secret storage requires Windows DPAPI (Keychain backend pending)".into())
}

#[cfg(not(windows))]
fn unprotect_bytes(_protected: &[u8]) -> Result<Vec<u8>, String> {
    Err("secure secret storage requires Windows DPAPI (Keychain backend pending)".into())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn protect_unprotect_roundtrip() {
        let secret = "some-oauth-refresh-token";
        let protected = protect_secret(secret).expect("protect");
        assert_ne!(protected, secret);
        assert!(!protected.contains(secret));
        let restored = unprotect_secret(&protected).expect("unprotect");
        assert_eq!(restored, secret);
    }
}
