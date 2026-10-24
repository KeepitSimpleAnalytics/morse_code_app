import { DatabaseZap } from "lucide-react";
import { useEffect } from "react";
import { screenById, type ScreenId } from "./app/screens";
import { screenForShortcut } from "./app/shortcuts";
import { ShortcutsOverlay } from "./components/shell/Shortcuts";
import { useShortcutsKey } from "./components/shell/shortcuts-state";
import { Sidebar } from "./components/shell/Sidebar";
import { TopBar } from "./components/shell/TopBar";
import { Banner } from "./components/ui";
import { DrillScreen } from "./features/drill/DrillScreen";
import { IcrScreen } from "./features/icr/IcrScreen";
import { KochScreen } from "./features/koch/KochScreen";
import { StatsScreen } from "./features/stats/StatsScreen";
import { Onboarding } from "./features/onboarding/Onboarding";
import { TextPlayer } from "./features/player/TextPlayer";
import { SettingsScreen } from "./features/settings/SettingsScreen";
import { dismissNotice, useApp } from "./state/app";
import { useNavStore } from "./state/nav";
import { useSettings } from "./state/settings";
import styles from "./App.module.css";

export function App() {
  const devMode = useApp((s) => s.store?.kind === "memory");
  return (
    <div className={styles.frame}>
      {devMode && (
        <p className={styles.devBanner} role="alert">
          Dev mode — progress is not saved
        </p>
      )}
      <div className={styles.stage}>
        <Phase />
      </div>
    </div>
  );
}

function Phase() {
  const phase = useApp((s) => s.phase);
  const onboarding = useApp((s) => s.onboarding);
  if (phase === "booting") return <div className={styles.boot} aria-busy="true" />;
  if (phase === "fatal") return <FatalScreen />;
  if (phase === "first-run" || onboarding) return <Onboarding />;
  return <Shell />;
}

function Shell() {
  const screenId = useNavStore((s) => s.screen);
  const go = useNavStore((s) => s.go);
  useShortcutsKey();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = screenForShortcut(event);
      if (target) {
        event.preventDefault();
        go(target);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [go]);

  const screen = screenById(screenId);

  return (
    <div className={styles.shell}>
      <Sidebar />
      <div className={`${styles.main} ${screen.id === "player" ? styles.workspace : ""}`}>
        <TopBar />
        <Notices />
        <main className={styles.content} id="main">
          {screen.id === "player" ? (
            <TextPlayer />
          ) : (
            <div className={styles.inner}>
              <ScreenContent id={screen.id} />
            </div>
          )}
        </main>
      </div>
      <ShortcutsOverlay />
    </div>
  );
}

/** Every screen but the Text Player, which lays itself out. */
function ScreenContent({ id }: { id: Exclude<ScreenId, "player"> }) {
  switch (id) {
    case "koch":
      return <KochScreen />;
    case "icr":
      return <IcrScreen />;
    case "groups":
    case "words":
    case "callsigns":
    case "custom":
      return <DrillScreen key={id} mode={id} />;
    case "stats":
      return <StatsScreen />;
    case "settings":
      return <SettingsScreen />;
  }
}

function Notices() {
  const notices = useApp((s) => s.notices);
  const saveError = useSettings((s) => s.saveError);
  if (notices.length === 0 && !saveError) return null;
  return (
    <div className={styles.notices}>
      {saveError && <Banner tone="danger">{saveError}</Banner>}
      {notices.map((n) => (
        <Banner
          key={n.id}
          tone={n.tone}
          onDismiss={() => {
            dismissNotice(n.id);
          }}
        >
          {n.text}
        </Banner>
      ))}
    </div>
  );
}

/** Shown when storage can't open. The app does not run without it (SPEC §9.3). */
function FatalScreen() {
  const fatal = useApp((s) => s.fatal);
  return (
    <div className={styles.fatal}>
      <div className={styles.fatalCard} role="alert">
        <div className={styles.fatalIcon} aria-hidden="true">
          <DatabaseZap size={26} strokeWidth={1.6} />
        </div>
        <h1 className={styles.fatalTitle}>{fatal?.title ?? "Morse Trainer couldn't start"}</h1>
        <p className={styles.fatalLead}>
          Nothing has been changed. Your progress stays in the database file until this is fixed.
        </p>
        {fatal?.dbPath && (
          <dl className={styles.fatalFacts}>
            <dt>Database</dt>
            <dd>
              <code>{fatal.dbPath}</code>
            </dd>
          </dl>
        )}
        <pre className={styles.fatalDetail}>{fatal?.detail}</pre>
      </div>
    </div>
  );
}
