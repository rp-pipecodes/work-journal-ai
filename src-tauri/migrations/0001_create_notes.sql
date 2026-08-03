-- A Note is the unit of everything: one dated line of text. There is
-- deliberately no status column and no source column — see
-- docs/adr/0001-defer-voice-capture-to-v2.md.
CREATE TABLE notes (
    -- Application-generated, so a Note has an identity before it is stored.
    id TEXT PRIMARY KEY NOT NULL,
    -- One line, never empty or whitespace-only.
    body TEXT NOT NULL CHECK (length(trim(body)) > 0),
    -- The instant the Note came into existence: UTC ISO-8601, never updated.
    captured_at TEXT NOT NULL,
    -- YYYY-MM-DD. Decided at capture as the local calendar day of Captured At,
    -- and never recomputed, so it survives a timezone change.
    journal_day TEXT NOT NULL,
    -- Null until the Body or the Journal Day is changed after capture.
    edited_at TEXT
);

-- Journal Day is the only column ever filtered on.
CREATE INDEX notes_journal_day ON notes (journal_day);
