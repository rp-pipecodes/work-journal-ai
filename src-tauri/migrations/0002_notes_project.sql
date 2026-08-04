-- Project is optional first-class filing beside Journal Day. NULL is Unfiled.
-- Identity is case-insensitive and stored lowercase; the name is letters,
-- digits, underscore or hyphen — see docs/adr/0007-project-is-first-class-filing.md.
ALTER TABLE notes ADD COLUMN project TEXT
    CHECK (
        project IS NULL
        OR (
            length(project) > 0
            AND project = lower(project)
            AND project NOT GLOB '*[^a-z0-9_-]*'
        )
    );

CREATE INDEX notes_project ON notes (project);
