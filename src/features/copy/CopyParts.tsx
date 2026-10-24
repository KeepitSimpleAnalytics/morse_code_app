import { Shuffle } from "lucide-react";
import { MorsePills } from "../../components/MorsePills";
import { Button } from "../../components/ui";
import type { CharSummary } from "../../core/lesson";
import type { ScoreTotals } from "../../core/drill";
import type { AlignmentOp } from "../../core/scoring";
import { tokenCode } from "../../core/code-text";
import { tokenize } from "../../core/tokenize";
import { useSettings } from "../../state/settings";
import styles from "./copy.module.css";
import { pct } from "./format";

/** Pieces shared by the copy modes (SPEC §7, "Common pattern"): Koch and the per-item drills. */

/** Accuracy, correct count, characters per minute and the error breakdown. */
export function ScoreMetrics({ score, cpm }: { score: ScoreTotals; cpm: number }) {
  return (
    <dl className={styles.metrics}>
      <div>
        <dt>Accuracy</dt>
        <dd className={styles.metricBig}>{pct(score.accuracy)}</dd>
      </div>
      <div>
        <dt>Correct</dt>
        <dd>
          {score.correct} / {score.sentCharCount}
        </dd>
      </div>
      <div>
        <dt>Characters per minute</dt>
        <dd>{Math.round(cpm)}</dd>
      </div>
      <div>
        <dt>Errors</dt>
        <dd>
          {score.substitutions} wrong · {score.misses} missed · {score.insertions} extra
        </dd>
      </div>
    </dl>
  );
}

/**
 * The aligned diff (SPEC §8.2): colour plus a symbol, so meaning never relies on
 * colour. `replayToken` outlines the sent character being replayed.
 */
export function Diff({
  ops,
  prompt,
  replayToken = null,
}: {
  ops: readonly AlignmentOp[];
  prompt: string;
  replayToken?: number | null;
}) {
  const showCode = useSettings((s) => s.values["display.showCode"]);
  const codeFormat = useSettings((s) => s.values["display.codeFormat"]);
  const tokens = tokenize(prompt).tokens;
  let sentIdx = -1;
  return (
    <div className={styles.diff}>
      {ops.map((op, i) => {
        const hasSent =
          op.op === "correct" ||
          op.op === "substituted" ||
          op.op === "missed" ||
          (op.op === "gap" && op.kind !== "inserted");
        if (hasSent) sentIdx++;
        const current = hasSent && sentIdx === replayToken;
        if (op.op === "gap") {
          return <span key={i} className={styles.diffGap} aria-hidden="true" />;
        }
        const tok = op.op === "inserted" ? undefined : tokens[sentIdx];
        const code =
          showCode !== "never" && tok?.type === "char" ? tokenCode(tok, codeFormat, "space") : null;
        const cls =
          op.op === "correct"
            ? ""
            : op.op === "substituted"
              ? styles.cellSub
              : op.op === "missed"
                ? styles.cellMiss
                : styles.cellIns;
        const label =
          op.op === "correct"
            ? `${op.sent} correct`
            : op.op === "substituted"
              ? `${op.sent} typed as ${op.typed}`
              : op.op === "missed"
                ? `${op.sent} missed`
                : `extra ${op.typed}`;
        return (
          <span
            key={i}
            className={[styles.cell, cls, current ? styles.cellCurrent : ""].join(" ")}
            role="img"
            aria-label={label}
            title={label}
          >
            <span className={styles.cellSent}>{op.op === "inserted" ? "" : op.sent}</span>
            <span className={styles.cellTyped}>
              {op.op === "substituted"
                ? op.typed.toLowerCase()
                : op.op === "missed"
                  ? "_"
                  : op.op === "inserted"
                    ? `+${op.typed.toLowerCase()}`
                    : ""}
            </span>
            {code && <span className={styles.cellCode}>{code}</span>}
          </span>
        );
      })}
    </div>
  );
}

export function DiffLegend() {
  return (
    <p className={styles.legend}>
      <span className={styles.legendSub}>H/s</span> heard as something else ·{" "}
      <span className={styles.legendMiss}>_</span> missed ·{" "}
      <span className={styles.legendIns}>+x</span> extra
    </p>
  );
}

/**
 * The weakest characters, with "Practice these characters" (Random Groups on
 * them). The button needs two characters, so a single weak one has none.
 */
export function WeakChars({
  title,
  weak,
  onPractise,
}: {
  title: string;
  weak: readonly CharSummary[];
  onPractise?: (chars: string[]) => void;
}) {
  if (weak.length === 0) {
    return <p className={styles.muted}>No characters missed.</p>;
  }
  return (
    <div className={styles.weak}>
      <h3 className={styles.label}>{title}</h3>
      <ul className={styles.weakList}>
        {weak.map((w) => (
          <li key={w.ch}>
            <strong>{w.ch}</strong> {w.correct}/{w.attempts}
          </li>
        ))}
      </ul>
      {onPractise && weak.length < 2 && (
        <p className={styles.muted}>
          Practice needs at least two characters, and only one was missed.
        </p>
      )}
      {onPractise && weak.length >= 2 && (
        <div className={styles.actions}>
          <Button
            size="sm"
            icon={Shuffle}
            onClick={() => {
              onPractise(weak.map((w) => w.ch));
            }}
          >
            Practice these characters
          </Button>
        </div>
      )}
    </div>
  );
}

/** "Show code: live": the pattern of the character being heard (SPEC §10.4). */
export function LiveCode({ pattern }: { pattern: string }) {
  return (
    <div className={styles.liveCode} aria-hidden="true">
      {pattern && <MorsePills pattern={pattern} size="md" />}
    </div>
  );
}
