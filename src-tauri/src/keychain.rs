//! The API Key, in the operating system's keychain rather than beside the
//! other settings — the only secret the app stores, and the only thing it
//! stores that outlives an uninstall. See
//! docs/adr/0026-the-api-key-lives-in-the-keychain-and-rust-makes-the-call.md:
//! `tauri-plugin-store` is plain JSON, world-readable to anything running as
//! the user and swept into every Time Machine backup, and a billable
//! credential does not belong there.
//!
//! Three questions and no others: is there a key, take this one, and remove
//! the one that is there. The key itself is never handed back — nothing here
//! reads it, and the webview has no way to ask for it.
//!
//! The keychain can refuse. A locked login keychain, or a prompt the user
//! denied, comes back as an ordinary error for Settings to explain, exactly as
//! a refused calendar grant does.

use keyring::{Entry, Error};

/// What the entry is called in the keychain, as Keychain Access shows it. Kept
/// stable: a rename would strand the key the user already saved, and stranded
/// is worse than absent — nothing would ever clear it.
const SERVICE: &str = "Work Journal";
const ACCOUNT: &str = "api-key";

/// The one entry, or why the keychain would not open at all.
fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(describe)
}

/// Whether a key is saved. The answer Settings shows — never the key.
///
/// Read through `get_password` on purpose: the Apple store answers
/// `get_credential` with the very same `SecKeychainFindGenericPassword` call,
/// so there is no cheaper existence check to reach for, and the value is
/// dropped here rather than travelling anywhere.
pub fn is_set() -> Result<bool, String> {
    match entry()?.get_password() {
        Ok(_) => Ok(true),
        // Nothing saved yet is the state every install starts in, not a
        // failure worth a line in Settings.
        Err(Error::NoEntry) => Ok(false),
        Err(error) => Err(describe(error)),
    }
}

/// Returns the key only to Rust's model request; it never crosses the command boundary.
pub fn password() -> Result<String, String> {
    match entry()?.get_password() {
        Ok(password) => Ok(password),
        Err(Error::NoEntry) => Err("Model Access is not configured. Open Settings to configure it.".into()),
        Err(error) => Err(describe(error)),
    }
}

/// Saves the key, over whatever was there before.
pub fn save(api_key: &str) -> Result<(), String> {
    entry()?.set_password(api_key).map_err(describe)
}

/// Removes the key. Removing one that is already gone is not an error: the
/// user asking for no key and there being no key are the same outcome.
pub fn clear() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) => Ok(()),
        Err(Error::NoEntry) => Ok(()),
        Err(error) => Err(describe(error)),
    }
}

/// What went wrong, in the keychain's own words, so that Settings can say
/// which refusal this was — a locked keychain and a denied prompt do not read
/// the same. The key is never in one of these: the messages describe the
/// keychain, not its contents.
fn describe(error: Error) -> String {
    error.to_string()
}

