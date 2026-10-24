import { Shuffle } from "lucide-react";
import { useEffect, useState } from "react";
import { Banner, Button } from "../../components/ui";
import { ALPHABET } from "../../core/alphabet";
import { kochOrder, maxKochLevel } from "../../core/koch";
import { median, TARGET_SAMPLE } from "../../core/icr";
import {
  accuracySince,
  confusions,
  daysBefore,
  dayStart,
  missedCount,
  practiceMsSince,
  weakForPractice,
  WEAK_MIN_ATTEMPTS,
  type Confusion,
} from "../../core/stats";
import { errorText, requireStore, useApp } from "../../state/app";
import { useSettings } from "../../state/settings";
import type { CharStatRow, Mode, Session } from "../../storage/schemas";
import ui from "../copy/copy.module.css";
import { pct } from "../copy/format";
import { learnedKochChars } from "../drill/modes";
import { practiseChars } from "../drill/practise";
import { recentMedianMs } from "../icr/controller";
import styles from "./stats.module.css";

/**
 * Stats (SPEC §7.10, trimmed in §15): overview tiles, the character grid with
 * what each character is confused with, the session history and "Practise my
 * weak characters".
 */

const HISTORY_PAGE = 20;

const MODE_LABEL: Record<Mode, string> = {
  koch: "Koch lesson",
  icr: "Instant Recognition",
  groups: "Random Groups",
  words: "Words",
  callsigns: "Callsigns",
  custom: "Custom",
  qso: "QSO",
  send: "Sending",
  player: "Text Player",
};

const SYMBOL_ORDER = new Map(ALPHABET.map((s, i) => [s.symbol, i]));
const minutes = (ms: number) => `${Math.round(ms / 60_000)} min`;

interface Overview {
  sessions: Session[];
  stats: CharStatRow[];
  learned: readonly string[];
  kochLevel: number;
  kochMax: number;
  kochOrderName: string;
  icrMedianMs: number | null;
  /** When this was loaded; "today" and "last 7 days" count from here. */
  loadedAt: number;
}

export function StatsScreen() {
  const profileId = useApp((s) => s.current?.id);
  const orderId = useSettings((s) => s.values["learning.kochOrder"]);
  // Each is tagged with what it was loaded for, so nothing from the last
  // profile (or Koch order) shows after a switch.
  const [data, setData] = useState<{ key: string; overview: Overview } | null>(null);
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);
  const [picked, setPicked] = useState<{ profileId: string; ch: string } | null>(null);
  const key = `${profileId ?? ""}|${orderId}`;

  useEffect(() => {
    let live = true;
    if (!profileId) return;
    const load = async (): Promise<Overview> => {
      const db = requireStore();
      const v = useSettings.getState().values;
      const order = kochOrder(v["learning.kochOrder"]);
      const learned = await learnedKochChars(db, profileId, v);
      return {
        sessions: await db.listSessions(profileId),
        stats: await db.getCharStats(profileId),
        learned,
        kochLevel: learned.length - 1,
        kochMax: maxKochLevel(order),
        kochOrderName: order.name,
        icrMedianMs: await recentMedianMs(db, profileId),
        loadedAt: Date.now(),
      };
    };
    load().then(
      (overview) => {
        if (live) {
          setData({ key, overview });
          setFailed(null);
        }
      },
      (err: unknown) => {
        if (live) setFailed({ key, message: `Loading your stats failed: ${errorText(err)}` });
      },
    );
    return () => {
      live = false;
    };
  }, [key, profileId]);

  const overview = data?.key === key ? data.overview : null;
  const error = failed?.key === key ? failed.message : null;
  const selected = picked && picked.profileId === profileId ? picked.ch : null;
  const setSelected = (ch: string | null) => {
    setPicked(ch && profileId ? { profileId, ch } : null);
  };

  return (
    <div className={ui.page}>
      <header>
        <p className={ui.eyebrow}>Progress</p>
        <h1 className={ui.title}>Stats</h1>
      </header>
      {error && <Banner tone="danger">{error}</Banner>}
      {!overview ? (
        !error && (
          <div className={ui.card} aria-busy="true">
            <span className={ui.srOnly}>Loading your stats…</span>
          </div>
        )
      ) : (
        <>
          <OverviewTiles o={overview} />
          <CharGrid o={overview} selected={selected} onSelect={setSelected} />
          {selected && profileId && (
            <CharDetail
              key={selected}
              profileId={profileId}
              stat={overview.stats.find((s) => s.ch === selected) ?? null}
              ch={selected}
            />
          )}
          <History sessions={overview.sessions} />
        </>
      )}
    </div>
  );
}

/* Overview ---------------------------------------------------------------- */

function OverviewTiles({ o }: { o: Overview }) {
  const now = o.loadedAt;
  const today = practiceMsSince(o.sessions, dayStart(now));
  const week = accuracySince(o.sessions, daysBefore(now, 6));
  const weak = weakForPractice(o.stats, o.learned);
  return (
    <section className={ui.card} aria-labelledby="stats-overview">
      <h2 id="stats-overview" className={ui.cardTitle}>
        Overview
      </h2>
      <dl className={styles.tiles}>
        <div className={styles.tile}>
          <dt>Koch level</dt>
          <dd>
            {o.kochLevel} <span className={styles.of}>of {o.kochMax}</span>
          </dd>
          <dd className={styles.caption}>{o.kochOrderName} order</dd>
        </div>
        <div className={styles.tile}>
          <dt>Accuracy, last 7 days</dt>
          <dd>{week === null ? "—" : pct(week)}</dd>
        </div>
        <div className={styles.tile}>
          <dt>Practice today</dt>
          <dd>{minutes(today)}</dd>
        </div>
        <div className={styles.tile}>
          <dt>Instant Recognition median</dt>
          <dd>{o.icrMedianMs === null ? "—" : `${Math.round(o.icrMedianMs)} ms`}</dd>
          <dd className={styles.caption}>over your last {TARGET_SAMPLE} correct answers</dd>
        </div>
      </dl>
      <div className={ui.startRow}>
        <Button
          variant="primary"
          icon={Shuffle}
          disabled={weak.length < 2}
          onClick={() => {
            practiseChars(weak, "adaptive");
          }}
        >
          Practise my weak characters
        </Button>
        <span className={ui.muted}>
          {weak.length >= 2
            ? `Random Groups on ${weak.join(" ")}.`
            : `Available once a character has ${WEAK_MIN_ATTEMPTS} attempts.`}
        </span>
      </div>
    </section>
  );
}

/* Character grid ---------------------------------------------------------- */

function CharGrid({
  o,
  selected,
  onSelect,
}: {
  o: Overview;
  selected: string | null;
  onSelect: (ch: string | null) => void;
}) {
  const byCh = new Map(o.stats.map((s) => [s.ch, s]));
  const chars = [...new Set([...o.learned, ...o.stats.map((s) => s.ch)])].sort(
    (a, b) => (SYMBOL_ORDER.get(a) ?? 999) - (SYMBOL_ORDER.get(b) ?? 999),
  );
  return (
    <section className={ui.card} aria-labelledby="stats-chars">
      <h2 id="stats-chars" className={ui.cardTitle}>
        Characters
      </h2>
      <p className={ui.muted}>
        Shaded by recent accuracy. Choose a character to see what you hear it as.
      </p>
      <ul className={styles.grid}>
        {chars.map((ch) => {
          const stat = byCh.get(ch);
          const label = stat
            ? `${ch}: ${pct(stat.ewmaAcc)} recent accuracy, ${stat.attempts} ${stat.attempts === 1 ? "attempt" : "attempts"}, last practised ${new Date(stat.lastSeen).toLocaleDateString()}`
            : `${ch}: not practised yet`;
          return (
            <li key={ch}>
              <button
                type="button"
                className={[styles.charTile, stat ? "" : styles.unseen].join(" ")}
                style={
                  stat ? ({ "--acc": stat.ewmaAcc.toFixed(2) } as React.CSSProperties) : undefined
                }
                aria-pressed={selected === ch}
                aria-label={label}
                title={label}
                onClick={() => {
                  onSelect(selected === ch ? null : ch);
                }}
              >
                <span className={styles.charGlyph}>{ch}</span>
                <span className={styles.charValue}>{stat ? pct(stat.ewmaAcc) : "new"}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CharDetail({
  profileId,
  ch,
  stat,
}: {
  profileId: string;
  ch: string;
  stat: CharStatRow | null;
}) {
  const [detail, setDetail] = useState<{
    confused: Confusion[];
    missed: number;
    rtMs: number | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const attempts = stat?.attempts ?? 0;
  useEffect(() => {
    let live = true;
    if (attempts === 0) return;
    const db = requireStore();
    Promise.all([
      db.countCharOutcomes(profileId, ch),
      // The same sample as the overview median: correct answers only.
      db.queryCharEvents(profileId, {
        ch,
        mode: "icr",
        outcome: "correct",
        withResponse: true,
        limit: TARGET_SAMPLE,
      }),
    ]).then(
      ([tallies, timed]) => {
        if (!live) return;
        setDetail({
          confused: confusions(tallies, attempts),
          missed: missedCount(tallies),
          rtMs: timed.length > 0 ? median(timed.map((e) => e.responseMs as number)) : null,
        });
      },
      (err: unknown) => {
        if (live) setError(`Loading ${ch} failed: ${errorText(err)}`);
      },
    );
    return () => {
      live = false;
    };
  }, [profileId, ch, attempts]);

  return (
    <section className={ui.card} aria-labelledby="stats-char" aria-live="polite">
      <h2 id="stats-char" className={ui.cardTitle}>
        <span className={styles.detailGlyph}>{ch}</span>
      </h2>
      {error && <Banner tone="danger">{error}</Banner>}
      {!stat ? (
        <p className={ui.muted}>Not practised yet.</p>
      ) : (
        <>
          <dl className={ui.metrics}>
            <div>
              <dt>Recent accuracy</dt>
              <dd>{pct(stat.ewmaAcc)}</dd>
            </div>
            <div>
              <dt>All time</dt>
              <dd>
                {stat.correct} / {stat.attempts}
              </dd>
            </div>
            <div>
              <dt>Median response (ICR)</dt>
              <dd>{detail?.rtMs == null ? "—" : `${Math.round(detail.rtMs)} ms`}</dd>
            </div>
            <div>
              <dt>Last practised</dt>
              <dd>{new Date(stat.lastSeen).toLocaleDateString()}</dd>
            </div>
          </dl>
          {detail && (
            <div className={ui.weak}>
              <h3 className={ui.label}>Most confused with</h3>
              {detail.confused.length === 0 ? (
                <p className={ui.muted}>Never heard as another character.</p>
              ) : (
                <ul className={styles.confusions}>
                  {detail.confused.slice(0, 5).map((c) => (
                    <li key={c.typed}>
                      You hear <strong>{ch}</strong> as <strong>{c.typed}</strong> {pct(c.share)} of
                      the time ({c.count}×)
                    </li>
                  ))}
                </ul>
              )}
              {detail.missed > 0 && (
                <p className={ui.muted}>
                  Missed (nothing typed) {detail.missed}× of {stat.attempts}.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/* History ----------------------------------------------------------------- */

function History({ sessions }: { sessions: readonly Session[] }) {
  const [shown, setShown] = useState(HISTORY_PAGE);
  const scored = sessions.filter((s) => s.sentChars > 0);
  return (
    <section className={ui.card} aria-labelledby="stats-history">
      <h2 id="stats-history" className={ui.cardTitle}>
        Sessions
      </h2>
      {scored.length === 0 ? (
        <p className={ui.muted}>No scored sessions yet.</p>
      ) : (
        <>
          <ol className={styles.history}>
            {scored.slice(0, shown).map((s) => (
              <li key={s.id} className={styles.session}>
                <span className={styles.when}>
                  {new Date(s.startedAt).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </span>
                <span className={styles.mode}>{MODE_LABEL[s.mode]}</span>
                <span className={styles.score}>{s.accuracy === null ? "—" : pct(s.accuracy)}</span>
                <span className={ui.muted}>
                  {s.correctChars}/{s.sentChars} · {minutes(s.activeMs)}
                  {s.completed ? "" : " · stopped early"}
                </span>
              </li>
            ))}
          </ol>
          {scored.length > shown && (
            <div className={ui.startRow}>
              <Button
                variant="ghost"
                onClick={() => {
                  setShown((n) => n + HISTORY_PAGE);
                }}
              >
                Show more ({scored.length - shown} older)
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
