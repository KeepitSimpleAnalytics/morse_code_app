import { useEffect } from "react";
import { screenById } from "./app/screens";
import { screenForShortcut } from "./app/shortcuts";
import { Sidebar } from "./components/shell/Sidebar";
import { TopBar } from "./components/shell/TopBar";
import { TextPlayer } from "./features/player/TextPlayer";
import { ScreenIntro } from "./features/shell/ScreenIntro";
import { useNavStore } from "./state/nav";
import styles from "./App.module.css";

export function App() {
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
        <main className={styles.content} id="main">
          {screen.id === "player" ? (
            <TextPlayer />
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
