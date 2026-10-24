import { ArrowRight, Eye, Play, Repeat, RotateCcw, Square, Volume2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { screenById } from "../../app/screens";
import { hasPrimaryModifier, PRIMARY_MODIFIER_LABEL } from "../../app/shortcuts";
import { Banner, Button } from "../../components/ui";
import { useSettings } from "../../state/settings";
import { Diff, DiffLegend, LiveCode, ScoreMetrics, WeakChars } from "../copy/CopyParts";
import { pct } from "../copy/format";
import ui from "../copy/copy.module.css";
import * as drill from "./controller";
import { practiseChars } from "./practise";
import { CallsignsSetup, CustomSetup, GroupsSetup, WordsSetup } from "./Setups";
import { drillStores, type DrillMode, type ItemResult } from "./store";
import styles from "./drill.module.css";

/** Random Groups, Words, Callsigns and Custom Practice (SPEC §7.3–7.7): one item at a time. */
export function DrillScreen({ mode }: { mode: DrillMode }) {
  const use = drillStores[mode];
  const phase = use((s) => s.phase);
  const error = use((s) => s.error);
  const notice = use((s) => s.notice);
  const set = use((s) => s.set);
  const screen = screenById(mode);

  // A hidden window or leaving the screen pauses (SPEC §13).
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") drill.pause(mode, "hidden");
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      drill.pause(mode, "left");
    };
  }, [mode]);

  // Shortcuts (SPEC §10.3). Enter in the answer box is handled by the box itself.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || document.querySelector('[role="dialog"]')) return;
      const p = drillStores[mode].getState().phase;
      const primary = hasPrimaryModifier(e) && !e.altKey;
      const plain = !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;
      if (e.key === "Enter" && plain && p === "feedback") {
        // A focused button handles its own Enter; anywhere else, Enter means Next.
        if (!(e.target instanceof HTMLButtonElement)) {
          e.preventDefault();
          void drill.next(mode);
        }
        return;
      }
      if (e.key === "Enter" && primary && e.shiftKey) {
        if (p === "playing" || p === "answering") {
          e.preventDefault();
          void drill.reveal(mode);
        }
      } else if (e.key === "Enter" && primary) {
        if (p === "idle" || p === "results") {
          e.preventDefault();
          void drill.start(mode);
        } else if (p === "feedback") {
          e.preventDefault();
          void drill.next(mode);
        }
      } else if (e.key === " " && primary && !e.shiftKey) {
        if (p === "playing" || p === "answering") {
          e.preventDefault();
          void drill.repeat(mode);
        }
      } else if (e.key === "Escape" && !e.defaultPrevented) {
        if (drillStores[mode].getState().replay) {
          drill.stopReplay(mode);
        } else if (
          p === "starting" ||
          p === "playing" ||
          p === "answering" ||
          p === "feedback" ||
          p === "paused"
        ) {
          e.preventDefault();
          void drill.stop(mode);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [mode]);

  return (
    <div className={ui.page}>
      <header>
        <p className={ui.eyebrow}>Practice</p>
        <h1 className={ui.title}>{screen.title}</h1>
      </header>
      {error && (
        <Banner
          tone="danger"
          onDismiss={() => {
            set({ error: null });
          }}
        >
          {error}
        </Banner>
      )}
      {notice && (
        <Banner
          tone="info"
          onDismiss={() => {
            set({ notice: null });
          }}
        >
          {notice}
        </Banner>
      )}
      <ResultAnnouncer mode={mode} />
      {phase === "idle" ? (
        mode === "groups" ? (
          <GroupsSetup />
        ) : mode === "words" ? (
          <WordsSetup />
        ) : mode === "callsigns" ? (
          <CallsignsSetup />
        ) : (
          <CustomSetup />
        )
      ) : phase === "results" ? (
        <ResultsPanel mode={mode} />
      ) : (
        <ItemPanel mode={mode} />
      )}
    </div>
  );
}

/** Announces each answer and the session result to screen readers (SPEC §10.6). */
function ResultAnnouncer({ mode }: { mode: DrillMode }) {
  const use = drillStores[mode];
  const feedback = use((s) => s.feedback);
  const summary = use((s) => s.summary);
  const text = summary
    ? `Session scored: ${pct(summary.totals.accuracy)} accuracy over ${summary.items.length} items.`
    : feedback
      ? `${feedback.revealed ? "Revealed" : feedback.score.accuracy === 1 ? "Correct" : "Not quite"}: ${feedback.item.text}${feedback.item.meaning ? `, ${feedback.item.meaning}` : ""}.`
      : "";
  return (
    <p className={ui.srOnly} role="status">
      {text}
    </p>
  );
}

/* One item ---------------------------------------------------------------- */

function ItemPanel({ mode }: { mode: DrillMode }) {
  const use = drillStores[mode];
  const phase = use((s) => s.phase);
  const index = use((s) => s.index);
  const total = use((s) => s.total);
  const typed = use((s) => s.typed);
  const repeats = use((s) => s.repeats);
  const heardToken = use((s) => s.heardToken);
  const feedback = use((s) => s.feedback);
  const pausedBy = use((s) => s.pausedBy);
  const replay = use((s) => s.replay);
  const set = use((s) => s.set);
  const showCode = useSettings((s) => s.values["display.showCode"]);
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLElement>(null);

  const answering = phase === "playing" || phase === "answering";
  useEffect(() => {
    if (answering) inputRef.current?.focus();
    else if (phase === "feedback") {
      cardRef.current?.querySelector<HTMLButtonElement>("[data-next]")?.focus();
    }
  }, [answering, phase, index]);

  const token = heardToken === null ? undefined : drill.currentItemTokens(mode)[heardToken];
  const last = index + 1 >= total;

  return (
    <section ref={cardRef} className={ui.card} aria-labelledby={`${mode}-item`}>
      <div className={ui.lessonHead}>
        <h2 id={`${mode}-item`} className={ui.cardTitle}>
          {phase === "starting"
            ? "Get ready…"
            : phase === "paused"
              ? "Paused"
              : phase === "feedback"
                ? feedback?.revealed
                  ? "Revealed"
                  : feedback?.score.accuracy === 1
                    ? "Correct"
                    : "Not quite"
                : phase === "saving"
                  ? "Saving…"
                  : phase === "closing"
                    ? "Finishing…"
                    : phase === "unsaved"
                      ? "Not saved yet"
                      : "Copy what you hear"}
        </h2>
        {total > 0 && (
          <span className={styles.progress}>
            <span aria-hidden="true">
              {Math.min(index + 1, total)} / {total}
            </span>
            <span className={ui.srOnly}>
              Item {Math.min(index + 1, total)} of {total}
            </span>
          </span>
        )}
      </div>

      {phase === "paused" && (
        <p className={ui.muted}>
          {pausedBy === "hidden"
            ? "The window was hidden, so practice paused."
            : "You left the screen, so practice paused."}
        </p>
      )}
      {phase === "unsaved" && (
        <p className={ui.muted}>
          Your answers are saved, but the session couldn't be closed. Try again.
        </p>
      )}

      {showCode === "live" && phase === "playing" && (
        <LiveCode pattern={token?.type === "char" ? token.symbol.pattern : ""} />
      )}

      {phase === "closing" || phase === "unsaved" ? null : phase === "feedback" && feedback ? (
        <div className={styles.feedback}>
          <Diff
            ops={feedback.score.ops}
            prompt={feedback.item.text}
            replayToken={replay?.index === index ? replay.token : null}
          />
          {feedback.item.meaning && <p className={styles.meaning}>{feedback.item.meaning}</p>}
          <DiffLegend />
        </div>
      ) : (
        <input
          ref={inputRef}
          className={styles.answer}
          value={typed}
          aria-label="Your answer"
          spellCheck={false}
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          disabled={!answering}
          onChange={(e) => {
            set({ typed: e.currentTarget.value });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
              e.preventDefault();
              void drill.submit(mode);
            }
          }}
        />
      )}

      <div className={ui.startRow}>
        {phase === "feedback" ? (
          <>
            <Button
              data-next=""
              variant="primary"
              icon={ArrowRight}
              title={`Enter or ${PRIMARY_MODIFIER_LABEL}+Enter`}
              onClick={() => void drill.next(mode)}
            >
              {last ? "See results" : "Next"}
            </Button>
            {replay ? (
              <Button
                icon={Square}
                onClick={() => {
                  drill.stopReplay(mode);
                }}
              >
                Stop replay
              </Button>
            ) : (
              <Button icon={Volume2} onClick={() => void drill.replayItem(mode, index)}>
                Replay with text shown
              </Button>
            )}
          </>
        ) : phase === "paused" ? (
          <Button variant="primary" icon={Play} onClick={() => void drill.resume(mode)}>
            Resume
          </Button>
        ) : phase === "unsaved" ? (
          <>
            <Button variant="primary" onClick={() => void drill.retryFinish(mode)}>
              Try again
            </Button>
            <Button
              onClick={() => {
                drill.resultsWithoutClosing(mode);
              }}
            >
              Show results anyway
            </Button>
          </>
        ) : phase === "closing" ? null : (
          <>
            <Button
              variant="primary"
              disabled={!answering}
              title="Enter"
              onClick={() => void drill.submit(mode)}
            >
              Submit
            </Button>
            <Button
              icon={Repeat}
              disabled={!answering}
              title={`${PRIMARY_MODIFIER_LABEL}+Space`}
              onClick={() => void drill.repeat(mode)}
            >
              Repeat{repeats > 0 ? ` (${repeats})` : ""}
            </Button>
            <Button
              variant="ghost"
              icon={Eye}
              disabled={!answering}
              title={`${PRIMARY_MODIFIER_LABEL}+Shift+Enter`}
              onClick={() => void drill.reveal(mode)}
            >
              Reveal
            </Button>
          </>
        )}
        {phase !== "unsaved" && phase !== "closing" && phase !== "saving" && (
          <Button variant="ghost" icon={Square} title="Esc" onClick={() => void drill.stop(mode)}>
            Stop
          </Button>
        )}
      </div>
    </section>
  );
}

/* Results ----------------------------------------------------------------- */

function ResultsPanel({ mode }: { mode: DrillMode }) {
  const use = drillStores[mode];
  const summary = use((s) => s.summary);
  const replay = use((s) => s.replay);
  const actionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    actionsRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [summary]);
  if (!summary) return null;
  return (
    <>
      <section className={ui.card} aria-labelledby={`${mode}-results`}>
        <h2 id={`${mode}-results`} className={ui.cardTitle}>
          Results
        </h2>
        <ScoreMetrics score={summary.totals} cpm={summary.cpm} />
        {!summary.completed && (
          <p className={ui.outcome}>
            Stopped after {summary.items.length} of {summary.planned} items. The answered items are
            saved.
          </p>
        )}
        <WeakChars title="Weakest this session" weak={summary.weak} onPractise={practiseChars} />
      </section>

      <section className={ui.card} aria-labelledby={`${mode}-items`}>
        <h2 id={`${mode}-items`} className={ui.cardTitle}>
          What was sent, and what you typed
        </h2>
        <ol className={styles.itemList}>
          {summary.items.map((r, i) => (
            <ResultRow
              key={i}
              mode={mode}
              result={r}
              index={i}
              replayToken={replay?.index === i ? replay.token : null}
              replaying={replay?.index === i}
            />
          ))}
        </ol>
        <DiffLegend />
      </section>

      <div className={ui.startRow} ref={actionsRef}>
        <Button
          variant="primary"
          icon={RotateCcw}
          title={`${PRIMARY_MODIFIER_LABEL}+Enter`}
          onClick={() => void drill.start(mode)}
        >
          New session
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            drill.dismissResults(mode);
          }}
        >
          Back to setup
        </Button>
      </div>
    </>
  );
}

function ResultRow({
  mode,
  result,
  index,
  replayToken,
  replaying,
}: {
  mode: DrillMode;
  result: ItemResult;
  index: number;
  replayToken: number | null;
  replaying: boolean;
}) {
  const tags = [
    result.revealed ? "revealed" : null,
    result.repeats > 0 ? `${result.repeats} ${result.repeats === 1 ? "repeat" : "repeats"}` : null,
  ].filter(Boolean);
  return (
    <li className={styles.itemRow}>
      <span className={styles.itemNo}>{index + 1}</span>
      <Button
        size="sm"
        variant="ghost"
        icon={replaying ? Square : Volume2}
        aria-label={replaying ? "Stop replay" : `Replay item ${index + 1}`}
        onClick={() => {
          if (replaying) drill.stopReplay(mode);
          else void drill.replayItem(mode, index);
        }}
      />
      <Diff ops={result.score.ops} prompt={result.item.text} replayToken={replayToken} />
      {result.item.meaning && <span className={ui.muted}>{result.item.meaning}</span>}
      {tags.length > 0 && <span className={styles.itemTags}>{tags.join(" · ")}</span>}
    </li>
  );
}
