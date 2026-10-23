import {
  EXPORT_FORMAT,
  EXPORT_FORMAT_VERSION,
  ExportFileSchema,
  type ExportFile,
  type ProfileData,
} from "./schemas";

/** Export / import file handling (SPEC §9.5). The Store does the database side. */

export class ImportFileError extends Error {
  override readonly name = "ImportFileError";
}

export function buildExportFile(
  profiles: ProfileData[],
  appVersion: string,
  now: number,
): ExportFile {
  return {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    appVersion,
    exportedAt: now,
    profiles,
  };
}

/** Checks that every record belongs to the profile it's listed under, and ids are unique. */
function integrityProblems(file: ExportFile): string[] {
  const problems: string[] = [];
  const profileIds = new Set<string>();
  const sessionIds = new Set<string>();
  const trialIds = new Set<string>();
  const eventIds = new Set<number>();
  for (const d of file.profiles) {
    const pid = d.profile.id;
    const label = `profile "${d.profile.name}"`;
    if (profileIds.has(pid)) problems.push(`${label} appears twice`);
    profileIds.add(pid);
    const foreign = (rows: readonly { profileId: string }[], what: string) => {
      if (rows.some((r) => r.profileId !== pid))
        problems.push(`${label}: ${what} of another profile`);
    };
    foreign(d.settings, "settings");
    foreign(d.sessions, "sessions");
    foreign(d.charEvents, "character events");
    foreign(d.kochProgress, "Koch progress");
    foreign(d.kochLevelHistory, "Koch history");
    foreign(d.snippets, "snippets");
    foreign(d.wordLists, "word lists");
    foreign(d.achievements, "achievements");
    const own = new Set(d.sessions.map((s) => s.id));
    for (const s of d.sessions) {
      if (sessionIds.has(s.id)) problems.push(`session ${s.id} appears twice`);
      sessionIds.add(s.id);
    }
    for (const t of d.trials) {
      if (!own.has(t.sessionId)) problems.push(`${label}: trial ${t.id} has no session`);
      if (trialIds.has(t.id)) problems.push(`trial ${t.id} appears twice`);
      trialIds.add(t.id);
    }
    for (const e of d.charEvents) {
      if (!own.has(e.sessionId)) problems.push(`${label}: character event ${e.id} has no session`);
      if (eventIds.has(e.id)) problems.push(`character event ${e.id} appears twice`);
      eventIds.add(e.id);
    }
    if (problems.length > 20) break;
  }
  return problems.slice(0, 20);
}

/** Parses and validates an export file. Every problem is reported; nothing is guessed. */
export function parseExportFile(text: string): ExportFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new ImportFileError(`The file isn't valid JSON (${(err as Error).message}).`);
  }
  if (typeof raw === "object" && raw !== null) {
    const { format, formatVersion } = raw as Record<string, unknown>;
    if (format !== EXPORT_FORMAT) {
      throw new ImportFileError("This isn't a Morse Trainer export file.");
    }
    if (typeof formatVersion === "number" && formatVersion > EXPORT_FORMAT_VERSION) {
      throw new ImportFileError(
        `The file was made by a newer version of Morse Trainer (format ${formatVersion}). Update the app to import it.`,
      );
    }
  }
  const result = ExportFileSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "file"}: ${i.message}`);
    throw new ImportFileError(`The file doesn't match the export format:\n${issues.join("\n")}`);
  }
  const problems = integrityProblems(result.data);
  if (problems.length > 0) {
    throw new ImportFileError(`The file is inconsistent:\n${problems.join("\n")}`);
  }
  return result.data;
}

export interface ExportSummary {
  profiles: { id: string; name: string; sessions: number }[];
  sessions: number;
  trials: number;
  snippets: number;
}

export function summarizeExport(file: ExportFile): ExportSummary {
  return {
    profiles: file.profiles.map((d) => ({
      id: d.profile.id,
      name: d.profile.name,
      sessions: d.sessions.length,
    })),
    sessions: file.profiles.reduce((n, d) => n + d.sessions.length, 0),
    trials: file.profiles.reduce((n, d) => n + d.trials.length, 0),
    snippets: file.profiles.reduce((n, d) => n + d.snippets.length, 0),
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "2 profiles, 340 sessions" (SPEC §9.5). */
export function describeSummary(s: ExportSummary): string {
  return `${plural(s.profiles.length, "profile")}, ${plural(s.sessions, "session")}`;
}

/** `morse-trainer-<who>-YYYY-MM-DD.json`, in local time. */
export function exportFileName(who: string, now: Date): string {
  const slug =
    who
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "profile";
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `morse-trainer-${slug}-${day}.json`;
}
