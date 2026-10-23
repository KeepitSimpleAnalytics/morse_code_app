import { useEffect, useRef } from "react";
import { layoutPattern } from "./morse-layout";
import styles from "./MorsePills.module.css";
import { prefersReducedMotion } from "../app/motion";

interface MorsePillsProps {
  /** Dots and dashes, letters separated by spaces. Decorative only. */
  pattern: string;
  size?: "xs" | "sm" | "md";
  /** Put each letter on its own row. */
  stacked?: boolean;
  /** Key the pills in real Morse timing at this many ms per dot unit. */
  unitMs?: number;
  /** While true the pattern repeats; it always plays once on mount. */
  loop?: boolean;
  className?: string;
}

const DIM = 0.32;

export function MorsePills({
  pattern,
  size = "md",
  stacked = false,
  unitMs,
  loop = false,
  className,
}: MorsePillsProps) {
  const { letters, cycleUnits } = layoutPattern(pattern);
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !unitMs) return;
    if (prefersReducedMotion()) return;

    const cycleMs = unitMs * cycleUnits;
    const lit = `0 0 10px ${getComputedStyle(root).getPropertyValue("--color-signal-glow").trim()}`;
    const pills = root.querySelectorAll<HTMLElement>("[data-start]");
    const animations = [...pills].map((pill) => {
      const start = Number(pill.dataset.start) / cycleUnits;
      const end = start + Number(pill.dataset.units) / cycleUnits;
      return pill.animate(
        [
          { opacity: DIM, boxShadow: "none", offset: 0 },
          { opacity: DIM, boxShadow: "none", offset: start },
          { opacity: 1, boxShadow: lit, offset: start },
          { opacity: 1, boxShadow: lit, offset: end },
          { opacity: DIM, boxShadow: "none", offset: end },
          { opacity: DIM, boxShadow: "none", offset: 1 },
        ],
        { duration: cycleMs, iterations: loop ? Infinity : 1, easing: "linear" },
      );
    });
    return () => {
      animations.forEach((a) => {
        a.cancel();
      });
    };
  }, [unitMs, loop, cycleUnits, pattern]);

  return (
    <span
      ref={rootRef}
      className={[
        styles.pills,
        styles[size],
        stacked ? styles.stacked : "",
        unitMs ? styles.keyed : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-hidden="true"
    >
      {letters.map((elements, li) => (
        <span key={li} className={styles.letter}>
          {elements.map((el, ei) => (
            <span
              key={ei}
              className={`${styles.pill} ${styles[el.kind]}`}
              data-start={el.startUnits}
              data-units={el.units}
            />
          ))}
        </span>
      ))}
    </span>
  );
}
