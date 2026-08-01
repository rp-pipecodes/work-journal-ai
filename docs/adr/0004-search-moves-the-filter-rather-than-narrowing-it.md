# Search moves the Filter rather than narrowing it

A Search finds Notes by what their Body says, anywhere in the journal, and its
only outcome is to move the Filter to the day a result is filed under. It is a
way in, not a second thing that decides what is on screen. The Filter remains
what it has always been: a range of Journal Days and nothing else.

## Why

The obvious design is the opposite one, which is why this is written down.
Everywhere else, searching narrows what you are looking at — so the first
instinct is to let a Filter be a range *and* some text, or to put a second
narrowing beside the Filter. Both were considered and both cost more than they
look.

Extending the Filter with text changes what the Digest means. A Digest is "the
Markdown rendering of every Note in the current Filter", so the moment a search
narrows the Filter, Copy All quietly starts copying search results — the standup
case breaks silently, without anything on screen saying so. It also gives
`decideArrival` a third answer it has no good response to: a Note captured into
the range being viewed, but not matching the text.

A separate narrowing beside the Filter avoids redefining anything, and produces
the opposite failure: the screen and the clipboard disagree, which is the exact
thing the History session goes out of its way to prevent by reading the list and
the Digest from the same Filter together.

Moving the Filter costs nothing to the model. Filter, Digest, Nudge and Occupied
Day keep their definitions verbatim; one term is added and none is rewritten.

It is also the better answer for the case that motivated Search at all. A Body is
one line by deliberate constraint — a remark, not a document — so six matching
remarks torn from four different days are close to unreadable. What a reader
wants at six months is the day the migration went wrong, with the eleven other
things they wrote that day still around it.

## Consequences

- **Nothing on screen is ever half a Filter.** Results replace the day list
  outright and are a distinct arm of History's state, so the window shows exactly
  one of them and the type says so.
- **Copy All is hidden while a Search is showing.** The Digest belongs to the
  Filter, and offering a button that copies something not on screen is how the
  wrong month reaches a standup thread.
- **A Note arriving during a Search always nudges, never shows.** While results
  are up there is no Filter on screen for it to belong to, which makes the rule
  simpler than the one it replaces rather than more complex.
- **Results do not re-run as the journal changes.** They answer the question that
  was asked, and hold still under a reader like everything else here.
- **Escape belongs to whatever has taken over the screen** — the results while
  they are up, the window otherwise. This generalises the existing carve-out for
  an open edit rather than adding a case to it.
- **Matching is a substring of the Body, case-insensitively.** A personal journal
  is thousands of short rows, so `LIKE` is instant and FTS5 would buy stemming
  and ranking at the price of a shadow table and triggers. The core owns every
  SQL statement, so swapping it later is one constant. The known limit is
  non-ASCII case folding: `MIGRAÇÃO` does not match `migração`.
