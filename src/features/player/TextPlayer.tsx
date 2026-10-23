import {
  Copy,
  Download,
  Eye,
  EyeOff,
  Gauge,
  Pause,
  Play,
  Radio,
  Repeat,
  Square,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { audioEngine, LATENCY_WARN_MS, type LatencyReport } from "../../audio/engine";
import { hasPrimaryModifier, PRIMARY_MODIFIER_LABEL } from "../../app/shortcuts";
import { Segmented, Slider, Toggle } from "../../components/controls";
import { PROSIGN_SYMBOLS } from "../../core/alphabet";
import { codeText, CODE_FORMAT_LABELS, type CodeFormat } from "../../core/code-text";
import {
  actualWpm,
  CHAR_WPM_MAX,
  CHAR_WPM_MIN,
  EFF_WPM_MIN,
  isLinked,
  withCharWpm,
  withEffWpm,
} from "../../core/speed";
import { tokenize } from "../../core/tokenize";
import { CodeView } from "./CodeView";
import * as player from "./controller";
import { Editor } from "./Editor";
import { saveWav } from "./export";
import { ReverseDecode } from "./ReverseDecode";
import { SnippetsButton } from "./Snippets";
import { PLAYER_MAX_CHARS, usePlayerStore } from "./store";
import { tokenIndexAtOffset, tokenIndexBySourceStart } from "./text-model";
import styles from "./TextPlayer.module.css";

const PALETTE = ["<AR>", "<SK>", "<BT>", "<KN>", "<AS>", "<BK>", "<CL>", "<SOS>", "<HH>"].filter(
  (p) => PROSIGN_SYMBOLS.includes(p),
);

type Mode = "encode" | "decode";

function isEditable(el: Element | null): boolean {
  if (!el) return false;
  return (
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLInputElement ||
    el instanceof HTMLButtonElement ||
    el instanceof HTMLSelectElement ||
    (el instanceof HTMLElement && el.isContentEditable)
  );
}

export function TextPlayer() {
  const s = usePlayerStore();
  const [mode, setMode] = useState<Mode>("encode");
  const [latency, setLatency] = useState<LatencyReport | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { tokens, unsupported } = useMemo(() => tokenize(s.text), [s.text]);
  const activeIndex = s.active ? tokenIndexBySourceStart(tokens, s.active.start) : null;
  const startIndex = s.startOffset === null ? null : tokenIndexAtOffset(tokens, s.startOffset);
  const charCount = tokens.filter((t) => t.type === "char").length;

  // Stop when leaving the screen.
  useEffect(
    () => () => {
      player.stop();
    },
    [],
  );

  // Keyboard: Ctrl/Cmd+Enter play/pause anywhere here, Space when not typing, Esc stop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && hasPrimaryModifier(e) && !e.shiftKey) {
        e.preventDefault();
        if (!usePlayerStore.getState().liveMode) player.togglePlayPause();
      } else if (e.code === "Space" && !e.repeat && !isEditable(document.activeElement)) {
        e.preventDefault();
        if (!usePlayerStore.getState().liveMode) player.togglePlayPause();
      } else if (e.key === "Escape") {
        player.stop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const setText = (next: string) => {
    const prev = usePlayerStore.getState().text;
    s.set({ text: next });
    player.onLiveEdit(prev, next);
  };

  const insertAtCaret = (insert: string) => {
    const ta = textareaRef.current;
    const text = usePlayerStore.getState().text;
    const at = ta ? ta.selectionStart : text.length;
    const end = ta ? ta.selectionEnd : text.length;
    const next = (text.slice(0, at) + insert + text.slice(end)).slice(0, PLAYER_MAX_CHARS);
    setText(next);
    requestAnimationFrame(() => {
      ta?.focus();
      ta?.setSelectionRange(at + insert.length, at + insert.length);
    });
  };

  const exportWav = async () => {
    try {
      const bytes = await player.renderWav();
      const result = await saveWav(s.text, bytes);
      if (result.kind === "saved") s.set({ notice: `Saved ${result.path}`, error: null });
    } catch (err) {
      s.set({ error: `Export failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(codeText(tokens, s.codeFormat, s.wordSep));
      s.set({ notice: "Code copied to the clipboard", error: null });
    } catch (err) {
      s.set({ error: `Copy failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  };

  const checkLatency = async () => {
    try {
      await audioEngine.start();
      setLatency(audioEngine.latency());
    } catch (err) {
      s.set({ error: `Audio check failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  };

  const playing = s.status === "playing";
  const startLabel =
    startIndex === null || startIndex === 0
      ? "From the start"
      : `From “${s.text
          .slice(s.startOffset ?? 0, (s.startOffset ?? 0) + 14)
          .replace(/\s+/g, " ")
          .trim()}…”`;

  return (
    <div className={styles.player}>
      <header className={styles.head}>
        <div>
          <p className={styles.eyebrow}>Tools</p>
          <h1 className={styles.title}>Text Player</h1>
        </div>
        <div className={styles.headRight}>
          {mode === "encode" && (
            <SnippetsButton
              text={s.text}
              onLoad={(body) => {
                player.stop();
                setText(body.slice(0, PLAYER_MAX_CHARS));
              }}
            />
          )}
          <Segmented<Mode>
            label="Direction"
            value={mode}
            onChange={(m) => {
              if (m === "decode") player.stop();
              setMode(m);
            }}
            options={[
              { value: "encode", label: "Text → Morse" },
              { value: "decode", label: "Morse → Text" },
            ]}
          />
        </div>
      </header>

      {mode === "decode" ? (
        <section className={`${styles.card} ${styles.decodeCard}`}>
          <ReverseDecode
            onUseText={(text) => {
              setText(text.slice(0, PLAYER_MAX_CHARS));
              setMode("encode");
            }}
          />
        </section>
      ) : (
        <div className={styles.panes}>
          <section className={`${styles.card} ${styles.editorCard}`} aria-label="Text">
            <div className={styles.cardBar}>
              <div className={styles.palette} role="group" aria-label="Insert prosign">
                {PALETTE.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={styles.chip}
                    title={`Insert ${p}`}
                    onClick={() => {
                      insertAtCaret(p);
                    }}
                  >
                    {p.slice(1, -1)}
                  </button>
                ))}
              </div>
              <div className={styles.barRight}>
                <Toggle
                  pressed={s.liveMode}
                  onChange={(on) => void player.setLiveMode(on)}
                  title="Type-to-transmit: each character plays as you type it"
                >
                  <Radio size={15} aria-hidden="true" /> Live
                </Toggle>
                <Toggle
                  pressed={s.hideText}
                  onChange={(hideText) => {
                    s.set({ hideText });
                  }}
                  title="Blur the text to quiz yourself"
                >
                  {s.hideText ? (
                    <EyeOff size={15} aria-hidden="true" />
                  ) : (
                    <Eye size={15} aria-hidden="true" />
                  )}{" "}
                  Hide text
                </Toggle>
              </div>
            </div>
            <div className={styles.editorBody}>
              <Editor
                text={s.text}
                onChange={setText}
                active={s.active}
                unsupported={unsupported}
                startOffset={s.startOffset}
                hidden={s.hideText}
                textareaRef={textareaRef}
                onCaret={(offset) => {
                  if (!s.liveMode) player.setStartOffset(offset);
                }}
              />
            </div>
          </section>

          <section className={`${styles.card} ${styles.codeCard}`} aria-label="Code">
            <div className={styles.cardBar}>
              <span className={styles.cardLabel}>Code</span>
              <div className={styles.barRight}>
                <Segmented<CodeFormat>
                  label="Code format"
                  value={s.codeFormat}
                  onChange={(codeFormat) => {
                    s.set({ codeFormat });
                  }}
                  options={(Object.keys(CODE_FORMAT_LABELS) as CodeFormat[]).map((f) => ({
                    value: f,
                    label: CODE_FORMAT_LABELS[f],
                  }))}
                />
                <Toggle
                  pressed={s.wordSep === "slash"}
                  onChange={(on) => {
                    s.set({ wordSep: on ? "slash" : "space" });
                  }}
                  title="Show / between words"
                >
                  / words
                </Toggle>
                <button
                  type="button"
                  className={styles.iconButton}
                  onClick={() => void copyCode()}
                  title="Copy code"
                >
                  <Copy size={16} aria-hidden="true" />
                  <span className="visually-hidden">Copy code</span>
                </button>
              </div>
            </div>
            <div className={styles.codeBody}>
              <CodeView
                tokens={tokens}
                format={s.codeFormat}
                wordSep={s.wordSep}
                activeIndex={activeIndex}
                startIndex={startIndex}
                onPick={(i) => {
                  const t = tokens[i];
                  if (t && !s.liveMode) player.setStartOffset(t.sourceStart);
                }}
              />
            </div>
          </section>
        </div>
      )}

      <footer className={styles.transport} aria-label="Transport">
        <div className={styles.buttons}>
          <button
            type="button"
            className={styles.playButton}
            disabled={s.liveMode || mode === "decode"}
            onClick={player.togglePlayPause}
            aria-label={playing ? "Pause" : s.status === "paused" ? "Resume" : "Play"}
            title={`${playing ? "Pause" : "Play"} (${PRIMARY_MODIFIER_LABEL}+Enter, or Space)`}
          >
            {playing ? (
              <Pause size={22} fill="currentColor" />
            ) : (
              <Play size={22} fill="currentColor" />
            )}
          </button>
          <button
            type="button"
            className={styles.roundButton}
            onClick={player.stop}
            aria-label="Stop"
            title="Stop (Esc)"
          >
            <Square size={16} fill="currentColor" />
          </button>
          <Toggle
            pressed={s.loop}
            onChange={(loop) => {
              s.set({ loop });
            }}
            title="Loop"
          >
            <Repeat size={15} aria-hidden="true" /> Loop
          </Toggle>
          {startIndex !== null && startIndex > 0 && (
            <span className={styles.fromChip}>
              {startLabel}
              <button
                type="button"
                aria-label="Play from the start"
                title="Play from the start"
                onClick={() => {
                  player.setStartOffset(null);
                }}
              >
                <X size={13} />
              </button>
            </span>
          )}
        </div>

        <div className={styles.sliders}>
          <Slider
            label="Speed"
            min={CHAR_WPM_MIN}
            max={CHAR_WPM_MAX}
            value={s.speeds.charWpm}
            display={`${s.speeds.charWpm} WPM`}
            onChange={(v) => {
              s.set({ speeds: withCharWpm(s.speeds, v) });
            }}
            hint="Character speed"
          />
          <Slider
            label="Effective"
            min={EFF_WPM_MIN}
            max={s.speeds.charWpm}
            value={s.speeds.effWpm}
            display={isLinked(s.speeds) ? "linked" : `${s.speeds.effWpm} WPM`}
            onChange={(v) => {
              s.set({ speeds: withEffWpm(s.speeds, v) });
            }}
            hint={`Farnsworth spacing. Actual speed: ${actualWpm(s.speeds)} WPM. Drag to the right end to link.`}
          />
          <Slider
            label="Tone"
            min={300}
            max={1200}
            step={10}
            value={s.toneHz}
            display={`${s.toneHz} Hz`}
            onChange={(toneHz) => {
              s.set({ toneHz });
              audioEngine.setFrequency(toneHz);
            }}
          />
          <Slider
            label="Volume"
            min={0}
            max={100}
            value={Math.round(s.volume * 100)}
            display={`${Math.round(s.volume * 100)}%`}
            onChange={(v) => {
              s.set({ volume: v / 100 });
              audioEngine.setVolume(v / 100);
            }}
          />
        </div>

        <button
          type="button"
          className={styles.exportButton}
          onClick={() => void exportWav()}
          disabled={charCount === 0}
        >
          <Download size={16} aria-hidden="true" /> Export WAV
        </button>
      </footer>

      <div className={styles.status} role="status" aria-live="polite">
        <span>
          {s.text.length.toLocaleString()} / {PLAYER_MAX_CHARS.toLocaleString()} characters
        </span>
        {unsupported.length > 0 && (
          <span
            className={styles.warn}
            title={[...new Set(unsupported.map((u) => u.char))].join(" ")}
          >
            {unsupported.length} not in Morse, skipped
          </span>
        )}
        {s.liveMode && <span className={styles.live}>Live · {s.liveQueued} queued</span>}
        <button type="button" className={styles.linkButton} onClick={() => void checkLatency()}>
          <Gauge size={14} aria-hidden="true" />
          {latency ? `Audio latency ${Math.round(latency.totalMs)} ms` : "Check audio latency"}
        </button>
        {latency && latency.totalMs > LATENCY_WARN_MS && (
          <span
            className={styles.warn}
            title={`Output latency is over ${LATENCY_WARN_MS} ms. Bluetooth, HDMI monitor speakers and some USB devices add delay. Wired headphones on the computer's own audio output are usually fastest, which matters most for sending practice.`}
          >
            Over {LATENCY_WARN_MS} ms: wired headphones are faster
          </span>
        )}
        {(s.error ?? s.notice) && (
          <span className={s.error ? styles.error : styles.notice}>
            {s.error ?? s.notice}
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => {
                s.set({ error: null, notice: null });
              }}
            >
              <X size={13} />
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
