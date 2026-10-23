import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";

/** Rust commands for the database file and its backups (SPEC §11). */

export interface StartupReport {
  dbPath: string;
  restored: boolean;
  backups: string[];
  errors: string[];
}

export interface BackupInfo {
  path: string;
  fileName: string;
  sizeBytes: number;
  /** Local time, `YYYY-MM-DD HH:MM:SS`. */
  takenAt: string;
}

export type BackupReason = "manual" | "replace-import" | "reset";

export const startupReport = () => invoke<StartupReport>("startup_report");
export const dbPath = () => invoke<string>("db_path");
export const backupDb = (reason: BackupReason) => invoke<string>("backup_db", { reason });
export const listBackups = () => invoke<BackupInfo[]>("list_backups");

/** Stages the backup, then restarts the app; the swap happens before the database opens. */
export async function restoreBackupAndRelaunch(path: string): Promise<void> {
  await invoke("restore_backup", { path });
  await relaunch();
}
