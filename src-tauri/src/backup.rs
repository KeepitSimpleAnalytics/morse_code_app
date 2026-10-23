//! Database location, automatic backups and restore (SPEC §9.1, §9.5, §11).
//!
//! Backups are `VACUUM INTO` copies taken through a separate read-only connection,
//! so they are consistent even while the SQL plugin's pool is open. A restore is
//! staged next to the database and swapped in at the next launch, before the
//! plugin opens the file.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{ConnectOptions, Connection, Row};

pub const DB_FILE: &str = "morse-trainer.db";
/// Connection string passed to the SQL plugin and used by the frontend.
pub const DB_URL: &str = "sqlite:morse-trainer.db";
pub const BACKUP_DIR: &str = "backups";
pub const KEEP_BACKUPS: usize = 14;
/// Highest migration version this build ships (see `lib.rs`).
pub const LATEST_MIGRATION: i64 = 1;

const RESTORE_PENDING: &str = "morse-trainer.db.restore";
const PREFIX: &str = "morse-trainer-";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub path: String,
    pub file_name: String,
    pub size_bytes: u64,
    /// Local time from the file name, `YYYY-MM-DD HH:MM:SS`.
    pub taken_at: String,
}

/// What happened to the database before the frontend opened it.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupReport {
    pub db_path: String,
    pub restored: bool,
    pub backups: Vec<String>,
    /// Errors are reported to the user; they never stop the app from starting.
    pub errors: Vec<String>,
}

fn err(context: &str, e: impl std::fmt::Display) -> String {
    format!("{context}: {e}")
}

/// `morse-trainer-YYYYMMDD-HHMMSS[-N].db` → (`YYYYMMDD`, `HHMMSS`).
fn parse_backup_name(name: &str) -> Option<(&str, &str)> {
    let stem = name.strip_prefix(PREFIX)?.strip_suffix(".db")?;
    let (date, rest) = stem.split_once('-')?;
    let time = rest.split('-').next()?;
    let digits = |s: &str, n: usize| s.len() == n && s.bytes().all(|b| b.is_ascii_digit());
    if !digits(date, 8) || !digits(time, 6) {
        return None;
    }
    if let Some((_, n)) = rest.split_once('-')
        && !(1..=4).contains(&n.len())
    {
        return None;
    }
    Some((date, time))
}

/// Backups in `dir`, newest first.
pub fn list_backups(dir: &Path) -> Result<Vec<BackupInfo>, String> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(err("reading the backups folder", e)),
    };
    let mut out = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| err("reading the backups folder", e))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some((date, time)) = parse_backup_name(&name) else {
            continue;
        };
        let taken_at = format!(
            "{}-{}-{} {}:{}:{}",
            &date[0..4],
            &date[4..6],
            &date[6..8],
            &time[0..2],
            &time[2..4],
            &time[4..6]
        );
        let size_bytes = entry
            .metadata()
            .map_err(|e| err("reading a backup's size", e))?
            .len();
        out.push(BackupInfo {
            path: entry.path().to_string_lossy().into_owned(),
            file_name: name,
            size_bytes,
            taken_at,
        });
    }
    // Names sort chronologically; a same-second suffix sorts after its base name.
    out.sort_by(|a, b| b.file_name.cmp(&a.file_name));
    Ok(out)
}

/// Deletes all but the newest `keep` backups.
pub fn prune_backups(dir: &Path, keep: usize) -> Result<(), String> {
    for old in list_backups(dir)?.into_iter().skip(keep) {
        fs::remove_file(&old.path).map_err(|e| err(&format!("deleting {}", old.file_name), e))?;
    }
    Ok(())
}

fn read_only(db: &Path) -> SqliteConnectOptions {
    SqliteConnectOptions::new()
        .filename(db)
        .read_only(true)
        .create_if_missing(false)
}

/// Copies `db` into `dir` with `VACUUM INTO`, then prunes old backups.
pub async fn backup(db: &Path, dir: &Path, stamp: &str) -> Result<PathBuf, String> {
    fs::create_dir_all(dir).map_err(|e| err("creating the backups folder", e))?;
    let mut target = dir.join(format!("{PREFIX}{stamp}.db"));
    let mut n = 1;
    while target.exists() {
        target = dir.join(format!("{PREFIX}{stamp}-{n}.db"));
        n += 1;
    }
    let mut conn = read_only(db)
        .connect()
        .await
        .map_err(|e| err("opening the database for backup", e))?;
    sqlx::query("VACUUM INTO ?")
        .bind(target.to_string_lossy().into_owned())
        .execute(&mut conn)
        .await
        .map_err(|e| err("writing the backup", e))?;
    conn.close()
        .await
        .map_err(|e| err("closing the backup connection", e))?;
    prune_backups(dir, KEEP_BACKUPS)?;
    Ok(target)
}

/// The highest applied migration, or 0 for a database that was never migrated.
pub async fn applied_migration(db: &Path) -> Result<i64, String> {
    let mut conn = read_only(db)
        .connect()
        .await
        .map_err(|e| err("opening the database", e))?;
    let has_table = sqlx::query(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = '_sqlx_migrations'",
    )
    .fetch_one(&mut conn)
    .await
    .map_err(|e| err("reading the schema", e))?
    .get::<i64, _>(0)
        > 0;
    let version = if has_table {
        sqlx::query("SELECT COALESCE(MAX(version), 0) FROM _sqlx_migrations WHERE success = 1")
            .fetch_one(&mut conn)
            .await
            .map_err(|e| err("reading the schema version", e))?
            .get::<i64, _>(0)
    } else {
        0
    };
    conn.close()
        .await
        .map_err(|e| err("closing the database", e))?;
    Ok(version)
}

/// Checks that `file` is an intact Morse Trainer database before it replaces the live one.
pub async fn validate_backup(file: &Path) -> Result<(), String> {
    let mut conn = read_only(file)
        .connect()
        .await
        .map_err(|e| err("opening the backup", e))?;
    let check: String = sqlx::query("PRAGMA integrity_check")
        .fetch_one(&mut conn)
        .await
        .map_err(|e| err("checking the backup", e))?
        .get(0);
    let profiles = sqlx::query(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'profiles'",
    )
    .fetch_one(&mut conn)
    .await
    .map_err(|e| err("reading the backup's schema", e))?
    .get::<i64, _>(0);
    conn.close()
        .await
        .map_err(|e| err("closing the backup", e))?;
    if check != "ok" {
        return Err(format!("the backup is damaged ({check})"));
    }
    if profiles == 0 {
        return Err("the file is not a Morse Trainer database".into());
    }
    Ok(())
}

/// Stages `backup` to replace the database at the next launch.
pub async fn stage_restore(data_dir: &Path, backup: &Path) -> Result<(), String> {
    let backups = data_dir.join(BACKUP_DIR);
    let canonical = |p: &Path, what: &str| p.canonicalize().map_err(|e| err(what, e));
    let file = canonical(backup, "finding the backup")?;
    if file.parent() != Some(canonical(&backups, "finding the backups folder")?.as_path()) {
        return Err("only files in the backups folder can be restored".into());
    }
    let name = file.file_name().map(|n| n.to_string_lossy().into_owned());
    if name.as_deref().and_then(parse_backup_name).is_none() {
        return Err("that file is not a Morse Trainer backup".into());
    }
    validate_backup(&file).await?;
    fs::copy(&file, data_dir.join(RESTORE_PENDING)).map_err(|e| err("staging the restore", e))?;
    Ok(())
}

/// Swaps a staged restore in. Returns whether one was applied. The current
/// database is backed up first, so a restore can itself be undone.
pub async fn apply_pending_restore(
    data_dir: &Path,
    stamp: &str,
    report: &mut StartupReport,
) -> Result<bool, String> {
    let pending = data_dir.join(RESTORE_PENDING);
    if !pending.exists() {
        return Ok(false);
    }
    let db = data_dir.join(DB_FILE);
    if db.exists() {
        let saved = backup(&db, &data_dir.join(BACKUP_DIR), stamp).await?;
        report.backups.push(saved.to_string_lossy().into_owned());
    }
    for suffix in ["", "-wal", "-shm"] {
        let f = data_dir.join(format!("{DB_FILE}{suffix}"));
        if f.exists() {
            fs::remove_file(&f).map_err(|e| err(&format!("removing {DB_FILE}{suffix}"), e))?;
        }
    }
    fs::rename(&pending, &db).map_err(|e| err("moving the restored database into place", e))?;
    Ok(true)
}

/// Runs before the frontend opens the database: applies a staged restore, then
/// takes a backup if a migration is pending or none was taken today.
pub async fn on_startup(data_dir: &Path, stamp: &str, today: &str) -> StartupReport {
    let db = data_dir.join(DB_FILE);
    let backups = data_dir.join(BACKUP_DIR);
    let mut report = StartupReport {
        db_path: db.to_string_lossy().into_owned(),
        ..Default::default()
    };
    if let Err(e) = fs::create_dir_all(data_dir) {
        report.errors.push(err("creating the data folder", e));
        return report;
    }
    match apply_pending_restore(data_dir, stamp, &mut report).await {
        Ok(restored) => report.restored = restored,
        Err(e) => report.errors.push(format!("Restore failed: {e}")),
    }
    if !db.exists() {
        return report;
    }

    let reason = match applied_migration(&db).await {
        Ok(v) if v < LATEST_MIGRATION => Some("migration"),
        Ok(_) => None,
        Err(e) => {
            report.errors.push(e);
            None
        }
    };
    let reason = reason.or_else(|| match list_backups(&backups) {
        Ok(list)
            if list
                .iter()
                .any(|b| b.file_name[PREFIX.len()..].starts_with(today)) =>
        {
            None
        }
        Ok(_) => Some("daily"),
        Err(e) => {
            report.errors.push(e);
            None
        }
    });
    if let Some(reason) = reason {
        match backup(&db, &backups, stamp).await {
            Ok(path) => report.backups.push(path.to_string_lossy().into_owned()),
            Err(e) => report
                .errors
                .push(format!("Automatic {reason} backup failed: {e}")),
        }
    }
    report
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn make_db(path: &Path, with_migration: bool) {
        let mut conn = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .connect()
            .await
            .unwrap();
        sqlx::raw_sql(include_str!("../migrations/0001_init.sql"))
            .execute(&mut conn)
            .await
            .unwrap();
        sqlx::query("INSERT INTO profiles VALUES ('p1', 'Ann', '#fff', 1, 1)")
            .execute(&mut conn)
            .await
            .unwrap();
        if with_migration {
            sqlx::raw_sql(
                "CREATE TABLE _sqlx_migrations (version BIGINT PRIMARY KEY, success BOOLEAN);
                 INSERT INTO _sqlx_migrations VALUES (1, 1);",
            )
            .execute(&mut conn)
            .await
            .unwrap();
        }
        conn.close().await.unwrap();
    }

    fn names(dir: &Path) -> Vec<String> {
        list_backups(dir)
            .unwrap()
            .into_iter()
            .map(|b| b.file_name)
            .collect()
    }

    #[test]
    fn parses_only_backup_names() {
        assert_eq!(
            parse_backup_name("morse-trainer-20261023-091500.db"),
            Some(("20261023", "091500"))
        );
        assert!(parse_backup_name("morse-trainer-20261023-091500-2.db").is_some());
        assert!(parse_backup_name("morse-trainer.db").is_none());
        assert!(parse_backup_name("morse-trainer-2026-091500.db").is_none());
        assert!(parse_backup_name("other-20261023-091500.db").is_none());
    }

    #[tokio::test]
    async fn backs_up_daily_and_keeps_the_newest_14() {
        let tmp = tempfile::tempdir().unwrap();
        let data = tmp.path();
        make_db(&data.join(DB_FILE), true).await;

        let r = on_startup(data, "20261023-080000", "20261023").await;
        assert!(r.errors.is_empty(), "{:?}", r.errors);
        assert_eq!(r.backups.len(), 1);
        // Same day: no second backup.
        let r = on_startup(data, "20261023-090000", "20261023").await;
        assert!(r.backups.is_empty());

        for day in 1..=20 {
            let stamp = format!("202611{day:02}-080000");
            on_startup(data, &stamp, &stamp[..8]).await;
        }
        let kept = names(&data.join(BACKUP_DIR));
        assert_eq!(kept.len(), KEEP_BACKUPS);
        assert_eq!(kept[0], "morse-trainer-20261120-080000.db");
        assert_eq!(kept[13], "morse-trainer-20261107-080000.db");
    }

    #[tokio::test]
    async fn backs_up_before_a_pending_migration_even_on_the_same_day() {
        let tmp = tempfile::tempdir().unwrap();
        let data = tmp.path();
        make_db(&data.join(DB_FILE), false).await;
        on_startup(data, "20261023-080000", "20261023").await;
        let r = on_startup(data, "20261023-080000", "20261023").await;
        assert_eq!(r.backups.len(), 1);
        assert!(r.backups[0].ends_with("morse-trainer-20261023-080000-1.db"));
    }

    #[tokio::test]
    async fn fresh_install_takes_no_backup() {
        let tmp = tempfile::tempdir().unwrap();
        let r = on_startup(tmp.path(), "20261023-080000", "20261023").await;
        assert!(r.errors.is_empty() && r.backups.is_empty() && !r.restored);
    }

    #[tokio::test]
    async fn restore_swaps_the_backup_in_and_saves_the_current_database() {
        let tmp = tempfile::tempdir().unwrap();
        let data = tmp.path();
        let db = data.join(DB_FILE);
        make_db(&db, true).await;
        let saved = backup(&db, &data.join(BACKUP_DIR), "20261023-080000")
            .await
            .unwrap();

        // Change the live database after the backup.
        let mut conn = SqliteConnectOptions::new()
            .filename(&db)
            .connect()
            .await
            .unwrap();
        sqlx::query("DELETE FROM profiles")
            .execute(&mut conn)
            .await
            .unwrap();
        conn.close().await.unwrap();

        stage_restore(data, &saved).await.unwrap();
        let r = on_startup(data, "20261023-090000", "20261023").await;
        assert!(r.restored && r.errors.is_empty(), "{:?}", r.errors);
        assert_eq!(r.backups.len(), 1, "the replaced database is backed up");

        let mut conn = read_only(&db).connect().await.unwrap();
        let n: i64 = sqlx::query("SELECT COUNT(*) FROM profiles")
            .fetch_one(&mut conn)
            .await
            .unwrap()
            .get(0);
        assert_eq!(n, 1);
    }

    #[tokio::test]
    async fn refuses_to_restore_files_outside_the_backups_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let data = tmp.path();
        fs::create_dir_all(data.join(BACKUP_DIR)).unwrap();
        let outside = data.join("morse-trainer-20261023-080000.db");
        make_db(&outside, true).await;
        let e = stage_restore(data, &outside).await.unwrap_err();
        assert!(e.contains("backups folder"), "{e}");

        let junk = data
            .join(BACKUP_DIR)
            .join("morse-trainer-20261023-080000.db");
        fs::write(&junk, b"not a database").unwrap();
        assert!(stage_restore(data, &junk).await.is_err());
    }
}
