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
    /// from a focused History window would otherwise record this app and hand
    /// focus straight back to the window the Capture is floating over; what the
    /// user left to open History is still the right place to return to.
    pub fn note(&self, frontmost: Option<ProcessId>, own: ProcessId) {
        let Some(frontmost) = frontmost.filter(|id| *id != own) else {
            return;
        };

        *self.remembered() = Some(frontmost);
    }

    /// Who to hand focus back to, if anyone. The answer is kept rather than
    /// consumed: two dismissals in a row both belong to the same application.
    pub fn remembered_id(&self) -> Option<ProcessId> {
        *self.remembered()
    }

    /// A poisoned lock is nothing to take the app down for — the worst it costs
    /// is one dismissal that hands focus nowhere.
    fn remembered(&self) -> std::sync::MutexGuard<'_, Option<ProcessId>> {
        self.0.lock().unwrap_or_else(|error| error.into_inner())
    }
}

/// What macOS has in front right now, if it is an application at all — a
/// full-screen login window or the Dock's own overlay is nobody.
#[cfg(target_os = "macos")]
pub fn frontmost_application() -> Option<ProcessId> {
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};

    unsafe {
        let workspace: Retained<AnyObject> = msg_send![class!(NSWorkspace), sharedWorkspace];
        let frontmost: Option<Retained<AnyObject>> = msg_send![&*workspace, frontmostApplication];
        let frontmost = frontmost?;
        Some(msg_send![&*frontmost, processIdentifier])
    }
}

/// This application's own process id, so it is never the one remembered.
#[cfg(target_os = "macos")]
pub fn own_application() -> ProcessId {
    std::process::id() as ProcessId
}

/// Hands focus to the application that was in front. Nothing happens if it has
/// quit in the meantime, which is the right outcome: the user is left wherever
/// macOS put them instead.
#[cfg(target_os = "macos")]
pub fn activate(id: ProcessId) {
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};

    unsafe {
        let application: Option<Retained<AnyObject>> = msg_send![
            class!(NSRunningApplication),
            runningApplicationWithProcessIdentifier: id
        ];
        let Some(application) = application else {
            return;
        };
        // No options: the application comes forward with the windows it had,
        // rather than being told which of them to raise.
        let _: bool = msg_send![&*application, activateWithOptions: 0usize];
    }
}

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
