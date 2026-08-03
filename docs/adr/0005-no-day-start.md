# No Day Start

Journal Day for a new Capture is the local calendar day of Captured At. There is
no configurable hour at which one Journal Day gives way to the next. Existing
Notes keep the Journal Day they already have; nothing is recomputed.

## Why

Day Start existed so work after midnight could file under the day it felt like.
That flexibility cost a setting, a cross-window announcement, a dependency every
Capture had to read, and a second clock in the reader's head when History talked
about "today". Presets need a single meaning of today; keeping Day Start would
make every named range a function of a preference most users never touch.

The accepted loss is late-night filing under the civil next day. Refiling a Note
remains available when that is wrong. Midnight is the boundary everyone already
knows.

## Consequences

- Settings no longer offers Day Start. Stored `dayStartHour` values are ignored
  and can be dropped.
- `journalDayFor` no longer takes an hour — local calendar date only.
- Presets, Occupied Day, and the open-default Filter all share one notion of
  "today" with Capture.
