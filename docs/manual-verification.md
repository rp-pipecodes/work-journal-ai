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
