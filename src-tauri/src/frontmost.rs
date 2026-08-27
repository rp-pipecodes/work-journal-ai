//! Which application to hand focus back to. A Capture interrupts whatever the
//! user was doing, so putting it away has to give that back — see
//! docs/adr/0023-the-app-enters-the-dock-only-while-the-main-window-is-open.md.
//!
//! What is remembered is a process id rather than the application object: it is
//! a number, so it crosses threads and outlives the application it names
//! without keeping it alive, and macOS is asked to find the application again
//! at the moment focus is handed back.

use std::sync::Mutex;

/// A process id, as macOS spells it.
pub type ProcessId = i32;

/// The application that was in front before Work Journal came forward.
#[derive(Default)]
pub struct PreviousApplication(Mutex<Option<ProcessId>>);

impl PreviousApplication {
    /// Takes note of what is in front, just before this app comes forward.
    ///
    /// Work Journal itself is never what gets remembered. Raising a Capture
    /// from a focused Main Window would otherwise record this app and hand
    /// focus straight back to the window the Capture is floating over; what the
    /// user left to open History is still the right place to return to.
    pub fn note(&self, frontmost: Option<ProcessId>, own: ProcessId) {
        let Some(frontmost) = frontmost.filter(|id| *id != own) else {
            return;
        };

        *self.locked() = Some(frontmost);
    }

    /// Who to hand focus back to, if anyone. The answer is kept rather than
    /// consumed: two dismissals in a row both belong to the same application.
    /// It goes stale the moment that application quits, and macOS is free to
    /// hand its process id to something else — the cost is one dismissal that
    /// activates the wrong application, against a Capture that would otherwise
    /// hand focus nowhere every time.
    pub fn remembered_id(&self) -> Option<ProcessId> {
        *self.locked()
    }

    /// A poisoned lock is nothing to take the app down for — the worst it costs
    /// is one dismissal that hands focus nowhere.
    fn locked(&self) -> std::sync::MutexGuard<'_, Option<ProcessId>> {
        self.0.lock().unwrap_or_else(|error| error.into_inner())
    }
}

#[cfg(target_os = "macos")]
mod app_kit {
    use super::ProcessId;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};

    /// What macOS has in front right now, if it is an application at all — a
    /// full-screen login window or the Dock's own overlay is nobody.
    pub fn frontmost_process_id() -> Option<ProcessId> {
        unsafe {
            let workspace: Retained<AnyObject> = msg_send![class!(NSWorkspace), sharedWorkspace];
            let frontmost: Option<Retained<AnyObject>> =
                msg_send![&*workspace, frontmostApplication];
            Some(msg_send![&*frontmost?, processIdentifier])
        }
    }

    /// This application's own process id, so it is never the one remembered.
    pub fn own_process_id() -> ProcessId {
        std::process::id() as ProcessId
    }

    /// Hands focus to the application that was in front. Nothing happens if it
    /// has quit in the meantime, which is the right outcome: the user is left
    /// wherever macOS put them instead.
    pub fn activate(id: ProcessId) {
        unsafe {
            let application: Option<Retained<AnyObject>> = msg_send![
                class!(NSRunningApplication),
                runningApplicationWithProcessIdentifier: id
            ];
            let Some(application) = application else {
                return;
            };
            // No options are needed: this only ever runs while Work Journal is
            // the active application, putting a panel away, so macOS lets the
            // activation through without being told to ignore anyone.
            let _: bool = msg_send![&*application, activateWithOptions: 0usize];
        }
    }
}

/// Nowhere else has an application to hand focus back to, so nothing is ever
/// in front and nothing is ever activated. Putting a panel away is all that
/// happens there.
#[cfg(not(target_os = "macos"))]
mod app_kit {
    use super::ProcessId;

    pub fn frontmost_process_id() -> Option<ProcessId> {
        None
    }

    pub fn own_process_id() -> ProcessId {
        0
    }

    pub fn activate(_id: ProcessId) {}
}

pub use app_kit::{activate, frontmost_process_id, own_process_id};

#[cfg(test)]
mod tests {
    use super::*;

    const OWN: ProcessId = 1;

    #[test]
    fn remembers_the_application_in_front() {
        let previous = PreviousApplication::default();

        previous.note(Some(42), OWN);

        assert_eq!(previous.remembered_id(), Some(42));
    }

    #[test]
    fn remembers_nobody_until_something_is_in_front() {
        let previous = PreviousApplication::default();

        previous.note(None, OWN);

        assert_eq!(previous.remembered_id(), None);
    }

    #[test]
    fn never_remembers_this_application() {
        let previous = PreviousApplication::default();

        previous.note(Some(42), OWN);
        previous.note(Some(OWN), OWN);

        assert_eq!(previous.remembered_id(), Some(42));
    }

    #[test]
    fn the_latest_application_in_front_replaces_the_last() {
        let previous = PreviousApplication::default();

        previous.note(Some(42), OWN);
        previous.note(Some(43), OWN);

        assert_eq!(previous.remembered_id(), Some(43));
    }

    #[test]
    fn the_same_application_is_handed_focus_back_twice() {
        let previous = PreviousApplication::default();

        previous.note(Some(42), OWN);

        assert_eq!(previous.remembered_id(), Some(42));
        assert_eq!(previous.remembered_id(), Some(42));
    }
}
