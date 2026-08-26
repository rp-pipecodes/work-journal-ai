-- Scheduled For: the optional local calendar date a Task is meant to be acted
-- on, with an optional minute-precise wall-clock time. Stored as civil time
-- rather than as a UTC instant — see
-- docs/adr/0021-task-schedules-are-stored-as-civil-time.md — so "Monday at
-- 14:00" is still 14:00 after the user travels.
ALTER TABLE tasks ADD COLUMN scheduled_date TEXT;

-- `HH:mm`, and only ever alongside a date: the date is the prerequisite, and
-- clearing it clears this too. NULL is a date-only schedule, which never
-- implies a hidden default time and so never produces a Task Alert.
ALTER TABLE tasks ADD COLUMN scheduled_time TEXT;

-- Tasks View reads the Open ones in Scheduled For order, earliest first, with
-- the Unscheduled ones falling out of the same read.
CREATE INDEX tasks_scheduled_for ON tasks (scheduled_date, scheduled_time);
