# Work Journal

A personal, local-first log of short work notes captured throughout the day, so that what you did is recoverable later — at standup, in a review, or as context for an LLM.

## Language

**Note**:
A single dated line of text about the user's work. The unit of everything — there is no smaller or larger record. Always has a Body from the moment it exists. May be filed under one Project; may be Unfiled. Comes into existence one of exactly two ways: a Capture or an Import.
_Avoid_: Entry, log, item, memo

**Task**:
A record of a work commitment the user intends, or intended, to complete. A first-class record beside a Note, not a kind or state of Note: Notes recover work that happened; Tasks hold work that remains to be done or preserve that it was completed. A Task is never filed under a Project or category, and remains editable in either state.
_Avoid_: Todo, action item, reminder, Note

**Task Description**:
The required single line of free text that says what a Task is. Leading and trailing whitespace is removed, while internal whitespace and all Unicode are preserved verbatim whether precise or vague; schedule words in it are never interpreted or removed automatically. Two Tasks may have the same Task Description, and there is no arbitrary domain length limit.
_Avoid_: Body, title, AI prompt

**Task Creation**:
The explicit act of writing a Task Description and optionally choosing Scheduled For and recurrence in its own always-ready window. `Enter` from the description or the Create action commits one Task; an empty description fails, while Escape or closing hides the window, commits nothing, and the next Task Creation starts empty. Date is the prerequisite for time and recurrence; clearing it also clears time, and asks before stopping an existing recurrence.
_Avoid_: Capture, task inference, draft

**Open Task**:
A Task whose commitment has not been completed. It may be Unscheduled or have a Scheduled For; once that moment passes, it is overdue but remains open.
_Avoid_: Active todo, pending item

**Completed Task**:
A Task whose commitment was completed. It remains a Task and does not become or automatically create a Note; its Task Description remains editable, while Scheduled For and recurrence may change only after it is reopened. Reopening preserves its former schedule, which may make it immediately overdue.
_Avoid_: Done Note, archived task

**Task Created At**:
The immutable instant a Task first came into existence. Used to order Unscheduled Tasks newest first, never as a substitute for Scheduled For.
_Avoid_: Created date, task date

**Task Completed At**:
The instant a Task or Task Occurrence was completed. Used to order Completed Tasks newest first; removed when an ordinary Task is reopened or the latest recurring completion is undone.
_Avoid_: Done date, archived at

**Scheduled For**:
The optional local calendar date when the user intends to act on a Task, with an optional minute-precise time. Its civil-time components are the source of truth and follow the user across timezone changes rather than preserving an original UTC instant. A past value is valid and makes an Open Task overdue; a date and time may produce a future Task Alert, while a date alone may not and never implies a hidden default time.
_Avoid_: Due At, deadline, reminder time

**Unscheduled Task**:
An Open Task with no Scheduled For. It is still a complete Task, not a draft waiting for a date.

**Task Alert**:
A local operating-system alert and sound derived from the journal's authoritative Open Task state for a future Scheduled For that includes a time. Only that one Open Task Occurrence is registered with macOS; completion or recurrence edits cancel it and register its successor. It shows the full Task Description and presents even while Work Journal is active, leaving preview and sound suppression to macOS. Clicking it opens the Main Window on Tasks View focused on that Task, replacing whatever section was showing; it has no Complete or Snooze actions, and an already-past schedule never produces a retroactive Alert. A nonexistent daylight-saving time fires at the first valid instant afterward that day; a repeated time fires once at its first occurrence. Failed operating-system scheduling never rolls back the Task; future Alerts are reconciled on launch, wake, permission restoration, and schedule changes. It is not a remote push message and is never required for the Task itself to work.
_Avoid_: Push notification, reminder

**Task Alert Permission**:
The operating-system grant that allows Task Alerts. Asked for in context when the first Task with a date and time is saved; refusal leaves the Task intact and is shown in Settings with the manual path to Work Journal's notification permission and an action that opens System Settings. It must be reversed by the user because the app cannot force or repeat the system prompt. Restoring it schedules future Alerts but never replays past ones.
_Avoid_: Notifications toggle, alert setting

**Recurring Task**:
A Task whose Scheduled For follows a fixed daily, weekly, monthly, yearly, or every-N-units calendar cadence until the recurrence is stopped. A weekly cadence may select multiple weekdays while retaining exactly one Open Task Occurrence: Monday-based weeks are counted from the week containing the series start, selected days before that start are ignored, and completion advances to the next selected day rather than producing simultaneous Tasks. Editing the starting date, selected days, cadence, or time immediately reanchors the series and replaces its Open occurrence without recording a completion. A series created from a past starting date opens on its latest elapsed slot, and completing an overdue occurrence advances to the next future slot, so missed slots never form a backlog. Monthly and yearly cadence retains its intended calendar anchor through shorter months: January 31 falls back to February's last day then returns to March 31, and February 29 returns in leap years after falling back to February 28.
_Avoid_: Repeating todo, generated tasks

**Task Occurrence**:
One scheduled commitment within a Recurring Task. Completed occurrences remain in an expandable history attached to that Task rather than appearing among ordinary Completed Tasks, while the Recurring Task continues with its next Open occurrence.
_Avoid_: Task copy, child task

**Undo Completion**:
Restore the most recently completed Task Occurrence as the one Open occurrence and remove the occurrence that completion advanced to, but only while that successor remains Open and unchanged. Older completions, or any completion whose successor was edited or completed, stay historical because undoing them would either create two Open occurrences or destroy later decisions.
_Avoid_: Reopen occurrence, roll back series

**Stop Recurrence**:
Remove the recurrence rule from a Recurring Task while retaining its current Task and completed Task Occurrences. There are no one-occurrence exceptions: recurrence edits affect the continuing series, while Deletion removes the Task and its occurrence history.
_Avoid_: End series, cancel repeat

**Tasks View**:
The Main Window section for creating and managing Tasks. Tasks are organized prospectively by state and schedule and Notes retrospectively by Journal Day, so Tasks View and History answer different questions — but they are sections of one window and are never on screen at once. Opens on Open Tasks grouped as Overdue, Today, Upcoming, and Unscheduled; Completed Tasks are a separate view, with no arbitrary filters or Search. A checkbox completes a Task immediately without confirmation; Recurring Tasks advance and expose Undo Completion while safe. Scheduled groups sort earliest first, Unscheduled sorts newest Task Created At first, and Completed sorts newest Task Completed At first. Every Task surface observes the same journal state immediately, and group membership refreshes at local midnight and whenever the app wakes or regains focus.
_Avoid_: Task History, Notes filter

**Task Editor**:
The sheet inside Tasks View that changes an existing Task, in the Main Window that section belongs to. Save commits the changes; Cancel or closing discards them. It never reuses the resident Task Creation window, whose unfinished new Task therefore remains untouched.
_Avoid_: Task Creation, edit window

**Body**:
The text content of a Note: a single line, no line breaks. Editable forever. One line is a deliberate limit — a Note is a remark, not a document — and it means every Note renders as exactly one bullet in a Digest.
_Avoid_: Content, text, transcript

**Capture**:
The act of writing a Note by hand. Ends in either one committed Note or nothing at all — never in a partial or empty one. May begin with a Project Marker; the marker is consumed at the boundary and never becomes part of the Body.
_Avoid_: Entry, input, quick add

**Captured Note**:
A Note the user typed. What the journal is for, and the only kind that counts as having journalled — a day of Imported Notes and no Captured Notes is a day nothing was said about.

**Import**:
The act of turning a meeting on the user's calendar into a Note, without being asked. The second and only other origin of a Note. Unlike a Capture it has no author present, so what it produces is always distinguishable from what was typed.
_Avoid_: Sync, ingest, intake

**Imported Note**:
A Note made by an Import. Its Body is the calendar event's title, verbatim, and its Captured At is when the meeting began. Always Unfiled — the calendars it comes from carry no Project meaning, so there is nothing to file it under. Ordinary in every other respect — editable, refilable and deletable like any Note. Rendered muted in History, with no icon and no label, so a scan-and-delete pass down the day is fast; a Digest shows no difference at all. Declined events never become one, nor do events covering the whole local day — whether or not the calendar marks them all-day, since an out-of-office block running local midnight to midnight does not, and would otherwise arrive as a meeting that began at 00:00.
_Avoid_: Meeting note, event, calendar entry

**Draft**:
Nothing. Text typed during a Capture but not committed does not exist — abandoning a Capture discards it, and the next Capture starts empty.

**Project**:
An optional named stream of work a Note is filed under. At most one per Note. First-class filing — parallel to Journal Day (when) rather than markup inside the Body (what was said). Identity is case-insensitive and stored lowercase; the name is a non-empty run of letters, digits, `_`, or `-`. Exists only as a value on Notes — no registry, so a name with no remaining Notes is gone.
_Avoid_: Tag, label, category, context, hashtag

**Project Marker**:
The `#name` prefix typed at the start of a Capture to name the Project. Consumed when the Note is committed: Project is set, Body is whatever follows. A bare marker with no Body fails Capture like any empty Body. Mid-line or malformed `#` is plain Body text, not a marker.
_Avoid_: Hashtag, tag prefix

**Unfiled**:
A Note with no Project. A real state and a real Filter value — not the same as “any project.”
_Avoid_: None, null project, untagged

**Prediction**:
A Project name offered from Projects already on Notes, matched by prefix as the user types. Offered wherever a Note is being filed — during a Capture after `#`, and when a Note already written is filed in History. Choosing one or typing a new name both work; a new name becomes a Project the moment a Note is filed under it, and a name the Project rule would refuse is never offered.
_Avoid_: Autocomplete, suggestion chip, typeahead

## Getting in

**Entry Point**:
A way to begin either a Capture or Task creation. Notes and Tasks have distinct Entry Points so choosing one is always explicit.
_Avoid_: Trigger, invocation, inference

**Note Hotkey**:
The global keyboard shortcut that begins a Capture. Defaults to `Ctrl+Shift+Cmd+J` for a new user and never replaces a combination an existing user chose. One of the Note Entry Points beside the Tray Menu and launching the app while it is already running.
_Avoid_: Hotkey, shortcut, keybinding, accelerator

**Task Hotkey**:
The global keyboard shortcut that begins Task Creation. Defaults to `Ctrl+Shift+Cmd+T` for a new user and never replaces a combination an existing user chose. One of the Task Entry Points beside the Tray Menu and the New Task control in Tasks View; distinct from the Note Hotkey so the record type is explicit before any text is entered.
_Avoid_: Hotkey, shortcut, keybinding, accelerator

**Hotkey Assignment**:
The independently stored combination and registration status of either Note Hotkey or Task Hotkey. The two may never share a combination: a refused remap leaves both previous registrations intact, while duplicate stored values at launch give precedence to Note Hotkey and leave Task Hotkey unavailable with its Tray Menu fallback. Invoking either while its input window exists focuses that window without resetting it, and invoking one never discards text waiting in the other.
_Avoid_: Shortcut setting, key binding

**Tray Menu**:
The menu bar icon's menu. The Entry Point that always works, offering both New Note and New Task so it is the fallback when either configured combination is unavailable. The way into the Main Window as well, and the one Entry Point that names which section to land on — View Notes, View Tasks and Settings each open their own. Also the one place the journal is read back without opening a window: Yesterday's Digest is copied from here.
_Avoid_: Menu bar, status item

**Tray Count**:
How many Captured Notes today's Journal Day holds, shown beside the menu bar glyph. The app solicits nothing about journalling — no prompts or scheduled nudges — so this is the only reminder to journal there is, and the only reason the app is noticed on a day nothing has been written. Captured Notes only: Imported Notes and Tasks would make the number mean two incompatible things. A day with none reads as a blank rather than as a zero, because a total reads as a day already accounted for.
_Avoid_: Badge, counter, notification

## Time

**Captured At**:
The instant the Note is about — when a Captured Note was typed, or when an Imported Note's meeting began. Never changes, never editable — provenance, not filing. Not the instant the Note was stored, which for an Import can be hours later and would sort a whole day wrongly.

**Journal Day**:
The single day a Note is filed under. Decided when the Note comes into existence as the local calendar day of Captured At, and thereafter the user's to change. Not recomputed from Captured At, so it never shifts under a timezone change.
_Avoid_: Date, day, created date

**Edited At**:
The instant a Note was last changed after capture — reworded, refiled to another Journal Day, or assigned a different Project (including clearing it). Nothing until then, so a Note still reading as it was typed claims nothing. It is what marks a corrected Note as corrected, so a reader knows the wording or filing may not be the original.
_Avoid_: Updated at, modified, revision

## Reading back

**Main Window**:
The one window the journal is read and configured in: History, Tasks View and Settings as sections of a sidebar, exactly one of them showing. An Entry Point that names a section decides which; anything that names none lands on History. A section holds whatever the user did to it while another is showing, but the window itself is gone when closed, so the next one opens fresh. While it is open the app has a Dock icon and a menu bar; when it closes the app is the menu bar glyph again.
_Avoid_: Main view, dashboard, home, shell

**History**:
The Main Window section where Notes are read back — everything the Filter describes, under the Journal Day each Note is filed under. Where a Note is reworded, refiled, deleted, and where a Digest is copied. The retrospective axis of the journal, which is why Tasks View is a section beside it rather than part of it.
_Avoid_: Journal view, timeline, feed, Notes list

**Filter**:
What is currently being viewed: a range of Journal Days, plus an optional Project constraint (a named Project, Unfiled, or Any). Opens on the most recent Occupied Day with Project = Any, and only changes when the user changes it — never on its own, even as new Notes arrive. Day range and Project constraint are independent axes; both must match for a Note to appear.

**Preset**:
A named civil-time range that sets the day axis of the Filter once and is forgotten: Today, Yesterday, This week, Last week, This month, Last month. Offered inside the one control that carries the day axis, beside the calendar; nothing holds the Preset afterwards, and the range it set is what the control reads. Does not touch the Project constraint. Week starts Monday. "This" units run from the unit start through today; "last" units are the full prior calendar unit. Yesterday is the calendar day before today, not the previous Occupied Day. An empty range is shown empty. Clock is read only when a Preset is chosen.
_Avoid_: Quick range, date chip, relative filter, rolling window

**Search**:
A way of moving the day axis of the Filter, never of narrowing it: the Notes anywhere in the journal whose Body contains what the reader typed, each labelled with the day it is filed under. Body only — not Project names. Answering one takes History to that day in full; the Project constraint is left as it was. What is on screen is always a Filter and nothing else.
_Avoid_: Query, find, filter by text

**Nudge**:
What a Note captured for a day outside the current Filter leaves behind: an unobtrusive line saying that day now has content, which the user can act on to move the Filter there, or dismiss. The reason a Filter can hold still without hiding new Notes. A Project mismatch alone does not Nudge — only Journal Day does.
_Avoid_: Notification, toast, badge, alert

**Occupied Day**:
A Journal Day that has at least one Note. What "the previous day" means in practice — the most recent Occupied Day, not yesterday's date, so a Monday morning shows Friday rather than an empty Sunday.

**Digest**:
The Markdown rendering of every Note in the current Filter, oldest first, grouped under day headings when the Filter spans more than one day. When the Project constraint is a single named Project, bullets are Body only. When it is Any or Unfiled, a Note that has a Project is rendered with a `#name` prefix on the bullet so mixed paste still carries filing. The journal's only output — written to be pasted into a standup or an LLM prompt. A copy says what it did twice: as a message that fades, and in a live region for a reader who is not looking at the screen. A clipboard write is invisible, and a count is how the reader knows it worked before they paste.
_Avoid_: Export, report, summary, copy-all text

**Yesterday's Digest**:
The Digest of the previous calendar day, on the clipboard from the Tray Menu. The payoff for capturing: it goes straight into the written work log the user already owes a chat group every morning, with no window to open and nothing to tidy up. Yesterday is the calendar day before today, not the previous Occupied Day — a standup post is about a date, so a Monday that pasted Friday would be a claim about the weekend. A day with no Notes copies nothing and leaves the clipboard as it was, since a blank paste is worse than no paste. Imported Notes are in it and read exactly like Captured ones: the muted rendering in History is for scanning and deleting, not for whoever reads the post. Does not touch the Filter — copying is not navigating.

**Export**:
Every Note and Task written to a Markdown file in separate sections, each appearing exactly once. Notes remain day-grouped and use a `#name` prefix when filed under a Project. Tasks are separated into Open and Completed and retain their Task Description, Scheduled For, recurrence rule, and completed Task Occurrence history. The way out of the SQLite file, so nothing kept here is locked in — which is why it ignores the Filter and Tasks View entirely, and why it is a core operation rather than a convenience.
_Avoid_: Backup, dump, save as

**Deletion**:
Confirmed permanent removal of a Note or Task. There is no trash, no archive, no recovery, and no bulk deletion of Completed Tasks. Deleting an Imported Note also refuses its meeting so it is never imported again; deleting a Recurring Task also removes its completed Task Occurrence history and says so before confirmation.

## Settings

**Settings**:
What the user gets to decide about the app: the Note and Task Hotkeys, the Theme, whether the app starts at login, whether today's meetings are imported and from which calendars, and how to recover unavailable Task Alert Permission — plus Export as its one action rather than a setting. A Main Window section, reached from the sidebar or named directly from the Tray Menu.

**Meeting Import**:
Whether Import runs, and over which calendars. Off until turned on, with no calendar ticked, so enabling it sweeps nothing until the user says which calendars mean work; an unticked calendar is ignored entirely. Turning it on is also where the calendar permission is asked for, because it is the one moment the user has said they want it. The stored setting is the user's wish for Import, and only the user writes it; whether Import runs is that wish and the OS answer together. Permission refused or revoked therefore leaves the wish standing and the toggle reading off, with a line saying why — a routine path rather than an exceptional one, since macOS keys the grant to the exact binary and every rebuilt release is asked about once. A grant restored in System Settings resumes Import without asking a second time, and pressing the toggle while it reads off withdraws the wish. The app never nags, and the journal keeps working exactly as before.
_Avoid_: Calendar sync, integration, connection

**Theme**:
Whether the app paints itself light or dark. Three answers, not two: `light`, `dark`, and `system` — and `system` is the absence of a preference rather than a third palette, so an unasked user follows the OS. Settable from Settings, and toggled from any window with Cmd+Shift+D. One preference for the whole app, so a window that did not host the change still hears about it and repaints.
_Avoid_: Appearance, dark mode, colour scheme, skin

**Resolved Theme**:
The palette actually on screen once the OS has been asked: only `light` or `dark`, never `system`. What the Theme comes to, not what the user chose — the distinction that lets the toggle switch to the opposite of what is visible rather than the next name in a list, and lets a `system` preference change with the OS under a window that is already open.

**Theme Toggle**:
Cmd+Shift+D, from any window. Never a bare `d`, and it stands aside entirely wherever text is being entered: this app is a text field with a window around it, and a shortcut that could fire mid-word would eat the Capture it was meant to serve. Using it settles the Theme on a palette — after a toggle the app no longer follows the OS.

**Start at Login**:
Whether the app launches when the user logs in. Off until the user says otherwise, and asked once on first run so the app never adds itself to the login items uninvited. Declining is an answer: the question is not asked again.
_Avoid_: Autostart, launch at startup, open at boot
