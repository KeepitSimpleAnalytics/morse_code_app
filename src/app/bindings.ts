import { usePlayerStore, type PlayerState } from "../features/player/store";
import { addNotice, errorText, useApp } from "../state/app";
import { useNavStore } from "../state/nav";
import { useSettings } from "../state/settings";
import type { SettingKey } from "../state/settings-schema";
import { THEME_PREFERENCES, useThemeStore, type ThemePreference } from "../state/theme";

/**
 * Keeps feature stores and settings in sync once a profile is open:
 * Player fields and the current screen are saved as settings, the theme is an
 * app-level meta value, and display settings drive the document root.
 * Returns a disposer.
 */

export const THEME_META_KEY = "app.theme";

const PLAYER_FIELDS = {
  text: "player.text",
  speeds: "player.speeds",
  toneHz: "player.toneHz",
  volume: "player.volume",
  riseMs: "player.riseMs",
  codeFormat: "player.codeFormat",
  wordSep: "player.wordSep",
  loop: "player.loop",
} as const satisfies Partial<Record<keyof PlayerState, SettingKey>>;

const ready = () => useApp.getState().phase === "ready";

export function bindAppState(doc: Document): () => void {
  const unsubs = [
    usePlayerStore.subscribe((s, prev) => {
      if (!ready()) return;
      const settings = useSettings.getState();
      for (const [field, key] of Object.entries(PLAYER_FIELDS) as [
        keyof typeof PLAYER_FIELDS,
        (typeof PLAYER_FIELDS)[keyof typeof PLAYER_FIELDS],
      ][]) {
        if (s[field] !== prev[field] && s[field] !== settings.values[key]) {
          settings.set(key, s[field]);
        }
      }
    }),

    useNavStore.subscribe((s, prev) => {
      if (ready() && s.screen !== prev.screen) useSettings.getState().set("nav.screen", s.screen);
    }),

    useThemeStore.subscribe((s, prev) => {
      const store = useApp.getState().store;
      if (!store || s.preference === prev.preference) return;
      store.setMeta(THEME_META_KEY, s.preference).catch((err: unknown) => {
        addNotice("danger", `The theme couldn't be saved: ${errorText(err)}`);
      });
    }),

    useSettings.subscribe((s) => {
      applyDisplay(doc, s.values["display.fontScale"], s.values["display.reduceMotion"]);
    }),
  ];
  const { values } = useSettings.getState();
  applyDisplay(doc, values["display.fontScale"], values["display.reduceMotion"]);
  return () => {
    for (const u of unsubs) u();
  };
}

function applyDisplay(doc: Document, fontScale: number, reduceMotion: boolean): void {
  doc.documentElement.style.fontSize = `${Math.round(fontScale * 100)}%`;
  doc.documentElement.dataset.reduceMotion = String(reduceMotion);
}

export function parseThemePreference(raw: string | null): ThemePreference | null {
  return THEME_PREFERENCES.find((p) => p === raw) ?? null;
}
