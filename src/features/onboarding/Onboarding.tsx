import { ArrowRight, Check } from "lucide-react";
import { useState } from "react";
import { createProfile, PROFILE_COLORS } from "../../app/session";
import { ColorPicker } from "../profiles/ProfileWidgets";
import { MorsePills } from "../../components/MorsePills";
import { Button, Field } from "../../components/ui";
import { errorText, useApp } from "../../state/app";
import { useNavStore } from "../../state/nav";
import { HOW_TO_LEARN } from "./how-to-learn";
import styles from "./Onboarding.module.css";

export function HowToLearnCards() {
  return (
    <ol className={styles.cards}>
      {HOW_TO_LEARN.map((c, i) => (
        <li key={c.title} className={styles.card} style={{ animationDelay: `${i * 70}ms` }}>
          <MorsePills
            pattern={c.pattern}
            size="md"
            unitMs={110}
            loop
            className={styles.cardPills}
          />
          <h3 className={styles.cardTitle}>{c.title}</h3>
          <p className={styles.cardBody}>{c.body}</p>
        </li>
      ))}
    </ol>
  );
}

type Step = "profile" | "learn" | "start";

/**
 * First run (SPEC §10.5): create a profile, read three short cards, then start at
 * Koch level 1, 20/15 WPM (the defaults a new profile already has).
 */
export function Onboarding() {
  const hasProfile = useApp((s) => s.current !== null);
  const [step, setStep] = useState<Step>(hasProfile ? "learn" : "profile");
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(PROFILE_COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finish = () => {
    useNavStore.getState().go("koch");
    useApp.setState({ onboarding: false });
  };

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a name for this profile.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      useApp.setState({ onboarding: true });
      await createProfile(trimmed, color);
      setStep("learn");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const steps: Step[] = ["profile", "learn", "start"];

  return (
    <div className={styles.screen}>
      <div className={styles.glow} aria-hidden="true" />
      <main className={styles.panel} aria-labelledby="onboarding-title">
        <ol className={styles.progress} aria-label="Steps">
          {steps.map((s, i) => (
            <li
              key={s}
              className={styles.dot}
              data-state={s === step ? "current" : steps.indexOf(step) > i ? "done" : "todo"}
              aria-current={s === step ? "step" : undefined}
            >
              <span className="visually-hidden">Step {i + 1}</span>
            </li>
          ))}
        </ol>

        {step === "profile" && (
          <form
            className={styles.step}
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <p className={styles.eyebrow}>Welcome to Morse Trainer</p>
            <h1 id="onboarding-title" className={styles.title}>
              Who's learning?
            </h1>
            <p className={styles.lead}>
              Each person on this computer gets a profile, so progress and settings stay separate.
            </p>
            <Field
              label="Name"
              value={name}
              maxLength={40}
              autoFocus
              autoComplete="off"
              placeholder="e.g. Sam or W1ABC"
              error={error}
              onChange={(e) => {
                setName(e.currentTarget.value);
              }}
            />
            <ColorPicker value={color} onChange={setColor} />
            <div className={styles.actions}>
              <Button type="submit" variant="primary" icon={ArrowRight} disabled={busy}>
                {busy ? "Creating…" : "Continue"}
              </Button>
            </div>
          </form>
        )}

        {step === "learn" && (
          <div className={styles.step}>
            <p className={styles.eyebrow}>How to learn</p>
            <h1 id="onboarding-title" className={styles.title}>
              Three habits that work
            </h1>
            <HowToLearnCards />
            <div className={styles.actions}>
              <Button
                variant="primary"
                icon={ArrowRight}
                onClick={() => {
                  setStep("start");
                }}
              >
                Next
              </Button>
            </div>
          </div>
        )}

        {step === "start" && (
          <div className={styles.step}>
            <p className={styles.eyebrow}>Recommended start</p>
            <h1 id="onboarding-title" className={styles.title}>
              Koch level 1: K and M
            </h1>
            <p className={styles.lead}>
              You'll start with two characters at 20 WPM, spaced out to 15 WPM. New characters are
              added one at a time as you pass each level. You can change the speed any time in
              Settings → Timing.
            </p>
            <div className={styles.startCard}>
              <MorsePills pattern="-.-" size="md" unitMs={60} loop />
              <MorsePills pattern="--" size="md" unitMs={60} loop />
              <span className={styles.startMeta}>20 / 15 WPM · 600 Hz</span>
            </div>
            <div className={styles.actions}>
              <Button variant="primary" icon={Check} onClick={finish} autoFocus>
                Start learning
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
