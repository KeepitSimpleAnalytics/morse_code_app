import type { ReactNode } from "react";
import styles from "./controls.module.css";

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Shown next to the label, e.g. "20 WPM". */
  display: string;
  onChange: (value: number) => void;
  hint?: string;
}

export function Slider({ label, value, min, max, step = 1, display, onChange, hint }: SliderProps) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className={styles.slider} title={hint}>
      <span className={styles.sliderHead}>
        <span className={styles.sliderLabel}>{label}</span>
        <span className={styles.sliderValue}>{display}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={display}
        style={{ "--fill": `${pct}%` } as React.CSSProperties}
        onChange={(e) => {
          onChange(Number(e.currentTarget.value));
        }}
      />
    </label>
  );
}

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: readonly { value: T; label: ReactNode; title?: string }[];
  onChange: (value: T) => void;
}

/** A single-choice segmented control (ARIA radio group, arrow keys move). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentedProps<T>) {
  const move = (step: number) => {
    const i = options.findIndex((o) => o.value === value);
    const next = options[(i + step + options.length) % options.length];
    if (next) onChange(next.value);
  };
  return (
    <div
      className={styles.segmented}
      role="radiogroup"
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault();
          move(e.key === "ArrowRight" ? 1 : -1);
          requestAnimationFrame(() => {
            e.currentTarget.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
          });
        }
      }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          title={o.title}
          className={styles.segment}
          onClick={() => {
            onChange(o.value);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

interface ToggleProps {
  pressed: boolean;
  onChange: (pressed: boolean) => void;
  children: ReactNode;
  title?: string;
  disabled?: boolean;
}

export function Toggle({ pressed, onChange, children, title, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      className={styles.toggle}
      aria-pressed={pressed}
      title={title}
      disabled={disabled}
      onClick={() => {
        onChange(!pressed);
      }}
    >
      {children}
    </button>
  );
}
