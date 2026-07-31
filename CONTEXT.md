# Work Journal

A personal, local-first log of short work notes captured throughout the day, so that what you did is recoverable later — at standup, in a review, or as context for an LLM.

## Language

**Note**:
A single dated line of text the user wrote about their work. The unit of everything — there is no smaller or larger record. Always has a Body from the moment it exists.
_Avoid_: Entry, log, item, memo

**Body**:
The text content of a Note: a single line, no line breaks. Editable forever. One line is a deliberate limit — a Note is a remark, not a document — and it means every Note renders as exactly one bullet in a Digest.
_Avoid_: Content, text, transcript

**Capture**:
The act of creating a Note. Ends in either one committed Note or nothing at all — never in a partial or empty one.
_Avoid_: Entry, input, quick add

**Draft**:
Nothing. Text typed during a Capture but not committed does not exist — abandoning a Capture discards it, and the next Capture starts empty.

## Getting in

**Entry Point**:
A way to begin a Capture. There are three, and each works when the others cannot: the Hotkey, the Tray Menu, and launching the app while it is already running.
_Avoid_: Trigger, invocation

**Hotkey**:
The global keyboard shortcut that begins a Capture. The fastest Entry Point and the only one that can be unavailable — macOS may withhold the permission it needs, or the user may be on a managed machine.
_Avoid_: Shortcut, keybinding, accelerator

**Tray Menu**:
The menu bar icon's menu. The Entry Point that always works, so it is the fallback rather than a duplicate of the Hotkey.
_Avoid_: Menu bar, status item

## Time

**Captured At**:
The instant a Note came into existence. Never changes, never editable — provenance, not filing.

**Journal Day**:
The single day a Note is filed under. Decided when the Note is captured, and thereafter the user's to change. Not recomputed from Captured At, so it never shifts under a timezone change or a Day Start change.
_Avoid_: Date, day, created date

**Edited At**:
The instant a Note was last changed after capture — reworded or refiled. Nothing until then, so a Note still reading as it was typed claims nothing. It is what marks a corrected Note as corrected, so a reader knows the wording may not be the original.
_Avoid_: Updated at, modified, revision

**Day Start**:
The hour at which one Journal Day gives way to the next. User-configurable, defaults to 04:00, so work done after midnight files under the day it felt like rather than the day the clock said.
_Avoid_: Cutoff, rollover, midnight

## Reading back

**Filter**:
The range of Journal Days currently being viewed. Opens on the most recent Occupied Day and only changes when the user changes it — never on its own, even as new Notes arrive.

**Nudge**:
What a Note captured for a day outside the current Filter leaves behind: an unobtrusive line saying that day now has content, which the user can act on to move the Filter there, or dismiss. The reason a Filter can hold still without hiding new Notes.
_Avoid_: Notification, toast, badge, alert

**Occupied Day**:
A Journal Day that has at least one Note. What "the previous day" means in practice — the most recent Occupied Day, not yesterday's date, so a Monday morning shows Friday rather than an empty Sunday.

**Digest**:
The Markdown rendering of every Note in the current Filter, oldest first, grouped under day headings when the Filter spans more than one day. The journal's only output — written to be pasted into a standup or an LLM prompt.
_Avoid_: Export, report, summary, copy-all text

**Export**:
Every Note in the journal written to a Markdown file, each appearing exactly once, under a heading for the day it is filed under. The way out of the SQLite file, so nothing captured here is locked in — which is why it ignores the Filter entirely, and why it is a core operation rather than a convenience.
_Avoid_: Backup, dump, save as

**Deletion**:
Permanent removal of a Note. There is no trash, no archive, and no recovery — a deleted Note is gone.

## Settings

**Settings**:
The five things about the app the user gets to decide: the Day Start, the Hotkey, the Theme, whether the app starts at login, and — as the one action rather than a setting — Export. Reached from the Tray Menu, and closed on dismiss rather than kept resident.

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
