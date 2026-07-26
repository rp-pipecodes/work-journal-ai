# Manual verification checklist

OS integrations that an automated test could only assert mocks against. Run these against a release build (`pnpm tauri build --bundles app`) before calling a ticket done. Each ticket adds its own items.

## The app itself

- [ ] The app launches and stays running with no Dock icon.
- [ ] `Cmd+Tab` does not list the app.
- [ ] A tray icon appears in the menu bar.
- [ ] Clicking the tray icon opens a menu containing **Quit**.
- [ ] **Quit** ends the process — the tray icon disappears and nothing is left running.
- [ ] Launching the app a second time while it is running leaves exactly one tray icon and one process.

## Capture from the Tray Menu

- [ ] **New Note** opens the capture window with the field focused — typing lands in it without clicking first.
- [ ] Typing a line and pressing `Enter` dismisses the window, and focus returns to the application that was in front.
- [ ] `Escape` dismisses the window and the text is gone.
- [ ] Clicking on another application dismisses the window and the text is gone.
- [ ] `Enter` on an empty field, and on a field holding only spaces, dismisses nothing and commits nothing.
- [ ] Pasting multi-line text into the field leaves a single line.
- [ ] Re-opening **New Note** after abandoning a Capture shows an empty field.
- [ ] Notes committed before quitting are still there after relaunching the app, and after a restart of the machine.

## The Hotkey and relaunch

- [ ] `Ctrl+Opt+Cmd+J` starts a Capture from a browser, from an editor, and from the Finder — the field is focused and empty each time.
- [ ] The keystroke does not reach the application that was in front (it is intercepted, not passed through).
- [ ] Holding the Hotkey down starts exactly one Capture.
- [ ] Pressing the Hotkey during a Capture already in progress leaves one capture window and does not clear what has been typed.
- [ ] Launching the app from Spotlight while it is running opens a capture window instead of a second instance.
- [ ] With the Hotkey unavailable — claim `Ctrl+Opt+Cmd+J` in another app first, e.g. as a System Settings keyboard shortcut — the app still launches, the tray icon appears, and **New Note** still starts a Capture.
- [ ] In that state the log records the failed registration with a reason, and nothing hangs at startup.

## The Filter and the Nudge

- [ ] **View Notes** opens on the most recent Occupied Day, with that day in both ends of the range.
- [ ] Widening the range to several days shows every Note in it under day headings, newest day first, and the two ends are included.
- [ ] Setting the earlier end after the later one still shows the range between them rather than nothing.
- [ ] A range holding no Notes says so instead of looking broken.
- [ ] Capturing a Note for a day outside the range leaves the list exactly where it was — scroll position included — and shows a line naming that day.
- [ ] **Show** on that line moves the range to that day; **Dismiss** leaves the range alone and the line goes away.
- [ ] Capturing a Note for a day inside the range makes it appear in the list without the range changing.
- [ ] With no Notes at all, capturing the first one replaces the empty state with that Note.
- [ ] `Escape` still closes the history window while a Nudge is on screen.
