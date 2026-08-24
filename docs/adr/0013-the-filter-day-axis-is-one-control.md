# The Filter's day axis is one control

The day axis of the Filter — both ends of the range, and every Preset — is one
control: a button reading the current range in words, opening a popup that
holds the Presets and a calendar. This supersedes the mechanism ADR-0006 chose,
"one select, and the day pickers remain the source of truth". Everything
ADR-0006 decided about what a Preset *is* still stands: one-shot, never sticky,
week starting Monday, the clock read only when one is chosen, and never a word
about the Project constraint.

## Why

ADR-0006 said "one select, not chips" to keep the header a journal rather than
a toolbar. It worked on its own terms and then lost to arithmetic: the header
carried six peer controls, three of which — From, To and Preset — were three
controls for a single concept, and two of those were native date inputs that
rendered in the OS's own font and ignored the app's Theme.

Collapsing them keeps ADR-0006's intent better than ADR-0006's mechanism did.
The header now carries three things and one primary action, and the day axis
reads as a sentence — "9 – 13 March 2026" — rather than as two blank pickers
the reader has to decode.

The old select snapped back to a neutral label because a Preset that stayed
selected would be a claim that stops being true at midnight. Nothing snaps back
now because nothing holds the Preset at all: what is on screen afterwards is
the range it set, which is the only thing still true tomorrow.

## Consequences

- Moving the Filter still has four equal user acts: the day range, a Preset,
  Search, a Nudge. The first two now share one control and one popup.
- A day is picked whole, in one click. The typed/settled dance `DayField`
  needed — a date input announces `0002`, `0020`, `0202` on the way to `2026` —
  is gone from the Filter along with the input that caused it.
- The range is said in the reader's own locale, as one range rather than two
  dates: what the ends share is said once.
- The popup is portalled, which the History window can carry and the Capture
  window cannot — see the Capture constraint in the redesign: that window is
  64px tall, transparent and undecorated, so anything portalled is clipped.
