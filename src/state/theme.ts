import { create } from "zustand";

/** The themes in tokens.css (<html data-theme>), plus "system", which follows the OS light/dark. */
export const THEMES = ["dark", "light", "contrast", "night", "terminal"] as const;
export type ResolvedTheme = (typeof THEMES)[number];
export type ThemePreference = ResolvedTheme | "system";

export const THEME_PREFERENCES: readonly ThemePreference[] = [...THEMES, "system"];

export const THEME_LABELS: Record<ThemePreference, string> = {
  dark: "Dark",
  light: "Light",
  contrast: "High contrast",
  night: "Night red",
  terminal: "Green terminal",
  system: "System default",
};

const DARK_QUERY = "(prefers-color-scheme: dark)";

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

interface ThemeState {
  preference: ThemePreference;
  systemPrefersDark: boolean;
  setPreference: (preference: ThemePreference) => void;
  setSystemPrefersDark: (dark: boolean) => void;
}

// App-level preference (SPEC §7.12: theme is global, not per profile).
// Persisted through the Store in phase 3; until then it lasts for the session.
export const useThemeStore = create<ThemeState>()((set) => ({
  // Dark until the user picks otherwise (owner, 2026-10-23).
  preference: "dark",
  systemPrefersDark: false,
  setPreference: (preference) => {
    set({ preference });
  },
  setSystemPrefersDark: (systemPrefersDark) => {
    set({ systemPrefersDark });
  },
}));

export function useResolvedTheme(): ResolvedTheme {
  return useThemeStore((s) => resolveTheme(s.preference, s.systemPrefersDark));
}

/**
 * Tracks the OS colour scheme and keeps <html data-theme> in sync with the store.
 * Returns a disposer.
 */
export function bindThemeToDocument(doc: Document, win: Window): () => void {
  const media = win.matchMedia(DARK_QUERY);
  const { setSystemPrefersDark } = useThemeStore.getState();
  setSystemPrefersDark(media.matches);

  const onMediaChange = (event: MediaQueryListEvent) => {
    setSystemPrefersDark(event.matches);
  };
  media.addEventListener("change", onMediaChange);

  const apply = (state: ThemeState) => {
    doc.documentElement.dataset.theme = resolveTheme(state.preference, state.systemPrefersDark);
  };
  apply(useThemeStore.getState());
  const unsubscribe = useThemeStore.subscribe(apply);

  return () => {
    media.removeEventListener("change", onMediaChange);
    unsubscribe();
  };
}
