//! The Hotkey: the fastest Entry Point, and the only one that can be
//! unavailable. Registration is a plain function over an injected registrar so
//! the outcome — including the failure — is decided here and testable without
//! a running app.

use serde::Serialize;

/// Three modifiers, because a global registration intercepts the keystroke
/// before the focused application sees it and this combination is unclaimed
/// territory. `Alt` is how the OS spells Option. Remapping arrives with
/// Settings.
pub const DEFAULT_HOTKEY: &str = "Ctrl+Alt+Cmd+J";

/// Whether the Hotkey is available, and if not, why. Recorded at startup and
/// readable from anywhere afterwards — Settings reports on it later.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum HotkeyStatus {
    Registered {
        hotkey: String,
    },
    /// macOS may withhold the permission registration needs, the combination
    /// may already belong to another application, or the machine may be
    /// managed. Every feature stays reachable through the Tray Menu, so this is
    /// recorded rather than fatal.
    Unavailable {
        hotkey: String,
        reason: String,
    },
}

/// Registers the Hotkey and reports the outcome. Never fails: a Hotkey that
/// could not be registered leaves the app running with one Entry Point fewer.
pub fn register<E: std::fmt::Display>(
    hotkey: &str,
    registrar: impl FnOnce(&str) -> Result<(), E>,
) -> HotkeyStatus {
    match registrar(hotkey) {
        Ok(()) => HotkeyStatus::Registered {
            hotkey: hotkey.to_string(),
        },
        Err(error) => HotkeyStatus::Unavailable {
            hotkey: hotkey.to_string(),
            reason: error.to_string(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_successful_registration_records_the_hotkey() {
        let status = register(DEFAULT_HOTKEY, |_| Ok::<(), String>(()));

        assert_eq!(
            status,
            HotkeyStatus::Registered {
                hotkey: DEFAULT_HOTKEY.to_string(),
            }
        );
    }

    #[test]
    fn a_failed_registration_records_the_reason_rather_than_panicking() {
        let status = register(DEFAULT_HOTKEY, |_| {
            Err::<(), _>("the combination belongs to another application")
        });

        assert_eq!(
            status,
            HotkeyStatus::Unavailable {
                hotkey: DEFAULT_HOTKEY.to_string(),
                reason: "the combination belongs to another application".to_string(),
            }
        );
    }

    #[test]
    fn the_hotkey_asked_for_is_the_one_registered() {
        let mut asked_for = None;

        register("Ctrl+K", |hotkey| {
            asked_for = Some(hotkey.to_string());
            Ok::<(), String>(())
        });

        assert_eq!(asked_for.as_deref(), Some("Ctrl+K"));
    }
}
