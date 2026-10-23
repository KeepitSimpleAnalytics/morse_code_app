import { DatabaseZap } from "lucide-react";
import { useEffect } from "react";
import { screenById } from "./app/screens";
import { screenForShortcut } from "./app/shortcuts";
import { Sidebar } from "./components/shell/Sidebar";
import { TopBar } from "./components/shell/TopBar";
import { Banner } from "./components/ui";
import { Onboarding } from "./features/onboarding/Onboarding";
import { TextPlayer } from "./features/player/TextPlayer";
import { SettingsScreen } from "./features/settings/SettingsScreen";
import { ScreenIntro } from "./features/shell/ScreenIntro";
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
          ) : screen.id === "settings" ? (
            <div className={styles.inner}>
              <SettingsScreen />
            </div>
          ) : (
            <div className={styles.inner}>
              <ScreenIntro key={screen.id} screen={screen} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
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
