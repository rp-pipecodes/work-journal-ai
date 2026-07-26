# Manual verification checklist

OS integrations that an automated test could only assert mocks against. Run these against a release build (`pnpm tauri build --bundles app`) before calling a ticket done. Each ticket adds its own items.

## The app itself

- [ ] The app launches and stays running with no Dock icon.
- [ ] `Cmd+Tab` does not list the app.
- [ ] A tray icon appears in the menu bar.
- [ ] Clicking the tray icon opens a menu containing **Quit**.
- [ ] **Quit** ends the process — the tray icon disappears and nothing is left running.
- [ ] Launching the app a second time while it is running leaves exactly one tray icon and one process.
