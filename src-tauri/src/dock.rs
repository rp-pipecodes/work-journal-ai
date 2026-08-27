//! Whether the app is a menu bar glyph or an application in the Dock.
//!
//! Work Journal runs as an Accessory application, which suits floating panels
//! and suits a real window badly: a window that Cmd+Tab and the Dock cannot
//! reach is a window the user loses behind other apps. So the app enters the
//! Dock while the Main Window is open and leaves again when it closes — see
//! docs/adr/0023-the-app-enters-the-dock-only-while-the-main-window-is-open.md.
//!
//! The decision is a state machine of one window, kept here so it can be
//! reasoned about without a running application: which windows count, and when
//! macOS actually has to be told anything.

use std::sync::Mutex;

use crate::MAIN_WINDOW;

/// How the app shows itself to the rest of the system.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Presence {
    /// A menu bar glyph: no Dock icon, no Cmd+Tab entry, no menu bar.
    MenuBarOnly,
    /// An ordinary application, with everything that comes with one.
    InTheDock,
}

/// What the app's presence currently rests on: whether the Main Window is open.
#[derive(Default)]
pub struct Dock(Mutex<bool>);

impl Dock {
    /// A window was opened. The answer is the presence macOS has to be told
    /// about, and `None` when nothing changed — a raise of a window that is
    /// already open, or any window that is not the Main one.
    pub fn window_opened(&self, label: &str) -> Option<Presence> {
        self.settle(label, true)
    }

    /// A window was closed for good. Hiding a resident panel is not this: those
    /// windows are never closed, and never move the app in or out of the Dock.
    pub fn window_closed(&self, label: &str) -> Option<Presence> {
        self.settle(label, false)
    }

    fn settle(&self, label: &str, open: bool) -> Option<Presence> {
        if label != MAIN_WINDOW {
            return None;
        }

        let mut main_window_open = self.locked();
        if *main_window_open == open {
            return None;
        }

        *main_window_open = open;
        Some(if open {
            Presence::InTheDock
        } else {
            Presence::MenuBarOnly
        })
    }

    /// A poisoned lock is nothing to take the app down for: the worst it costs
    /// is a Dock icon that is one open behind.
    fn locked(&self) -> std::sync::MutexGuard<'_, bool> {
        self.0.lock().unwrap_or_else(|error| error.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{CAPTURE_WINDOW, SETTINGS_WINDOW, TASK_CREATION_WINDOW};

    #[test]
    fn opening_the_main_window_puts_the_app_in_the_dock() {
        let dock = Dock::default();

        assert_eq!(dock.window_opened(MAIN_WINDOW), Some(Presence::InTheDock));
    }

    #[test]
    fn closing_the_main_window_takes_the_app_out_again() {
        let dock = Dock::default();
        dock.window_opened(MAIN_WINDOW);

        assert_eq!(dock.window_closed(MAIN_WINDOW), Some(Presence::MenuBarOnly));
    }

    #[test]
    fn raising_the_main_window_it_already_has_changes_nothing() {
        let dock = Dock::default();
        dock.window_opened(MAIN_WINDOW);

        assert_eq!(dock.window_opened(MAIN_WINDOW), None);
    }

    #[test]
    fn a_close_without_an_open_changes_nothing() {
        let dock = Dock::default();

        assert_eq!(dock.window_closed(MAIN_WINDOW), None);
    }

    #[test]
    fn the_resident_panels_never_touch_the_dock() {
        let dock = Dock::default();

        for label in [CAPTURE_WINDOW, TASK_CREATION_WINDOW] {
            assert_eq!(dock.window_opened(label), None);
            assert_eq!(dock.window_closed(label), None);
        }
    }

    #[test]
    fn a_panel_raised_over_the_main_window_leaves_the_dock_icon_alone() {
        let dock = Dock::default();
        dock.window_opened(MAIN_WINDOW);

        assert_eq!(dock.window_opened(CAPTURE_WINDOW), None);
        assert_eq!(dock.window_closed(CAPTURE_WINDOW), None);
        // And the Main Window closing still ends in the menu bar.
        assert_eq!(dock.window_closed(MAIN_WINDOW), Some(Presence::MenuBarOnly));
    }

    #[test]
    fn another_window_of_its_own_is_not_the_main_window() {
        let dock = Dock::default();

        assert_eq!(dock.window_opened(SETTINGS_WINDOW), None);
        assert_eq!(dock.window_closed(SETTINGS_WINDOW), None);
    }

    #[test]
    fn opening_and_closing_repeatedly_strands_nothing() {
        let dock = Dock::default();

        for _ in 0..3 {
            assert_eq!(dock.window_opened(MAIN_WINDOW), Some(Presence::InTheDock));
            assert_eq!(dock.window_closed(MAIN_WINDOW), Some(Presence::MenuBarOnly));
        }
    }
}
