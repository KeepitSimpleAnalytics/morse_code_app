import { screenById } from "../../app/screens";
import { useNavStore } from "../../state/nav";
import { ThemeSwitch } from "./ThemeSwitch";
import styles from "./TopBar.module.css";

/**
 * Phase 0 top bar. The profile switcher, streak, goal ring and speed chip (SPEC §10.1)
 * are added with the data that drives them: profiles and settings in phase 3,
 * streaks and goals in phase 9.
 */
export function TopBar() {
  const screen = screenById(useNavStore((s) => s.screen));

  return (
    <header className={styles.topbar}>
      <p className={styles.crumbs}>
        <span className={styles.group}>{screen.group === "System" ? "App" : screen.group}</span>
        <span className={styles.sep} aria-hidden="true">
          /
        </span>
        <span className={styles.current}>{screen.title}</span>
      </p>
      <div className={styles.actions}>
        <ThemeSwitch />
      </div>
    </header>
  );
}
