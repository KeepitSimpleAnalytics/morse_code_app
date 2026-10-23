import type { ScreenDef } from "../../app/screens";
import { MorsePills } from "../../components/MorsePills";
import styles from "./ScreenIntro.module.css";

/** Digits 1–3 in Morse, used as decorative list markers. */
const DIGIT_PATTERNS = [".----", "..---", "...--"] as const;

/**
 * The page a screen shows until its phase is built. It says plainly that the
 * feature isn't here yet; nothing on it pretends to work.
 */
export function ScreenIntro({ screen }: { screen: ScreenDef }) {
  const Icon = screen.icon;

  return (
    <article className={styles.page} aria-labelledby="screen-title">
      <section className={styles.hero}>
        <div className={styles.heroGlow} aria-hidden="true" />
        <div className={styles.heroIcon} aria-hidden="true">
          <Icon size={26} strokeWidth={1.6} />
        </div>
        <p className={styles.eyebrow}>{screen.group === "System" ? "App" : screen.group}</p>
        <h1 id="screen-title" className={styles.title}>
          {screen.title}
        </h1>
        <p className={styles.summary}>{screen.summary}</p>
        <p className={styles.status}>
          <span className={styles.statusDot} aria-hidden="true" />
          Not built yet. Arrives in phase {screen.phase}.
        </p>
      </section>

      <section aria-labelledby="coming-title">
        <h2 id="coming-title" className={styles.sectionTitle}>
          What you'll find here
        </h2>
        <ol className={styles.highlights}>
          {screen.highlights.map((text, i) => (
            <li key={text} className={styles.highlight}>
              <MorsePills pattern={DIGIT_PATTERNS[i] ?? ""} size="sm" className={styles.marker} />
              <span>{text}</span>
            </li>
          ))}
        </ol>
      </section>

      <aside className={styles.tip}>
        <span className={styles.tipLabel}>Tip</span>
        <p>
          Don't count dots and dashes. Listen for the rhythm of each character: K is{" "}
          <em>dah-di-dah</em>, not "dash dot dash".
        </p>
      </aside>
    </article>
  );
}
