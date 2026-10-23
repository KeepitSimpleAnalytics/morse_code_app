mod backup;
mod db;

use std::path::PathBuf;

use backup::{BACKUP_DIR, BackupInfo, DB_URL, StartupReport};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // Single-instance must be the first plugin registered (SPEC §10.1).
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            focus_main_window(app);
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build());

    builder
        .plugin(tauri_plugin_fs::init())
        // Paths chosen in a save/open dialog are added to the fs scope by the dialog
        // plugin itself (plugins/dialog/src/commands.rs), so the capability only
        // pre-authorizes $APPDATA.
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::new()
                .add_migrations(DB_URL, migrations())
                .build(),
        )
        .setup(|app| {
            // Runs before the frontend loads, so before the plugin opens the database.
            let report = match data_dir(app.handle()) {
                Ok(dir) => {
                    let now = chrono::Local::now();
                    tauri::async_runtime::block_on(backup::on_startup(
                        &dir,
                        &now.format("%Y%m%d-%H%M%S").to_string(),
                        &now.format("%Y%m%d").to_string(),
                    ))
                }
                Err(e) => StartupReport {
                    errors: vec![e],
                    ..Default::default()
                },
            };
            for e in &report.errors {
                eprintln!("startup: {e}");
            }
            app.manage(report);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            startup_report,
            db_path,
            backup_db,
            list_backups,
            restore_backup,
            db::db_transaction
        ])
        .run(tauri::generate_context!())
        .expect("error while running Morse Trainer");
}

fn migrations() -> Vec<Migration> {
    let list = vec![Migration {
        version: 1,
        description: "init",
        sql: include_str!("../migrations/0001_init.sql"),
        kind: MigrationKind::Up,
    }];
    debug_assert_eq!(
        list.last().map(|m| m.version),
        Some(backup::LATEST_MIGRATION)
    );
    list
}

/// The folder the SQL plugin keeps the database in. The plugin resolves
/// `sqlite:` URLs against `app_config_dir`, which on Windows and macOS is the
/// same folder as `app_data_dir` (SPEC §9.1).
fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|e| format!("finding the app data folder: {e}"))
}

#[tauri::command]
fn startup_report(report: State<'_, StartupReport>) -> StartupReport {
    report.inner().clone()
}

#[tauri::command]
fn db_path(app: AppHandle) -> Result<String, String> {
    Ok(data_dir(&app)?
        .join(backup::DB_FILE)
        .to_string_lossy()
        .into_owned())
}

#[tauri::command]
async fn backup_db(app: AppHandle, reason: String) -> Result<String, String> {
    if !matches!(reason.as_str(), "manual" | "replace-import" | "reset") {
        return Err(format!("unknown backup reason {reason:?}"));
    }
    let dir = data_dir(&app)?;
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    let path = backup::backup(&dir.join(backup::DB_FILE), &dir.join(BACKUP_DIR), &stamp).await?;
    eprintln!("backup ({reason}): {}", path.display());
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn list_backups(app: AppHandle) -> Result<Vec<BackupInfo>, String> {
    backup::list_backups(&data_dir(&app)?.join(BACKUP_DIR))
}

/// Stages the restore. The frontend then relaunches the app, and the swap happens
/// at startup before the database is opened.
#[tauri::command]
async fn restore_backup(app: AppHandle, path: String) -> Result<(), String> {
    backup::stage_restore(&data_dir(&app)?, &PathBuf::from(path)).await
}

/// A second launch brings the existing window forward instead of opening another.
#[cfg(desktop)]
fn focus_main_window(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        eprintln!("single-instance: main window not found");
        return;
    };
    for (step, result) in [
        ("unminimize", window.unminimize()),
        ("show", window.show()),
        ("set_focus", window.set_focus()),
    ] {
        if let Err(err) = result {
            eprintln!("single-instance: {step} failed: {err}");
        }
    }
}
