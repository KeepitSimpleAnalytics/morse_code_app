/** Number formats shared by the copy-mode screens. */

export const pct = (v: number) => `${Math.round(v * 100)}%`;

/** m:ss, rounding up so a timer never shows 0:00 while time is left. */
export function clock(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
