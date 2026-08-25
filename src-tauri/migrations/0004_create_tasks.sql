-- A Task is a first-class record beside a Note, never a kind or state of one —
-- see docs/adr/0014-tasks-are-first-class-work-commitments.md. Its own table
-- says so in the schema: nothing here joins to `notes`, and no column of
-- `notes` is touched.
CREATE TABLE tasks (
    id TEXT PRIMARY KEY NOT NULL,
    -- The required single line that says what the Task is. Trimmed at the ends
    -- and otherwise verbatim; duplicates are ordinary, so nothing is unique
    -- here but the identifier.
    description TEXT NOT NULL,
    -- The immutable instant the Task came into existence. UTC ISO-8601, like
    -- every other instant in the file. Orders Unscheduled Tasks newest first.
    created_at TEXT NOT NULL,
    -- When the commitment was completed, or NULL while it is still Open.
    -- Reopening clears it, which is the whole of what reopening is.
    completed_at TEXT
);

-- The two reads Tasks View makes: the Open ones newest created first, and the
-- Completed ones newest completed first.
CREATE INDEX tasks_created_at ON tasks (created_at DESC);
CREATE INDEX tasks_completed_at ON tasks (completed_at DESC);
