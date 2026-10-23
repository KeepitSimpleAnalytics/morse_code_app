import { isTauri } from "@tauri-apps/api/core";
import { addNotice, errorText, useApp } from "../state/app";
import { useNavStore } from "../state/nav";
import { useThemeStore } from "../state/theme";
import { MemoryStore } from "../storage/memory";
import { startupReport } from "../storage/native";
import { SqliteStore } from "../storage/sqlite";
import { openTauriDriver } from "../storage/tauri-driver";
import { parseThemePreference, THEME_META_KEY } from "./bindings";
import { SCREENS } from "./screens";
import { activateProfile, createProfile } from "./session";

/**
 * Opens storage and the last-used profile (SPEC §9.3, §7.12).
 *
 * In the desktop app the store is SQLite, and if it can't be opened the app stops
 * on an error screen with the database path and the error. `pnpm dev:web` (Vite
 * mode "web") uses MemoryStore under a red banner. There is no other fallback.
 */
export async function boot(): Promise<void> {
  try {
    if (isTauri()) {
      const report = await startupReport();
      useApp.setState({ dbPath: report.dbPath });
      let driver;
      try {
        driver = await openTauriDriver();
      } catch (err) {
        useApp.setState({
          phase: "fatal",
          fatal: {
            title: "The progress database couldn't be opened",
            detail: errorText(err),
            dbPath: report.dbPath,
          },
        });
        return;
      }
      useApp.setState({ store: new SqliteStore(driver) });
      if (report.restored) addNotice("info", "Your data was restored from the backup.");
      for (const e of report.errors) addNotice("warning", e);
    } else if (import.meta.env.MODE === "web") {
      useApp.setState({ store: new MemoryStore() });
    } else {
      useApp.setState({
        phase: "fatal",
        fatal: {
          title: "Morse Trainer runs as a desktop app",
          detail:
            "This page was opened in a browser, where progress can't be saved. Start the app with `pnpm tauri dev`, or use `pnpm dev:web` for a browser session that saves nothing.",
          dbPath: null,
        },
      });
      return;
    }

    const store = useApp.getState().store;
    if (!store) throw new Error("storage did not open");
    const theme = parseThemePreference(await store.getMeta(THEME_META_KEY));
    if (theme) useThemeStore.getState().setPreference(theme);

    if (store.kind === "memory") await openDemoProfile();

    const profiles = await store.listProfiles();
    useApp.setState({ profiles });
    const last = profiles[0];
    if (last) await activateProfile(last);
    else useApp.setState({ phase: "first-run", onboarding: true });
  } catch (err) {
    useApp.setState({
      phase: "fatal",
      fatal: {
        title: "Morse Trainer couldn't start",
        detail: errorText(err),
        dbPath: useApp.getState().dbPath,
      },
    });
  }
}

/**
 * `pnpm dev:web` only: `?demo=settings` (any screen id) opens a throwaway profile
 * on that screen, so screens can be checked without clicking through first run.
 */
async function openDemoProfile(): Promise<void> {
  const screen = new URLSearchParams(window.location.search).get("demo");
  const target = SCREENS.find((s) => s.id === screen);
  if (!target) return;
  await createProfile("Demo", "#7c5cd6");
  useNavStore.getState().go(target.id);
}
