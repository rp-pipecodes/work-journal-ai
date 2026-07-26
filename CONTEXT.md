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

**Day Start**:
The hour at which one Journal Day gives way to the next. User-configurable, defaults to 04:00, so work done after midnight files under the day it felt like rather than the day the clock said.
_Avoid_: Cutoff, rollover, midnight

## Reading back

**Filter**:
The range of Journal Days currently being viewed. Opens on the most recent Occupied Day and only changes when the user changes it — never on its own, even as new Notes arrive.

**Occupied Day**:
A Journal Day that has at least one Note. What "the previous day" means in practice — the most recent Occupied Day, not yesterday's date, so a Monday morning shows Friday rather than an empty Sunday.

**Digest**:
The Markdown rendering of every Note in the current Filter, oldest first, grouped under day headings when the Filter spans more than one day. The journal's only output — written to be pasted into a standup or an LLM prompt.
_Avoid_: Export, report, summary, copy-all text

**Deletion**:
Permanent removal of a Note. There is no trash, no archive, and no recovery — a deleted Note is gone.
