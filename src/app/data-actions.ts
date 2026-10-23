import { requireProfile, requireStore, useApp } from "../state/app";
import { flushSettings } from "../state/settings";
import {
  buildExportFile,
  exportFileName,
  parseExportFile,
  summarizeExport,
  type ExportSummary,
} from "../storage/export";
import {
  applyV1Import,
  parseV1Progress,
  planV1Import,
  type V1ImportPlan,
} from "../storage/import-v1";
import { backupDb, type BackupReason } from "../storage/native";
import type { ExportFile } from "../storage/schemas";
import type { ImportMode, ImportResult } from "../storage/store";
import { openTextFile, saveTextFile } from "./files";
import { deleteProfile, newId, reloadCurrentProfile } from "./session";
import { APP_VERSION } from "./version";

/** Settings → Data actions (SPEC §9.5, §9.6). UI lives in features/settings/DataSection. */

const JSON_FILTER = { name: "Morse Trainer export", extensions: ["json"] };

/** Backs up the database before a destructive change. Skipped only for the in-memory store. */
async function safetyBackup(reason: BackupReason): Promise<string | null> {
  if (requireStore().kind !== "sqlite") return null;
  return backupDb(reason);
}

export type ExportScope = "current" | "all";

/** Returns where the file was saved, or null if the user cancelled. */
export async function exportData(scope: ExportScope): Promise<string | null> {
  await flushSettings();
  const store = requireStore();
  const current = requireProfile();
  const ids = scope === "current" ? [current.id] : useApp.getState().profiles.map((p) => p.id);
  const file = buildExportFile(await store.exportProfiles(ids), APP_VERSION, Date.now());
  const name = exportFileName(scope === "current" ? current.name : "all-profiles", new Date());
  return saveTextFile("Export progress", name, JSON.stringify(file), JSON_FILTER);
}

export interface PendingImport {
  file: ExportFile;
  summary: ExportSummary;
}

/** Opens and validates an export file. Throws ImportFileError with the reason. */
export async function pickImportFile(): Promise<PendingImport | null> {
  const text = await openTextFile("Import progress", JSON_FILTER);
  if (text === null) return null;
  const file = parseExportFile(text);
  return { file, summary: summarizeExport(file) };
}

export interface ImportOutcome extends ImportResult {
  backup: string | null;
}

export async function runImport(file: ExportFile, mode: ImportMode): Promise<ImportOutcome> {
  await flushSettings();
  // Replace wipes everything, so the database is backed up first (SPEC §9.5).
  const backup = mode === "replace" ? await safetyBackup("replace-import") : null;
  const result = await requireStore().importProfiles(file.profiles, mode);
  await reloadCurrentProfile();
  return { ...result, backup };
}

export function planV1(text: string): V1ImportPlan {
  return planV1Import(parseV1Progress(text), requireProfile().id, Date.now(), newId);
}

export async function runV1Import(plan: V1ImportPlan): Promise<void> {
  await flushSettings();
  await applyV1Import(requireStore(), requireProfile(), plan, Date.now());
  await reloadCurrentProfile();
}

export async function rebuildStats(): Promise<void> {
  await requireStore().rebuildCharStats(requireProfile().id);
}

export async function resetProgress(): Promise<string | null> {
  const backup = await safetyBackup("reset");
  await requireStore().resetProgress(requireProfile().id);
  await reloadCurrentProfile();
  return backup;
}

export async function deleteCurrentProfile(): Promise<string | null> {
  const backup = await safetyBackup("reset");
  await deleteProfile(requireProfile().id);
  return backup;
}
