import {
  AudioLines,
  BookOpen,
  Database,
  Gauge,
  Info,
  MonitorCog,
  Timer,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { audioEngine, LATENCY_WARN_MS, type LatencyReport } from "../../audio/engine";
import { Segmented, Slider, Toggle } from "../../components/controls";
import { ThemeSwitch } from "../../components/shell/ThemeSwitch";
import { Button, Dialog } from "../../components/ui";
import { CODE_FORMAT_LABELS, type CodeFormat } from "../../core/code-text";
import { KOCH_ORDERS } from "../../core/koch";
import {
  actualWpm,
  CHAR_WPM_MAX,
  CHAR_WPM_MIN,
  EFF_WPM_MIN,
  isLinked,
  withCharWpm,
  withEffWpm,
} from "../../core/speed";
import { WORD_SPACING_MAX, WORD_SPACING_MIN } from "../../core/timing";
import { errorText } from "../../state/app";
import { useSettings } from "../../state/settings";
import type { Advancement, ShowCode } from "../../state/settings-schema";
import { HowToLearnCards } from "../onboarding/Onboarding";
import { DataSection } from "./DataSection";
import { ProfileSection } from "./ProfileSection";
import styles from "./Settings.module.css";

interface SectionDef {
  id: string;
  label: string;
  icon: LucideIcon;
}

const SECTIONS: readonly SectionDef[] = [
  { id: "profile", label: "Profile", icon: UserRound },
  { id: "timing", label: "Timing", icon: Timer },
  { id: "audio", label: "Audio", icon: AudioLines },
  { id: "display", label: "Display", icon: MonitorCog },
  { id: "learning", label: "Learning", icon: BookOpen },
  { id: "data", label: "Data", icon: Database },
  { id: "about", label: "About", icon: Info },
];

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Settings (SPEC §10.2). Keys, realism and sidetone settings arrive with phases 8 and 9. */
export function SettingsScreen() {
  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <p className={styles.eyebrow}>App</p>
        <h1 className={styles.title}>Settings</h1>
        <p className={styles.lead}>
          Changes save on their own. Timing and audio here are for training; the Text Player keeps
          its own.
        </p>
      </header>
      <div className={styles.layout}>
        <nav className={styles.toc} aria-label="Settings sections">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <a key={id} href={`#settings-${id}`} className={styles.tocLink}>
              <Icon size={15} strokeWidth={1.8} aria-hidden="true" />
              {label}
            </a>
          ))}
        </nav>
        <div className={styles.sections}>
          <Section id="profile" title="Profile">
            <ProfileSection />
          </Section>
          <TimingSection />
          <AudioSection />
          <DisplaySection />
          <LearningSection />
          <Section id="data" title="Data">
            <DataSection />
          </Section>
          <AboutSection />
        </div>
      </div>
    </div>
  );
}

export function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={`settings-${id}`}
      className={styles.section}
      aria-labelledby={`settings-${id}-title`}
    >
      <div className={styles.sectionHead}>
        <h2 id={`settings-${id}-title`} className={styles.sectionTitle}>
          {title}
        </h2>
        {description && <p className={styles.sectionDesc}>{description}</p>}
      </div>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}

export function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <span className={styles.rowLabel}>{label}</span>
        {hint && <span className={styles.rowHint}>{hint}</span>}
      </div>
      <div className={styles.rowControl}>{children}</div>
    </div>
  );
}

function TimingSection() {
  const v = useSettings((s) => s.values);
  const set = useSettings((s) => s.set);
  const speeds = v["timing.speeds"];
  return (
    <Section
      id="timing"
      title="Timing"
      description="Characters keep their full speed; Farnsworth spacing slows the gaps between them."
    >
      <div className={styles.speedHero}>
        <span className={styles.speedBig}>{actualWpm(speeds)}</span>
        <span className={styles.speedUnit}>
          WPM actual
          <span className={styles.speedSub}>
            {isLinked(speeds)
              ? "Character and effective speed are linked"
              : `${speeds.charWpm} WPM characters · ${speeds.effWpm} WPM effective`}
          </span>
        </span>
      </div>
      <div className={styles.sliderGrid}>
        <Slider
          label="Character speed"
          min={CHAR_WPM_MIN}
          max={CHAR_WPM_MAX}
          value={speeds.charWpm}
          display={`${speeds.charWpm} WPM`}
          onChange={(c) => {
            set("timing.speeds", withCharWpm(speeds, c));
          }}
          hint="How fast each character is sent. 18–20 WPM or more teaches the sound, not the count."
        />
        <Slider
          label="Effective speed"
          min={EFF_WPM_MIN}
          max={speeds.charWpm}
          value={speeds.effWpm}
          display={isLinked(speeds) ? "linked" : `${speeds.effWpm} WPM`}
          onChange={(e) => {
            set("timing.speeds", withEffWpm(speeds, e));
          }}
          hint="Overall speed including the gaps. Drag to the right end to link it to character speed."
        />
        <Slider
          label="Extra word spacing"
          min={WORD_SPACING_MIN}
          max={WORD_SPACING_MAX}
          step={0.1}
          value={v["timing.wordSpacing"]}
          display={`×${v["timing.wordSpacing"].toFixed(1)}`}
          onChange={(w) => {
            set("timing.wordSpacing", Math.round(w * 10) / 10);
          }}
          hint="Stretches the gap between words only."
        />
      </div>
    </Section>
  );
}

function AudioSection() {
  const v = useSettings((s) => s.values);
  const set = useSettings((s) => s.set);
  const [latency, setLatency] = useState<LatencyReport | null>(null);
  const [latencyError, setLatencyError] = useState<string | null>(null);

  const test = async () => {
    try {
      await audioEngine.start();
      setLatency(audioEngine.latency());
      setLatencyError(null);
    } catch (err) {
      setLatencyError(errorText(err));
    }
  };

  return (
    <Section id="audio" title="Audio">
      <div className={styles.sliderGrid}>
        <Slider
          label="Tone"
          min={300}
          max={1200}
          step={10}
          value={v["audio.toneHz"]}
          display={`${v["audio.toneHz"]} Hz`}
          onChange={(hz) => {
            set("audio.toneHz", hz);
          }}
        />
        <Slider
          label="Volume"
          min={0}
          max={100}
          value={Math.round(v["audio.volume"] * 100)}
          display={pct(v["audio.volume"])}
          onChange={(p) => {
            set("audio.volume", p / 100);
          }}
        />
        <Slider
          label="Rise time"
          min={2}
          max={10}
          step={0.5}
          value={v["audio.riseMs"]}
          display={`${v["audio.riseMs"]} ms`}
          onChange={(ms) => {
            set("audio.riseMs", ms);
          }}
          hint="Softens each key-down and key-up so the tone doesn't click. 5 ms suits most speeds."
        />
      </div>
      <Row
        label="Audio latency"
        hint="Delay between the app and your ears. Under 40 ms feels instant when sending."
      >
        <div className={styles.inline}>
          {latency && (
            <span className={latency.totalMs > LATENCY_WARN_MS ? styles.warnPill : styles.okPill}>
              {Math.round(latency.totalMs)} ms
            </span>
          )}
          <Button size="sm" icon={Gauge} onClick={() => void test()}>
            Test latency
          </Button>
        </div>
      </Row>
      {latency && latency.totalMs > LATENCY_WARN_MS && (
        <p className={styles.callout}>
          Bluetooth audio adds delay. Use wired headphones for sending practice.
        </p>
      )}
      {latencyError && <p className={styles.errorText}>Audio couldn't start: {latencyError}</p>}
    </Section>
  );
}

function DisplaySection() {
  const v = useSettings((s) => s.values);
  const set = useSettings((s) => s.set);
  return (
    <Section id="display" title="Display">
      <Row label="Theme" hint="System follows Windows' light or dark setting.">
        <ThemeSwitch />
      </Row>
      <Row
        label="Show code"
        hint="Seeing dots and dashes while listening teaches counting, so the default is after you answer."
      >
        <Segmented<ShowCode>
          label="Show code"
          value={v["display.showCode"]}
          options={[
            { value: "never", label: "Never" },
            { value: "after", label: "After answer" },
            { value: "live", label: "Live" },
          ]}
          onChange={(x) => {
            set("display.showCode", x);
          }}
        />
      </Row>
      <Row label="Code format">
        <Segmented<CodeFormat>
          label="Code format"
          value={v["display.codeFormat"]}
          options={(Object.keys(CODE_FORMAT_LABELS) as CodeFormat[]).map((f) => ({
            value: f,
            label: CODE_FORMAT_LABELS[f],
          }))}
          onChange={(x) => {
            set("display.codeFormat", x);
          }}
        />
      </Row>
      <div className={styles.sliderGrid}>
        <Slider
          label="Font size"
          min={100}
          max={200}
          step={10}
          value={Math.round(v["display.fontScale"] * 100)}
          display={pct(v["display.fontScale"])}
          onChange={(p) => {
            set("display.fontScale", p / 100);
          }}
        />
      </div>
      <Row
        label="Reduce motion"
        hint="Turns off animations. Windows' own setting is always respected."
      >
        <Toggle
          pressed={v["display.reduceMotion"]}
          onChange={(on) => {
            set("display.reduceMotion", on);
          }}
        >
          {v["display.reduceMotion"] ? "On" : "Off"}
        </Toggle>
      </Row>
    </Section>
  );
}

function LearningSection() {
  const v = useSettings((s) => s.values);
  const set = useSettings((s) => s.set);
  return (
    <Section id="learning" title="Learning">
      <Row
        label="Koch order"
        hint="The order new characters are introduced. Progress is kept per order."
      >
        <Segmented
          label="Koch order"
          value={v["learning.kochOrder"]}
          options={KOCH_ORDERS.map((o) => ({ value: o.id, label: o.name }))}
          onChange={(x) => {
            set("learning.kochOrder", x);
          }}
        />
      </Row>
      <Row label="When you pass a level">
        <Segmented<Advancement>
          label="Advancement"
          value={v["learning.advancement"]}
          options={[
            { value: "prompt", label: "Ask first" },
            { value: "auto", label: "Advance automatically" },
          ]}
          onChange={(x) => {
            set("learning.advancement", x);
          }}
        />
      </Row>
      <Row label="Adaptive practice" hint="Characters you miss come up more often.">
        <Toggle
          pressed={v["learning.adaptive"]}
          onChange={(on) => {
            set("learning.adaptive", on);
          }}
        >
          {v["learning.adaptive"] ? "On" : "Off"}
        </Toggle>
      </Row>
      <div className={styles.sliderGrid}>
        <Slider
          label="Pass threshold"
          min={80}
          max={98}
          value={Math.round(v["learning.passThreshold"] * 100)}
          display={pct(v["learning.passThreshold"])}
          onChange={(p) => {
            set("learning.passThreshold", p / 100);
          }}
          hint="Lesson accuracy needed to add the next character."
        />
        <Slider
          label="Step-back floor"
          min={50}
          max={85}
          value={Math.round(v["learning.regressionFloor"] * 100)}
          display={pct(v["learning.regressionFloor"])}
          onChange={(p) => {
            set("learning.regressionFloor", p / 100);
          }}
          hint="Three lessons in a row below this suggests going back a level. It is never automatic."
        />
        <Slider
          label="Newest character weight"
          min={1}
          max={4}
          step={0.5}
          value={v["learning.newestWeight"]}
          display={`×${v["learning.newestWeight"].toFixed(1)}`}
          onChange={(w) => {
            set("learning.newestWeight", w);
          }}
          hint="How much more often the newest Koch character is sent."
        />
        <Slider
          label="Daily goal"
          min={5}
          max={60}
          step={5}
          value={v["learning.dailyGoalMin"]}
          display={`${v["learning.dailyGoalMin"]} min`}
          onChange={(m) => {
            set("learning.dailyGoalMin", m);
          }}
        />
      </div>
    </Section>
  );
}

function AboutSection() {
  const [cards, setCards] = useState(false);
  return (
    <Section id="about" title="About">
      <Row label="Morse Trainer" hint="Version 2.0.0 · Keep It Simple Analytics">
        <Button
          size="sm"
          icon={BookOpen}
          onClick={() => {
            setCards(true);
          }}
        >
          How to learn
        </Button>
      </Row>
      <p className={styles.small}>
        Bundled data (Koch orders) and its sources are listed in the app's data README. Licences for
        libraries and word lists are added with the release.
      </p>
      {cards && (
        <Dialog
          title="How to learn"
          wide
          onClose={() => {
            setCards(false);
          }}
          actions={
            <Button
              variant="primary"
              onClick={() => {
                setCards(false);
              }}
            >
              Got it
            </Button>
          }
        >
          <HowToLearnCards />
        </Dialog>
      )}
    </Section>
  );
}
