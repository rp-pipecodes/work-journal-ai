-- A Note now comes into existence one of exactly two ways: a Capture or an
-- Import — see docs/adr/0010-notes-have-two-origins.md. Existing rows were all
-- typed, which is what the default says.
ALTER TABLE notes ADD COLUMN origin TEXT NOT NULL DEFAULT 'capture'
    CHECK (origin IN ('capture', 'import'));

-- Which meetings have already been handled, remembered separately from the
-- Notes on purpose: deleting an Imported Note refuses its meeting for good, and
-- an id kept on the Note would be destroyed by the very deletion that has to be
-- remembered. Rows are written on Import and never removed.
CREATE TABLE imported_meetings (
    -- One occurrence of one calendar event: a recurring meeting shares its
    -- event identifier across every occurrence, so the instant it began is part
    -- of the identity.
    event_key TEXT PRIMARY KEY NOT NULL,
    -- When the sweep handled it. Never read by the app; it is here so a human
    -- reading the file can tell when a refusal was recorded.
    handled_at TEXT NOT NULL
);
