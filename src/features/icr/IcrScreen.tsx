import { Play, RotateCcw, Square } from "lucide-react";
import { useEffect, useRef } from "react";
import { hasPrimaryModifier, PRIMARY_MODIFIER_LABEL } from "../../app/shortcuts";
import { Segmented, Slider, Toggle } from "../../components/controls";
import { Banner, Button, Field } from "../../components/ui";
import { lookupSymbol } from "../../core/alphabet";
import { parseCustomCharset } from "../../core/charset";
import {
  ICR_COUNT_MAX,
  ICR_COUNT_MIN,
  ICR_MINUTES_MAX,
  ICR_MINUTES_MIN,
  ICR_TIMEOUT_MAX_MS,
  ICR_TIMEOUT_MIN_MS,
  icrChars,
  SINGLE_KEY_CHARS,
  TARGET_SAMPLE,
  targetTimeout,
} from "../../core/icr";
import { useApp } from "../../state/app";
import { useSettings } from "../../state/settings";
import {
  CUSTOM_CHARSET_MAX,
  type IcrCharset,
  type IcrRoundKind,
} from "../../state/settings-schema";
import { WeakChars } from "../copy/CopyParts";
import ui from "../copy/copy.module.css";
import { clock, pct } from "../copy/format";
import { useLearnedChars } from "../copy/useLearnedChars";
import { practiseChars } from "../drill/practise";
import * as icr from "./controller";
import { useIcrStore } from "./store";
import styles from "./icr.module.css";

const ms = (v: number) => `${Math.round(v)} ms`;
/** Punctuation by name for screen readers, which may skip a bare "." or ",". */
const spoken = (ch: string) => lookupSymbol(ch)?.name ?? ch;
const seconds = (v: number) => `${(v / 1000).toFixed(1)} s`;

/** Instant Character Recognition (SPEC §7.2): one character, one keypress. */
export function IcrScreen() {
  const phase = useIcrStore((s) => s.phase);
  const error = useIcrStore((s) => s.error);
  const notice = useIcrStore((s) => s.notice);
  const set = useIcrStore((s) => s.set);
  const profileId = useApp((s) => s.current?.id);

  useEffect(() => {
    if (!icr.roundInProgress()) void icr.loadStats();
  }, [profileId]);

  // A hidden window or leaving the screen pauses (SPEC §13).
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") icr.pause("hidden");
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      icr.pause("left");
    };
  }, []);

  // A dialog or menu (the shortcut list, the speed chip, a profile menu) takes
  // the keyboard, so the round pauses while one is open rather than time out.
  useEffect(() => {
    const check = () => {
      if (document.querySelector('[role="dialog"]')) icr.pause("overlay");
    };
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
    };
  }, []);

  // Answer keys are taken in the capture phase, before any other shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // An open dialog or popover owns the keyboard (this listener runs before theirs).
      if (e.repeat || document.querySelector('[role="dialog"]')) return;
      const p = useIcrStore.getState().phase;
      const inRound = p === "listening" || p === "feedback" || p === "resuming";
      if (e.key === "Escape") {
        if (icr.roundInProgress()) {
          e.preventDefault();
          void icr.stop();
        }
        return;
      }
      if (e.key === "Enter" && hasPrimaryModifier(e) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (p === "idle" || p === "results") void icr.start();
        else if (p === "paused") void icr.resume();
        else if (p === "unsaved") void icr.retrySave();
        else if (p === "unclosed") void icr.retryFinish();
        return;
      }
      // AltGr arrives as Ctrl+Alt on Windows; it types characters such as @, so it's allowed.
      const altGr = e.getModifierState("AltGraph");
      if (!altGr && (e.ctrlKey || e.metaKey || e.altKey)) return;
      if (p === "listening" && icr.onKey(e.key, e.timeStamp)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // Mid-round, Space, Enter and ? mustn't press a button or open the shortcut list.
      if (inRound && (e.key === " " || e.key === "Enter" || e.key === "?")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
    };
  }, []);

  return (
    <div className={ui.page}>
      <header>
        <p className={ui.eyebrow}>Learn</p>
        <h1 className={ui.title}>Instant Character Recognition</h1>
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
      <Announcer />
      {phase === "idle" ? <Setup /> : phase === "results" ? <Results /> : <Stage />}
    </div>
  );
}

/** Screen-reader announcements (SPEC §10.6): each answer, then the round. */
function Announcer() {
  const phase = useIcrStore((s) => s.phase);
  const answer = useIcrStore((s) => s.answer);
  const result = useIcrStore((s) => s.result);
  const text = result
    ? `Round over: ${pct(result.summary.accuracy)} correct, median ${result.summary.medianMs === null ? "none" : ms(result.summary.medianMs)}.`
    : phase === "feedback" && answer
      ? answer.correct
        ? `Correct, ${ms(answer.responseMs)}.`
        : `${answer.typed === null ? "Too slow" : `Not ${spoken(answer.typed)}`}: it was ${spoken(answer.ch)}.`
      : phase === "listening" && !answer
        ? "Listen, then press the character's key."
        : phase === "paused"
          ? "Paused."
          : phase === "unsaved"
            ? "An answer couldn't be saved."
            : "";
  return (
    <p className={ui.srOnly} role="status">
      {text}
    </p>
  );
}

/* Setup ------------------------------------------------------------------- */

function Setup() {
  const v = useSettings((s) => s.values);
  const set = useSettings((s) => s.set);
  const medianMs = useIcrStore((s) => s.medianMs);
  const slowest = useIcrStore((s) => s.slowest);
  const learned = useLearnedChars();

  const source: readonly string[] | null =
    v["icr.charset"] === "koch"
      ? learned.chars
      : v["icr.charset"] === "all"
        ? SINGLE_KEY_CHARS
        : parseCustomCharset(v["icr.custom"]).chars;
  const set_ = source === null ? null : icrChars(source);
  const unsupported =
    v["icr.charset"] === "custom" ? parseCustomCharset(v["icr.custom"]).unsupported : [];
  const enough = set_ !== null && set_.chars.length >= 2;
  const target = targetTimeout(medianMs, v["icr.timeoutMs"]);

  return (
    <section className={ui.card} aria-labelledby="icr-setup">
      <h2 id="icr-setup" className={ui.cardTitle}>
        Setup
      </h2>
      <div className={ui.setupGrid}>
        <div className={ui.setupItem}>
          <span className={ui.label}>Characters</span>
          <Segmented<IcrCharset>
            label="Character set"
            value={v["icr.charset"]}
            options={[
              { value: "koch", label: "Koch learned" },
              { value: "all", label: "All" },
              { value: "custom", label: "Custom" },
            ]}
            onChange={(x) => {
              set("icr.charset", x);
            }}
          />
          {v["icr.charset"] === "custom" && (
            <Field
              label="Your characters"
              value={v["icr.custom"]}
              maxLength={CUSTOM_CHARSET_MAX}
              spellCheck={false}
              autoComplete="off"
              placeholder="e.g. KMRSUAPTLOWI"
              onChange={(e) => {
                set("icr.custom", e.currentTarget.value);
              }}
              error={unsupported.length > 0 ? `No Morse code for: ${unsupported.join(" ")}` : null}
            />
          )}
          {set_ && set_.chars.length > 0 && (
            <p className={`${ui.muted} ${styles.preview}`} aria-live="polite">
              {set_.chars.join(" ")}
            </p>
          )}
          {set_ && set_.excluded.length > 0 && (
            <p className={styles.warn}>
              Prosigns can't be answered with one key, so these are left out:{" "}
              {set_.excluded.join(" ")}
            </p>
          )}
          {learned.error && v["icr.charset"] === "koch" && (
            <p className={styles.warn}>Couldn't load your Koch level: {learned.error}</p>
          )}
        </div>
        <div className={ui.setupItem}>
          <Slider
            label="Timeout"
            min={ICR_TIMEOUT_MIN_MS}
            max={ICR_TIMEOUT_MAX_MS}
            step={100}
            value={v["icr.timeoutMs"]}
            display={seconds(v["icr.timeoutMs"])}
            onChange={(n) => {
              set("icr.timeoutMs", n);
            }}
          />
          <div className={styles.toggles}>
            <Toggle
              pressed={v["icr.target"]}
              onChange={(p) => {
                set("icr.target", p);
              }}
            >
              Target
            </Toggle>
            <Toggle
              pressed={v["icr.tick"]}
              onChange={(p) => {
                set("icr.tick", p);
              }}
            >
              Tick when correct
            </Toggle>
          </div>
          <p className={ui.muted} aria-live="polite">
            Target sets the timeout to your median over your last {TARGET_SAMPLE} correct answers,
            minus 10%: never below 0.3 s, and never above the timeout set here.{" "}
            {medianMs === null
              ? "No ICR answers yet, so Target uses the timeout."
              : `Your median: ${ms(medianMs)}.${v["icr.target"] ? ` Target timeout: ${seconds(target)}.` : ""}`}
          </p>
        </div>
        <div className={ui.setupItem}>
          <span className={ui.label}>Round</span>
          <Segmented<IcrRoundKind>
            label="Round length"
            value={v["icr.roundKind"]}
            options={[
              { value: "count", label: "Characters" },
              { value: "minutes", label: "Minutes" },
            ]}
            onChange={(x) => {
              set("icr.roundKind", x);
            }}
          />
          {v["icr.roundKind"] === "count" ? (
            <Slider
              label="Characters"
              min={ICR_COUNT_MIN}
              max={ICR_COUNT_MAX}
              step={10}
              value={v["icr.count"]}
              display={String(v["icr.count"])}
              onChange={(n) => {
                set("icr.count", n);
              }}
            />
          ) : (
            <Slider
              label="Minutes"
              min={ICR_MINUTES_MIN}
              max={ICR_MINUTES_MAX}
              value={v["icr.minutes"]}
              display={`${v["icr.minutes"]} min`}
              onChange={(n) => {
                set("icr.minutes", n);
              }}
            />
          )}
        </div>
      </div>
      <p className={ui.muted}>
        {v["learning.adaptive"]
          ? "Characters you miss or answer slowly come up more often (Settings → Learning)."
          : "Characters are drawn evenly: adaptive practice is off in Settings → Learning."}
        {slowest.length > 0 &&
          ` Slowest for you: ${slowest.map((x) => `${x.ch} ${ms(x.ewmaRt)}`).join(", ")}.`}
      </p>
      <div className={ui.startRow}>
        <Button variant="primary" icon={Play} disabled={!enough} onClick={() => void icr.start()}>
          Start
        </Button>
        {set_ === null ? (
          <span className={ui.muted}>Loading your characters…</span>
        ) : !enough ? (
          <span className={styles.warn}>Choose at least two characters.</span>
        ) : (
          <span className={ui.muted}>
            Press the character's key as soon as you know it, no Enter needed.{" "}
            <kbd>{PRIMARY_MODIFIER_LABEL}</kbd>+<kbd>Enter</kbd> starts, <kbd>Esc</kbd> stops.
          </span>
        )}
      </div>
    </section>
  );
}

/* Round ------------------------------------------------------------------- */

function Stage() {
  const phase = useIcrStore((s) => s.phase);
  const answered = useIcrStore((s) => s.answered);
  const total = useIcrStore((s) => s.total);
  const remainingMs = useIcrStore((s) => s.remainingMs);
  const answer = useIcrStore((s) => s.answer);
  const timeoutMs = useIcrStore((s) => s.timeoutMs);
  const targetMedianMs = useIcrStore((s) => s.targetMedianMs);
  const pausedBy = useIcrStore((s) => s.pausedBy);
  const stageRef = useRef<HTMLDivElement>(null);

  // Keep focus off the buttons, so Space or Enter can't press one by accident.
  useEffect(() => {
    if (phase === "listening" && !document.querySelector('[role="dialog"]')) {
      stageRef.current?.focus();
    }
  }, [phase]);

  const glyph =
    phase === "feedback" && answer ? (
      <span className={`${styles.glyph} ${answer.correct ? styles.ok : styles.bad}`}>
        {answer.ch}
      </span>
    ) : (
      <span className={`${styles.glyph} ${styles.waiting}`} aria-hidden="true">
        {phase === "listening" ? "·" : " "}
      </span>
    );
  const note =
    phase === "feedback" && answer
      ? answer.correct
        ? `Correct · ${ms(answer.responseMs)}`
        : answer.typed === null
          ? "Too slow"
          : `You pressed ${answer.typed}`
      : phase === "listening"
        ? "Press the key"
        : phase === "starting" || phase === "resuming"
          ? "Get ready…"
          : phase === "paused"
            ? pausedBy === "hidden"
              ? "Paused: the window was hidden"
              : pausedBy === "left"
                ? "Paused: you left the screen"
                : pausedBy === "overlay"
                  ? "Paused while a menu or dialog was open"
                  : "Paused"
            : phase === "unsaved"
              ? "An answer couldn't be saved"
              : phase === "closing"
                ? "Finishing…"
                : phase === "unclosed"
                  ? "The round couldn't be closed"
                  : "";

  return (
    <section className={ui.card} aria-labelledby="icr-round">
      <div className={ui.lessonHead}>
        <h2 id="icr-round" className={ui.cardTitle}>
          {timeoutMs === null
            ? "Round"
            : targetMedianMs !== null
              ? `Target ${seconds(timeoutMs)} (your median ${ms(targetMedianMs)})`
              : `Timeout ${seconds(timeoutMs)}`}
        </h2>
        <span className={styles.counter}>
          {total !== null ? (
            <>
              <span aria-hidden="true">
                {answered} / {total}
              </span>
              <span className={ui.srOnly}>
                {answered} of {total} answered
              </span>
            </>
          ) : remainingMs !== null ? (
            <span aria-label="Time left">{clock(remainingMs)}</span>
          ) : null}
        </span>
      </div>
      <div
        ref={stageRef}
        className={styles.stage}
        tabIndex={-1}
        role="application"
        aria-label="Answer area: press each character's key"
      >
        {glyph}
        <span className={styles.stageNote}>{note}</span>
      </div>
      <div className={ui.startRow}>
        {phase === "paused" && (
          <Button variant="primary" icon={Play} onClick={() => void icr.resume()}>
            Resume
          </Button>
        )}
        {phase === "unsaved" && (
          <Button variant="primary" onClick={() => void icr.retrySave()}>
            Try saving again
          </Button>
        )}
        {phase === "unclosed" && (
          <>
            <Button variant="primary" onClick={() => void icr.retryFinish()}>
              Try again
            </Button>
            <Button onClick={icr.resultsWithoutClosing}>Show results anyway</Button>
          </>
        )}
        {phase !== "closing" && phase !== "unclosed" && (
          <Button variant="ghost" icon={Square} title="Esc" onClick={() => void icr.stop()}>
            Stop
          </Button>
        )}
      </div>
    </section>
  );
}

/* Results ----------------------------------------------------------------- */

function Results() {
  const result = useIcrStore((s) => s.result);
  const actionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    actionsRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [result]);
  if (!result) return null;
  const { summary } = result;
  const weak = summary.perChar
    .filter((c) => c.correct < c.attempts)
    .map((c) => ({
      ch: c.ch,
      attempts: c.attempts,
      correct: c.correct,
      accuracy: c.correct / c.attempts,
    }))
    .sort((a, b) => a.accuracy - b.accuracy || b.attempts - a.attempts)
    .slice(0, 5);
  return (
    <>
      <section className={ui.card} aria-labelledby="icr-results">
        <h2 id="icr-results" className={ui.cardTitle}>
          Results
        </h2>
        <dl className={ui.metrics}>
          <div>
            <dt>Accuracy</dt>
            <dd className={ui.metricBig}>{pct(summary.accuracy)}</dd>
          </div>
          <div>
            <dt>Correct</dt>
            <dd>
              {summary.correct} / {summary.attempts}
            </dd>
          </div>
          <div>
            <dt>Median (all answers)</dt>
            <dd>{summary.medianMs === null ? "—" : ms(summary.medianMs)}</dd>
          </div>
          <div>
            <dt>90th percentile</dt>
            <dd>{summary.p90Ms === null ? "—" : ms(summary.p90Ms)}</dd>
          </div>
        </dl>
        {!result.completed && (
          <p className={ui.outcome}>Stopped early. The answers so far are saved.</p>
        )}
        <p className={ui.muted}>
          {result.targetMedianMs !== null
            ? `Target timeout ${seconds(result.timeoutMs)}, from your median of ${ms(result.targetMedianMs)}. `
            : `Timeout ${seconds(result.timeoutMs)}. `}
          Times run from the end of each character's sound; a key pressed while it was still playing
          counts as 0 ms, and a timeout counts as the timeout.
          {result.estimated > 0 &&
            ` ${result.estimated} of ${summary.attempts} times were estimated from the audio output latency, because the device didn't report its output time then.`}
        </p>
        <WeakChars title="Most missed" weak={weak} onPractise={practiseChars} />
      </section>

      {summary.perChar.length > 0 && (
        <section className={ui.card} aria-labelledby="icr-chars">
          <h2 id="icr-chars" className={ui.cardTitle}>
            Per character, slowest first
          </h2>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Char</th>
                <th scope="col">Correct</th>
                <th scope="col">Median</th>
                <th scope="col">90th</th>
                <th scope="col">Slowest</th>
              </tr>
            </thead>
            <tbody>
              {summary.perChar.map((c) => (
                <tr key={c.ch}>
                  <td>{c.ch}</td>
                  <td>
                    {c.correct}/{c.attempts}
                  </td>
                  <td>{ms(c.medianMs)}</td>
                  <td>{ms(c.p90Ms)}</td>
                  <td>{ms(c.slowestMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <div className={ui.startRow} ref={actionsRef}>
        <Button
          variant="primary"
          icon={RotateCcw}
          title={`${PRIMARY_MODIFIER_LABEL}+Enter`}
          onClick={() => void icr.start()}
        >
          New round
        </Button>
        <Button variant="ghost" onClick={icr.dismissResults}>
          Back to setup
        </Button>
      </div>
    </>
  );
}
