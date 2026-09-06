-- A Recurring Task keeps a given slot once — see
-- docs/adr/0038-a-series-keeps-a-slot-once.md, which records both the rule and
-- what a journal already carrying duplicates makes of it. The one-Open index
-- in migration 0006 puts a central invariant in the schema rather than in
-- application code; this is the same defence for the other half of the
-- occurrence table's shape, because whatever route the application misses,
-- the schema is the one place that cannot be reached around.
--
-- The index cannot be created bare: journals retimed onto a kept slot before
-- the application-level fix in ADR 0037 may already carry two completions for
-- one (task_id, scheduled_date), and a bare unique index would fail there —
-- which, because the migration pool opens before setup runs, would fail the
-- launch itself, including the launch that restores an older snapshot (ADR
-- 0033) and then migrates it. So the repair comes first. The order within the
-- repair is forced: the pointer below names a row by id, and the self-reference
-- is immediate, so the pointers are re-pointed while every row they might name
-- still exists — taking a stray away first would refuse the very delete that
-- makes room for the index.

-- Which completion survives when a slot has two: the earliest completed_at.
-- That is the one the user actually kept on the day; the later one is the
-- accidental second tick, and the expandable history should read what
-- happened once, not twice. Ties on the instant are broken by id, so the
-- survivor is deterministic.
--
-- The occurrence whose completion produced the Open one may be one of the
-- strays, so every pointer is re-pointed at the earliest completion on the
-- slot it names — which for a pointer that was already sound is the very row
-- it named, and for one naming a stray second tick is the row about to
-- survive. Re-pointed rather than cleared, because advanced_from is exactly
-- what makes Undo Completion safe to offer and the earliest completion on file
-- is still the latest completion of the series: undoing it restores the slot
-- it stands for. A pointer naming a slot that holds no completion finds no
-- keeper and is cleared.
UPDATE task_occurrences
SET advanced_from = (
    SELECT keeper.id
    FROM task_occurrences named
    JOIN task_occurrences keeper
      ON keeper.task_id = named.task_id
     AND keeper.scheduled_date = named.scheduled_date
     AND keeper.completed_at IS NOT NULL
    WHERE named.id = task_occurrences.advanced_from
    ORDER BY keeper.completed_at, keeper.id
    LIMIT 1
)
WHERE advanced_from IS NOT NULL;

-- Then the strays go, and nothing is left pointing at one: every row numbered
-- past 1 per (task_id, scheduled_date) is an accidental second tick.
DELETE FROM task_occurrences
WHERE id IN (
    SELECT id FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                   PARTITION BY task_id, scheduled_date
                   ORDER BY completed_at, id
               ) AS among_kept
        FROM task_occurrences
        WHERE completed_at IS NOT NULL
    )
    WHERE among_kept > 1
);

-- The invariant itself: at most one kept occurrence per slot, per Task. The
-- Open occurrence is outside this index — completed_at IS NULL never matches —
-- because a series may legitimately stand Open on the date of a slot it kept
-- (a date-only undo middle state writes exactly that), and constraining it
-- would break undoCompletion and the date-only reanchor. Only the date is the
-- slot's identity here: the times an accidental second tick carried belong to
-- the stray occurrence, not to the day's commitment.
CREATE UNIQUE INDEX task_occurrences_one_kept_per_slot
    ON task_occurrences (task_id, scheduled_date)
    WHERE completed_at IS NOT NULL;
