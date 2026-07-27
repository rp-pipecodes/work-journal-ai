//! The Hotkey: the fastest Entry Point, and the only one that can be
//! unavailable. Registration is a plain function over an injected registrar so
//! the outcome — including the failure — is decided here and testable without
//! a running app.

use serde::Serialize;

/// Three modifiers, because a global registration intercepts the keystroke
/// before the focused application sees it and this combination is unclaimed
/// territory. `Alt` is how the OS spells Option. Remappable in Settings; this
/// is only where it starts, and where it returns to if the store has never
/// been written.
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

impl HotkeyStatus {
    /// The combination this status is about, registered or not.
    pub fn hotkey(&self) -> &str {
        match self {
            HotkeyStatus::Registered { hotkey } => hotkey,
            HotkeyStatus::Unavailable { hotkey, .. } => hotkey,
        }
    }

    /// Whether the combination is actually live, and so whether it has to be
    /// given up before another one can take its place.
    fn is_registered(&self) -> bool {
        matches!(self, HotkeyStatus::Registered { .. })
    }
}

/// The OS's global shortcut table, as remapping needs to see it. Injected so
/// every decision below is testable without a running app.
pub trait Registrar {
    fn register(&self, hotkey: &str) -> Result<(), String>;
    fn unregister(&self, hotkey: &str);
}

/// Moves the Hotkey to another combination, or explains why it could not move.
///
/// The old binding is given up first, because the OS will not hand out a
/// combination twice and remapping onto an overlapping one would otherwise
/// fail against the app itself. If the new combination is refused, the old one
/// is put back: a rejected remap must leave the user with the Hotkey they had,
/// not with none at all.
///
/// The error is the reason the OS gave, for the caller to say plainly.
pub fn remap(
    current: &HotkeyStatus,
    next: &str,
    registrar: &impl Registrar,
) -> Result<HotkeyStatus, String> {
    let next = next.trim();

    if next.is_empty() {
        return Err("a Hotkey cannot be empty".to_string());
    }

    // Already live and unchanged: nothing to give up and nothing to claim.
    if current.is_registered() && current.hotkey() == next {
        return Ok(current.clone());
    }

    if current.is_registered() {
        registrar.unregister(current.hotkey());
    }

    match registrar.register(next) {
        Ok(()) => Ok(HotkeyStatus::Registered {
            hotkey: next.to_string(),
        }),
        Err(reason) => {
            if current.is_registered() {
                // Best effort: if even the old combination will not come back,
                // there is nothing further to try, and the Tray Menu is
                // unaffected either way.
                let _ = registrar.register(current.hotkey());
            }
            Err(reason)
        }
    }
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
    use std::cell::RefCell;

    /// Every call made to the OS, in order, plus which combinations it refuses.
    struct FakeRegistrar {
        refuses: Vec<String>,
        calls: RefCell<Vec<String>>,
    }

    impl FakeRegistrar {
        fn accepting_everything() -> Self {
            FakeRegistrar {
                refuses: Vec::new(),
                calls: RefCell::new(Vec::new()),
            }
        }

        fn refusing(hotkey: &str) -> Self {
            FakeRegistrar {
                refuses: vec![hotkey.to_string()],
                calls: RefCell::new(Vec::new()),
            }
        }

        fn calls(&self) -> Vec<String> {
            self.calls.borrow().clone()
        }
    }

    impl Registrar for FakeRegistrar {
        fn register(&self, hotkey: &str) -> Result<(), String> {
            self.calls.borrow_mut().push(format!("register {hotkey}"));
            if self.refuses.iter().any(|refused| refused == hotkey) {
                return Err("the combination belongs to another application".to_string());
            }
            Ok(())
        }

        fn unregister(&self, hotkey: &str) {
            self.calls.borrow_mut().push(format!("unregister {hotkey}"));
        }
    }

    fn registered(hotkey: &str) -> HotkeyStatus {
        HotkeyStatus::Registered {
            hotkey: hotkey.to_string(),
        }
    }

    #[test]
    fn a_remap_gives_up_the_old_combination_before_claiming_the_new_one() {
        let registrar = FakeRegistrar::accepting_everything();

        let status = remap(&registered("Ctrl+Alt+Cmd+J"), "Ctrl+Alt+K", &registrar);

        assert_eq!(status, Ok(registered("Ctrl+Alt+K")));
        assert_eq!(
            registrar.calls(),
            vec!["unregister Ctrl+Alt+Cmd+J", "register Ctrl+Alt+K"]
        );
    }

    #[test]
    fn a_refused_remap_reports_the_reason_and_puts_the_old_combination_back() {
        let registrar = FakeRegistrar::refusing("Ctrl+Alt+K");

        let status = remap(&registered("Ctrl+Alt+Cmd+J"), "Ctrl+Alt+K", &registrar);

        assert_eq!(
            status,
            Err("the combination belongs to another application".to_string())
        );
        assert_eq!(
            registrar.calls(),
            vec![
                "unregister Ctrl+Alt+Cmd+J",
                "register Ctrl+Alt+K",
                "register Ctrl+Alt+Cmd+J"
            ]
        );
    }

    #[test]
    fn remapping_to_the_combination_already_in_force_touches_nothing() {
        let registrar = FakeRegistrar::accepting_everything();

        let status = remap(&registered("Ctrl+Alt+Cmd+J"), "Ctrl+Alt+Cmd+J", &registrar);

        assert_eq!(status, Ok(registered("Ctrl+Alt+Cmd+J")));
        assert!(registrar.calls().is_empty());
    }

    #[test]
    fn an_unavailable_hotkey_has_nothing_to_give_up() {
        let registrar = FakeRegistrar::accepting_everything();
        let current = HotkeyStatus::Unavailable {
            hotkey: "Ctrl+Alt+Cmd+J".to_string(),
            reason: "macOS withheld the permission".to_string(),
        };

        let status = remap(&current, "Ctrl+Alt+K", &registrar);

        assert_eq!(status, Ok(registered("Ctrl+Alt+K")));
        assert_eq!(registrar.calls(), vec!["register Ctrl+Alt+K"]);
    }

    #[test]
    fn a_hotkey_that_failed_to_register_can_be_retried_as_it_is() {
        let registrar = FakeRegistrar::accepting_everything();
        let current = HotkeyStatus::Unavailable {
            hotkey: "Ctrl+Alt+Cmd+J".to_string(),
            reason: "macOS withheld the permission".to_string(),
        };

        let status = remap(&current, "Ctrl+Alt+Cmd+J", &registrar);

        assert_eq!(status, Ok(registered("Ctrl+Alt+Cmd+J")));
    }

    #[test]
    fn an_empty_hotkey_is_refused_without_giving_up_the_working_one() {
        let registrar = FakeRegistrar::accepting_everything();

        let status = remap(&registered("Ctrl+Alt+Cmd+J"), "   ", &registrar);

        assert!(status.is_err());
        assert!(registrar.calls().is_empty());
    }

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
