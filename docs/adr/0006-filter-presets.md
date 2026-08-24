# Filter Presets

> The mechanism below — one select beside two day pickers — is superseded by
> ADR-0013, which folds the Presets and both ends of the range into one
> control. What a Preset *is* is unchanged.

History offers one select of named ranges that set the Filter once and are
forgotten: Today, Yesterday, This week, Last week, This month, Last month. The
select snaps back to a neutral label; the day pickers remain the source of truth.
This supersedes `.out-of-scope/filter-presets.md`, which rejected the feature.

## Why

The rejection was about chrome — chips turning the header into a toolbar — and
about reading back depending on the clock for the first time. Both still matter.
The cost that did not hold is the standup and LLM case: a wide Filter with no
text to Search for, paid for every time by two date pickers.

One select, not chips, keeps the header a journal. One-shot, not a mode, keeps
the Filter as a range of Journal Days and nothing else — the same rule Search
obeys (ADR-0004). Anchoring on the clock is accepted: Presets are deliberately
about civil time relative to today, while Occupied Day stays what History opens
on and what "the previous day with work" means.

## Shape

- Week starts Monday.
- "This week" / "This month" run from the unit start through today.
- "Last week" / "Last month" are the full prior calendar unit.
- Yesterday is the calendar day before today, not the previous Occupied Day.
- An empty range is shown empty; the Preset is not second-guessed.

## Consequences

- Moving the Filter has four equal user acts: pickers, Preset, Search, Nudge.
- History reads the clock when a Preset is chosen, and only then.
- No rolling "last N days", no prev/next steppers, no sticky Preset state.
