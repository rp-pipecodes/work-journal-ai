# The app enters the Dock only while the Main Window is open

The app runs as `ActivationPolicy::Accessory`: no Dock icon, no Cmd+Tab, no menu bar. That fits a tray app whose windows are floating panels, and it fits the Main Window of [0022](0022-one-main-window-for-reading-and-settings.md) badly — a real window that cannot be reached by Cmd+Tab is a window the user loses. So the policy becomes Regular while the Main Window is open and returns to Accessory when it closes.

Rejected: staying Accessory permanently, which leaves the app's one substantial window unreachable by every system-standard way of returning to a window; and becoming Regular permanently, which puts a standing Dock icon on an app chosen for being invisible.

## Consequences

- **Dismissing a Capture no longer hides the application.** `app.hide()` hid every window, which was defensible when nothing else was ever on screen and reads as a crash once a Dock icon vanishes with it. The panel is hidden and the application that was frontmost when the Capture began is reactivated instead — recorded on the way in, restored on the way out, through `objc2`. Focus goes back there whether or not the Main Window is open: a Capture interrupts what you were doing, and giving that back is the whole behaviour. It also removes the `app.show()` that every window open needed first.
- **A menu bar appears whenever the Main Window is active**, because a Regular app owns one. It is deliberately two menus — the app menu with About, Settings and Quit, and Edit. Edit is not optional: macOS routes Cmd+C/V/Z through menu items, so without it the clipboard and undo stop working in the Task Editor and in History's fields.
- **Cmd+Q now exists and quits the app** — tray, Hotkeys, Meeting Import, pending Task Alerts and all. It is the same action as Quit in the Tray Menu. A Regular app that refused a system-standard shortcut would be more surprising than one that honours it, and the Dock icon is the honest signal that this is now an app you can quit.
- **Clicking the Dock icon with no Main Window open opens one, on History.** A fourth Entry Point that names no section.
- **There is no View menu and no section shortcuts.** Cmd+1/2/3 without a menu to advertise them is undiscoverable, and every section holds a text field that a bare-ish shortcut would have to stand aside for — the same reason the Theme Toggle is Cmd+Shift+D and never a bare `d`.
- **The policy flip is a state machine of one window.** Nothing else opens the Dock: the resident panels come and go without touching it.
