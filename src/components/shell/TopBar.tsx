import { Check, ChevronDown, Plus, Settings2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { screenById } from "../../app/screens";
import { switchProfile } from "../../app/session";
import {
  actualWpm,
  CHAR_WPM_MAX,
  CHAR_WPM_MIN,
  EFF_WPM_MIN,
  isLinked,
  withCharWpm,
  withEffWpm,
} from "../../core/speed";
import { NewProfileDialog, ProfileAvatar } from "../../features/profiles/ProfileWidgets";
import { addNotice, errorText, useApp } from "../../state/app";
import { useNavStore } from "../../state/nav";
import { useSettings } from "../../state/settings";
import { Slider } from "../controls";
import { ThemeSwitch } from "./ThemeSwitch";
import styles from "./TopBar.module.css";

/**
 * Top bar (SPEC §10.1): breadcrumb, speed chip with the timing popover, theme and
 * the profile switcher. The streak flame and goal ring arrive with goals in phase 9.
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
        <SpeedChip />
        <ThemeSwitch />
        <ProfileSwitcher />
      </div>
    </header>
  );
}

/** A button with a panel that closes on Esc or a click outside. */
function Popover({
  button,
  label,
  children,
  align = "end",
}: {
  button: (open: boolean, toggle: () => void) => ReactNode;
  label: string;
  children: (close: () => void) => ReactNode;
  align?: "end" | "start";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        ref.current?.querySelector<HTMLElement>("button")?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className={styles.popoverWrap} ref={ref}>
      {button(open, () => {
        setOpen((o) => !o);
      })}
      {open && (
        <div
          className={`${styles.popover} ${align === "start" ? styles.alignStart : ""}`}
          role="dialog"
          aria-label={label}
        >
          {children(() => {
            setOpen(false);
          })}
        </div>
      )}
    </div>
  );
}

function SpeedChip() {
  const speeds = useSettings((s) => s.values["timing.speeds"]);
  const tone = useSettings((s) => s.values["audio.toneHz"]);
  const set = useSettings((s) => s.set);
  const go = useNavStore((s) => s.go);
  const text = `${speeds.charWpm}/${speeds.effWpm} WPM · ${tone} Hz`;

  return (
    <Popover
      label="Training speed"
      button={(open, toggle) => (
        <button
          type="button"
          className={styles.chip}
          aria-expanded={open}
          aria-haspopup="dialog"
          title="Training speed and tone"
          onClick={toggle}
        >
          <span className={styles.chipDot} aria-hidden="true" />
          {text}
        </button>
      )}
    >
      {(close) => (
        <div className={styles.speedPanel}>
          <p className={styles.panelTitle}>
            Training speed
            <span className={styles.panelMeta}>{actualWpm(speeds)} WPM actual</span>
          </p>
          <Slider
            label="Character"
            min={CHAR_WPM_MIN}
            max={CHAR_WPM_MAX}
            value={speeds.charWpm}
            display={`${speeds.charWpm} WPM`}
            onChange={(c) => {
              set("timing.speeds", withCharWpm(speeds, c));
            }}
          />
          <Slider
            label="Effective"
            min={EFF_WPM_MIN}
            max={speeds.charWpm}
            value={speeds.effWpm}
            display={isLinked(speeds) ? "linked" : `${speeds.effWpm} WPM`}
            onChange={(e) => {
              set("timing.speeds", withEffWpm(speeds, e));
            }}
          />
          <Slider
            label="Tone"
            min={300}
            max={1200}
            step={10}
            value={tone}
            display={`${tone} Hz`}
            onChange={(hz) => {
              set("audio.toneHz", hz);
            }}
          />
          <button
            type="button"
            className={styles.panelLink}
            onClick={() => {
              close();
              go("settings");
            }}
          >
            More timing and audio settings
          </button>
        </div>
      )}
    </Popover>
  );
}

function ProfileSwitcher() {
  const current = useApp((s) => s.current);
  const profiles = useApp((s) => s.profiles);
  const go = useNavStore((s) => s.go);
  const [creating, setCreating] = useState(false);
  if (!current) return null;

  return (
    <>
      <Popover
        label="Profiles"
        button={(open, toggle) => (
          <button
            type="button"
            className={styles.profileButton}
            aria-expanded={open}
            aria-haspopup="dialog"
            aria-label={`Profile: ${current.name}. Switch profile`}
            onClick={toggle}
          >
            <ProfileAvatar name={current.name} color={current.color} size={26} />
            <span className={styles.profileName}>{current.name}</span>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
        )}
      >
        {(close) => (
          <div className={styles.menu}>
            <p className={styles.menuLabel}>Profiles</p>
            {profiles.map((p) => (
              <button
                key={p.id}
                type="button"
                className={styles.menuItem}
                aria-current={p.id === current.id ? "true" : undefined}
                onClick={() => {
                  close();
                  switchProfile(p.id).catch((err: unknown) => {
                    addNotice("danger", `Switching profile failed: ${errorText(err)}`);
                  });
                }}
              >
                <ProfileAvatar name={p.name} color={p.color} size={22} />
                <span className={styles.menuText}>{p.name}</span>
                {p.id === current.id && <Check size={15} aria-hidden="true" />}
              </button>
            ))}
            <div className={styles.menuSep} />
            <button
              type="button"
              className={styles.menuItem}
              onClick={() => {
                close();
                setCreating(true);
              }}
            >
              <Plus size={16} aria-hidden="true" />
              <span className={styles.menuText}>New profile…</span>
            </button>
            <button
              type="button"
              className={styles.menuItem}
              onClick={() => {
                close();
                go("settings");
              }}
            >
              <Settings2 size={16} aria-hidden="true" />
              <span className={styles.menuText}>Manage profiles</span>
            </button>
          </div>
        )}
      </Popover>
      {creating && (
        <NewProfileDialog
          onClose={() => {
            setCreating(false);
          }}
        />
      )}
    </>
  );
}
