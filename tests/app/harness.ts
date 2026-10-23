import { bindAppState } from "../../src/app/bindings";
import { createProfile } from "../../src/app/session";
import { useApp } from "../../src/state/app";
import { flushSettings } from "../../src/state/settings";
import { MemoryStore } from "../../src/storage/memory";

// main.tsx installs these in the app.
if (typeof document !== "undefined") bindAppState(document);

/** A booted app on a fresh MemoryStore, with no profile yet (first run). */
export async function freshApp(): Promise<MemoryStore> {
  await flushSettings();
  const store = new MemoryStore();
  useApp.setState({
    phase: "first-run",
    onboarding: true,
    fatal: null,
    store,
    dbPath: null,
    profiles: [],
    current: null,
    notices: [],
  });
  return store;
}

/** A booted app with one open profile, past onboarding. */
export async function openTestProfile(name = "Tester"): Promise<MemoryStore> {
  const store = await freshApp();
  await createProfile(name, "#3b82f6");
  useApp.setState({ onboarding: false });
  return store;
}
