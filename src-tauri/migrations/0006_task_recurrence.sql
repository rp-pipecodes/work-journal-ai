-- Recurrence, and the occurrences it produces — see
-- docs/adr/0016-recurring-tasks-have-one-open-occurrence.md and
-- docs/adr/0020-recurring-task-transitions-are-transactional.md.
--
-- The rule lives on the Task, because a Recurring Task is one Task rather than
-- a stream of cloned ones. All four columns are NULL together on a Task that
-- does not repeat, and set together on one that does.

-- Which calendar unit the cadence counts in. NULL is a Task that does not
-- repeat, which is every Task written before this migration.
ALTER TABLE tasks ADD COLUMN recurrence_unit TEXT
    CHECK (recurrence_unit IS NULL OR recurrence_unit IN ('day', 'week', 'month', 'year'));

-- Every N of that unit. 1 is every one of them; there is no 0 and no negative
-- cadence, because neither describes a repetition.
ALTER TABLE tasks ADD COLUMN recurrence_interval INTEGER
    CHECK (recurrence_interval IS NULL OR recurrence_interval >= 1);

-- The selected weekdays of a weekly cadence, ISO 1 (Monday) to 7 (Sunday),
-- ascending and comma-separated. Only a weekly cadence has any: the other three
-- units take their day from the starting date.
ALTER TABLE tasks ADD COLUMN recurrence_weekdays TEXT
    CHECK (
        recurrence_weekdays IS NULL
        OR (
            length(recurrence_weekdays) > 0
            AND recurrence_weekdays NOT GLOB '*[^1-7,]*'
        )
    );

-- The starting date the series is counted from, `YYYY-MM-DD`. Kept apart from
-- `scheduled_date`, which is the current Open occurrence and moves with every
-- completion: every-N weeks are counted from the Monday-based week containing
-- this date, and a monthly or yearly cadence keeps this date's day of the month
-- through shorter months rather than drifting after a fallback.
ALTER TABLE tasks ADD COLUMN recurrence_anchor_date TEXT;

-- One scheduled commitment within a Recurring Task. Completed rows are the
-- Task's history and stay attached to it rather than joining the ordinary
-- Completed Tasks; the one row with no `completed_at` is what the Task is
-- currently asking for.
CREATE TABLE task_occurrences (
    id TEXT PRIMARY KEY NOT NULL,
    -- The Recurring Task this belongs to. Deleting a Task takes its whole
    -- history with it, in the same transaction.
    task_id TEXT NOT NULL REFERENCES tasks (id),
    -- The slot: civil time, exactly as a Task's own schedule is stored — see
    -- docs/adr/0021-task-schedules-are-stored-as-civil-time.md. An occurrence
    -- always has a date; a series with no date is not a series.
    scheduled_date TEXT NOT NULL,
    scheduled_time TEXT,
    -- When this occurrence was completed, or NULL while it is the Open one.
    completed_at TEXT,
    created_at TEXT NOT NULL,
    -- The occurrence whose completion produced this one, and NULL when nothing
    -- did — a series just created, or one an edit reanchored. This is what
    -- makes Undo Completion safe to offer: it is available exactly while the
    -- Open occurrence still points back at the completion being undone.
    advanced_from TEXT REFERENCES task_occurrences (id)
);

-- The central invariant, in the schema rather than in application code: a
-- Recurring Task has exactly one Open Task Occurrence, so completing-and-
-- advancing or undoing cannot leave two behind however it is interrupted.
CREATE UNIQUE INDEX task_occurrences_one_open
    ON task_occurrences (task_id)
    WHERE completed_at IS NULL;

-- The expandable history under a Recurring Task: its completed occurrences,
-- most recently completed first.
CREATE INDEX task_occurrences_history
    ON task_occurrences (task_id, completed_at DESC);
