import { ArrowUpLeft } from "lucide-react";
import { useMemo, useState } from "react";
import { decodeMorseText } from "../../core/code-text";
import styles from "./ReverseDecode.module.css";

/** Paste Morse, get text (SPEC §7.8 reverse decode). */
export function ReverseDecode({ onUseText }: { onUseText: (text: string) => void }) {
  const [input, setInput] = useState(".... . .-.. .-.. --- / .-- --- .-. .-.. -..");
  const result = useMemo(() => decodeMorseText(input), [input]);

  return (
    <div className={styles.decode}>
      <label className={styles.inputWrap}>
        <span className={styles.label}>Morse</span>
        <textarea
          className={styles.input}
          value={input}
          spellCheck={false}
          placeholder="Paste dots and dashes: .... . .-.. .-.. --- / .-- --- .-. .-.. -.."
          onChange={(e) => {
            setInput(e.currentTarget.value);
          }}
        />
        <span className={styles.help}>
          Elements: <code>.</code> <code>-</code> <code>·</code> <code>–</code> <code>_</code>.
          Words: <code>/</code>, <code>|</code> or three spaces.
        </span>
      </label>

      <div className={styles.outputWrap}>
        <span className={styles.label}>Text</span>
        <output className={styles.output} aria-live="polite">
          {result.text || <span className={styles.placeholder}>Decoded text appears here.</span>}
        </output>
        {result.errors.length > 0 && (
          <ul className={styles.errors} aria-label="Decoding errors">
            {result.errors.map((e) => (
              <li key={e.index}>
                <code>{e.sequence}</code>{" "}
                {e.reason === "unknown-pattern"
                  ? "isn't a Morse character"
                  : "contains characters other than dots and dashes"}{" "}
                (position {e.index + 1})
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          className={styles.use}
          disabled={!result.text}
          onClick={() => {
            onUseText(result.text);
          }}
        >
          <ArrowUpLeft size={16} aria-hidden="true" /> Use as text
        </button>
      </div>
    </div>
  );
}
