import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import type { KeyboardEvent } from "react";
import { THEME_PREFERENCES, useThemeStore, type ThemePreference } from "../../state/theme";
import styles from "./ThemeSwitch.module.css";

const OPTIONS: Record<ThemePreference, { label: string; icon: LucideIcon }> = {
  light: { label: "Light", icon: Sun },
  dark: { label: "Dark", icon: Moon },
  system: { label: "System", icon: Monitor },
};

/** Light / Dark / System segmented control, implemented as an ARIA radio group. */
export function ThemeSwitch() {
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const i = THEME_PREFERENCES.indexOf(preference);
    const step = event.key === "ArrowRight" ? 1 : -1;
    const next =
      THEME_PREFERENCES[(i + step + THEME_PREFERENCES.length) % THEME_PREFERENCES.length];
    if (next) {
      setPreference(next);
      event.currentTarget.querySelector<HTMLButtonElement>(`[data-value="${next}"]`)?.focus();
    }
  };

  return (
    <div className={styles.switch} role="radiogroup" aria-label="Theme" onKeyDown={onKeyDown}>
      {THEME_PREFERENCES.map((value) => {
        const { label, icon: Icon } = OPTIONS[value];
        const checked = preference === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={label}
            title={label}
            tabIndex={checked ? 0 : -1}
            data-value={value}
            className={styles.option}
            onClick={() => {
              setPreference(value);
            }}
          >
            <Icon size={15} strokeWidth={1.9} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
