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

**Where the app keeps its state.** `~/Library/Application Support/com.pipecodes.work-journal` — `settings.json` holds both Hotkeys, the Theme and the Start at Login answer, and `work-journal.db` holds the Notes and the Tasks. Deleting the whole directory returns the app to a first run.

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
- [ ] Clicking the tray icon opens a menu holding **New Note**, **New Task**, **View Notes**, **View Tasks**, **Copy Yesterday's Digest**, **Settings** and **Quit**, and nothing else.
- [ ] **New Note** opens a capture window, with the Note Hotkey spelled out beside the item.
- [ ] **New Task** opens the Task Creation window, with the Task Hotkey spelled out beside the item.
- [ ] **View Notes** opens the history window.
- [ ] **View Tasks** opens the tasks window, and both can be open at once.
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

## The two Hotkeys and relaunch

Run these on a first run — with no `settings.json` — so the defaults are the ones a new user gets.

- [ ] `Ctrl+Shift+Cmd+J` starts a Capture from a browser, from an editor, and from the Finder — the field is focused and empty each time.
- [ ] `Ctrl+Shift+Cmd+T` starts a Task Creation from those same three applications, and never a Capture.
- [ ] Neither keystroke reaches the application that was in front (they are intercepted, not passed through).
- [ ] Holding either combination down starts exactly one window — one action per press, never a stream of them.
- [ ] Neither Hotkey fights VoiceOver: with VoiceOver on, `Ctrl+Opt` commands still work as documented.
- [ ] Pressing the Note Hotkey during a Capture already in progress leaves one capture window and does not clear what has been typed; the same for the Task Hotkey and the Task Creation window.
- [ ] With half a Note typed and the capture window dismissed with `Escape`, then half a Task typed: neither window's text ever appears in the other, and abandoning one leaves the other's next use empty.
- [ ] Clicking on another application while either window holds text closes it and the text is gone — the handoff below is the only thing that preserves it.
- [ ] With text waiting in the Task Creation window, pressing the Note Hotkey puts that window away, opens a Capture, and leaves the app on screen rather than hiding it; pressing the Task Hotkey again shows the description still there.
- [ ] The same the other way round: half a Note, then the Task Hotkey, then the Note Hotkey — the Body is still there.
- [ ] With one Hotkey unavailable — claim `Ctrl+Shift+Cmd+T` in another app first, e.g. as a System Settings keyboard shortcut — the app still launches, the tray icon appears, and **New Task** still opens the Task Creation window while the Note Hotkey keeps working.
- [ ] In that state the app starts normally and nothing hangs — and on a development build the terminal records the failed registration with a reason.
- [ ] In that state **Settings** names the *Task Hotkey*, the combination and the reason, and points at **New Task** — and says nothing at all about the Note Hotkey.
- [ ] Releasing the combination in the other app and relaunching Work Journal makes that Hotkey work again and the message go away.
- [ ] An installation that predates Tasks — a `settings.json` with no `hotkey` key but other settings in it — keeps `Ctrl+Opt+Cmd+J` for Notes after the upgrade, and gains `Ctrl+Shift+Cmd+T` for Tasks.
- [ ] Hand-editing `settings.json` so both keys hold the same combination and relaunching leaves the Note Hotkey working, the Task Hotkey reported unavailable in Settings, and **New Task** still reachable from the Tray Menu.

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
- [ ] An action whose calendar or Project list is open stays visible under it, even with the pointer away from the row.
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

## The Hotkeys, remapped

- [ ] **Change** beside **Note Hotkey**, then pressing a combination, rebinds it — the new one starts a Capture and the old one no longer does. The Task Hotkey is untouched and still starts a Task Creation.
- [ ] The same for **Task Hotkey**, with the Note Hotkey untouched.
- [ ] The Tray Menu shows each remapped combination beside its own item straight away.
- [ ] Both remapped Hotkeys still work after quitting and relaunching the app.
- [ ] `Escape` while recording abandons it and leaves that Hotkey as it was.
- [ ] Recording the combination the *other* Hotkey already holds is refused, says which one holds it, and leaves both Hotkeys working exactly as before.
- [ ] Choosing a combination another application has registered globally (for example `Ctrl+Opt+Cmd+Space` while another tool holds it) reports the refusal, names the combination and the action, and points at the Work Journal menu — and the previous Hotkey still works.
- [ ] Pressing a bare key, or only modifiers, records nothing.
- [ ] Settings says in as many words that a conflict with an application's own in-window shortcut cannot be detected, and that the two Hotkeys may never be the same.

## Tasks

- [ ] **New Task** opens the Task Creation window with the field focused — typing lands in it without clicking first.
- [ ] Typing a line and pressing `Enter` closes the window, and focus returns to the application that was in front.
- [ ] `Escape` closes the window and the text is gone; the next **New Task** opens empty.
- [ ] Clicking on another application closes the window and the text is gone.
- [ ] `Enter` on an empty field, and on a field holding only spaces, creates nothing and closes nothing.
- [ ] Two Tasks with exactly the same description are both created and both listed.
- [ ] **View Tasks** opens on **Open**, newest first, and a Task created while it is open appears with no manual refresh.
- [ ] A Task's checkbox completes it immediately, with no confirmation, and it leaves the Open list at once.
- [ ] **Completed** lists it, newest completed first; its checkbox reopens it and it returns to **Open**.
- [ ] Clicking a Task's description opens the Editor; **Save** commits the new wording, and the list shows it.
- [ ] **Cancel** and `Escape` both discard the edit — and `Escape` does not close the window.
- [ ] Opening the Editor with text waiting in the Task Creation window leaves that text untouched.
- [ ] **New Task** inside Tasks View opens the same resident Task Creation window the Hotkey does, with whatever was already typed in it.
- [ ] **Delete** opens a confirmation naming the Task; **Cancel** leaves it there, confirming removes it for good.
- [ ] Tasks created before quitting are still there after relaunching the app, and after a restart of the machine.
- [ ] Tasks View and the history window can be open at the same time, and neither changes the other.

## Scheduling a Task

- [ ] The Task Creation window shows a date control, a time control and a cadence control under the field, and opens with all three empty however the last Task Creation ended.
- [ ] Typing a line, choosing a date and a time, and pressing `Enter` creates one Task with that schedule; **View Tasks** shows it under the right heading.
- [ ] Typing a line and pressing `Enter` with no date chosen creates an Unscheduled Task.
- [ ] With no date chosen in the Task Creation window, the time control cannot be used; **Clear** empties both.
- [ ] The Task Creation window is tall enough for the field, the schedule row and the cadence row, with no clipped control and no transparent band under the panel — including with **Weekly** chosen and all seven weekday buttons showing.
- [ ] The Editor shows a date control and a time control; with no date chosen, the time control cannot be used.
- [ ] Choosing a date and saving moves the Task into **Today** or **Upcoming**, under a heading, with the date beside it.
- [ ] Adding a time to that date and saving keeps it in the same group and shows the time beside it.
- [ ] **Clear** removes the date and the time together, and the Task returns to **Unscheduled**.
- [ ] A description holding words like "tomorrow at 9" is saved exactly as typed and changes no date or time.
- [ ] A date in the past saves, and the Task appears under **Overdue** immediately.
- [ ] Completing a scheduled Task and opening its Editor offers no date or time, only the wording; reopening it restores both, and an elapsed schedule leaves it **Overdue**.
- [ ] Open Tasks are grouped **Overdue**, **Today**, **Upcoming**, **Unscheduled**, each sorted earliest first except **Unscheduled**, which is newest created first; empty groups are absent.
- [ ] Leaving Tasks View open across local midnight, or sleeping and waking the machine, re-groups it without a manual refresh.
- [ ] Changing the Mac's timezone and returning to Tasks View leaves each Task at the wall-clock time it was given.
- [ ] On the day the clocks go forward, a Task scheduled inside the skipped hour still groups as the day's own — it is never lost from every group.

## Recurring Tasks

- [ ] With no date chosen, the cadence control cannot be used in either the Task Creation window or the Editor; choosing a date enables it, and **Clear** turns it off again.
- [ ] Creating a Task with a date and **Daily** puts one Task in the list with `every day` beside it — one Task, not one per day.
- [ ] **Weekly** preselects the weekday the chosen date falls on; adding Wednesday and Friday shows `every week on Monday, Wednesday and Friday`.
- [ ] Completing that Task from its checkbox advances it to the next selected weekday immediately, with no confirmation, and it never appears in **Completed**.
- [ ] **every 2 weeks** starting from a Friday first lands on the Monday of the week after next — the week containing the starting date is the first active week, and its earlier weekdays are ignored.
- [ ] A series created with a starting date a fortnight in the past opens as a single **Overdue** Task on its latest elapsed slot, not as a fortnight of Tasks.
- [ ] Completing that overdue Task advances it to the next slot still ahead, skipping the ones that were missed.
- [ ] A monthly Task starting on the 31st falls back to the last day of February and returns to the 31st in March.
- [ ] A yearly Task starting on 29 February falls back to 28 February in an ordinary year and returns to the 29th in the next leap year.
- [ ] After a completion, the row offers **Undo**; using it restores the occurrence just completed and removes the one it advanced to.
- [ ] Editing the Task's date, time, weekdays or cadence and saving replaces its Open occurrence without recording a completion, and **Undo** is no longer offered.
- [ ] Completing again after a completion also stops **Undo** reaching the older one: only the latest is ever offered.
- [ ] The row shows an expandable count of completed occurrences; opening it lists each slot and when it was kept, and none of them appear in **Completed Tasks**.
- [ ] **Stop repeating** asks first, then leaves the Task exactly where it stands with its history still under it; the Task can then be completed like any other.
- [ ] Clearing the date on a Recurring Task in the Editor asks before doing it, and cancelling leaves the cadence untouched.
- [ ] **Delete** on a Recurring Task says the occurrence history goes too; confirming removes both.
- [ ] Quitting and relaunching leaves every Recurring Task on exactly the slot it was on, with its history intact — and force-quitting during a completion leaves either the old slot or the new one, never both and never neither.
- [ ] Completing a Recurring Task in one Tasks View updates a second one, and the Task Creation window, without a manual refresh.
- [ ] Changing the Mac's timezone leaves each Recurring Task at the wall-clock time it was given, and its next slot on the same civil day.
- [ ] A daily Recurring Task set to a wall-clock time the spring transition skips still advances across that day rather than being lost.

## Task Alerts

Requires the release build: macOS will not hold a notification for a binary with no bundle. Run these on a machine whose notification settings for Work Journal you are willing to change.

- [ ] Creating the first Task with a date **and** a time from the Task Creation window raises the macOS notification prompt after the window has gone, in front of whatever is on screen.
- [ ] Saving the first Task with a date **and** a time raises the macOS notification prompt — and nothing raised it at first launch, before any Task had a time.
- [ ] Allowing it leaves the Task exactly as saved; **Settings › Task Alerts** then reads **Allowed**.
- [ ] The Alert arrives at the minute chosen, shows the whole Task Description, and plays a sound.
- [ ] It arrives while Work Journal is the active application too, rather than being swallowed.
- [ ] Clicking the Alert opens Tasks View with that Task singled out. There is no Complete and no Snooze on it.
- [ ] Clicking an Alert with Tasks View closed — including one delivered while the app was quit — opens the window with that Task singled out, not on a plain list.
- [ ] Switching to **Completed** and back stops singling it out, and opening Tasks View from the Tray Menu afterwards singles out nothing.
- [ ] Quitting the app before the moment arrives still delivers the Alert.
- [ ] A Task with a date and **no** time never alerts — not at 09:00, and not at any other hour.
- [ ] Editing the time, completing, reopening or deleting a Task before its moment cancels or moves the Alert accordingly; nothing arrives for a Task that is gone.
- [ ] A Recurring Task with a time has exactly one pending Alert, whatever its cadence: completing it cancels that one and registers the next slot's, so two never arrive for the same series.
- [ ] Editing a Recurring Task's cadence or time replaces its pending Alert rather than adding one, and nothing arrives for the slot it was reanchored away from.
- [ ] A schedule already in the past produces no Alert at all, and none arrives when the app is relaunched.
- [ ] Refusing the prompt still saves the Task and its schedule; Tasks View says the Task is unaffected, and **Settings › Task Alerts** reads **Not allowed** with the path `System Settings › Notifications › Work Journal` and an **Open System Settings** button that opens that pane.
- [ ] Turning notifications back on there and returning to the Settings window changes **Task Alerts** to **Allowed** without a relaunch, and the Tasks still ahead are registered; none of the past ones are replayed.
- [ ] With Work Journal denied, everything else about Tasks — creating, scheduling, completing, exporting — still works.

Daylight saving is macOS's to resolve, not the app's: the app registers the civil date and minute, and the OS matches its own clock against them. These are what verify it — run them by setting the Mac's clock and date forward to the transition, or on the day itself.

- [ ] A Task scheduled at a wall-clock time the spring transition skips still alerts, at the first valid minute after the clocks move — not silently never.
- [ ] A Task scheduled at a wall-clock time the autumn transition repeats alerts exactly once, at the first of the two occurrences.
- [ ] Reconciling while an Alert's minute is arriving — saving another Task at that moment — does not swallow the Alert that was due.

## Export

- [ ] **Export all to Markdown** writes a file to the Downloads folder and names the path it wrote to.
- [ ] The file holds a `# Notes` section and a `# Tasks` section, each record exactly once, including Notes on days outside the Filter History was last showing.
- [ ] Under `# Tasks`, Open Tasks read as `- [ ]` and Completed ones as `- [x]` with the day and time they were completed.
- [ ] A scheduled Task carries `(scheduled YYYY-MM-DD)` — with ` HH:mm` after it when it has a time — on both Open and Completed bullets, and an Unscheduled one carries nothing.
- [ ] A Recurring Task carries `repeats …` in the same words the row shows, with a time when it has one and without when it does not, and a Task whose recurrence was stopped carries none.
- [ ] Its completed occurrences are nested `- occurrence …` lines under it, indented; each Recurring Task appears exactly once and no occurrence appears as a Task of its own.
- [ ] The line under the button names both counts — Notes and Tasks — and matches what is in the file.
- [ ] A journal holding only Tasks exports the Tasks section alone and reports the Task count.
- [ ] Exporting twice leaves two files rather than overwriting the first.
- [ ] Exporting an empty journal writes a file and says so, rather than failing.

## Walkthroughs

One line per end-to-end walk: the date, the build, and what it turned up. "Nothing" is a result.

| Date | Build | Findings |
| ---- | ----- | -------- |
| 2026-07-27 | `pnpm tauri build --bundles app`, 0.1.0 | Partial — only the items checkable without a person at the keyboard were run: the bundle builds, launches, and a second launch leaves exactly one process. The release build logs nothing, so the log item moved to a development build. The rest of the list is unwalked. |
