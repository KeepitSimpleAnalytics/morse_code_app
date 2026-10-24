import { requireStore } from "../../state/app";
import type { TrialRecord } from "../../storage/store";

/**
 * Writes a trial (§9.4). If an earlier attempt reported failure but did commit,
 * a retry hits the same id: that trial is already saved, so it counts as success.
 */
export async function saveTrial(record: TrialRecord): Promise<void> {
  const db = requireStore();
  try {
    await db.recordTrial(record);
  } catch (err) {
    const saved = await db.listTrials(record.trial.sessionId).catch(() => []);
    if (saved.some((x) => x.id === record.trial.id)) return;
    throw err;
  }
}
