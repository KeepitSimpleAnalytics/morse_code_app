import { useState } from "react";
import { SCREENS, shortcutIndex, type ScreenGroup, type ScreenId } from "../../app/screens";
import { PRIMARY_MODIFIER_LABEL } from "../../app/shortcuts";
import { useNavStore } from "../../state/nav";
import { MorsePills } from "../MorsePills";
import styles from "./Sidebar.module.css";

const MAIN_GROUPS: readonly ScreenGroup[] = ["Learn", "Practice", "Tools", "Progress"];

/** "CW" in Morse, keyed at 20 WPM (PARIS: 1200 / 20 = 60 ms per unit). */
const BRAND_PATTERN = "-.-. .--";
const BRAND_UNIT_MS = 60;

export function Sidebar() {
  const screen = useNavStore((s) => s.screen);
  const go = useNavStore((s) => s.go);
  const [brandHover, setBrandHover] = useState(false);

  return (
    <nav className={styles.sidebar} aria-label="Main">
      <div
        className={styles.brand}
        onMouseEnter={() => {
          setBrandHover(true);
        }}
        onMouseLeave={() => {
          setBrandHover(false);
        }}
      >
        <span className={styles.brandMark} aria-hidden="true">
          <MorsePills
            pattern={BRAND_PATTERN}
            unitMs={BRAND_UNIT_MS}
            loop={brandHover}
            size="xs"
            stacked
          />
        </span>
        <span className={styles.brandText}>
          <span className={styles.brandName}>Morse Trainer</span>
          <span className={styles.brandTag}>Learn to hear in rhythm</span>
        </span>
      </div>

      <div className={styles.groups}>
        {MAIN_GROUPS.map((group) => (
          <section key={group} className={styles.group} aria-labelledby={`nav-${group}`}>
            <h2 id={`nav-${group}`} className={styles.groupLabel}>
              {group}
            </h2>
            <ul className={styles.list}>
              {SCREENS.filter((s) => s.group === group).map((s) => (
                <NavItem key={s.id} id={s.id} active={screen === s.id} onSelect={go} />
              ))}
            </ul>
          </section>
        ))}
      </div>

      <ul className={`${styles.list} ${styles.footer}`}>
        <NavItem id="settings" active={screen === "settings"} onSelect={go} />
      </ul>
    </nav>
  );
}

interface NavItemProps {
  id: ScreenId;
  active: boolean;
  onSelect: (id: ScreenId) => void;
}

function NavItem({ id, active, onSelect }: NavItemProps) {
  const def = SCREENS.find((s) => s.id === id);
  if (!def) throw new Error(`Unknown screen: ${id}`);
  const Icon = def.icon;
  const shortcut = shortcutIndex(id);

  return (
    <li>
      <button
        type="button"
        className={styles.item}
        aria-current={active ? "page" : undefined}
        title={shortcut ? `${def.title} (${PRIMARY_MODIFIER_LABEL}+${shortcut})` : def.title}
        onClick={() => {
          onSelect(id);
        }}
      >
        <Icon className={styles.icon} size={18} strokeWidth={1.75} aria-hidden="true" />
        <span className={styles.label}>{def.label}</span>
        {shortcut !== null && (
          <kbd className={styles.kbd} aria-hidden="true">
            {PRIMARY_MODIFIER_LABEL === "Ctrl" ? `^${shortcut}` : `⌘${shortcut}`}
          </kbd>
        )}
      </button>
    </li>
  );
}
