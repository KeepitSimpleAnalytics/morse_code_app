import { Palette } from "lucide-react";
import {
  THEME_LABELS,
  THEME_PREFERENCES,
  useThemeStore,
  type ThemePreference,
} from "../../state/theme";
import styles from "./ThemeSwitch.module.css";

/** The theme picker: a native select, so it works by keyboard and screen reader as is. */
export function ThemeSwitch() {
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);
  return (
    <label className={styles.switch} title="Theme">
      <Palette size={15} strokeWidth={1.9} aria-hidden="true" />
      <span className={styles.srOnly}>Theme</span>
      <select
        className={styles.select}
        value={preference}
        onChange={(e) => {
          setPreference(e.currentTarget.value as ThemePreference);
        }}
      >
        {THEME_PREFERENCES.map((value) => (
          <option key={value} value={value}>
            {THEME_LABELS[value]}
          </option>
        ))}
      </select>
    </label>
  );
}
