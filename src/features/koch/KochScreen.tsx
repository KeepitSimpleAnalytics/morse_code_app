import {
  ArrowDownToLine,
  ArrowUpToLine,
  Pause,
  Play,
  RotateCcw,
  Square,
  Volume2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { hasPrimaryModifier, PRIMARY_MODIFIER_LABEL } from "../../app/shortcuts";
import { Segmented, Slider } from "../../components/controls";
import { MorsePills } from "../../components/MorsePills";
import { Banner, Button, ConfirmDialog, Dialog } from "../../components/ui";
import { lookupSymbol } from "../../core/alphabet";
import { kochOrder } from "../../core/koch";
import {
  LESSON_GROUPS_MAX,
  LESSON_GROUPS_MIN,
  LESSON_MINUTES_MAX,
  LESSON_MINUTES_MIN,
  type KochGroupSize,
} from "../../core/lesson";
import { useApp } from "../../state/app";
import { useSettings } from "../../state/settings";
import type { LessonLengthKind } from "../../state/settings-schema";
import { Diff, DiffLegend, LiveCode, ScoreMetrics, WeakChars } from "../copy/CopyParts";
import { clock, pct } from "../copy/format";
import ui from "../copy/copy.module.css";
import { practiseChars } from "../drill/practise";
import * as koch from "./controller";
import { useKochStore, type LessonResult, type LevelInfo } from "./store";
import styles from "./KochScreen.module.css";

/** Koch Lessons (SPEC §7.1). */
export function KochScreen() {
  const phase = useKochStore((s) => s.phase);
  const error = useKochStore((s) => s.error);
  const notice = useKochStore((s) => s.notice);
  const set = useKochStore((s) => s.set);
  const profileId = useApp((s) => s.current?.id);
  const orderId = useSettings((s) => s.values["learning.kochOrder"]);

  // (Re)load the level for this profile and order, unless a lesson is under way.
  useEffect(() => {
    if (!koch.lessonInProgress()) void koch.loadLevel();
  }, [profileId, orderId]);

  // A hidden window or leaving the screen pauses the lesson (SPEC §13).
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") koch.pauseLesson("hidden");
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      koch.pauseLesson("left");
      koch.stopReplay();
      if (useKochStore.getState().phase === "intro") koch.closeIntro();
    };
  }, []);

  // Ctrl+Enter starts a lesson, Esc stops one (SPEC §10.3).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const p = useKochStore.getState().phase;
      if (e.key === "Enter" && hasPrimaryModifier(e) && !e.shiftKey && !e.altKey) {
        if (p === "idle" || p === "results") {
          e.preventDefault();
          void koch.startLesson();
        } else if (p === "intro") {
          e.preventDefault();
          void koch.beginLesson();
        } else if (p === "finishing") {
          e.preventDefault();
          void koch.finishLesson();
        }
      } else if (e.key === "Escape" && !e.defaultPrevented) {
        if (p === "playing" || p === "paused" || p === "starting" || p === "resuming") {
          e.preventDefault();
          void koch.stopLesson();
        } else if (useKochStore.getState().replaying) {
          koch.stopReplay();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className={ui.page}>
      <header>
        <p className={ui.eyebrow}>Learn</p>
        <h1 className={ui.title}>Koch Lessons</h1>
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
      <ResultAnnouncer />
      {phase === "loading" ? (
        <div className={ui.card} aria-busy={error ? undefined : true}>
          {error && (
            <div className={ui.startRow}>
              <Button onClick={() => void koch.loadLevel()}>Try again</Button>
            </div>
          )}
        </div>
      ) : phase === "idle" ? (
        <>
          <LevelCard />
          <LessonSetup />
        </>
      ) : phase === "intro" ? (
        <IntroPanel />
      ) : phase === "results" ? (
        <ResultsPanel />
      ) : (
        <LessonPanel />
      )}
    </div>
  );
}

/** Announces a lesson's result to screen readers (SPEC §10.6). Always mounted. */
function ResultAnnouncer() {
  const result = useKochStore((s) => s.result);
  let text = "";
  if (result) {
    const { outcome } = result;
    text = `Lesson scored: ${pct(result.score.accuracy)} accuracy, ${result.score.correct} of ${result.score.sentCharCount} correct.`;
    if (outcome.passed && result.decision === "advanced") {
      text += ` You moved up to level ${result.level + 1}.`;
    } else if (outcome.passed) {
      text += " You passed.";
    } else if (result.suggestStepBack) {
      text += " Going back a level is suggested.";
    }
  }
  return (
    <p className={ui.srOnly} role="status">
      {text}
    </p>
  );
}

/* Level card -------------------------------------------------------------- */

function CharTile({ ch, info, isNew }: { ch: string; info: LevelInfo; isNew: boolean }) {
  const stat = info.stats[ch];
  const acc = stat?.ewmaAcc;
  const label = stat
    ? `${ch}: ${pct(stat.ewmaAcc)} accuracy over ${stat.attempts} attempts`
    : `${ch}: not practised yet`;
  return (
    <li
      className={[styles.tile, stat ? "" : styles.tileUnseen, isNew ? styles.tileNew : ""].join(
        " ",
      )}
      style={
        acc === undefined
          ? undefined
          : ({ "--acc": `${Math.round(acc * 100)}%` } as React.CSSProperties)
      }
      title={label}
      aria-label={label}
    >
      <span className={styles.tileChar}>{ch}</span>
      <span className={styles.tileValue}>{stat ? pct(stat.ewmaAcc) : "new"}</span>
    </li>
  );
}

function LevelCard() {
  const info = useKochStore((s) => s.info);
  const [jumping, setJumping] = useState(false);
  if (!info) return null;
  const newest = info.chars[info.chars.length - 1] ?? "";
  const order = kochOrder(info.orderId);
  return (
    <section className={ui.card} aria-labelledby="koch-level">
      <div className={styles.levelHead}>
        <div>
          <p className={ui.kicker}>{order.name} order</p>
          <h2 id="koch-level" className={styles.levelTitle}>
            Level {info.level}
            <span className={styles.levelOf}> of {info.maxLevel}</span>
          </h2>
          <p className={ui.muted}>
            {info.chars.length} characters learned · newest <strong>{newest}</strong>
          </p>
        </div>
        <dl className={styles.facts}>
          <div>
            <dt>Best lesson here</dt>
            <dd>{info.bestAccuracy === null ? "—" : pct(info.bestAccuracy)}</dd>
          </div>
          <div>
            <dt>Lessons at this level</dt>
            <dd>{info.lessons}</dd>
          </div>
        </dl>
      </div>
      <ul className={styles.tiles} aria-label="Learned characters">
        {info.chars.map((ch) => (
          <CharTile key={ch} ch={ch} info={info} isNew={ch === newest} />
        ))}
      </ul>
      <div className={ui.actions}>
        <Button size="sm" icon={Volume2} onClick={() => void koch.openIntro()}>
          {info.level === 1 ? "Hear K and M" : `Hear ${newest} again`}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setJumping(true);
          }}
        >
          Jump to level…
        </Button>
      </div>
      {jumping && (
        <JumpDialog
          info={info}
          onClose={() => {
            setJumping(false);
          }}
        />
      )}
    </section>
  );
}

function JumpDialog({ info, onClose }: { info: LevelInfo; onClose: () => void }) {
  const [target, setTarget] = useState(info.level);
  const [confirming, setConfirming] = useState(false);
  const order = kochOrder(info.orderId);
  const chars = order.chars.slice(0, target + 1);
  if (confirming) {
    return (
      <ConfirmDialog
        title={`Jump to level ${target}?`}
        confirmLabel="Jump"
        onCancel={() => {
          setConfirming(false);
        }}
        onConfirm={() => {
          void koch.jumpToLevel(target).then(onClose);
        }}
      >
        <p>
          You'll practise {chars.length} characters. Your lesson history and character stats are
          kept, and you can come back to level {info.level} the same way.
        </p>
      </ConfirmDialog>
    );
  }
  return (
    <Dialog
      title="Jump to level"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={target === info.level}
            onClick={() => {
              setConfirming(true);
            }}
          >
            Continue
          </Button>
        </>
      }
    >
      <Slider
        label="Level"
        min={1}
        max={info.maxLevel}
        value={target}
        display={String(target)}
        onChange={setTarget}
      />
      <p className={styles.jumpChars} aria-live="polite">
        {chars.join(" ")}
      </p>
    </Dialog>
  );
}

/* Lesson setup ------------------------------------------------------------ */

function LessonSetup() {
  const v = useSettings((s) => s.values);
  const setSetting = useSettings((s) => s.set);
  return (
    <section className={ui.card} aria-labelledby="koch-setup">
      <h2 id="koch-setup" className={ui.cardTitle}>
        Lesson
      </h2>
      <div className={ui.setupGrid}>
        <div className={ui.setupItem}>
          <span className={ui.label}>Length</span>
          <Segmented<LessonLengthKind>
            label="Lesson length"
            value={v["koch.lengthKind"]}
            options={[
              { value: "minutes", label: "Minutes" },
              { value: "groups", label: "Groups" },
            ]}
            onChange={(x) => {
              setSetting("koch.lengthKind", x);
            }}
          />
          {v["koch.lengthKind"] === "minutes" ? (
            <Slider
              label="Minutes"
              min={LESSON_MINUTES_MIN}
              max={LESSON_MINUTES_MAX}
              value={v["koch.minutes"]}
              display={`${v["koch.minutes"]} min`}
              onChange={(m) => {
                setSetting("koch.minutes", m);
              }}
            />
          ) : (
            <Slider
              label="Groups"
              min={LESSON_GROUPS_MIN}
              max={LESSON_GROUPS_MAX}
              step={5}
              value={v["koch.groups"]}
              display={`${v["koch.groups"]} groups`}
              onChange={(g) => {
                setSetting("koch.groups", g);
              }}
              hint="Lessons under a minute are scored but don't count towards passing."
            />
          )}
        </div>
        <div className={ui.setupItem}>
          <span className={ui.label}>Group size</span>
          <Segmented<KochGroupSize>
            label="Group size"
            value={v["koch.groupSize"]}
            options={[
              { value: "fixed", label: "5 characters" },
              { value: "random", label: "Random 2–7" },
            ]}
            onChange={(x) => {
              setSetting("koch.groupSize", x);
            }}
          />
        </div>
      </div>
      <div className={ui.startRow}>
        <Button variant="primary" icon={Play} onClick={() => void koch.startLesson()}>
          Start lesson
        </Button>
        <span className={ui.muted}>
          <kbd>{PRIMARY_MODIFIER_LABEL}</kbd>+<kbd>Enter</kbd> to start, <kbd>Esc</kbd> to stop.
          Type what you hear as you go. Speed and tone are in the chip at the top.
        </span>
      </div>
    </section>
  );
}

/* Intro ------------------------------------------------------------------- */

function IntroPanel() {
  const intro = useKochStore((s) => s.intro);
  if (!intro) return null;
  return (
    <section className={ui.card} aria-labelledby="koch-intro">
      <h2 id="koch-intro" className={ui.cardTitle}>
        {intro.chars.length > 1 ? "Your first two characters" : "A new character"}
      </h2>
      <p className={ui.muted}>
        Listen to the rhythm, not the dots and dashes. Each one plays three times.
      </p>
      <div className={styles.introChars}>
        {intro.chars.map((ch, i) => {
          const sym = lookupSymbol(ch);
          const active = intro.playing && intro.index === i;
          return (
            <div
              key={ch}
              className={[styles.introChar, active ? styles.introActive : ""].join(" ")}
            >
              <span className={styles.introGlyph}>{ch}</span>
              {sym && <MorsePills pattern={sym.pattern} size="md" />}
              <span className={styles.introPhonetic}>{sym?.phonetic}</span>
              {sym?.name && <span className={ui.muted}>{sym.name}</span>}
              <Button
                size="sm"
                variant="ghost"
                icon={Volume2}
                disabled={intro.playing}
                onClick={() => void koch.playIntro(i)}
              >
                Play
              </Button>
            </div>
          );
        })}
      </div>
      <div className={ui.startRow}>
        <Button variant="primary" icon={Play} onClick={() => void koch.beginLesson()}>
          {intro.playing ? "Skip and start lesson" : "Start lesson"}
        </Button>
        <Button variant="ghost" onClick={koch.closeIntro}>
          Back
        </Button>
      </div>
    </section>
  );
}

/* Lesson ------------------------------------------------------------------ */

function LessonPanel() {
  const phase = useKochStore((s) => s.phase);
  const typed = useKochStore((s) => s.typed);
  const remainingMs = useKochStore((s) => s.remainingMs);
  const pausedBy = useKochStore((s) => s.pausedBy);
  const heardToken = useKochStore((s) => s.heardToken);
  const set = useKochStore((s) => s.set);
  const showCode = useSettings((s) => s.values["display.showCode"]);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (phase === "playing" || phase === "finishing") ref.current?.focus();
  }, [phase]);

  return (
    <section className={ui.card} aria-labelledby="koch-lesson">
      <div className={ui.lessonHead}>
        <h2 id="koch-lesson" className={ui.cardTitle}>
          {phase === "paused"
            ? "Paused"
            : phase === "starting" || phase === "resuming"
              ? "Get ready…"
              : phase === "finishing"
                ? "Finish typing"
                : phase === "scoring"
                  ? "Scoring…"
                  : phase === "unsaved"
                    ? "Not saved yet"
                    : "Copy what you hear"}
        </h2>
        <span className={styles.timer} aria-label="Time left">
          {clock(remainingMs)}
        </span>
      </div>
      {phase === "paused" && (
        <p className={ui.muted}>
          {pausedBy === "hidden"
            ? "The window was hidden, so the lesson paused. "
            : pausedBy === "left"
              ? "You left the screen, so the lesson paused. "
              : ""}
          Resuming replays the group that was cut off.
        </p>
      )}
      {phase === "finishing" && (
        <p className={ui.muted}>
          That was the last group. Finish typing it, then press <kbd>Enter</kbd> to score.
        </p>
      )}
      {phase === "unsaved" && (
        <p className={ui.muted}>
          The stopped lesson couldn't be saved. Your typing is kept, so you can try again.
        </p>
      )}
      {showCode === "live" && phase === "playing" && <LiveCode pattern={livePattern(heardToken)} />}
      <textarea
        ref={ref}
        className={ui.copyBox}
        value={typed}
        aria-label="Your copy"
        spellCheck={false}
        autoCapitalize="characters"
        autoComplete="off"
        autoCorrect="off"
        disabled={phase === "scoring"}
        onChange={(e) => {
          set({ typed: e.currentTarget.value });
        }}
        onKeyDown={(e) => {
          if (phase === "finishing" && e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void koch.finishLesson();
          }
        }}
      />
      <div className={ui.startRow}>
        {phase === "finishing" ? (
          <Button variant="primary" onClick={() => void koch.finishLesson()}>
            Score lesson
          </Button>
        ) : phase === "unsaved" ? (
          <Button variant="primary" onClick={() => void koch.retryStopped()}>
            Try saving again
          </Button>
        ) : phase === "paused" ? (
          <Button variant="primary" icon={Play} onClick={() => void koch.resumeLesson()}>
            Resume
          </Button>
        ) : (
          <Button
            icon={Pause}
            disabled={phase !== "playing"}
            onClick={() => {
              koch.pauseLesson("user");
            }}
          >
            Pause
          </Button>
        )}
        {(phase === "playing" ||
          phase === "paused" ||
          phase === "starting" ||
          phase === "resuming") && (
          <Button variant="ghost" icon={Square} onClick={() => void koch.stopLesson()}>
            Stop and score
          </Button>
        )}
      </div>
    </section>
  );
}

/** The pattern of the character being heard, for "Show code: live". */
function livePattern(tokenIndex: number | null): string {
  const token = tokenIndex === null ? undefined : koch.currentPromptTokens()[tokenIndex];
  return token?.type === "char" ? token.symbol.pattern : "";
}

/* Results ----------------------------------------------------------------- */

function ResultsPanel() {
  const result = useKochStore((s) => s.result);
  const replaying = useKochStore((s) => s.replaying);
  const replayToken = useKochStore((s) => s.replayToken);
  if (!result) return null;
  const { score } = result;
  return (
    <>
      <section className={ui.card} aria-labelledby="koch-results">
        <h2 id="koch-results" className={ui.cardTitle}>
          Lesson results · level {result.level}
        </h2>
        <ScoreMetrics score={score} cpm={result.cpm} />
        <Outcome result={result} />
      </section>

      <section className={ui.card} aria-labelledby="koch-diff">
        <div className={ui.lessonHead}>
          <h2 id="koch-diff" className={ui.cardTitle}>
            What was sent, and what you typed
          </h2>
          {replaying ? (
            <Button size="sm" icon={Square} onClick={koch.stopReplay}>
              Stop replay
            </Button>
          ) : (
            <Button size="sm" icon={Volume2} onClick={() => void koch.replayWithText()}>
              Replay with text shown
            </Button>
          )}
        </div>
        <Diff ops={score.ops} prompt={result.prompt} replayToken={replayToken} />
        <DiffLegend />
        <WeakChars title="Weakest this lesson" weak={result.weak} onPractise={practiseChars} />
      </section>

      <div className={ui.startRow}>
        <Button variant="primary" icon={RotateCcw} onClick={() => void koch.startLesson()}>
          Next lesson
        </Button>
        <Button variant="ghost" onClick={koch.dismissResults}>
          Back to level
        </Button>
      </div>
    </>
  );
}

function Outcome({ result }: { result: LessonResult }) {
  const { outcome, decision } = result;
  if (outcome.notCounted === "stopped") {
    return (
      <p className={ui.outcome}>Stopped early: scored, but it doesn't count towards passing.</p>
    );
  }
  if (outcome.notCounted === "short") {
    return (
      <p className={ui.outcome}>
        Lessons under a minute are scored but don't count towards passing.
      </p>
    );
  }
  if (outcome.passed) {
    if (outcome.nextChar === null) {
      return (
        <p className={`${ui.outcome} ${ui.pass}`}>
          You passed, and you've learned every character in this order.
        </p>
      );
    }
    if (decision === "advanced") {
      return (
        <p className={`${ui.outcome} ${ui.pass}`}>
          {result.autoAdvanced ? "You passed and moved up" : "Moved up"} to level {result.level + 1}
          . Next lesson adds <strong>{outcome.nextChar}</strong>.
        </p>
      );
    }
    if (decision === "stayed") {
      return <p className={ui.outcome}>Staying at level {result.level}.</p>;
    }
    return (
      <div className={`${ui.outcome} ${ui.pass}`}>
        <p>
          You passed! Add <strong>{outcome.nextChar}</strong>?
        </p>
        <div className={ui.actions}>
          <Button
            variant="primary"
            size="sm"
            icon={ArrowUpToLine}
            onClick={() => void koch.advance()}
          >
            Advance
          </Button>
          <Button size="sm" onClick={koch.stay}>
            Stay
          </Button>
        </div>
      </div>
    );
  }
  if (result.suggestStepBack) {
    if (decision === "steppedBack") {
      return <p className={ui.outcome}>Back to level {result.level - 1}.</p>;
    }
    if (decision === "stayed") {
      return <p className={ui.outcome}>Staying at level {result.level}.</p>;
    }
    return (
      <div className={ui.outcome}>
        <p>
          Your last three lessons here were below{" "}
          {pct(useSettings.getState().values["learning.regressionFloor"])}. Going back a level for a
          while often helps.
        </p>
        <div className={ui.actions}>
          <Button size="sm" icon={ArrowDownToLine} onClick={() => void koch.stepBack()}>
            Go back to level {result.level - 1}
          </Button>
          <Button size="sm" variant="ghost" onClick={koch.stay}>
            Keep going
          </Button>
        </div>
      </div>
    );
  }
  return (
    <p className={ui.outcome}>
      {pct(useSettings.getState().values["learning.passThreshold"])} passes this level. Keep at it.
    </p>
  );
}
