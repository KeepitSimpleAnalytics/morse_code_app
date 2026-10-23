import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { Unsupported } from "../../core/tokenize";
import { PLAYER_MAX_CHARS, type SourceRange } from "./store";
import { overlaySegments } from "./text-model";
import styles from "./Editor.module.css";

interface EditorProps {
  text: string;
  onChange: (next: string) => void;
  active: SourceRange | null;
  unsupported: readonly Unsupported[];
  startOffset: number | null;
  hidden: boolean;
  /** Called with the caret offset when the user clicks or moves the caret. */
  onCaret: (offset: number) => void;
  /** Exposes the textarea so the prosign palette can insert at the caret. */
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}

export function Editor({
  text,
  onChange,
  active,
  unsupported,
  startOffset,
  hidden,
  onCaret,
  textareaRef,
  onKeyDown,
}: EditorProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLSpanElement>(null);

  const segments = useMemo(
    () => overlaySegments(text.length, active, unsupported, startOffset),
    [text.length, active, unsupported, startOffset],
  );

  const syncScroll = () => {
    const ta = textareaRef.current;
    const ov = overlayRef.current;
    if (ta && ov) ov.scrollTop = ta.scrollTop;
  };

  // Keep the character being heard in view (SPEC §7.8: the view auto-scrolls).
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    const mark = activeRef.current;
    if (!ta || !mark) return;
    const top = mark.offsetTop;
    const bottom = top + mark.offsetHeight;
    if (top < ta.scrollTop + 8 || bottom > ta.scrollTop + ta.clientHeight - 8) {
      ta.scrollTop = Math.max(0, top - ta.clientHeight / 3);
      syncScroll();
    }
  });

  useEffect(() => {
    const ta = textareaRef.current;
    const ov = overlayRef.current;
    if (ta && ov) ov.scrollTop = ta.scrollTop;
  }, [text, textareaRef]);

  const reportCaret = () => {
    const ta = textareaRef.current;
    if (ta && ta.selectionStart === ta.selectionEnd) onCaret(ta.selectionStart);
  };

  return (
    <div className={`${styles.editor} ${hidden ? styles.hidden : ""}`}>
      <textarea
        ref={textareaRef}
        className={styles.textarea}
        value={text}
        maxLength={PLAYER_MAX_CHARS}
        spellCheck={false}
        aria-label="Text to play as Morse"
        placeholder="Type or paste anything. It plays as Morse."
        onChange={(e) => {
          onChange(e.currentTarget.value);
        }}
        onScroll={syncScroll}
        onClick={reportCaret}
        onKeyUp={(e) => {
          if (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End") reportCaret();
        }}
        onKeyDown={onKeyDown}
      />
      <div ref={overlayRef} className={styles.overlay} aria-hidden="true">
        {segments.map((seg) => {
          const content = text.slice(seg.start, seg.end);
          const cls = [
            seg.active ? styles.active : "",
            seg.unsupported ? styles.unsupported : "",
            seg.startMark ? styles.startMark : "",
          ]
            .filter(Boolean)
            .join(" ");
          if (!cls) return <span key={seg.start}>{content}</span>;
          return (
            <span
              key={seg.start}
              ref={seg.active ? activeRef : undefined}
              className={cls}
              title={seg.unsupported ? "Not in Morse — skipped" : undefined}
              onMouseDown={
                seg.unsupported
                  ? (e) => {
                      // The overlay sits above the textarea; put the caret where the user clicked.
                      e.preventDefault();
                      const ta = textareaRef.current;
                      ta?.focus();
                      ta?.setSelectionRange(seg.start, seg.start);
                      onCaret(seg.start);
                    }
                  : undefined
              }
            >
              {content}
            </span>
          );
        })}
        {/* A trailing newline needs a character after it to take up a line. */}
        {"​"}
      </div>
    </div>
  );
}
