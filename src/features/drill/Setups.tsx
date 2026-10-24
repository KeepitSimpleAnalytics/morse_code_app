import { Play } from "lucide-react";
import type { ReactNode } from "react";
import { PRIMARY_MODIFIER_LABEL } from "../../app/shortcuts";
import { Segmented, Slider, Toggle } from "../../components/controls";
import { Button, Field } from "../../components/ui";
import { PREFIXES, WORD_LISTS, wordList, type WordListId } from "../../core/bundled";
import { charsetFromClasses, MIN_CHARSET, parseCustomCharset } from "../../core/charset";
import { chunkText, WORDS_PER_ITEM_MAX, WORDS_PER_ITEM_MIN } from "../../core/chunk";
import { DRILL_ITEMS_MAX, DRILL_ITEMS_MIN } from "../../core/drill";
import {
  CALLSIGN_FORMATS,
  eligiblePrefixes,
  type CallsignFormat,
} from "../../core/generators/callsigns";
import { GROUP_LENGTH_MAX, GROUP_LENGTH_MIN } from "../../core/generators/groups";
import { wordsUsing } from "../../core/generators/words";
import { useSettings } from "../../state/settings";
import {
  CUSTOM_CHARSET_MAX,
  CUSTOM_TEXT_MAX,
  type ChunkKind,
  type GroupSource,
  type SettingKey,
  type SettingsValues,
  type Weighting,
} from "../../state/settings-schema";
import ui from "../copy/copy.module.css";
import { useLearnedChars } from "../copy/useLearnedChars";
import * as drill from "./controller";
import { drillStores, type DrillMode } from "./store";
import styles from "./drill.module.css";

/** The setup card of each per-item mode: its options, a preview, and Start. */

type ItemsKey = "groups.items" | "words.items" | "callsigns.items";

function SetupCard({
  mode,
  children,
  itemsKey,
  canStart,
  blocked,
}: {
  mode: DrillMode;
  children: ReactNode;
  /** The item-count setting; Custom plays every chunk instead. */
  itemsKey?: ItemsKey;
  canStart: boolean;
  /** Why Start is disabled. */
  blocked: string | null;
}) {
  const v = useSettings((s) => s.values);
  const set = useSettings((s) => s.set);
  return (
    <section className={ui.card} aria-labelledby={`${mode}-setup`}>
      <h2 id={`${mode}-setup`} className={ui.cardTitle}>
        Setup
      </h2>
      <div className={ui.setupGrid}>{children}</div>
      {itemsKey && (
        <div className={ui.setupItem}>
          <Slider
            label="Items per session"
            min={DRILL_ITEMS_MIN}
            max={DRILL_ITEMS_MAX}
            value={v[itemsKey]}
            display={String(v[itemsKey])}
            onChange={(n) => {
              set(itemsKey, n);
            }}
          />
        </div>
      )}
      <div className={ui.startRow}>
        <Button
          variant="primary"
          icon={Play}
          disabled={!canStart}
          onClick={() => void drill.start(mode)}
        >
          Start
        </Button>
        {blocked ? (
          <span className={styles.warn}>{blocked}</span>
        ) : (
          <span className={ui.muted}>
            <kbd>{PRIMARY_MODIFIER_LABEL}</kbd>+<kbd>Enter</kbd> to start. Type each item, then{" "}
            <kbd>Enter</kbd>. Speed and tone are in the chip at the top.
          </span>
        )}
      </div>
    </section>
  );
}

type BoolKey = {
  [K in SettingKey]: SettingsValues[K] extends boolean ? K : never;
}[SettingKey];

function BoolToggle({ k, children }: { k: BoolKey; children: ReactNode }) {
  const value = useSettings((s) => s.values[k]);
  const set = useSettings((s) => s.set);
  return (
    <Toggle
      pressed={value}
      onChange={(p) => {
        set(k, p);
      }}
    >
      {children}
    </Toggle>
  );
}

/* Random Groups ----------------------------------------------------------- */

export function GroupsSetup() {
  const v = useSettings((s) => s.values);
  const set = useSettings((s) => s.set);
  const override = drillStores.groups((s) => s.override);
  const learned = useLearnedChars();

  const custom = parseCustomCharset(v["groups.custom"]);
  const chars: readonly string[] | null =
    override ??
    (v["groups.source"] === "classes"
      ? charsetFromClasses({
          letters: v["groups.letters"],
          digits: v["groups.digits"],
          punct: v["groups.punct"],
          prosigns: v["groups.prosigns"],
        })
      : v["groups.source"] === "custom"
        ? custom.chars
        : learned.chars);
  const enough = chars !== null && chars.length >= MIN_CHARSET;

  return (
    <SetupCard
      mode="groups"
      itemsKey="groups.items"
      canStart={enough}
      blocked={
        !override && v["groups.source"] === "koch" && learned.error
          ? `Couldn't load your Koch level: ${learned.error}`
          : chars !== null && !enough
            ? "Choose at least two characters."
            : null
      }
    >
      <div className={ui.setupItem}>
        <span className={ui.label}>Characters</span>
        {override ? (
          <div className={styles.override}>
            <span>
              Practising <strong className={styles.preview}>{override.join(" ")}</strong>
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                drill.setOverride(null);
              }}
            >
              Use my character set
            </Button>
          </div>
        ) : (
          <>
            <Segmented<GroupSource>
              label="Character source"
              value={v["groups.source"]}
              options={[
                { value: "classes", label: "Sets" },
                { value: "custom", label: "Custom" },
                { value: "koch", label: "Koch learned" },
              ]}
              onChange={(x) => {
                set("groups.source", x);
              }}
            />
            {v["groups.source"] === "classes" && (
              <div className={styles.toggles}>
                <BoolToggle k="groups.letters">Letters</BoolToggle>
                <BoolToggle k="groups.digits">Digits</BoolToggle>
                <BoolToggle k="groups.punct">Punctuation</BoolToggle>
                <BoolToggle k="groups.prosigns">Prosigns</BoolToggle>
              </div>
            )}
            {v["groups.source"] === "custom" && (
              <Field
                label="Your characters"
                value={v["groups.custom"]}
                maxLength={CUSTOM_CHARSET_MAX}
                spellCheck={false}
                autoComplete="off"
                placeholder="e.g. KMRS<AR>"
                onChange={(e) => {
                  set("groups.custom", e.currentTarget.value);
                }}
                error={
                  custom.unsupported.length > 0
                    ? `No Morse code for: ${custom.unsupported.join(" ")}`
                    : null
                }
                hint="Prosigns as <AR>, <SK>…"
              />
            )}
            {chars !== null && chars.length > 0 && (
              <p className={`${ui.muted} ${styles.preview}`} aria-live="polite">
                {chars.join(" ")}
              </p>
            )}
          </>
        )}
      </div>
      <div className={ui.setupItem}>
        <Slider
          label="Group length"
          min={GROUP_LENGTH_MIN}
          max={GROUP_LENGTH_MAX}
          value={v["groups.length"]}
          display={`${v["groups.length"]} characters`}
          onChange={(n) => {
            set("groups.length", n);
          }}
        />
        <span className={ui.label}>Weighting</span>
        <Segmented<Weighting>
          label="Weighting"
          value={v["groups.weighting"]}
          options={[
            { value: "adaptive", label: "Adaptive", title: "Weak characters come up more often" },
            { value: "uniform", label: "Uniform" },
          ]}
          onChange={(x) => {
            set("groups.weighting", x);
          }}
        />
      </div>
    </SetupCard>
  );
}

/* Words ------------------------------------------------------------------- */

export function WordsSetup() {
  const v = useSettings((s) => s.values);
  const set = useSettings((s) => s.set);
  const learned = useLearnedChars();
  const list = wordList(v["words.list"]);
  const learnedOnly = v["words.learnedOnly"];
  const available = !learnedOnly
    ? list.items.length
    : learned.chars
      ? wordsUsing(list.items, learned.chars).length
      : null;

  return (
    <SetupCard
      mode="words"
      itemsKey="words.items"
      canStart={available !== null && available > 0}
      blocked={
        learnedOnly && learned.error
          ? `Couldn't load your Koch level: ${learned.error}`
          : available === 0
            ? "No words in this list use only your learned characters yet."
            : null
      }
    >
      <div className={ui.setupItem}>
        <span className={ui.label}>List</span>
        <Segmented<WordListId>
          label="Word list"
          value={v["words.list"]}
          options={WORD_LISTS.map((l) => ({ value: l.id, label: l.name }))}
          onChange={(x) => {
            set("words.list", x);
          }}
        />
        <p className={ui.muted} aria-live="polite">
          {available === null
            ? "Counting words…"
            : `${available} of ${list.items.length} words available`}
          {list.items.some((w) => w.meaning) ? " · meanings shown after each answer" : ""}
        </p>
      </div>
      <div className={ui.setupItem}>
        <span className={ui.label}>Filter</span>
        <div className={styles.toggles}>
          <BoolToggle k="words.learnedOnly">Only learned Koch characters</BoolToggle>
        </div>
      </div>
    </SetupCard>
  );
}

/* Callsigns --------------------------------------------------------------- */

const FORMAT_LABEL = (f: CallsignFormat) => f.replace("x", "×");

export function CallsignsSetup() {
  const v = useSettings((s) => s.values);
  const set = useSettings((s) => s.set);
  const formats = v["callsigns.formats"];
  const prefixes = eligiblePrefixes(PREFIXES, formats, v["callsigns.usOnly"]).length;

  return (
    <SetupCard
      mode="callsigns"
      itemsKey="callsigns.items"
      canStart={prefixes > 0}
      blocked={prefixes === 0 ? "No prefixes fit these formats." : null}
    >
      <div className={ui.setupItem}>
        <span className={ui.label}>Formats (prefix × suffix)</span>
        <div className={styles.toggles}>
          {CALLSIGN_FORMATS.map((f) => {
            const on = formats.includes(f);
            return (
              <Toggle
                key={f}
                pressed={on}
                disabled={on && formats.length === 1}
                title={on && formats.length === 1 ? "Keep at least one format" : undefined}
                onChange={(p) => {
                  set(
                    "callsigns.formats",
                    CALLSIGN_FORMATS.filter((x) => (x === f ? p : formats.includes(x))),
                  );
                }}
              >
                {FORMAT_LABEL(f)}
              </Toggle>
            );
          })}
        </div>
        <p className={ui.muted}>
          2×3 is a call like DL1ABC: a two-character prefix, a digit, three letters.
        </p>
      </div>
      <div className={ui.setupItem}>
        <span className={ui.label}>Region</span>
        <div className={styles.toggles}>
          <BoolToggle k="callsigns.usOnly">US only</BoolToggle>
        </div>
        <p className={ui.muted} aria-live="polite">
          {prefixes} prefixes
        </p>
      </div>
    </SetupCard>
  );
}

/* Custom Practice --------------------------------------------------------- */

export function CustomSetup() {
  const v = useSettings((s) => s.values);
  const set = useSettings((s) => s.set);
  const split =
    v["custom.split"] === "line"
      ? ({ kind: "line" } as const)
      : ({ kind: "words", perItem: v["custom.wordsPerItem"] } as const);
  const { items, unsupported } = chunkText(v["custom.text"], split);

  return (
    <SetupCard
      mode="custom"
      canStart={items.length > 0}
      blocked={items.length === 0 ? "Paste some text to practise." : null}
    >
      <div className={ui.setupItem}>
        <label className={ui.label} htmlFor="custom-text">
          Your text
        </label>
        <textarea
          id="custom-text"
          className={styles.customText}
          value={v["custom.text"]}
          maxLength={CUSTOM_TEXT_MAX}
          spellCheck={false}
          placeholder="Paste or type anything: a QSO, a news story, call signs…"
          onChange={(e) => {
            set("custom.text", e.currentTarget.value);
          }}
        />
        <p className={ui.muted} aria-live="polite">
          {items.length} {items.length === 1 ? "item" : "items"}, played in order ·{" "}
          {v["custom.text"].length.toLocaleString()} / {CUSTOM_TEXT_MAX.toLocaleString()} characters
        </p>
        {v["custom.text"].length >= CUSTOM_TEXT_MAX && (
          <p className={styles.warn}>That's the limit: anything pasted past it wasn't added.</p>
        )}
        {unsupported.length > 0 && (
          <p className={styles.warn}>Left out (no Morse code): {unsupported.join(" ")}</p>
        )}
      </div>
      <div className={ui.setupItem}>
        <span className={ui.label}>Split</span>
        <Segmented<ChunkKind>
          label="Split the text"
          value={v["custom.split"]}
          options={[
            { value: "line", label: "By line" },
            { value: "words", label: "Every N words" },
          ]}
          onChange={(x) => {
            set("custom.split", x);
          }}
        />
        {v["custom.split"] === "words" && (
          <Slider
            label="Words per item"
            min={WORDS_PER_ITEM_MIN}
            max={WORDS_PER_ITEM_MAX}
            value={v["custom.wordsPerItem"]}
            display={String(v["custom.wordsPerItem"])}
            onChange={(n) => {
              set("custom.wordsPerItem", n);
            }}
          />
        )}
      </div>
    </SetupCard>
  );
}
