# Filter Presets

History will not offer preset ranges — no "last 7 days" chip, no "this week", no
"this month". The Filter is moved by its two date pickers, and by answering a
Search or a Nudge.

## Why this is out of scope

The feature is obvious, cheap, and genuinely useful. It is rejected anyway, for
what it does to the window rather than for what it costs to build.

History opens on the most recent Occupied Day, which is the right default and
serves the daily standup with no interaction at all. Everything beyond that is a
deliberate act, and the header is where deliberate acts happen. That header now
holds two date pickers, a Search field, and a Copy All that comes and goes — see
`docs/adr/0004-search-moves-the-filter-rather-than-narrowing-it.md`. A row of
preset chips on top of that makes the app read as a tool with a toolbar, when
what it is meant to read as is a journal. This app cuts features rather than
accumulating them, and a convenience that introduces no domain concept is the
first kind to cut.

Two supporting arguments were weighed and did not survive:

**"Typing into the pickers is unpleasant."** It was, and that was a bug (#11),
now fixed. `DayField` keeps typing local and commits only a settled value, so
reaching an arbitrary day is ordinary typing. The remaining cost of a wide Filter
is working out the date yourself — real, but small and infrequent.

**"It is only pure functions over the clock and the Day Start."** Nearly. History
today never asks what time it is: it opens on the most recent Occupied Day, which
is stored data, and every Filter it shows came from a picker or a stored day.
"The last seven days" is anchored on *today*, so presets would make reading back
depend on the clock for the first time. Small, but it is a new dependency rather
than arithmetic over things already known.

```ts
// The whole of the Filter-building surface, and deliberately so:
export function filterForJournalDay(journalDay: string): Filter
export function filterForRange(oneEnd: string, otherEnd: string): Filter
```

## What stays unserved, honestly

Search does not cover this. Search finds a day by what a Note says; presets would
have covered a wide range with no text to look for — a Monday standup spanning
the week, or a week of context pasted into an LLM prompt. That case is real, it
is named in the project's own description, and the permanent answer to it is
moving two date pickers. That is the accepted cost of this rejection, not an
oversight in it.

If it is ever reconsidered, the version to reconsider is **one control, not
four**: a single select in the header offering the three ranges, and a preset as
a shortcut that moves the pickers and is then forgotten — never a mode the Filter
stays in.

## Prior requests

- #22 — "One click for the Filter a standup actually wants"
