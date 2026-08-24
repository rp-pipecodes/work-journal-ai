# Work Journal

A personal, local-first log of short work notes captured throughout the day, so that what you did is recoverable later — at standup, in a review, or as context for an LLM.

## Language

**Note**:
A single dated line of text about the user's work. The unit of everything — there is no smaller or larger record. Always has a Body from the moment it exists. May be filed under one Project; may be Unfiled. Comes into existence one of exactly two ways: a Capture or an Import.
_Avoid_: Entry, log, item, memo

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
A Project name offered during Capture from Projects already on Notes, matched by prefix as the user types after `#`. Choosing one or typing a new name both work; a new name becomes a Project on commit.
_Avoid_: Autocomplete, suggestion chip, typeahead

## Getting in

**Entry Point**:
A way to begin a Capture. There are three, and each works when the others cannot: the Hotkey, the Tray Menu, and launching the app while it is already running.
_Avoid_: Trigger, invocation

**Hotkey**:
The global keyboard shortcut that begins a Capture. The fastest Entry Point and the only one that can be unavailable — macOS may withhold the permission it needs, or the user may be on a managed machine.
_Avoid_: Shortcut, keybinding, accelerator

**Tray Menu**:
The menu bar icon's menu. The Entry Point that always works, so it is the fallback rather than a duplicate of the Hotkey. Also the one place the journal is read back without opening a window: Yesterday's Digest is copied from here.
_Avoid_: Menu bar, status item

**Tray Count**:
How many Captured Notes today's Journal Day holds, shown beside the menu bar glyph. The app solicits nothing — no prompts, no scheduled nudges — so this is the only reminder to journal there is, and the only reason the app is noticed on a day nothing has been written. Captured Notes only: a count inflated by Imported Notes would reassure precisely on the days nothing was typed. A day with none reads as a blank rather than as a zero, because a total reads as a day already accounted for.
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

**Filter**:
What is currently being viewed: a range of Journal Days, plus an optional Project constraint (a named Project, Unfiled, or Any). Opens on the most recent Occupied Day with Project = Any, and only changes when the user changes it — never on its own, even as new Notes arrive. Day range and Project constraint are independent axes; both must match for a Note to appear.

**Preset**:
A named civil-time range that sets the day axis of the Filter once and is forgotten: Today, Yesterday, This week, Last week, This month, Last month. One select, snaps back to a neutral label; the day pickers remain the source of truth. Does not touch the Project constraint. Week starts Monday. "This" units run from the unit start through today; "last" units are the full prior calendar unit. Yesterday is the calendar day before today, not the previous Occupied Day. An empty range is shown empty. Clock is read only when a Preset is chosen.
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
The Markdown rendering of every Note in the current Filter, oldest first, grouped under day headings when the Filter spans more than one day. When the Project constraint is a single named Project, bullets are Body only. When it is Any or Unfiled, a Note that has a Project is rendered with a `#name` prefix on the bullet so mixed paste still carries filing. The journal's only output — written to be pasted into a standup or an LLM prompt.
_Avoid_: Export, report, summary, copy-all text

**Yesterday's Digest**:
The Digest of the previous calendar day, on the clipboard from the Tray Menu. The payoff for capturing: it goes straight into the written work log the user already owes a chat group every morning, with no window to open and nothing to tidy up. Yesterday is the calendar day before today, not the previous Occupied Day — a standup post is about a date, so a Monday that pasted Friday would be a claim about the weekend. A day with no Notes copies nothing and leaves the clipboard as it was, since a blank paste is worse than no paste. Imported Notes are in it and read exactly like Captured ones: the muted rendering in History is for scanning and deleting, not for whoever reads the post. Does not touch the Filter — copying is not navigating.

**Export**:
Every Note in the journal written to a Markdown file, each appearing exactly once, under a heading for the day it is filed under — still day-grouped, never regrouped by Project. Notes that have a Project render with a `#name` prefix on the bullet. The way out of the SQLite file, so nothing captured here is locked in — which is why it ignores the Filter entirely, and why it is a core operation rather than a convenience.
_Avoid_: Backup, dump, save as

**Deletion**:
Permanent removal of a Note. There is no trash, no archive, and no recovery — a deleted Note is gone. Deleting an Imported Note also refuses its meeting: that meeting is never imported again.

## Settings

**Settings**:
What the user gets to decide about the app: the Hotkey, the Theme, whether the app starts at login, whether today's meetings are imported and from which calendars — and, as the one action rather than a setting, Export. Reached from the Tray Menu, and closed on dismiss rather than kept resident.

**Meeting Import**:
Whether Import runs, and over which calendars. Off until turned on, with no calendar ticked, so enabling it sweeps nothing until the user says which calendars mean work; an unticked calendar is ignored entirely. Turning it on is also where the calendar permission is asked for, because it is the one moment the user has said they want it. Permission refused or revoked returns the toggle to off with a line saying why — a routine path rather than an exceptional one, since macOS keys the grant to the exact binary and every rebuilt release is asked about once. The app never nags, and the journal keeps working exactly as before.
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
