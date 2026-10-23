import { create } from "zustand";
import type { Profile } from "../storage/schemas";
import type { Store } from "../storage/store";

/**
 * App lifecycle and the current profile. `boot` (app/boot.ts) moves this from
 * "booting" to "ready", "first-run" (no profile yet) or "fatal".
 */

export type AppPhase = "booting" | "fatal" | "first-run" | "ready";

export interface FatalError {
  title: string;
  detail: string;
  dbPath: string | null;
}

export interface Notice {
  id: number;
  tone: "info" | "warning" | "danger";
  text: string;
}

interface AppState {
  phase: AppPhase;
  fatal: FatalError | null;
  store: Store | null;
  /** Where the database lives (null in web dev mode). */
  dbPath: string | null;
  profiles: Profile[];
  current: Profile | null;
  notices: Notice[];
  /** First run is showing (it stays up after the profile is created, for the cards). */
  onboarding: boolean;
}

export const useApp = create<AppState>()(() => ({
  phase: "booting",
  fatal: null,
  store: null,
  dbPath: null,
  profiles: [],
  current: null,
  notices: [],
  onboarding: false,
}));

let noticeId = 0;

export function addNotice(tone: Notice["tone"], text: string): void {
  useApp.setState((s) => ({ notices: [...s.notices, { id: ++noticeId, tone, text }] }));
}

export function dismissNotice(id: number): void {
  useApp.setState((s) => ({ notices: s.notices.filter((n) => n.id !== id) }));
}

/** The open store. Only valid once booted; anything else is a programming error. */
export function requireStore(): Store {
  const { store } = useApp.getState();
  if (!store) throw new Error("storage is not open yet");
  return store;
}

export function requireProfile(): Profile {
  const { current } = useApp.getState();
  if (!current) throw new Error("no profile is selected");
  return current;
}

export const errorText = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);
