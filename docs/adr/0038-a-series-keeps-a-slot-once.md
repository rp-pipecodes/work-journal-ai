# A series keeps a slot once

The one-Open index in migration 0006 put a central invariant in the schema
rather than in application code, so that completing-and-advancing or undoing
could not leave two Open occurrences behind however it was interrupted. The
other half of the occurrence table's shape had no such defence: nothing said a
Recurring Task may keep a given slot only once, and #186 exploited exactly that
gap — a retimed edit landed the Open occurrence on a day already kept, and
completing it wrote a second completion for the same slot, silently. ADR 0037
closed the application-level route; migration 0007 closes every route, seen or
unseen, by putting the invariant in the schema too: at most one kept occurrence
per `(task_id, scheduled_date)`.

## The migration repairs before it constrains

The index cannot be created bare. Journals retimed onto a kept slot before the
fix in ADR 0037 may already carry two completions for one slot, and a bare
unique index would refuse to build there — which, because the migration pool
opens before `setup` runs, would fail the launch itself. Worse, a Restore (ADR
0033) replaces the journal at startup and the migrations then run against the
restored file, so a backup carrying duplicates would turn a restore into a
launch failure; the restore's schema check reads tables and columns, not rows,
and cannot catch it. The migration therefore de-duplicates first, under the
rule below, and only then builds the index.

## Which completion survives: the earliest

When a slot has two completions, the one with the earliest `completed_at`
survives; ties on the instant break by id, so the survivor is deterministic.
The earliest is the one the user actually kept on the day — the later one is
the accidental second tick, and the expandable history should read what
happened once, not twice. This is a recorded rule rather than an accident of
`MIN()`: dropping a completion is permanent (there is no trash), so what the
migration keeps is a product decision.

## The pointer is re-pointed, never left dangling

`advanced_from` is a self-reference, and it is exactly what makes Undo
Completion safe to offer: the Open occurrence points back at the completion
that produced it. The completion a pointer names may be one of the stray rows
the migration removes, so every pointer is re-pointed at the earliest
completion on the slot it named — which for a pointer that was already sound
is the very row it named, and for one naming a stray is the row that survives.
Re-pointed rather than cleared, because the earliest completion on file is
still the latest completion of the series: undoing it restores the slot it
stands for. A pointer naming a slot that holds no completion finds no keeper
and is cleared. The re-pointing runs before the removal, because the
self-reference is immediate: taking a stray away first would refuse the very
delete that makes room for the index.

## The index is partial: kept occurrences only

The index covers rows `WHERE completed_at IS NOT NULL` and no others. The one
Open occurrence must stay outside it, because a series may legitimately stand
Open on the date of a slot it kept: undo's middle states and the date-only
reanchor both produce a kept row and an Open row sharing a date, and ADR 0037's
floor deliberately allows the head to rest on the day after the newest kept
slot. Constraining the Open occurrence by date would break `undoCompletion`,
which is why the naive index over all rows was never an option. Only the date
is the slot's identity here; the times an accidental second tick carried belong
to the stray occurrence, not to the day's commitment.

## Considered options

- **Telling the user their history was corrected.** Rejected for the migration:
  it runs at launch against a file the user may never have opened in this
  version, and a launch that pauses to narrate de-duplication is a launch that
  fails to start cleanly. The rule is recorded here instead, and the rollback
  file a Restore keeps (ADR 0033) plus the automatic snapshots (ADR 0032)
  remain the ways back to the pre-migration whole.
- **Keeping the latest completion instead.** Rejected: the later tick is the
  accident, not the record. A user who completed the day and then, through the
  #186 route, completed it again did not do the work twice.
- **Clearing `advanced_from` when its target is removed.** Rejected: it would
  withdraw Undo Completion from series the migration touched, destroying the
  safety property to avoid repairing it.

## Consequences

- **`SUPPORTED_MIGRATION_VERSION` in `backup.rs` moves to 7**, and every
  future migration must keep older snapshots migratable, as ADR 0033 already
  requires. `expected_schema` gains no new arm: an index adds neither a table
  nor a column, and the fallback already covers the version.
- **The application-level floor in ADR 0037 remains the first line of
  defence.** The schema is the last one; a constraint violation is a loud
  failure where the duplicate was a silent one.
- **Nothing changes for journals without duplicates:** the re-pointing is a
  no-op on sound pointers, the removal removes nothing, and the index rejects
  only what no code path writes any more.
