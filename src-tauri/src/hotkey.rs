//! The Hotkey: the fastest Entry Point, and the only one that can be
//! unavailable. Registration is a plain function over an injected registrar so
//! the outcome — including the failure — is decided here and testable without
//! a running app.

use serde::Serialize;

/// Three modifiers, because a global registration intercepts the keystroke
/// before the focused application sees it and this combination is unclaimed
/// territory. `Alt` is macOS's Option. Remapping arrives with Settings.
pub const DEFAULT_HOTKEY: &str = "Ctrl+Alt+Cmd+J";

/// Whether the Hotkey is available, and if not, why. Recorded at startup and
/// readable from anywhere afterwards — Settings reports on it later.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum HotkeyStatus {
    Registered {
        accelerator: String,
    },
    /// macOS may withhold the permission registration needs, or the machine may
    /// be managed. Every feature stays reachable through the Tray Menu, so this
    /// is recorded rather than fatal.
    Unavailable {
        accelerator: String,
        reason: String,
    },
}

/// Registers the Hotkey and reports the outcome. Never fails: a Hotkey that
/// could not be registered leaves the app running with one Entry Point fewer.
pub fn register<E: std::fmt::Display>(
    accelerator: &str,
    register: impl FnOnce(&str) -> Result<(), E>,
) -> HotkeyStatus {
    match register(accelerator) {
        Ok(()) => HotkeyStatus::Registered {
            accelerator: accelerator.to_string(),
        },
        Err(error) => HotkeyStatus::Unavailable {
            accelerator: accelerator.to_string(),
            reason: error.to_string(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_successful_registration_records_the_accelerator() {
        let status = register(DEFAULT_HOTKEY, |_| Ok::<(), String>(()));

        assert_eq!(
            status,
            HotkeyStatus::Registered {
                accelerator: DEFAULT_HOTKEY.to_string(),
            }
        );
    }

    #[test]
    fn a_failed_registration_records_the_reason_rather_than_panicking() {
        let status = register(DEFAULT_HOTKEY, |_| {
            Err::<(), _>("accessibility permission withheld")
        });

        assert_eq!(
            status,
            HotkeyStatus::Unavailable {
                accelerator: DEFAULT_HOTKEY.to_string(),
                reason: "accessibility permission withheld".to_string(),
            }
        );
    }

    #[test]
    fn the_accelerator_asked_for_is_the_one_registered() {
        let mut asked_for = None;

        register("Ctrl+K", |accelerator| {
            asked_for = Some(accelerator.to_string());
            Ok::<(), String>(())
        });

        assert_eq!(asked_for.as_deref(), Some("Ctrl+K"));
    }
}
