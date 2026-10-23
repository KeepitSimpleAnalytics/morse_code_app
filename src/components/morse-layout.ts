export interface PillElement {
  kind: "dit" | "dah";
  /** Start offset in dot units from the beginning of the pattern. */
  startUnits: number;
  units: number;
}

export interface PillLayout {
  letters: PillElement[][];
  /** Pattern length plus a 7-unit rest before it repeats. */
  cycleUnits: number;
}

/**
 * Lays out a decorative pattern such as "-.-. .--" (letters separated by spaces)
 * with standard spacing: 1 unit between elements and 3 between letters.
 */
export function layoutPattern(pattern: string): PillLayout {
  const letters: PillElement[][] = [];
  let t = 0;
  pattern
    .trim()
    .split(/\s+/)
    .forEach((letter, li) => {
      if (li > 0) t += 3;
      const elements: PillElement[] = [];
      for (const symbol of letter) {
        if (elements.length > 0) t += 1;
        const units = symbol === "-" ? 3 : 1;
        elements.push({ kind: units === 3 ? "dah" : "dit", startUnits: t, units });
        t += units;
      }
      letters.push(elements);
    });
  return { letters, cycleUnits: t + 7 };
}
