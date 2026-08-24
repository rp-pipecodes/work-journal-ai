# Manual verification checklist

OS integrations that an automated test could only assert mocks against. Run these against a release build — except where an item says otherwise — before calling a ticket done. Each ticket adds its own items.

You do not need to have written the app to run this. Every item says what to do and what should happen; if what happens is anything else, the item fails.

## Before you start

Build the app and open it:

```bash
pnpm install && pnpm tauri build --bundles app
```

```bash
open "src-tauri/target/release/bundle/macos/Work Journal.app"
```

Three things are worth knowing before you begin.

**Where the app keeps its state.** `~/Library/Application Support/com.pipecodes.work-journal` — `settings.json` holds the Hotkey, the Theme and the Start at Login answer, and `work-journal.db` holds the Notes. Deleting the whole directory returns the app to a first run.

```bash
rm -rf ~/Library/Application\ Support/com.pipecodes.work-journal
```

Quit the app first, and only do this on a machine whose Notes you are willing to lose.

**How to read the log.** A release build logs nothing — the log plugin is only in debug builds. The handful of items that ask what the app recorded need a development build instead, run from a terminal so its output lands there:

```bash
pnpm tauri dev
```

Everything else is checked against the release build.

**How to fill this in.** Tick each item as it passes. Anything that fails gets written down at the bottom under [Walkthroughs](#walkthroughs) — with what you did and what happened instead — and then fixed or filed as an issue. Every walk gets a row there, including one that found nothing and one that stopped early: an unwalked list and a clean one must not read the same.

## The app itself

- [ ] The app launches and stays running with no Dock icon.
- [ ] `Cmd+Tab` does not list the app.
- [ ] A tray icon appears in the menu bar.
- [ ] Clicking the tray icon opens a menu holding **New Note**, **View Notes**, **Settings** and **Quit**, and nothing else.
- [ ] **New Note** opens a capture window.
- [ ] **View Notes** opens the history window.
- [ ] **Settings** opens the settings window.
- [ ] **Quit** ends the process — the tray icon disappears and nothing is left running.
- [ ] Launching the app a second time while it is running — from Spotlight, and again from the Finder — leaves exactly one tray icon and one process each time, and opens a capture window rather than a second app.

## Opening a window

The palette is the point of this section, and the moment to watch is the one the window arrives in — not the window afterwards. A window is painted the Theme it is going to keep before its webview has anything to show, so it should never be seen in the wrong one.

- [ ] With the Theme set to **Dark**, **View Notes** puts a window on screen that is dark from the moment it appears — no white rectangle, no flash, no snap from light to dark.
- [ ] The same for **Settings**, and for both windows with the Theme set to **Light**.
- [ ] With the Theme on **Match the system** and macOS in dark mode, both windows arrive dark; with macOS in light mode, light.
- [ ] Toggling the Theme with `Cmd+Shift+D`, then closing the window and opening it again, shows it in the palette that was toggled *to* — the Rust side reads the same preference the window does.
- [ ] Changing the macOS appearance while the Theme is **Match the system** and a window is open repaints that window, and the next window opens in the new palette.

## Capture from the Tray Menu

- [ ] **New Note** opens the capture window with the field focused — typing lands in it without clicking first.
- [ ] Typing a line and pressing `Enter` dismisses the window, and focus returns to the application that was in front.
- [ ] `Escape` dismisses the window and the text is gone.
- [ ] Clicking on another application dismisses the window and the text is gone.
- [ ] `Enter` on an empty field, and on a field holding only spaces, dismisses nothing and commits nothing.
- [ ] Pasting multi-line text into the field leaves a single line.
- [ ] Re-opening **New Note** after abandoning a Capture shows an empty field.
- [ ] Re-opening **New Note** straight after committing a Note shows an empty field too — the committed text is not still sitting there.
- [ ] Notes committed before quitting are still there after relaunching the app, and after a restart of the machine.

## The Hotkey and relaunch

- [ ] `Ctrl+Opt+Cmd+J` starts a Capture from a browser, from an editor, and from the Finder — the field is focused and empty each time.
- [ ] The keystroke does not reach the application that was in front (it is intercepted, not passed through).
- [ ] Holding the Hotkey down starts exactly one Capture.
- [ ] Pressing the Hotkey during a Capture already in progress leaves one capture window and does not clear what has been typed.
- [ ] With the Hotkey unavailable — claim `Ctrl+Opt+Cmd+J` in another app first, e.g. as a System Settings keyboard shortcut — the app still launches, the tray icon appears, and **New Note** still starts a Capture.
- [ ] In that state the app starts normally and nothing hangs — and on a development build the terminal records the failed registration with a reason.
- [ ] In that state **Settings** shows a message naming the combination and the reason, and pointing at the Tray Menu — not a silent or broken-looking Hotkey section.
- [ ] Releasing the combination in the other app and relaunching Work Journal makes the Hotkey work again and the message go away.

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

## Correcting the record

- [ ] A row's actions are out of sight until the row is hovered, and appear when one of them is tabbed to — tabbing to the Body alone does not bring them up.
- [ ] The Body keeps exactly the same wrapping whether or not the actions are showing.
- [ ] Clicking a Note's Body turns it into a field holding that text, focused.
- [ ] `Enter` saves the new wording; the list shows it and the Note carries the edited mark, which reads "Changed since it was captured" on hover.
- [ ] `Escape` abandons the edit, leaves the Body as it was, and does **not** close the window.
- [ ] Clicking away from a field being edited abandons the edit too.
- [ ] `Enter` on an emptied field changes nothing and leaves the field open.
- [ ] The time shown against an edited Note is unchanged — Captured At never moves.
- [ ] The day action opens a calendar; picking a day refiles the Note in one click, and `Escape` closes the calendar without refiling anything or closing the window.
- [ ] Changing a Note's day moves it out of the current range when the new day is outside it, and under the right heading when it is inside.
- [ ] A refiled Note keeps its original time and carries the edited mark.
- [ ] Changing a Note's Project (assign, switch, or clear to Unfiled) leaves Body and day alone, marks the Note edited, and does not re-parse markers from the Body.
- [ ] The Project action opens a list of the Projects currently on Notes; typing narrows it, a name nothing is filed under yet is offered as itself, and **Unfiled** clears the Note.
- [ ] `Escape` in that list files nothing — not even a name typed in full — and leaves the window open.
- [ ] After the last Note leaves a Project, that name is gone from the list.
- [ ] **Delete** opens a confirmation naming the Note; **Cancel** leaves the Note there.
- [ ] Confirming removes the Note from the list, and it is still gone after quitting and relaunching the app.
- [ ] Deleting the last Note of the most recent Occupied Day makes **View Notes** open on the previous Occupied Day next time.
- [ ] `Escape` while the confirmation is open closes the confirmation only, not the window.

## The Digest

- [ ] **Copy Digest** on a single day puts one bullet per Note on the clipboard, oldest first, with no day heading and no times.
- [ ] Pasting into a plain-text editor and into a Markdown one both read correctly, with nothing to clean up.
- [ ] **Copy Digest** over a range of days puts a heading above each day that has Notes, and none above the days that have none.
- [ ] The confirmation names the same number of Notes as there are bullets on the clipboard.
- [ ] Copying twice in a row copies the same thing both times — the clipboard write is not lost after the first click.
- [ ] **Copy Digest** on a range holding no Notes says so and leaves the clipboard as it was.
- [ ] Moving either end of the range clears the confirmation, and the next copy carries the new range.

## Settings

- [ ] **Settings** in the Tray Menu opens the settings window; `Escape` closes it, and re-opening it builds a fresh one.
- [ ] On a first run — with no `settings.json` in the app data directory — the settings window opens on its own and asks about starting at login.
- [ ] Answering **Not now** leaves the app out of System Settings → General → Login Items, and the question is not asked again on the next launch.
- [ ] Closing the window without answering counts as **Not now** — the app is not added to the login items, and the question is not asked again either.
- [ ] Answering **Start at login** adds it, and the app launches after a log out and back in.
- [ ] The checkbox afterwards adds and removes the login item, and matches what System Settings shows when Settings is re-opened.
- [ ] Settings shows the exact configured Tauri application version centered at the bottom.
- [ ] A development build shows a **Dev** label beside that version; a release build shows the version without it.

## Capture after midnight

- [ ] Capturing at, say, 01:00 files the Note under today's local calendar day, not yesterday.

## The Hotkey, remapped

- [ ] **Change**, then pressing a combination, rebinds the Hotkey — the new one starts a Capture and the old one no longer does.
- [ ] The remapped Hotkey still works after quitting and relaunching the app.
- [ ] `Escape` while recording abandons it and leaves the Hotkey as it was.
- [ ] Choosing a combination another application has registered globally (for example `Ctrl+Opt+Cmd+Space` while another tool holds it) reports the refusal, names the combination, and points at the Work Journal menu — and the previous Hotkey still works.
- [ ] Pressing a bare key, or only modifiers, records nothing.
- [ ] Settings says in as many words that a conflict with an application's own in-window shortcut cannot be detected.

## Export

- [ ] **Export all to Markdown** writes a file to the Downloads folder and names the path it wrote to.
- [ ] The file holds every Note in the journal, each exactly once, including Notes on days outside the Filter History was last showing.
- [ ] Exporting twice leaves two files rather than overwriting the first.
- [ ] Exporting an empty journal writes a file and says so, rather than failing.

## Walkthroughs

One line per end-to-end walk: the date, the build, and what it turned up. "Nothing" is a result.

| Date | Build | Findings |
| ---- | ----- | -------- |
| 2026-07-27 | `pnpm tauri build --bundles app`, 0.1.0 | Partial — only the items checkable without a person at the keyboard were run: the bundle builds, launches, and a second launch leaves exactly one process. The release build logs nothing, so the log item moved to a development build. The rest of the list is unwalked. |
