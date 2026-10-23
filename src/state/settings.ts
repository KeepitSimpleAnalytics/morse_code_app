import { create } from "zustand";
import {
  defaultSettings,
  validateSetting,
  type SettingKey,
  type SettingsValues,
} from "./settings-schema";

/**
 * The current profile's settings. Changes apply at once and are written 300 ms
 * after the last change (SPEC §9.4), so a dragged slider is one write, not dozens.
 * `flush()` writes anything pending immediately (profile switch, window close).
 */

export const SAVE_DEBOUNCE_MS = 300;

export type SaveFn = (entries: Partial<SettingsValues>) => Promise<void>;

interface SettingsState {
  values: SettingsValues;
  /** The last failed save, shown to the user until the next successful one. */
  saveError: string | null;
  set: <K extends SettingKey>(key: K, value: SettingsValues[K]) => void;
}

export const useSettings = create<SettingsState>()((set) => ({
  values: defaultSettings(),
  saveError: null,
  set: (key, value) => {
    const v = validateSetting(key, value);
    set((s) => ({ values: { ...s.values, [key]: v } }));
    writer.schedule(key, v);
  },
}));

class DebouncedWriter {
  private pending: Partial<Record<SettingKey, unknown>> = {};
  private timer: ReturnType<typeof setTimeout> | null = null;
  private save: SaveFn | null = null;
  private inFlight: Promise<void> = Promise.resolve();

  /** Points the writer at a profile's storage. Pass null to detach (pending writes are dropped). */
  attach(save: SaveFn | null): void {
    this.cancel();
    this.pending = {};
    this.save = save;
  }

  schedule(key: SettingKey, value: unknown): void {
    if (!this.save) return;
    this.pending[key] = value;
    this.cancel();
    this.timer = setTimeout(() => {
      void this.flush();
    }, SAVE_DEBOUNCE_MS);
  }

  /** Writes pending changes now. Resolves when they (and earlier writes) are saved. */
  flush(): Promise<void> {
    this.cancel();
    const save = this.save;
    const entries = this.pending as Partial<SettingsValues>;
    this.pending = {};
    if (save && Object.keys(entries).length > 0) {
      this.inFlight = this.inFlight.then(async () => {
        try {
          await save(entries);
          useSettings.setState({ saveError: null });
        } catch (err) {
          // Keep the values for the next attempt and tell the user (no silent loss).
          this.pending = { ...entries, ...this.pending };
          useSettings.setState({
            saveError: `Settings couldn't be saved: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      });
    }
    return this.inFlight;
  }

  private cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}

const writer = new DebouncedWriter();

/** Loads a profile's settings and starts saving changes through `save`. */
export function loadSettings(values: SettingsValues, save: SaveFn | null): void {
  writer.attach(save);
  useSettings.setState({ values, saveError: null });
}

export const flushSettings = (): Promise<void> => writer.flush();
