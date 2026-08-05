# An applied migration is immutable

A `.sql` file under `src-tauri/migrations/` is never edited once it has shipped — not the DDL, and not the comments either. sqlx records a SHA-384 of each migration as it applies it and refuses to run again when the file no longer hashes to what it stored, so a one-word comment fix in an old migration is indistinguishable from a rewritten schema: every existing install stops at that migration, later migrations never apply, and the app opens onto a database it cannot read.

This happened once. `3581f11` reworded a comment in `0001_create_notes.sql` to drop the Day Start (ADR 0005) from its description of `journal_day`; every database created before it — including the release install — then failed to take `0002_notes_project.sql`, which surfaced as a Capture that committed nothing and a History that could not be read. The file was restored to its original bytes, stale comment and all.

So a migration file reads as a record of what was run at the time, not as documentation of the schema as it now stands. Where the two diverge, `CONTEXT.md` and the ADRs are the ones that get corrected; a wrong comment in an old migration is left wrong. Changing the schema means a new migration, always.
