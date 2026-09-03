# A restore replaces the journal at startup from a validated snapshot, and keeps a rollback

A snapshot nobody has ever restored is not a backup — it is a file. #153 takes snapshots; this closes the loop, in the app rather than as "quit, replace the file, relaunch" in a document, because the in-app path is tested code and the document is not. Restore is deliberately the second, smaller half: it runs once, in a crisis, and everything expensive about it is the moment the live journal is replaced.

A restore replaces; it never reconciles. There is no merging of two journals, no parsing of Markdown back into records — an Export is not restorable and this never pretends otherwise — and no restoring of settings, the API Key, Hotkeys, login-item state or OS permissions. A snapshot holds the journal and nothing else (ADR 0032); restoring one returns the journal to an earlier whole, it does not undo one Note.

## Validation happens read-only, before anything is staged

A candidate is opened read-only and validated before anything is staged, and never opened with the app's own pool. Validation never writes to the file the user chose, and never mutates anything on a refusal. A refusal names which check failed.

A candidate must pass `PRAGMA quick_check`, hold every expected table for the schema version it claims, and carry a `_sqlx_migrations` version no newer than this build understands. The version boundary is the newest migration this build ships: an older snapshot is accepted and migrated forward by the existing immutable list (ADR 0009), while a newer one is refused before anything is touched. The table check is version-aware for the same reason — a version 5 snapshot cannot be expected to hold the version 6 occurrence table, or nothing old would ever be migratable. What is checked is that the tables the claimed version must have are there; a valid SQLite file that is not a journal, and a journal with a table missing for its version, are both refused.

## The replacement happens at startup, before plugin-sql opens

The replacement happens at startup, before plugin-sql opens, because that is the only moment nothing holds the file. A small plugin registered ahead of the sql plugin applies a staged file during build: when one is present it renames the live journal to the timestamped rollback path, removes the stale `-wal` and `-shm` sidecars — the restored file has its own history and applying the old journal's WAL to it is the corruption case — and renames the staged file into the exact path plugin-sql will open. Renames only, no copies, so a half-written journal is never the live one. If any step fails, the journal is left as it was and the failure is logged.

The previous journal is kept as a timestamped rollback file beside the live one, and is never deleted by the app. The rollback name carries its instant in the same UTC stamp the snapshots use, so it sorts with its own instant and opens in `sqlite3` directly. Staging is a copy of a validated candidate into the staged path; applying it is the two renames above. Choosing a location and acting on it are two Desktop operations sequenced by the frontend (`chooseRestoreCandidate`, `stageRestore`), per the `installUpdate` / `restart` precedent: a cancelled dialog stages nothing and is not an error, and the path arriving over IPC is trusted for nothing because validation already refuses anything that is not a readable journal snapshot at a supported version.

## Restore ends in a restart, and the user is told so before they confirm

Restore ends in a restart, and the user is told so before they confirm. The confirmation says, before the user commits: the current journal is replaced, the previous one is kept as a rollback file, the app restarts, and the API Key, Hotkeys and settings are not restored. On success the user is told a restart is happening and the app restarts — as with the updater, the message is on screen before the webview goes away.

## No in-progress marker and no automatic rollback on failed startup

There is no in-progress marker and no automatic rollback on failed startup. This is the most contestable decision here, so it is written as one: the candidate was validated with `quick_check`, the expected tables and the migration boundary before staging, so the case that machinery guards — a staged file that cannot open — is already excluded at the only moment it can be excluded cheaply. The machinery would buy protection against the remaining case, a journal that validates and still fails to start, at the cost of a state machine that itself can fail halfway and must then be reasoned about in a crisis. The cost of not having it is named: when that case happens, the rollback file is on disk under its documented name beside the live journal and the recovery is one rename, done by hand. A marker would not make that recovery automatic, only less obvious.

## Considered options

- **Replace the live file while the app runs.** Rejected: plugin-sql holds the file open, so the only safe moment is before it opens.
- **Copy rather than rename into place.** Rejected: a copy can leave a half-written file as the live one; two renames cannot.
- **Merge the snapshot with the live journal.** Rejected: a restore returns the journal to an earlier whole, and reconciling two journals is a different product.
- **Automatic rollback when the restored journal fails to start.** Rejected, as above: the validated-before-staging check already excludes the case, and the fallback is one documented rename rather than a second mechanism to distrust in a crisis.

## Consequences

- **Every future migration raises the version boundary a restore refuses on, and must keep older snapshots migratable.** The boundary is the newest migration this build ships; review attention belongs on the order of the two renames and the sidecar removal, which is the whole safety argument.
- **Deletion stays permanent.** A restore returns the journal to an earlier whole; it does not undo one Note.
- **The dialog needs `dialog:allow-open` beside `dialog:allow-save`, and no new dependency.** Choosing a candidate is an open dialog filtered to the backup extension; no path is ever hand-typed.
