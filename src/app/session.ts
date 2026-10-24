import { resetKoch } from "../features/koch/controller";
import * as player from "../features/player/controller";
import { usePlayerStore } from "../features/player/store";
import { addNotice, errorText, requireStore, useApp } from "../state/app";
import { useNavStore } from "../state/nav";
import { flushSettings, loadSettings } from "../state/settings";
import { defaultSettings, hydrateSettings, type SettingsValues } from "../state/settings-schema";
import type { Profile } from "../storage/schemas";

/**
 * Profile lifecycle (SPEC §7.12): open the last-used profile, switch, create,
 * rename and delete. Everything per-profile is loaded here and nowhere else.
 */

export const PROFILE_COLORS = [
  "#e0622a",
  "#d9488f",
  "#7c5cd6",
  "#3b82f6",
  "#0f9d8a",
  "#4f9a2f",
  "#c99a06",
  "#8a6d5a",
] as const;

export const newId = (): string => crypto.randomUUID();

/** Copies saved Player settings and the last screen into their feature stores. */
function applyToFeatures(v: SettingsValues): void {
  player.stop();
  resetKoch();
  usePlayerStore.getState().set({
    text: v["player.text"],
    speeds: v["player.speeds"],
    toneHz: v["player.toneHz"],
    volume: v["player.volume"],
    riseMs: v["player.riseMs"],
    codeFormat: v["player.codeFormat"],
    wordSep: v["player.wordSep"],
    loop: v["player.loop"],
    startOffset: null,
    error: null,
    notice: null,
  });
  useNavStore.getState().go(v["nav.screen"]);
}

/** Makes `profile` current: closes sessions a crash left open, then loads its settings. */
export async function activateProfile(profile: Profile): Promise<void> {
  await flushSettings();
  const store = requireStore();
  const now = Date.now();
  await store.updateProfile(profile.id, { lastUsedAt: now });
  const closed = await store.closeAbandonedSessions(profile.id, now);
  const { values, invalid } = hydrateSettings(await store.getSettings(profile.id));

  loadSettings(values, (entries) => store.putSettings(profile.id, entries, Date.now()));
  applyToFeatures(values);
  useApp.setState({
    current: { ...profile, lastUsedAt: now },
    profiles: await store.listProfiles(),
    phase: "ready",
  });

  if (closed > 0) {
    addNotice(
      "info",
      closed === 1
        ? "A session that didn't finish last time was saved as incomplete."
        : `${closed} sessions that didn't finish were saved as incomplete.`,
    );
  }
  if (invalid.length > 0) {
    addNotice(
      "warning",
      `Some saved settings were invalid, so their defaults are in use until you change them: ${invalid
        .map((i) => `${i.key} (${i.message})`)
        .join("; ")}`,
    );
  }
}

export async function switchProfile(id: string): Promise<void> {
  const target = useApp.getState().profiles.find((p) => p.id === id);
  if (!target) throw new Error(`profile ${id} not found`);
  if (target.id === useApp.getState().current?.id) return;
  await activateProfile(target);
}

export async function createProfile(name: string, color: string): Promise<Profile> {
  const store = requireStore();
  const now = Date.now();
  const profile: Profile = {
    id: newId(),
    name: name.trim(),
    color,
    createdAt: now,
    lastUsedAt: now,
  };
  await store.createProfile(profile);
  await activateProfile(profile);
  return profile;
}

export async function updateCurrentProfile(patch: {
  name?: string;
  color?: string;
}): Promise<void> {
  const store = requireStore();
  const { current } = useApp.getState();
  if (!current) throw new Error("no profile is selected");
  const next = { ...patch, ...(patch.name === undefined ? {} : { name: patch.name.trim() }) };
  await store.updateProfile(current.id, next);
  useApp.setState({ current: { ...current, ...next }, profiles: await store.listProfiles() });
}

/** Deletes a profile. If it was current, opens the next one, or first run if none is left. */
export async function deleteProfile(id: string): Promise<void> {
  const store = requireStore();
  const wasCurrent = useApp.getState().current?.id === id;
  if (wasCurrent) {
    await flushSettings();
    loadSettings(defaultSettings(), null);
  }
  await store.deleteProfile(id);
  const profiles = await store.listProfiles();
  useApp.setState({ profiles });
  if (!wasCurrent) return;
  const next = profiles[0];
  if (next) await activateProfile(next);
  else useApp.setState({ current: null, phase: "first-run", onboarding: true });
}

/** Reloads the current profile from storage, e.g. after an import or reset. */
export async function reloadCurrentProfile(): Promise<void> {
  const store = requireStore();
  const profiles = await store.listProfiles();
  const currentId = useApp.getState().current?.id;
  const current = profiles.find((p) => p.id === currentId) ?? profiles[0];
  useApp.setState({ profiles });
  if (current) {
    // Pending edits belong to the data that was just replaced.
    loadSettings(defaultSettings(), null);
    await activateProfile(current);
  } else {
    useApp.setState({ current: null, phase: "first-run", onboarding: true });
  }
}

/** Writes pending settings; used on window close and when the window is hidden. */
export async function flushAll(): Promise<void> {
  try {
    await flushSettings();
  } catch (err) {
    addNotice("danger", `Saving failed: ${errorText(err)}`);
  }
}
