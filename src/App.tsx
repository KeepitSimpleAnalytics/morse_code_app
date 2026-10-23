import { useEffect } from "react";
import { screenById } from "./app/screens";
import { screenForShortcut } from "./app/shortcuts";
import { Sidebar } from "./components/shell/Sidebar";
import { TopBar } from "./components/shell/TopBar";
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
      <div className={styles.main}>
        <TopBar />
        <main className={styles.content} id="main">
          <div className={styles.inner}>
            <ScreenIntro key={screen.id} screen={screen} />
          </div>
        </main>
      </div>
    </div>
  );
}
