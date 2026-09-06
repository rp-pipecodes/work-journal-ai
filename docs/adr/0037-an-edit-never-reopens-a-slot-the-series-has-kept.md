# An edit never reopens a slot the series has kept

Editing a Recurring Task's schedule reanchors the series and replaces its Open
occurrence — see docs/adr/0016-recurring-tasks-have-one-open-occurrence.md —
but the replacement was derived from the anchor and the clock alone, with no
regard for what the series had already kept. Retiming a daily stand-up from
09:00 to 10:00 at 14:00 therefore moved the Open occurrence *backwards* onto a
day already completed, where ticking it wrote a second completion for the same
slot. The head of an edited series is now floored at the first slot strictly
after the newest kept occurrence, for every schedule edit rather than only a
change of time, because the reason for the floor is what the series has kept
and not which field the user touched.

## Considered Options

Asking the user to choose when an edit would move the head back over completed
days was rejected: every other edit in this app is silent, and the prompt would
ask the user to adjudicate arithmetic they never saw go wrong. "Clamp forward
past the newest completion" and "apply from the next occurrence" turned out to
be one rule stated twice — with the series kept through 15 June, both yield 16
June — so the decision is only where the floor sits, not which of the two it is.

The floor is against **kept** occurrences only, never against the current Open
one. A series overdue since 10 June with nothing completed may still collapse
forward to its latest elapsed slot when retimed: only the date label moves, not
the count of what is owed, and ADR 0016's whole design is that missed slots
never form a backlog.

## Consequences

Opening a series and resuming one are different questions, so they are answered
by different arithmetic. Creation keeps `openingSlot` and its step back onto the
latest *elapsed* slot, because a start date in the past is something the user
deliberately chose. Editing uses `resumedSlot`, which is `openingSlot` without
that step back: it prefers today's slot whenever the time just typed is still
ahead. Without the split, retiming a reminder to 23:00 at 14:00 opens
*yesterday* at 23:00.

The head of an edited series is then the later of `resumedSlot` and the floor —
not `advancedSlot` from the newest kept slot, which an earlier draft of this
record wrongly claimed was equivalent. It is not, because `advancedSlot` skips
every slot whose moment has already passed, and today's has when the user
retimes to a time earlier than the clock. A monthly invoice anchored on 31
January, kept in January and retimed from 09:00 to 07:00 at 08:00 on 28
February, advances to 31 March under `advancedSlot` — February's commitment
disappears without being kept. Taking the later of the floor and `resumedSlot`
leaves it standing on 28 February as Overdue, which is what the user still owes.

Nothing in the schema forbids two kept occurrences on the same slot: the unique
index in migration 0006 constrains one *Open* occurrence per Task and no more.
An index on `(task_id, scheduled_date)` would have made this a loud failure
instead of a silent duplicate, and is worth adding — but separately, because
databases already carrying duplicates make the migration a question of which
completion survives.

Completions still re-day when the user crosses time zones, and this is recorded
here as a decision rather than left as a defect to be refiled. Review and
Standup group a completion by the instant it was completed at, not by the civil
slot the occurrence stores, because an ordinary Completed Task has nothing but
an instant — and "work kept yesterday" meaning one thing across both kinds of
completion is worth more than a stable day label for a user who has crossed the
dateline. This follows from
docs/adr/0021-task-schedules-are-stored-as-civil-time.md: civil time follows
the user.
