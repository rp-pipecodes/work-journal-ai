//! Backup: a snapshot of the journal's SQLite file itself, so the journal is
//! never only as durable as the one file it lives in. What a Backup is, and
//! why `VACUUM INTO` and never a file copy, is
//! docs/adr/0032-a-backup-is-a-sqlite-snapshot-taken-with-vacuum-into.md;
//! restoring one is #161 and not here.
//!
//! Everything in this module is narrow and Tauri-free: filenames, due and
//! prune arithmetic, and one snapshot through a `SqlitePool`. The command and
//! the startup hook in `lib.rs` hand it what it needs; nothing here reaches
//! for the app.

use serde::Serialize;
use sqlx::SqlitePool;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// How long a snapshot waits before the next one is worth taking. A constant,
/// not a setting: the journal is tens of kilobytes, so the interval costs
/// nothing and asks nothing of the user.
pub const SNAPSHOT_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);

/// How many snapshots are kept. Oldest pruned past this, and nothing else in
/// the directory is ever touched.
pub const RETAINED_SNAPSHOTS: usize = 30;

/// The stem every snapshot is named with, and the only name pruning will
/// touch. An unrelated file in the backups directory parses as nothing and is
/// left exactly where it is.
const FILE_STEM: &str = "work-journal";

/// The extension a snapshot carries: a backup is a SQLite file, not a
/// document.
const FILE_EXTENSION: &str = "db";

/// What Settings says about the automatic backups: how many there are, and
/// when the newest was taken. Null when there are none — a first run, or a
/// directory the user emptied.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomaticBackups {
    pub count: u32,
    /// The instant the newest snapshot was taken, as epoch seconds, or null.
    pub newest_taken_at: Option<i64>,
}

/// The filename a snapshot of `instant` carries: `work-journal-` plus the
/// instant in UTC, second-precise, plus `.db` —
/// `work-journal-20260903T084500.db`. UTC rather than local, so the name is
/// stable against timezone changes and sorts with its own instant.
pub fn snapshot_file_name(instant: SystemTime) -> String {
    let seconds = instant
        .duration_since(UNIX_EPOCH)
        .map(|since| since.as_secs())
        .unwrap_or(0);
    format!("{FILE_STEM}-{}.{FILE_EXTENSION}", timestamp(seconds))
}

/// Reads a snapshot's instant back out of its name, and nothing else: a file
/// that is not a snapshot's name — including a neighbour's export, or a
/// snapshot renamed by hand — is not one, and pruning never touches it.
pub fn snapshot_instant(file_name: &str) -> Option<SystemTime> {
    let (stem, extension) = split_extension(file_name)?;
    if extension != FILE_EXTENSION {
        return None;
    }

    let stamped = stem.strip_prefix(FILE_STEM)?;
    let stamped = stamped.strip_prefix('-')?;
    let seconds = parse_timestamp(stamped)?;
    Some(UNIX_EPOCH + Duration::from_secs(seconds))
}

/// The name a destination from the save dialog is reined back to: the chosen
/// name only, refusing anything that is a path — the dialog already asked
/// where, and this side never climbs a directory tree it was handed. A
/// destination that would clobber a directory rather than a file is not a
/// plain file name either.
pub fn plain_destination(destination: &str) -> Option<String> {
    let candidate = Path::new(destination);
    if candidate.file_name() == Some(candidate.as_os_str()) && !destination.trim().is_empty() {
        return Some(candidate.to_string_lossy().into_owned());
    }
    None
}

/// The whole automatic pass: whether a snapshot is due given what is already
/// in `directory`, and — once one has been taken — which files to prune.
/// Split rather than one function so a caller that took no snapshot prunes
/// nothing.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Automatic {
    /// Whether the interval has passed since the newest snapshot, or there
    /// are none yet: take one.
    pub due: bool,
    /// What the directory holds after the pass: count and newest instant,
    /// for Settings to say.
    pub status: AutomaticBackups,
}

/// Decides, from the directory's listing and a clock, whether a snapshot is
/// due and what the automatic backups look like right now. Unrelated files
/// are invisible to this: they are not snapshots, so they neither delay one
/// nor count as one.
pub fn automatic(directory: &Path, now: SystemTime) -> Automatic {
    let snapshots = listed_snapshots(directory);
    let status = status_of(&snapshots);

    let due = match snapshots.first() {
        Some(newest) => match newest.instant {
            Some(taken) => now
                .duration_since(taken)
                .is_ok_and(|age| age >= SNAPSHOT_INTERVAL),
            // A snapshot whose name cannot be read is a snapshot gone wrong;
            // taking a fresh one over it is the recovery.
            None => true,
        },
        None => true,
    };

    Automatic { due, status }
}

/// Which snapshots to prune once a new one is safely on disk: all but the
/// newest N, oldest first. Only files that parse as snapshots are ever
/// returned, so an unrelated file in the directory is left alone.
pub fn prunable(directory: &Path) -> Vec<PathBuf> {
    // Counted by what is a snapshot, not by what is in the directory: the
    // limit is on backups, and a neighbour that is not one is outside the
    // arithmetic entirely.
    let mut snapshots: Vec<Listed> = listed_snapshots(directory)
        .into_iter()
        .filter(|listed| listed.instant.is_some())
        .collect();
    if snapshots.len() <= RETAINED_SNAPSHOTS {
        return Vec::new();
    }

    // Oldest first, so pruning walks down from the edge of retention.
    snapshots.reverse();
    snapshots
        .into_iter()
        .skip(RETAINED_SNAPSHOTS)
        .filter_map(|snapshot| snapshot.path)
        .collect()
}

/// Takes a snapshot of `source` into `destination` through the pool the
/// journal is already served from — one statement, no second connection.
///
/// The destination is bound, never interpolated: `VACUUM INTO ?`. A snapshot
/// opens, passes `quick_check`, and carries every journal table including
/// `_sqlx_migrations`, whether the source runs WAL or rollback-journal.
pub async fn take_snapshot(destination: &Path, pool: &SqlitePool) -> Result<(), String> {
    let destination = destination.to_string_lossy().into_owned();
    sqlx::query("VACUUM INTO ?")
        .bind(destination)
        .execute(pool)
        .await
        .map_err(|error| format!("the snapshot could not be written: {error}"))?;
    Ok(())
}

/// Reads what Settings says about the automatic backups, out of the live
/// directory: how many snapshots are there, and when the newest was taken.
pub fn automatic_backups(directory: &Path) -> AutomaticBackups {
    status_of(&listed_snapshots(directory))
}

/// One file in the backups directory, as far as this module can read it.
struct Listed {
    path: Option<PathBuf>,
    instant: Option<SystemTime>,
}

/// Every snapshot in `directory`, newest first. A file whose name does not
/// parse — including a file that is not a snapshot at all — is carried with
/// `path` and `instant` both null when it is there at all: it must neither be
/// counted as a snapshot nor pruned, and `prunable` uses the null path to
/// drop it. Unparsable names sort oldest so a retention pass takes them
/// first.
fn listed_snapshots(directory: &Path) -> Vec<Listed> {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return Vec::new();
    };

    let mut listed: Vec<Listed> = entries
        .filter_map(|entry| entry.ok())
        .map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let instant = snapshot_instant(&name);
            Listed {
                instant,
                path: instant.map(|_| entry.path()),
            }
        })
        // A directory cannot hold two files of one name, so an instant that
        // parses is on disk exactly once — and the None sort key must never
        // compare as greater than a real instant, or an unparsable neighbour
        // would read as the newest backup in the directory.
        .collect();

    listed.sort_by(|a, b| match (&a.instant, &b.instant) {
        (Some(a), Some(b)) => b.cmp(a),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => std::cmp::Ordering::Equal,
    });
    listed
}

/// Count and newest, for the one line Settings says about the automatics.
fn status_of(snapshots: &[Listed]) -> AutomaticBackups {
    AutomaticBackups {
        count: snapshots.iter().filter(|listed| listed.instant.is_some()).count() as u32,
        newest_taken_at: snapshots.first().and_then(|newest| {
            newest
                .instant
                .and_then(|instant| instant.duration_since(UNIX_EPOCH).ok())
                .map(|since| since.as_secs() as i64)
        }),
    }
}

/// `YYYYMMDDTHHMMSS`, in the calendar-agnostic arithmetic UTC makes honest.
fn timestamp(seconds: u64) -> String {
    let (year, month, day, hour, minute, second) = civil_from_seconds(seconds);
    format!("{year:04}{month:02}{day:02}T{hour:02}{minute:02}{second:02}")
}

/// Reads one of the above back, refusing anything that is not exactly it.
fn parse_timestamp(stamped: &str) -> Option<u64> {
    let bytes = stamped.as_bytes();
    if bytes.len() != 15 || bytes[8] != b'T' {
        return None;
    }
    for (at, byte) in bytes.iter().enumerate() {
        let digit = if at == 8 { continue } else { byte.is_ascii_digit() };
        if !digit {
            return None;
        }
    }

    let number = |from: usize, to: usize| stamped.get(from..to)?.parse::<u64>().ok();
    let year = number(0, 4)?;
    let month = number(4, 6)?;
    let day = number(6, 8)?;
    let hour = number(9, 11)?;
    let minute = number(11, 13)?;
    let second = number(13, 15)?;

    if !(1..=12).contains(&month) || !(1..=31).contains(&day) || hour > 23 || minute > 59 || second > 59 {
        return None;
    }

    Some(seconds_from_civil(year, month, day, hour, minute, second))
}

fn split_extension(file_name: &str) -> Option<(&str, &str)> {
    let (stem, extension) = file_name.rsplit_once('.')?;
    if stem.is_empty() || extension.is_empty() {
        return None;
    }
    Some((stem, extension))
}

/// Days-from-civil and back again (Howard Hinnant's algorithms): the civil
/// calendar read straight off a Unix second, with no timezone in between —
/// UTC is the point of the name, so the conversion is exact arithmetic and
/// no dependency.
fn civil_from_seconds(seconds: u64) -> (i64, u64, u64, u64, u64, u64) {
    let days = (seconds / 86_400) as i64;
    let rest = seconds % 86_400;
    let (year, month, day) = civil_from_days(days);
    (
        year,
        month,
        day,
        rest / 3_600,
        (rest % 3_600) / 60,
        rest % 60,
    )
}

/// The proleptic Gregorian civil date of a count of days since the epoch.
fn civil_from_days(z: i64) -> (i64, u64, u64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u64;
    let month = if mp < 10 { (mp + 3) as u64 } else { (mp - 9) as u64 };
    (
        if month <= 2 { y + 1 } else { y },
        month,
        day,
    )
}

/// The count of days since the epoch of a civil date — the inverse above.
fn days_from_civil(year: i64, month: u64, day: u64) -> i64 {
    let y = year - if month <= 2 { 1 } else { 0 };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = if month > 2 { month as i64 - 3 } else { month as i64 + 9 };
    let doy = (153 * mp + 2) / 5 + day as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn seconds_from_civil(year: u64, month: u64, day: u64, hour: u64, minute: u64, second: u64) -> u64 {
    let days = days_from_civil(year as i64, month, day);
    (days as u64) * 86_400 + hour * 3_600 + minute * 60 + second
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    /// Runs one async test on its own single-threaded runtime: the runtime is
    /// only the shape an async test takes here, not something the module
    /// depends on — tokio is already in the tree through tauri and sqlx.
    macro_rules! async_test {
        ($name:ident, $body:block) => {
            #[test]
            fn $name() {
                tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .expect("could not start a runtime")
                    .block_on(async { $body });
            }
        };
    }

    /// A directory of this run's own, removed when the test is done with it.
    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new(name: &str) -> Self {
            // Tests run in parallel and share one process, so the name alone
            // is not enough to own a directory: a counter makes every call's
            // directory its own.
            use std::sync::atomic::{AtomicU64, Ordering};
            static CALLS: AtomicU64 = AtomicU64::new(0);
            let call = CALLS.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!("work-journal-backup-{name}-{call}"));
            let _ = std::fs::remove_dir_all(&path);
            std::fs::create_dir_all(&path).expect("could not make a temporary directory");
            TempDir { path }
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    /// A journal-shaped database with one row in it, so a snapshot has
    /// something to carry and a `quick_check` is worth running.
    async fn seeded_journal(mode: &str) -> (TempDir, SqlitePool) {
        // Its own subdirectory: `VACUUM INTO` refuses to create a directory
        // on the way, so wherever a snapshot goes, the caller has made.
        let directory = TempDir::new("mode");
        let url = format!("sqlite:{}/journal.db?mode=rwc", directory.path.display());
        let pool = SqlitePool::connect(&url).await.expect("could not open the source");

        sqlx::query(&format!("PRAGMA journal_mode = {mode}"))
            .execute(&pool)
            .await
            .expect("could not set the journal mode");

        sqlx::query(
            "CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT NOT NULL);
             CREATE TABLE _sqlx_migrations (version BIGINT PRIMARY KEY, description TEXT NOT NULL);
             INSERT INTO notes VALUES ('n1', 'a Note');
             INSERT INTO _sqlx_migrations VALUES (6, 'task recurrence');",
        )
        .execute(&pool)
        .await
        .expect("could not seed the journal");

        (directory, pool)
    }

    /// The snapshot's own checks, run against the file rather than against
    /// the pool: it opens standalone, holds the rows, and passes
    /// `quick_check`.
    async fn assert_healthy_snapshot(destination: &Path) {
        let url = format!("sqlite:{}?mode=ro", destination.display());
        let snapshot = SqlitePool::connect(&url)
            .await
            .expect("the snapshot did not open standalone");

        let check: (String,) = sqlx::query_as("PRAGMA quick_check")
            .fetch_one(&snapshot)
            .await
            .expect("quick_check did not run");
        assert_eq!(check.0, "ok");

        let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM notes")
            .fetch_one(&snapshot)
            .await
            .expect("notes did not read back");
        assert_eq!(count, 1);

        let (migrations,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM _sqlx_migrations")
            .fetch_one(&snapshot)
            .await
            .expect("migrations did not read back");
        assert_eq!(migrations, 1);

        snapshot.close().await;
    }

    async_test!(a_snapshot_of_a_healthy_journal_opens_and_passes_quick_check, {
        let (_source, pool) = seeded_journal("delete").await;
        let directory = TempDir::new("healthy");
        let destination = directory.path.join("work-journal-20260903T084500.db");

        take_snapshot(&destination, &pool)
            .await
            .expect("the snapshot failed");

        assert_healthy_snapshot(&destination).await;
    });

    async_test!(a_snapshot_taken_while_a_write_transaction_is_open_is_consistent, {
        let (_source, pool) = seeded_journal("delete").await;
        let mut transaction = pool.begin().await.expect("could not begin");
        sqlx::query("INSERT INTO notes VALUES ('n2', 'uncommitted')")
            .execute(&mut *transaction)
            .await
            .expect("could not write in the transaction");

        let directory = TempDir::new("open-transaction");
        let destination = directory.path.join("work-journal-20260903T084500.db");
        take_snapshot(&destination, &pool)
            .await
            .expect("the snapshot failed");
        transaction.rollback().await.expect("could not roll back");

        // The snapshot is the journal as committed, not the transaction half
        // taken: one Note, the one that was committed before it began.
        let url = format!("sqlite:{}?mode=ro", destination.display());
        let snapshot = SqlitePool::connect(&url).await.expect("did not open");
        let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM notes")
            .fetch_one(&snapshot)
            .await
            .expect("did not read");
        assert_eq!(count, 1);
        snapshot.close().await;
    });

    async_test!(a_snapshot_works_from_a_wal_source, {
        let (_source, pool) = seeded_journal("wal").await;
        let directory = TempDir::new("wal");
        let destination = directory.path.join("work-journal-20260903T084500.db");

        take_snapshot(&destination, &pool)
            .await
            .expect("the snapshot failed");

        assert_healthy_snapshot(&destination).await;
    });

    async_test!(the_destination_is_bound_not_interpolated, {
        // The one thing a path with a quote in it proves: interpolated, this
        // statement breaks or worse; bound, the name is data and survives.
        let (_source, pool) = seeded_journal("delete").await;
        let directory = TempDir::new("quoted-path");
        let destination = directory.path.join("it's-2026's backup.db");

        take_snapshot(&destination, &pool)
            .await
            .expect("the snapshot failed");

        assert_healthy_snapshot(&destination).await;
    });

    async_test!(a_destination_that_is_a_directory_is_refused, {
        let (_source, pool) = seeded_journal("delete").await;
        let directory = TempDir::new("refuses-directory");

        let result = take_snapshot(&directory.path, &pool).await;

        assert!(result.is_err());
        // And the directory is still a directory — clobbered by nothing.
        assert!(directory.path.is_dir());
    });

    #[test]
    fn a_snapshot_name_carries_its_instant_and_reads_back_to_it() {
        // 2026-09-03T08:45:00Z — the instant the ADR names.
        let instant = UNIX_EPOCH + Duration::from_secs(1_788_425_100);
        let name = snapshot_file_name(instant);

        assert_eq!(name, "work-journal-20260903T084500.db");
        assert_eq!(snapshot_instant(&name), Some(instant));
    }

    #[test]
    fn every_instant_of_a_wide_range_round_trips_through_its_name() {
        // A day at a time across several years, the ends of months and a
        // leap day included — the arithmetic the name is built on has to
        // survive all of it, since pruning reads names, not mtimes.
        let start = 86_400; // 1970-01-02
        for days in 0..(365 * 60) {
            let instant = UNIX_EPOCH + Duration::from_secs((start + days * 86_400) as u64);
            assert_eq!(snapshot_instant(&snapshot_file_name(instant)), Some(instant));
        }
    }

    #[test]
    fn names_that_are_not_snapshots_read_back_as_nothing() {
        for name in [
            "work-journal.db",
            "work-journal-2.db",
            "export-20260903T084500.md",
            "work-journal-20260903T084500.md",
            "work-journal-20260903T0845.db",
            "work-journal-20261303T084500.db",
            "work-journal-20260903T084500",
            "",
        ] {
            assert!(snapshot_instant(name).is_none(), "{name} parsed as a snapshot");
        }
    }

    #[test]
    fn a_destination_that_is_a_path_is_refused() {
        for destination in ["../escaped.db", "nested/notes.db", "/tmp/notes.db", "  ", ""] {
            assert!(plain_destination(destination).is_none(), "{destination} is not plain");
        }
        // And what the dialog hands over — a bare name — is kept as itself.
        assert_eq!(
            plain_destination("work-journal-20260903T084500.db").as_deref(),
            Some("work-journal-20260903T084500.db")
        );
    }

    #[test]
    fn a_snapshot_is_due_past_the_interval_and_not_before() {
        let directory = TempDir::new("due-decision");
        let now = UNIX_EPOCH + Duration::from_secs(1_788_425_100);
        std::fs::write(
            directory.path.join(snapshot_file_name(now - SNAPSHOT_INTERVAL - Duration::from_secs(1))),
            "older than the interval",
        )
        .unwrap();

        assert!(automatic(&directory.path, now).due);

        std::fs::write(
            directory.path.join(snapshot_file_name(now - SNAPSHOT_INTERVAL + Duration::from_secs(1))),
            "newer than the interval",
        )
        .unwrap();

        assert!(!automatic(&directory.path, now).due);
    }

    #[test]
    fn an_empty_directory_is_always_due() {
        let directory = TempDir::new("due-empty");
        let now = UNIX_EPOCH + Duration::from_secs(1_788_425_100);

        let decision = automatic(&directory.path, now);

        assert!(decision.due);
        assert_eq!(decision.status.count, 0);
        assert_eq!(decision.status.newest_taken_at, None);
    }

    #[test]
    fn an_unreadable_snapshot_name_means_take_a_fresh_one() {
        let directory = TempDir::new("due-unreadable");
        let now = UNIX_EPOCH + Duration::from_secs(1_788_425_100);
        // A snapshot renamed by hand is no longer a snapshot; the interval
        // cannot be read off it, so the pass errs toward taking one.
        std::fs::write(directory.path.join("work-journal.db"), "not a snapshot name").unwrap();

        assert!(automatic(&directory.path, now).due);
    }

    #[test]
    fn retention_keeps_exactly_the_newest_n() {
        let directory = TempDir::new("prune");
        for seconds in 0..RETAINED_SNAPSHOTS + 5 {
            let instant = UNIX_EPOCH + Duration::from_secs(1_788_425_100 + seconds as u64);
            std::fs::write(directory.path.join(snapshot_file_name(instant)), "a snapshot").unwrap();
        }

        let pruned = prunable(&directory.path);

        // The five oldest go, the thirty newest stay, and what is named is
        // what is on disk — so the caller's deletes cannot miss.
        assert_eq!(pruned.len(), 5);
        for path in &pruned {
            assert!(path.exists(), "{} is not on disk", path.display());
        }
        // Pruning is the caller's delete; having done it, nothing more is
        // ever offered.
        for path in &pruned {
            std::fs::remove_file(path).unwrap();
        }
        assert!(prunable(&directory.path).is_empty());
    }

    #[test]
    fn retention_touches_nothing_but_snapshots() {
        let directory = TempDir::new("prune-unrelated");
        for seconds in 0..RETAINED_SNAPSHOTS + 2 {
            let instant = UNIX_EPOCH + Duration::from_secs(1_788_425_100 + seconds as u64);
            std::fs::write(directory.path.join(snapshot_file_name(instant)), "a snapshot").unwrap();
        }
        // The neighbours a user, or an export, put there.
        std::fs::write(directory.path.join("read-me-first.txt"), "unrelated").unwrap();
        std::fs::write(directory.path.join("work-journal.db"), "not a snapshot name").unwrap();

        let pruned = prunable(&directory.path);

        // Two over the limit means the two oldest *snapshots* go — and
        // neither neighbour is among them, whatever either is named.
        assert_eq!(pruned.len(), 2);
        for path in &pruned {
            let name = path.file_name().unwrap().to_string_lossy();
            assert_ne!(name, "read-me-first.txt");
            assert_ne!(name, "work-journal.db");
        }
        assert!(directory.path.join("read-me-first.txt").exists());
        assert!(directory.path.join("work-journal.db").exists());
    }

    #[test]
    fn the_automatic_status_counts_snapshots_and_names_the_newest() {
        let directory = TempDir::new("status");
        let older = UNIX_EPOCH + Duration::from_secs(1_788_425_100);
        let newer = UNIX_EPOCH + Duration::from_secs(1_788_425_200);
        std::fs::write(directory.path.join(snapshot_file_name(older)), "a").unwrap();
        std::fs::write(directory.path.join(snapshot_file_name(newer)), "b").unwrap();
        std::fs::write(directory.path.join("work-journal.db"), "not a snapshot").unwrap();

        let status = automatic_backups(&directory.path);

        // Two snapshots, not three: the file that is not one is not counted.
        assert_eq!(status.count, 2);
        assert_eq!(status.newest_taken_at, Some(1_788_425_100 + 100));
    }
}
