import { memo, useEffect, useRef } from "react";
import { tokenCode, type CodeFormat, type WordSeparator } from "../../core/code-text";
import type { Token } from "../../core/tokenize";
import styles from "./CodeView.module.css";

interface CodeViewProps {
  tokens: readonly Token[];
  format: CodeFormat;
  wordSep: WordSeparator;
  /** Index of the token being heard. */
  activeIndex: number | null;
  /** Index of the play-from token. */
  startIndex: number | null;
  onPick: (tokenIndex: number) => void;
}

/** Morse rendering kept in sync with the text (SPEC §7.8). Click a character to play from it. */
export function CodeView({
  tokens,
  format,
  wordSep,
  activeIndex,
  startIndex,
  onPick,
}: CodeViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  // Highlighting toggles classes directly so 20 000 spans don't re-render per character.
  useMarker(rootRef, activeIndex, styles.active as string, true);
  useMarker(rootRef, startIndex, styles.start as string, false);

  return (
    <div
      ref={rootRef}
      className={`${styles.code} ${format === "phonetic" ? styles.phonetic : ""}`}
      onClick={(e) => {
        const target = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
        if (target?.dataset.i) onPick(Number(target.dataset.i));
      }}
    >
      <CodeTokens tokens={tokens} format={format} wordSep={wordSep} />
    </div>
  );
}

const CodeTokens = memo(function CodeTokens({
  tokens,
  format,
  wordSep,
}: {
  tokens: readonly Token[];
  format: CodeFormat;
  wordSep: WordSeparator;
}) {
  if (tokens.length === 0) {
    return <span className={styles.empty}>The code appears here as you type.</span>;
  }
  return (
    <>
      {tokens.map((t, i) =>
        t.type === "gap" ? (
          <span key={i} data-i={i} className={styles.gap}>
            {wordSep === "slash" ? "/" : " "}
          </span>
        ) : (
          <span
            key={i}
            data-i={i}
            className={styles.char}
            title={`${t.symbol.symbol}  ${t.symbol.phonetic}`}
          >
            {tokenCode(t, format, wordSep)}
          </span>
        ),
      )}
    </>
  );
});

function useMarker(
  rootRef: React.RefObject<HTMLDivElement>,
  index: number | null,
  className: string,
  scroll: boolean,
): void {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || index === null) return;
    const el = root.querySelector<HTMLElement>(`[data-i="${index}"]`);
    if (!el) return;
    el.classList.add(className);
    if (scroll) el.scrollIntoView({ block: "nearest", inline: "nearest" });
    return () => {
      el.classList.remove(className);
    };
  });
}
