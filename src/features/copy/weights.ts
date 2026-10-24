import { adaptiveWeights, type CharStat, type WeightContext } from "../../core/adaptive";
import type { Store } from "../../storage/store";

/**
 * Adaptive weights (SPEC §8.3) from the profile's char_stats, the same way in
 * every mode that draws characters (Koch, Random Groups, ICR).
 */

/**
 * Start of the third most recent session, or null with fewer than three. A
 * character not seen since then gets the recency bonus.
 */
export async function recentSessionsSince(store: Store, profileId: string): Promise<number | null> {
  const recent = await store.listSessions(profileId, 3);
  return recent.length >= 3 ? (recent[2]?.startedAt ?? null) : null;
}

export async function loadWeights(
  store: Store,
  profileId: string,
  chars: readonly string[],
  mode: WeightContext["mode"],
): Promise<Map<string, number>> {
  const rows = await store.getCharStats(profileId);
  const stats = new Map<string, CharStat>(rows.map((r) => [r.ch, r] as const));
  return adaptiveWeights(chars, stats, {
    mode,
    recentSessionsSince: await recentSessionsSince(store, profileId),
  });
}
